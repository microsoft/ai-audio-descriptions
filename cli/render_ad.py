from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Sequence

from dotenv import load_dotenv

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.ad import ADError, DEFAULT_VOICE, render_ad
from engine.speech import AzureSpeech


ROOT = Path(__file__).resolve().parents[1]


def _configured_value(name: str, *aliases: str) -> str | None:
    for candidate in (name, *aliases):
        value = os.environ.get(candidate)
        if value and value.strip():
            return value.strip()
    return None


def _configuration() -> dict[str, str]:
    load_dotenv(ROOT / ".env")
    values = {
        "FOUNDRY_RESOURCE": _configured_value(
            "FOUNDRY_RESOURCE", "AIAD_FOUNDRY_RESOURCE"
        ),
        "FOUNDRY_RESOURCE_ID": _configured_value(
            "FOUNDRY_RESOURCE_ID",
            "AIAD_FOUNDRY_RESOURCE_ID",
            "AIAD_SPEECH_RESOURCE_ID",
        ),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ADError(
            "Missing configuration: "
            + ", ".join(missing)
            + ". Set the environment variables and retry.",
            2,
        )
    return {name: value for name, value in values.items() if value is not None}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render an audio-described MP4 from an MP4 and WebVTT file."
    )
    parser.add_argument("source", help="source MP4")
    parser.add_argument("vtt", help="audio-description WebVTT")
    parser.add_argument(
        "output",
        nargs="?",
        help="output MP4 (default: source filename with .ad.mp4)",
    )
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"Azure neural voice (default: {DEFAULT_VOICE})",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="show processing progress"
    )
    return parser


def _progress(stage: str, current: int, total: int) -> None:
    logging.debug("%s %d/%d", stage, current, total)


def process(args: argparse.Namespace) -> int:
    config = _configuration()
    resource = config["FOUNDRY_RESOURCE"]
    source = Path(args.source).expanduser()
    output = (
        Path(args.output).expanduser()
        if args.output
        else source.with_name(source.stem + ".ad.mp4")
    )

    try:
        from azure.identity import DefaultAzureCredential
    except ImportError as exc:
        raise ADError(
            "Install the dependencies in requirements.txt.", 2
        ) from exc

    credential = DefaultAzureCredential()
    speech = AzureSpeech(
        credential,
        f"https://{resource}.cognitiveservices.azure.com/",
        config["FOUNDRY_RESOURCE_ID"],
    )
    result = render_ad(
        source,
        Path(args.vtt).expanduser(),
        output,
        speech=speech,
        voice=args.voice,
        progress=_progress if args.verbose else None,
    )
    adjusted = sum(cue.adjusted for cue in result.cues)
    logging.info(
        "Rendered %d cue(s); %d adjusted.", len(result.cues), adjusted
    )
    print(result.output_video)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    try:
        return process(args)
    except ADError as exc:
        logging.error("%s", exc)
        return exc.code
    except Exception as exc:
        logging.error("%s", exc)
        return 1
    except KeyboardInterrupt:
        logging.error("Interrupted.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

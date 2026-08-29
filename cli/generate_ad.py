from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.ad import ADError, generate_ad
from engine.speech import AzureSpeech


OPENAI_API_VERSION = "2025-04-01-preview"
COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default"


def _configured_value(name: str, *aliases: str) -> str | None:
    for candidate in (name, *aliases):
        value = os.environ.get(candidate)
        if value and value.strip():
            return value.strip()
    return None


def _configuration() -> dict[str, str]:
    values = {
        "FOUNDRY_RESOURCE": _configured_value(
            "FOUNDRY_RESOURCE", "AIAD_FOUNDRY_RESOURCE"
        ),
        "FOUNDRY_RESOURCE_ID": _configured_value(
            "FOUNDRY_RESOURCE_ID",
            "AIAD_FOUNDRY_RESOURCE_ID",
            "AIAD_SPEECH_RESOURCE_ID",
        ),
        "GPT_DEPLOYMENT": _configured_value(
            "GPT_DEPLOYMENT", "AIAD_OPENAI_DEPLOYMENT"
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
        description="Generate an audio-description WebVTT file from an MP4."
    )
    parser.add_argument("source", help="source MP4")
    parser.add_argument(
        "output",
        nargs="?",
        help="output VTT (default: source filename with .vtt)",
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
        else source.with_suffix(".vtt")
    )

    try:
        from azure.identity import (
            DefaultAzureCredential,
            get_bearer_token_provider,
        )
        from openai import AzureOpenAI
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
    token_provider = get_bearer_token_provider(credential, COGNITIVE_SCOPE)
    openai_client = AzureOpenAI(
        azure_endpoint=f"https://{resource}.openai.azure.com/",
        azure_ad_token_provider=token_provider,
        api_version=OPENAI_API_VERSION,
        timeout=90.0,
        max_retries=3,
    )
    result = generate_ad(
        source,
        output,
        speech=speech,
        openai_client=openai_client,
        model=config["GPT_DEPLOYMENT"],
        progress=_progress if args.verbose else None,
    )
    for warning in result.warnings:
        logging.warning(
            "%s %.3f-%.3f: %s",
            warning.stage,
            warning.start,
            warning.end,
            warning.error,
        )
    print(result.output_vtt)
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

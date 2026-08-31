from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.separation import (
    MAX_DURATION_DIFFERENCE,
    MIN_ALIGNMENT_CORRELATION,
    SeparationError,
    separate_ad,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Recover an AD narration stem from matching main and "
            "audio-described soundtracks."
        )
    )
    parser.add_argument("source", help="main soundtrack or video")
    parser.add_argument(
        "described",
        help="audio-described soundtrack or video",
    )
    parser.add_argument(
        "output",
        nargs="?",
        help=(
            "output WAV (default: described filename with "
            ".ad-only.wav)"
        ),
    )
    parser.add_argument(
        "--max-shift",
        type=float,
        default=2.0,
        help="maximum alignment shift in seconds (default: 2)",
    )
    return parser


def process(args: argparse.Namespace) -> int:
    described = Path(args.described).expanduser()
    output = (
        Path(args.output).expanduser()
        if args.output
        else described.with_name(
            described.stem + ".ad-only.wav"
        )
    )
    result = separate_ad(
        Path(args.source).expanduser(),
        described,
        output,
        max_shift_seconds=args.max_shift,
    )
    logging.info(
        "Alignment: %+d samples (%+.4fs), correlation %.3f",
        result.shift_samples,
        result.shift_seconds,
        result.correlation,
    )
    logging.info(
        "Duration: source %.3fs, AD %.3fs (difference %+.3fs)",
        result.source_duration,
        result.described_duration,
        result.duration_difference,
    )
    if result.correlation < MIN_ALIGNMENT_CORRELATION:
        logging.warning(
            "Low alignment correlation; verify that both inputs "
            "use the same edit and master."
        )
    if abs(result.duration_difference) > MAX_DURATION_DIFFERENCE:
        logging.warning(
            "Input durations differ substantially; unmatched AD "
            "audio was preserved without subtraction."
        )
    print(result.output_audio)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    try:
        return process(args)
    except SeparationError as exc:
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

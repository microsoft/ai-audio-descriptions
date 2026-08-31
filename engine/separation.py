from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

from engine import ffmpeg


MIN_ALIGNMENT_CORRELATION = 0.5
MAX_DURATION_DIFFERENCE = 0.5
ALIGNMENT_WINDOW_SECONDS = 4.0

EXIT_BAD_INPUT = 2
EXIT_NO_FFMPEG = 3
EXIT_FFMPEG_FAILED = 6


class SeparationError(Exception):
    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SeparationResult:
    output_audio: Path
    shift_samples: int
    sample_rate: int
    correlation: float
    source_duration: float
    described_duration: float
    uncovered_duration: float

    @property
    def shift_seconds(self) -> float:
        return self.shift_samples / self.sample_rate

    @property
    def duration_difference(self) -> float:
        return self.described_duration - self.source_duration


def _run_binary(
    command: Sequence[str],
    *,
    input_data: bytes | None = None,
) -> bytes:
    try:
        process = subprocess.run(
            [str(part) for part in command],
            input=input_data,
            capture_output=True,
        )
    except OSError as exc:
        raise ffmpeg.FFmpegError(
            f"Could not run {command[0]}: {exc}"
        ) from exc
    if process.returncode != 0:
        detail = process.stderr.decode(
            "utf-8", errors="replace"
        ).strip()[-2000:]
        raise ffmpeg.FFmpegError(
            f"Command failed ({process.returncode}): "
            f"{' '.join(str(part) for part in command[:3])} ..."
            + (f"\n{detail}" if detail else "")
        )
    return process.stdout


def _probe_sample_rate(path: Path) -> int:
    output = _run_binary(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate",
            "-of",
            "json",
            str(path),
        ]
    )
    try:
        stream = json.loads(output)["streams"][0]
        return int(stream["sample_rate"])
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise ffmpeg.FFmpegError(
            f"No readable audio stream found in {path.name}."
        ) from exc


def _decode_audio(
    path: Path,
    sample_rate: int,
    channels: int = 2,
) -> np.ndarray:
    output = _run_binary(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ar",
            str(sample_rate),
            "-ac",
            str(channels),
            "-",
        ]
    )
    return np.frombuffer(output, dtype="<f4").reshape(-1, channels).copy()


def _encode_wav(
    samples: np.ndarray,
    output: Path,
    sample_rate: int,
) -> None:
    _run_binary(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ar",
            str(sample_rate),
            "-ac",
            str(samples.shape[1]),
            "-i",
            "-",
            "-codec:a",
            "pcm_s24le",
            str(output),
        ],
        input_data=np.asarray(samples, dtype="<f4").tobytes(),
    )


def _rms_envelope(samples: np.ndarray, block_size: int) -> np.ndarray:
    usable = len(samples) - len(samples) % block_size
    blocks = samples[:usable].reshape(-1, block_size)
    return np.sqrt(np.mean(blocks * blocks, axis=1) + 1e-12)


def _normalized_correlation(a: np.ndarray, b: np.ndarray) -> float:
    a = a - np.mean(a)
    b = b - np.mean(b)
    return float(
        np.dot(a, b)
        / np.sqrt(np.dot(a, a) * np.dot(b, b) + 1e-20)
    )


def _window_alignment(
    reference: np.ndarray,
    described: np.ndarray,
    start: int,
    length: int,
    max_shift: int,
) -> tuple[int, float]:
    best_shift = 0
    best_score = -1.0
    for shift in range(-max_shift, max_shift + 1):
        described_start = start + shift
        if (
            described_start < 0
            or described_start + length > len(described)
        ):
            continue
        score = _normalized_correlation(
            reference[start : start + length],
            described[described_start : described_start + length],
        )
        if score > best_score:
            best_shift = shift
            best_score = score
    return best_shift, best_score


def _fine_alignment(
    reference: np.ndarray,
    described: np.ndarray,
    start: int,
    length: int,
    coarse_shift: int,
    radius: int,
) -> tuple[int, float]:
    minimum_shift = max(coarse_shift - radius, -start)
    maximum_shift = min(
        coarse_shift + radius,
        len(described) - start - length,
    )
    ref = reference[start : start + length].astype(np.float64)
    ref -= np.mean(ref)
    described_region = described[
        start + minimum_shift : start + maximum_shift + length
    ].astype(np.float64)

    fft_size = 1 << (len(ref) + len(described_region) - 2).bit_length()
    convolution = np.fft.irfft(
        np.fft.rfft(described_region, fft_size)
        * np.fft.rfft(ref[::-1], fft_size),
        fft_size,
    )
    count = maximum_shift - minimum_shift + 1
    correlation = convolution[
        len(ref) - 1 : len(ref) - 1 + count
    ]

    cumulative = np.concatenate(([0.0], np.cumsum(described_region)))
    cumulative_square = np.concatenate(
        ([0.0], np.cumsum(described_region * described_region))
    )
    sums = cumulative[len(ref) :] - cumulative[: -len(ref)]
    square_sums = (
        cumulative_square[len(ref) :]
        - cumulative_square[: -len(ref)]
    )
    variance = square_sums - sums * sums / len(ref)
    scores = correlation / np.sqrt(
        np.sum(ref * ref) * np.maximum(variance, 1e-20)
    )
    best = int(np.argmax(scores))
    return minimum_shift + best, float(scores[best])


def find_alignment(
    reference: np.ndarray,
    described: np.ndarray,
    sample_rate: int,
    max_shift_seconds: float = 2.0,
) -> tuple[int, float]:
    block_size = max(1, sample_rate // 200)
    ref_env = _rms_envelope(np.mean(reference, axis=1), block_size)
    ad_env = _rms_envelope(np.mean(described, axis=1), block_size)
    common_length = min(len(ref_env), len(ad_env))
    max_shift = round(max_shift_seconds * sample_rate / block_size)
    window_length = min(
        round(
            ALIGNMENT_WINDOW_SECONDS * sample_rate / block_size
        ),
        common_length - 2 * max_shift,
    )
    if window_length < 10:
        raise ValueError("Audio is too short for alignment.")

    coarse_shift, _ = _window_alignment(
        ref_env,
        ad_env,
        max_shift,
        common_length - 2 * max_shift,
        max_shift,
    )
    first_start = max_shift
    last_start = common_length - max_shift - window_length
    cumulative_energy = np.concatenate(
        ([0.0], np.cumsum(ref_env * ref_env))
    )
    energy = (
        cumulative_energy[window_length:]
        - cumulative_energy[:-window_length]
    )
    start = first_start + int(
        np.argmax(energy[first_start : last_start + 1])
    )

    fine_shift, fine_score = _fine_alignment(
        np.mean(reference, axis=1),
        np.mean(described, axis=1),
        start * block_size,
        window_length * block_size,
        coarse_shift * block_size,
        block_size * 2,
    )
    return fine_shift, fine_score


def _aligned_overlap(
    reference: np.ndarray,
    described: np.ndarray,
    shift: int,
) -> tuple[np.ndarray, np.ndarray, int]:
    if shift >= 0:
        reference_start = 0
        described_start = shift
    else:
        reference_start = -shift
        described_start = 0
    length = min(
        len(reference) - reference_start,
        len(described) - described_start,
    )
    return (
        reference[reference_start : reference_start + length],
        described[described_start : described_start + length],
        described_start,
    )


def adaptive_subtract(
    reference: np.ndarray,
    described: np.ndarray,
    sample_rate: int,
) -> np.ndarray:
    frame_size = round(sample_rate * 0.08)
    hop_size = round(sample_rate * 0.02)
    gains = []
    positions = []

    for start in range(
        0,
        len(described) - frame_size + 1,
        hop_size,
    ):
        background = reference[start : start + frame_size]
        target = described[start : start + frame_size]
        gain = np.sum(background * target) / (
            np.sum(background * background) + 1e-12
        )
        gains.append(np.clip(gain, 0.0, 2.0))
        positions.append(start + frame_size // 2)

    if not gains:
        return described - reference

    gains = np.asarray(gains)
    gains = np.convolve(gains, np.ones(5) / 5, mode="same")
    sample_gains = np.interp(
        np.arange(len(described)),
        positions,
        gains,
        left=gains[0],
        right=gains[-1],
    ).astype(np.float32)
    return described - reference * sample_gains[:, None]


def _validate_input(path: str | Path, label: str) -> Path:
    source = Path(path).expanduser()
    if not source.exists() or not source.is_file():
        raise SeparationError(
            f"{label} file not found: {source}",
            EXIT_BAD_INPUT,
        )
    return source.resolve()


def separate_ad(
    source_audio: str | Path,
    described_audio: str | Path,
    output_audio: str | Path,
    *,
    max_shift_seconds: float = 2.0,
) -> SeparationResult:
    source = _validate_input(source_audio, "Source")
    described_source = _validate_input(
        described_audio,
        "Audio-described",
    )
    output = Path(output_audio).expanduser().resolve()
    if output.suffix.lower() != ".wav":
        raise SeparationError(
            "Output must be a .wav file.",
            EXIT_BAD_INPUT,
        )
    if output in (source, described_source):
        raise SeparationError(
            "Output must differ from both inputs.",
            EXIT_BAD_INPUT,
        )

    try:
        ffmpeg.require_tools()
        sample_rate = _probe_sample_rate(described_source)
        reference = _decode_audio(source, sample_rate)
        described = _decode_audio(described_source, sample_rate)
        shift, correlation = find_alignment(
            reference,
            described,
            sample_rate,
            max_shift_seconds,
        )
        aligned_reference, aligned_described, described_start = (
            _aligned_overlap(reference, described, shift)
        )
        residual = adaptive_subtract(
            aligned_reference,
            aligned_described,
            sample_rate,
        )

        result = described.copy()
        result[
            described_start : described_start + len(residual)
        ] = residual
        peak = float(np.max(np.abs(result)))
        if peak > 0.98:
            result *= 0.98 / peak

        output.parent.mkdir(parents=True, exist_ok=True)
        _encode_wav(result, output, sample_rate)
    except ffmpeg.ToolNotFoundError as exc:
        raise SeparationError(str(exc), EXIT_NO_FFMPEG) from exc
    except ffmpeg.FFmpegError as exc:
        raise SeparationError(str(exc), EXIT_FFMPEG_FAILED) from exc

    source_duration = len(reference) / sample_rate
    described_duration = len(described) / sample_rate
    return SeparationResult(
        output,
        shift,
        sample_rate,
        correlation,
        source_duration,
        described_duration,
        (len(described) - len(residual)) / sample_rate,
    )

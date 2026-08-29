from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence


SILENCE_DB = -50
TAIL_PAD = 0.1
MIN_TRIMMED = 0.15
MIN_TRIMMED_RATIO = 0.4
DUCK_RAMP = 0.25


class FFmpegError(RuntimeError):
    pass


class ToolNotFoundError(FFmpegError):
    pass


@dataclass(frozen=True)
class MediaInfo:
    path: Path
    duration: float
    has_audio: bool
    width: int
    height: int
    fps: float


def run(
    command: Sequence[str], *, check: bool = True
) -> subprocess.CompletedProcess[str]:
    try:
        process = subprocess.run(
            [str(part) for part in command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        raise FFmpegError(f"Could not run {command[0]}: {exc}") from exc
    if check and process.returncode != 0:
        detail = (process.stderr or process.stdout or "").strip()[-2000:]
        raise FFmpegError(
            f"Command failed ({process.returncode}): "
            f"{' '.join(str(part) for part in command[:3])} ..."
            + (f"\n{detail}" if detail else "")
        )
    return process


def require_tools() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        raise ToolNotFoundError(
            f"Required media tool not found on PATH: {', '.join(missing)}."
        )


def _first_float(*values: Any) -> float | None:
    for value in values:
        try:
            if value is not None:
                return float(value)
        except (TypeError, ValueError):
            continue
    return None


def probe_video(path: Path) -> MediaInfo:
    process = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    try:
        payload = json.loads(process.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise FFmpegError(f"ffprobe returned invalid data for {path}.") from exc

    streams = payload.get("streams", [])
    video = next(
        (stream for stream in streams if stream.get("codec_type") == "video"),
        None,
    )
    audio = next(
        (stream for stream in streams if stream.get("codec_type") == "audio"),
        None,
    )
    if video is None:
        raise FFmpegError(f"No video stream found in {path.name}.")

    duration = _first_float(
        payload.get("format", {}).get("duration"), video.get("duration")
    )
    if duration is None or duration <= 0:
        raise FFmpegError(f"Could not determine the duration of {path.name}.")

    rate = video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/0"
    try:
        numerator, _, denominator = rate.partition("/")
        fps = (
            float(numerator) / float(denominator)
            if float(denominator)
            else 0.0
        )
    except (ValueError, ZeroDivisionError):
        fps = 0.0

    return MediaInfo(
        path=path,
        duration=duration,
        has_audio=audio is not None,
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        fps=fps,
    )


def media_duration(path: Path) -> float:
    process = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
    )
    duration = _first_float((process.stdout or "").strip())
    if duration is None or duration < 0:
        raise FFmpegError(f"Could not read duration of {path}.")
    return duration


def extract_audio(video: Path, output: Path) -> Path:
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(video),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output),
        ]
    )
    return output


def detect_shots(source: Path, threshold: float) -> list[float]:
    process = run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostats",
            "-i",
            str(source),
            "-vf",
            f"scdet=threshold={threshold},metadata=print:file=-",
            "-an",
            "-f",
            "null",
            "-",
        ],
        check=False,
    )
    return sorted(
        {
            round(float(match.group(1)), 3)
            for match in re.finditer(
                r"lavfi\.scd\.time=([\d.]+)", process.stdout or ""
            )
        }
    )


def extract_frame(
    video: Path, timestamp: float, output: Path, max_width: int
) -> Path | None:
    output.unlink(missing_ok=True)
    process = run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{timestamp:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vf",
            f"scale='min({max_width},iw)':-2",
            "-q:v",
            "4",
            str(output),
        ],
        check=False,
    )
    if process.returncode == 0 and output.exists() and output.stat().st_size > 0:
        return output
    output.unlink(missing_ok=True)
    return None


def trim_outer_silence(source: Path, output: Path) -> float:
    original_duration = media_duration(source)
    trim_start = (
        f"silenceremove=start_periods=1:start_threshold={SILENCE_DB}dB:"
        "start_silence="
    )
    try:
        run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-af",
                f"{trim_start}0,areverse,{trim_start}{TAIL_PAD},areverse",
                "-c:a",
                "pcm_s16le",
                str(output),
            ]
        )
        trimmed_duration = media_duration(output)
    except FFmpegError:
        output.unlink(missing_ok=True)
        shutil.copy2(source, output)
        return original_duration

    if (
        trimmed_duration < MIN_TRIMMED
        or trimmed_duration < original_duration * MIN_TRIMMED_RATIO
    ):
        output.unlink(missing_ok=True)
        shutil.copy2(source, output)
        return original_duration
    return trimmed_duration


def atempo(source: Path, output: Path, tempo: float) -> float:
    if not 0.5 <= tempo <= 2.0:
        raise ValueError("atempo must be between 0.5 and 2.0")
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-filter:a",
            f"atempo={tempo:.4f}",
            "-c:a",
            "pcm_s16le",
            str(output),
        ]
    )
    return media_duration(output)


def mix_audio(
    info: MediaInfo,
    clips: Sequence[tuple[float, float, Path]],
    output: Path,
    duck_db: float,
) -> Path:
    gain = 10 ** (duck_db / 20.0)
    command = ["ffmpeg", "-y", "-v", "error"]
    if info.has_audio:
        command += ["-i", str(info.path)]
    else:
        command += [
            "-f",
            "lavfi",
            "-t",
            f"{info.duration:.3f}",
            "-i",
            "anullsrc=r=48000:cl=stereo",
        ]
    for _, _, path in clips:
        command += ["-i", str(path)]

    base = (
        "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:"
        "channel_layouts=stereo"
    )
    envelopes = [
        f"clip(min((t-{max(0.0, start - DUCK_RAMP):.3f})/{DUCK_RAMP},"
        f"({start + duration + DUCK_RAMP:.3f}-t)/{DUCK_RAMP}),0,1)"
        for start, duration, _ in clips
    ]
    if envelopes:
        combined = (
            envelopes[0]
            if len(envelopes) == 1
            else f"clip({'+'.join(envelopes)},0,1)"
        )
        base += f",volume=volume='1-{1 - gain:.5f}*{combined}':eval=frame"
    base += f",apad,atrim=0:{info.duration:.3f},asetpts=N/SR/TB[base]"

    filters = [base]
    mix_inputs = ["[base]"]
    for number, (start, _, _) in enumerate(clips, start=1):
        delay_ms = int(round(start * 1000))
        filters.append(
            f"[{number}:a]aformat=sample_fmts=fltp:sample_rates=48000:"
            f"channel_layouts=stereo,adelay={delay_ms}:all=1[d{number}]"
        )
        mix_inputs.append(f"[d{number}]")

    if len(mix_inputs) > 1:
        filters.append(
            "".join(mix_inputs)
            + f"amix=inputs={len(mix_inputs)}:duration=first:normalize=0,"
            f"alimiter=limit=0.95,atrim=0:{info.duration:.3f}[out]"
        )
    else:
        filters.append("[base]anull[out]")

    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        str(output),
    ]
    run(command)
    return output


def mux_video(video: Path, audio: Path, output: Path) -> Path:
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(video),
            "-i",
            str(audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
            str(output),
        ]
    )
    return output

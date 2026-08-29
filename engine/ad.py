from __future__ import annotations

import bisect
import math
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from engine import ffmpeg
from engine import openai as openai_transport
from engine import vtt


DEFAULT_VOICE = "en-US-JennyNeural"
GAP_PADDING = 0.15
MIN_GAP = 1.2
DUCK_DB = -10.0
SHOT_THRESHOLD = 6.0
WORDS_PER_SECOND = 3.2
MIN_SENTENCE_WORDS = 8
SENTENCE_SECONDS = MIN_SENTENCE_WORDS / WORDS_PER_SECOND
MAX_PROSODY_RATE = 20
MAX_ATEMPO = 1.15
FRAME_MAX_WIDTH = 768
MAX_GAP_FRAMES = 12
CATCHUP_WORDS_PER_FRAME = 3
MIN_CATCHUP_FRAMES = 2
MAX_CATCHUP_FRAMES = 12
CATCHUP_OFFSET = 0.3
FIT_TOLERANCE = 0.01

EXIT_BAD_INPUT = 2
EXIT_NO_FFMPEG = 3
EXIT_NO_GAPS = 5
EXIT_FFMPEG_FAILED = 6
EXIT_TRANSCRIBE_FAILED = 7
EXIT_SYNTHESIS_FAILED = 8
EXIT_OVERFLOW = 9

ProgressCallback = Callable[[str, int, int], None]


class ADError(Exception):
    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Gap:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class Description:
    gap: Gap
    text: str


@dataclass(frozen=True)
class ADWarning:
    stage: str
    start: float
    end: float
    error: str


@dataclass(frozen=True)
class GenerateADResult:
    output_vtt: Path
    cues: tuple[vtt.Cue, ...]
    warnings: tuple[ADWarning, ...]


@dataclass(frozen=True)
class RenderedCue:
    cue: vtt.Cue
    duration: float
    prosody_rate: int
    tempo: float

    @property
    def adjusted(self) -> bool:
        return self.prosody_rate > 0 or self.tempo > 1.001


@dataclass(frozen=True)
class RenderADResult:
    output_video: Path
    cues: tuple[RenderedCue, ...]


SYSTEM_PROMPT = """You write audio description for blind and low-vision audiences.

Rules:
- Present tense, third person.
- Concrete and visual: describe only what is literally visible.
- No interpretation of emotion, motive, or intent; no guessing at backstory.
- Never say "we see", "the camera", "the shot", "the scene shows", or "the image".
- Never restate information the dialogue already conveys.
- Prioritise what a viewer needs to follow the story: who is present, where they
  are, what they do, on-screen text, and significant changes.
- Do not editorialise, do not address the listener, do not use adjectives of
  judgement.
- Output the description text only: no quotes, no labels, no markdown."""


def _invert(
    spans: Iterable[tuple[float, float]], total: float
) -> list[tuple[float, float]]:
    merged: list[list[float]] = []
    for start, end in sorted(spans):
        start, end = max(0.0, start), min(total, end)
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    free = []
    cursor = 0.0
    for start, end in merged:
        if start > cursor:
            free.append((cursor, start))
        cursor = max(cursor, end)
    if total > cursor:
        free.append((cursor, total))
    return free


def find_gaps(
    segments: Sequence[Segment],
    duration: float,
    min_gap: float = MIN_GAP,
    has_audio: bool = True,
) -> list[Gap]:
    candidates = (
        _invert(((segment.start, segment.end) for segment in segments), duration)
        if has_audio and segments
        else [(0.0, duration)]
    )
    gaps = []
    for start, end in candidates:
        start = max(0.0, start + GAP_PADDING)
        end = min(duration, end - GAP_PADDING)
        if end - start >= min_gap:
            gaps.append(Gap(start, end))
    return sorted(gaps, key=lambda gap: gap.start)


def split_gaps_on_shots(
    gaps: Sequence[Gap],
    cuts: Sequence[float],
    piece_floor: float = SENTENCE_SECONDS,
) -> list[Gap]:
    if not cuts:
        return list(gaps)

    output = []
    for gap in gaps:
        inner = [
            cut for cut in cuts if gap.start + 0.05 < cut < gap.end - 0.05
        ]
        if not inner:
            output.append(gap)
            continue

        pieces = []
        cursor = gap.start
        for cut in [*inner, gap.end]:
            if cut - cursor >= piece_floor:
                pieces.append(Gap(cursor, cut))
                cursor = cut
        if pieces:
            pieces[-1] = Gap(pieces[-1].start, gap.end)
            output.extend(pieces)
        else:
            output.append(gap)
    return sorted(output, key=lambda gap: gap.start)


def word_budget(gap_seconds: float) -> int:
    return max(3, int(gap_seconds * WORDS_PER_SECOND))


def catchup_times(
    gap: Gap, cuts: Sequence[float], since: float | None
) -> list[float]:
    if since is None or not cuts:
        return []
    budget = min(
        MAX_CATCHUP_FRAMES,
        max(
            MIN_CATCHUP_FRAMES,
            round(word_budget(gap.duration) / CATCHUP_WORDS_PER_FRAME),
        ),
    )
    inner = [cut for cut in cuts if since < cut < gap.start - CATCHUP_OFFSET]
    if len(inner) > budget:
        inner = [
            inner[int((index + 0.5) * len(inner) / budget)]
            for index in range(budget)
        ]
    return [cut + CATCHUP_OFFSET for cut in inner]


def frame_times(
    gap: Gap, cuts: Sequence[float] = (), since: float | None = None
) -> list[float]:
    count = min(
        MAX_GAP_FRAMES, max(2, round(gap.duration / SENTENCE_SECONDS))
    )
    times = [
        gap.start + (index + 0.5) * gap.duration / count
        for index in range(count)
    ]
    if gap.start > 0.6:
        times.insert(0, max(0.0, gap.start - 0.5))
    return catchup_times(gap, cuts, since) + times


def _transcript_context(
    segments: Sequence[Segment],
    gap: Gap,
    window: float = 25.0,
    since: float | None = None,
) -> str:
    floor = gap.start - window if since is None else min(since, gap.start - window)
    before = [
        segment
        for segment in segments
        if segment.end <= gap.start and segment.end >= floor and segment.text
    ]
    after = [
        segment
        for segment in segments
        if segment.start >= gap.end
        and segment.start <= gap.end + window
        and segment.text
    ]
    lines = []
    if before:
        if since is None:
            label = "Dialogue just before the gap"
        elif since <= 0.0:
            label = "Dialogue so far, from the start of the video"
        else:
            label = "Dialogue since your last description"
        lines.append(f"{label}: " + " ".join(item.text for item in before[-12:]))
    if after:
        lines.append(
            "Dialogue just after the gap: "
            + " ".join(item.text for item in after[:4])
        )
    return "\n".join(lines) if lines else "No dialogue nearby."


def build_description_prompt(
    gap: Gap,
    segments: Sequence[Segment],
    previous: Sequence[str],
    *,
    since: float | None = None,
    catchup_count: int = 0,
    same_shot_text: str = "",
) -> str:
    prior = "\n".join(f"- {text}" for text in list(previous)[-6:]) or "- (none yet)"
    if catchup_count and not previous:
        frame_note = (
            f"The first {catchup_count} frame(s) are from the opening of the video, "
            f"before this gap, in order. Nothing has been described yet, so nothing "
            f"in them has been established for the listener. The remaining frames "
            f"are from the gap itself."
        )
    elif catchup_count:
        frame_note = (
            f"The first {catchup_count} frame(s) are from the preceding stretch of "
            f"dialogue, in order, and show what happened on screen while people were "
            f"talking - action you have not had a chance to describe yet. The "
            f"remaining frames are from the gap itself."
        )
    else:
        frame_note = (
            "The attached frames are taken from this moment (the first may be from "
            "just before the gap, for context)."
        )
    continuity = ""
    if same_shot_text:
        continuity = (
            "\n\nThe camera has not cut since your last description, which was: "
            f'"{same_shot_text}". Describe only what has materially changed since '
            f"then. A change of facial expression alone is not a material change."
        )
    return (
        f"A {gap.duration:.1f} second gap in the dialogue starts at "
        f"{vtt.format_timestamp(gap.start)} of the video.\n\n"
        f"{_transcript_context(segments, gap, since=since)}\n\n"
        f"Descriptions already spoken earlier in this video (do not repeat them, "
        f"and do not re-introduce people or places already introduced):\n{prior}\n\n"
        f"{frame_note}{continuity}\n\n"
        "Write one audio description to be spoken in this gap. Hard limit: "
        f"{word_budget(gap.duration)} words. Shorter is better than rushed. If nothing "
        f"story-relevant is visible, or nothing has changed, reply with exactly: SKIP"
    )


def build_cues(
    descriptions: Sequence[Description], duration: float
) -> tuple[vtt.Cue, ...]:
    cues = []
    previous_end = 0.0
    for description in sorted(descriptions, key=lambda item: item.gap.start):
        start = max(0.0, description.gap.start, previous_end)
        end = min(duration, description.gap.end)
        if end <= start:
            continue
        cues.append(vtt.Cue(start, end, description.text))
        previous_end = end
    return tuple(cues)


def _validate_source(path: str | Path) -> Path:
    source = Path(path).expanduser()
    if not source.exists() or not source.is_file():
        raise ADError(f"Input file not found: {source}", EXIT_BAD_INPUT)
    if source.suffix.lower() != ".mp4":
        raise ADError(
            f"Expected an .mp4 file, got {source.suffix!r}.", EXIT_BAD_INPUT
        )
    return source.resolve()


def _prepare_media(source: Path) -> ffmpeg.MediaInfo:
    try:
        ffmpeg.require_tools()
    except ffmpeg.ToolNotFoundError as exc:
        raise ADError(str(exc), EXIT_NO_FFMPEG) from exc
    try:
        return ffmpeg.probe_video(source)
    except ffmpeg.FFmpegError as exc:
        raise ADError(str(exc), EXIT_BAD_INPUT) from exc


def _progress(
    callback: ProgressCallback | None, stage: str, current: int, total: int
) -> None:
    if callback is not None:
        callback(stage, current, total)


def _grab_frames(
    video: Path,
    gap: Gap,
    workspace: Path,
    index: int,
    cuts: Sequence[float],
    since: float | None,
) -> tuple[list[Path], int, int]:
    catchup = catchup_times(gap, cuts, since)
    frames = []
    caught_up = 0
    failed = 0
    for number, timestamp in enumerate(frame_times(gap, cuts, since)):
        output = workspace / f"gap{index:03d}_f{number}.jpg"
        try:
            frame = ffmpeg.extract_frame(
                video, timestamp, output, FRAME_MAX_WIDTH
            )
        except Exception:
            frame = None
        if frame is None:
            failed += 1
            continue
        frames.append(frame)
        if number < len(catchup):
            caught_up += 1
    return frames, caught_up, failed


def _as_segments(items: Any) -> list[Segment]:
    if items is None:
        raise ADError(
            "Transcription failed, so dialogue-safe narration windows cannot "
            "be determined.",
            EXIT_TRANSCRIBE_FAILED,
        )
    try:
        segments = [
            Segment(float(item.start), float(item.end), str(item.text))
            for item in items
        ]
    except (AttributeError, TypeError, ValueError) as exc:
        raise ADError(
            f"Transcription returned invalid segments: {exc}",
            EXIT_TRANSCRIBE_FAILED,
        ) from exc
    return sorted(segments, key=lambda segment: segment.start)


def _fit_cue(
    speech_client: Any,
    cue: vtt.Cue,
    workspace: Path,
    index: int,
    voice: str,
) -> tuple[RenderedCue, Path]:
    raw = workspace / f"cue{index:03d}.wav"
    trimmed = workspace / f"cue{index:03d}_trim.wav"
    try:
        speech_client.synthesize(cue.text, raw, voice, rate_pct=0)
        duration = ffmpeg.trim_outer_silence(raw, trimmed)
    except ffmpeg.FFmpegError as exc:
        raise ADError(str(exc), EXIT_FFMPEG_FAILED) from exc
    except Exception as exc:
        raise ADError(
            f"Speech synthesis failed for VTT cue {index}: {exc}",
            EXIT_SYNTHESIS_FAILED,
        ) from exc

    path = trimmed
    rate = 0
    tempo = 1.0
    if duration > cue.duration + FIT_TOLERANCE:
        rate = min(
            MAX_PROSODY_RATE,
            max(1, int(math.ceil((duration / cue.duration - 1.0) * 100))),
        )
        raw = workspace / f"cue{index:03d}_r{rate}.wav"
        trimmed = workspace / f"cue{index:03d}_r{rate}_trim.wav"
        try:
            speech_client.synthesize(cue.text, raw, voice, rate_pct=rate)
            duration = ffmpeg.trim_outer_silence(raw, trimmed)
        except ffmpeg.FFmpegError as exc:
            raise ADError(str(exc), EXIT_FFMPEG_FAILED) from exc
        except Exception as exc:
            raise ADError(
                f"Speech synthesis failed for VTT cue {index}: {exc}",
                EXIT_SYNTHESIS_FAILED,
            ) from exc
        path = trimmed

    if duration > cue.duration + FIT_TOLERANCE:
        tempo = min(MAX_ATEMPO, duration / cue.duration)
        if tempo > 1.001:
            adjusted = workspace / f"cue{index:03d}_tempo.wav"
            try:
                duration = ffmpeg.atempo(path, adjusted, tempo)
            except ffmpeg.FFmpegError as exc:
                raise ADError(str(exc), EXIT_FFMPEG_FAILED) from exc
            path = adjusted

    return RenderedCue(cue, duration, rate, tempo), path


def generate_ad(
    input_video: str | Path,
    output_vtt: str | Path,
    *,
    speech: Any,
    openai_client: Any,
    model: str,
    workspace: str | Path | None = None,
    progress: ProgressCallback | None = None,
) -> GenerateADResult:
    source = _validate_source(input_video)
    output = Path(output_vtt).expanduser().resolve()
    if output.suffix.lower() != ".vtt":
        raise ADError("Output must be a .vtt file.", EXIT_BAD_INPUT)
    if workspace is None:
        with tempfile.TemporaryDirectory(prefix="ad_generate_") as temporary:
            return _generate_ad(
                source,
                output,
                speech,
                openai_client,
                model,
                Path(temporary),
                progress,
            )
    work = Path(workspace).expanduser().resolve()
    work.mkdir(parents=True, exist_ok=True)
    return _generate_ad(
        source, output, speech, openai_client, model, work, progress
    )


def _generate_ad(
    source: Path,
    output: Path,
    speech_client: Any,
    openai_client: Any,
    model: str,
    workspace: Path,
    progress: ProgressCallback | None,
) -> GenerateADResult:
    info = _prepare_media(source)
    _progress(progress, "preparing", 1, 1)

    segments: list[Segment] = []
    if info.has_audio:
        try:
            audio = ffmpeg.extract_audio(source, workspace / "source.wav")
            segments = _as_segments(speech_client.transcribe(audio))
        except ADError:
            raise
        except ffmpeg.FFmpegError as exc:
            raise ADError(str(exc), EXIT_FFMPEG_FAILED) from exc
        except Exception as exc:
            raise ADError(
                f"Transcription failed: {exc}", EXIT_TRANSCRIBE_FAILED
            ) from exc
        _progress(progress, "transcribing", 1, 1)
    else:
        _progress(progress, "transcribing", 0, 0)

    gaps = find_gaps(segments, info.duration, MIN_GAP, info.has_audio)
    if not gaps:
        raise ADError("No usable narration windows were found.", EXIT_NO_GAPS)

    try:
        cuts = ffmpeg.detect_shots(source, SHOT_THRESHOLD)
    except ffmpeg.FFmpegError as exc:
        raise ADError(str(exc), EXIT_FFMPEG_FAILED) from exc
    gaps = split_gaps_on_shots(gaps, cuts)
    _progress(progress, "detecting_shots", 1, 1)

    descriptions = []
    warnings = []
    spoken: list[str] = []
    since = 0.0
    last_shot: int | None = None
    last_text = ""
    for index, gap in enumerate(gaps, start=1):
        shot = bisect.bisect_right(cuts, (gap.start + gap.end) / 2)
        same_shot_text = last_text if shot == last_shot else ""
        frames, catchup_count, failed_frames = _grab_frames(
            source, gap, workspace, index, cuts, since
        )
        if failed_frames:
            warnings.append(
                ADWarning(
                    "frames",
                    gap.start,
                    gap.end,
                    f"{failed_frames} frame extraction(s) failed.",
                )
            )
        if not frames:
            _progress(progress, "describing", index, len(gaps))
            continue

        prompt = build_description_prompt(
            gap,
            segments,
            spoken,
            since=since,
            catchup_count=catchup_count,
            same_shot_text=same_shot_text,
        )
        try:
            text = openai_transport.generate_description(
                openai_client, model, SYSTEM_PROMPT, prompt, frames
            )
        except Exception as exc:
            warnings.append(ADWarning("model", gap.start, gap.end, str(exc)))
            _progress(progress, "describing", index, len(gaps))
            continue

        if text:
            descriptions.append(Description(gap, text))
            spoken.append(text)
            since, last_shot, last_text = gap.end, shot, text
        _progress(progress, "describing", index, len(gaps))

    if not descriptions:
        raise ADError(
            "No descriptions could be generated for this video.",
            EXIT_NO_GAPS,
        )

    cues = build_cues(descriptions, info.duration)
    try:
        vtt.write(cues, output)
    except OSError as exc:
        raise ADError(f"Could not write VTT file {output}: {exc}") from exc
    _progress(progress, "writing_vtt", 1, 1)
    return GenerateADResult(output, cues, tuple(warnings))


def render_ad(
    input_video: str | Path,
    input_vtt: str | Path,
    output_video: str | Path,
    *,
    speech: Any,
    voice: str = DEFAULT_VOICE,
    workspace: str | Path | None = None,
    progress: ProgressCallback | None = None,
) -> RenderADResult:
    source = _validate_source(input_video)
    captions = Path(input_vtt).expanduser()
    if not captions.exists() or not captions.is_file():
        raise ADError(f"Input VTT file not found: {captions}", EXIT_BAD_INPUT)
    if captions.suffix.lower() != ".vtt":
        raise ADError("Input captions must be a .vtt file.", EXIT_BAD_INPUT)
    output = Path(output_video).expanduser().resolve()
    if output.suffix.lower() != ".mp4":
        raise ADError("Output must be an .mp4 file.", EXIT_BAD_INPUT)
    if output == source:
        raise ADError(
            "Output video must differ from the input video.", EXIT_BAD_INPUT
        )
    if workspace is None:
        with tempfile.TemporaryDirectory(prefix="ad_render_") as temporary:
            return _render_ad(
                source,
                captions,
                output,
                speech,
                voice,
                Path(temporary),
                progress,
            )
    work = Path(workspace).expanduser().resolve()
    work.mkdir(parents=True, exist_ok=True)
    return _render_ad(
        source, captions, output, speech, voice, work, progress
    )


def _render_ad(
    source: Path,
    input_vtt: Path,
    output: Path,
    speech_client: Any,
    voice: str,
    workspace: Path,
    progress: ProgressCallback | None,
) -> RenderADResult:
    info = _prepare_media(source)
    try:
        cues = vtt.read(input_vtt)
    except vtt.VTTError as exc:
        raise ADError(str(exc), EXIT_BAD_INPUT) from exc
    if not cues:
        raise ADError("The VTT contains no audio-description cues.", EXIT_NO_GAPS)
    for number, cue in enumerate(cues, start=1):
        if cue.end > info.duration + FIT_TOLERANCE:
            raise ADError(
                f"VTT cue {number} ends after the source video.",
                EXIT_BAD_INPUT,
            )
    _progress(progress, "preparing", 1, 1)

    rendered = []
    audio_paths = []
    overflows = []
    for index, cue in enumerate(cues, start=1):
        rendered_cue, audio_path = _fit_cue(
            speech_client, cue, workspace, index, voice
        )
        rendered.append(rendered_cue)
        audio_paths.append(audio_path)
        if rendered_cue.duration > cue.duration + FIT_TOLERANCE:
            overflows.append((index, rendered_cue))
        _progress(progress, "synthesizing", index, len(cues))

    if overflows:
        details = ", ".join(
            f"cue {index} ({vtt.format_timestamp(item.cue.start)} --> "
            f"{vtt.format_timestamp(item.cue.end)}; {item.duration:.2f}s audio "
            f"in {item.cue.duration:.2f}s)"
            for index, item in overflows
        )
        raise ADError(
            f"Narration does not fit its available VTT window: {details}.",
            EXIT_OVERFLOW,
        )

    clips = [
        (item.cue.start, item.duration, path)
        for item, path in zip(rendered, audio_paths)
    ]
    mixed = workspace / "mixed.wav"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{output.stem}.",
        suffix=".mp4",
        dir=output.parent,
        delete=False,
    ) as staged_file:
        staged_output = Path(staged_file.name)
    try:
        ffmpeg.mix_audio(info, clips, mixed, DUCK_DB)
        _progress(progress, "mixing", 1, 1)
        ffmpeg.mux_video(source, mixed, staged_output)
    except ffmpeg.FFmpegError as exc:
        staged_output.unlink(missing_ok=True)
        raise ADError(str(exc), EXIT_FFMPEG_FAILED) from exc

    try:
        staged_output.replace(output)
    except OSError as exc:
        staged_output.unlink(missing_ok=True)
        raise ADError(f"Could not write output video {output}: {exc}") from exc
    _progress(progress, "writing_video", 1, 1)
    return RenderADResult(output, tuple(rendered))

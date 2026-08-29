from __future__ import annotations

import hashlib
import json
import math
import shutil
import tempfile
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from engine import vtt
from engine.ad import DEFAULT_VOICE


class VideoError(RuntimeError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Services:
    speech: Any
    openai_client: Any
    model: str
    generate_ad: Callable[..., Any]
    render_ad: Callable[..., Any]


class VideoStore:
    def __init__(
        self,
        root: Path,
        services: Services,
        voice: str = DEFAULT_VOICE,
    ) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.services = services
        self.voice = voice
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.active: dict[str, Future[Any]] = {}
        self.lock = threading.Lock()
        self._mark_interrupted()

    def close(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)

    def create(self, title: str, upload: Any) -> dict[str, Any]:
        title = title.strip()
        if not title:
            raise VideoError("A video title is required.")
        if upload is None or not upload.filename:
            raise VideoError("An MP4 video is required.")
        if Path(upload.filename).suffix.lower() != ".mp4":
            raise VideoError("The uploaded file must be an MP4.")
        if any(item["title"].casefold() == title.casefold() for item in self.list()):
            raise VideoError(
                "There is already an existing video file that has the same "
                "title, please use a different title.",
                409,
            )

        video_id = uuid.uuid4().hex
        directory = self._directory(video_id)
        directory.mkdir()
        try:
            upload.save(directory / "source.mp4")
            self._write_record(
                video_id,
                {
                    "id": video_id,
                    "title": title,
                    "status": "uploaded",
                    "audioGenerated": 0,
                    "renderFingerprint": None,
                },
            )
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        return self.get(video_id)

    def list(self) -> list[dict[str, Any]]:
        videos = []
        for record_path in self.root.glob("*/video.json"):
            try:
                record = json.loads(record_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise VideoError(
                    f"Video metadata could not be read: {record_path}", 500
                ) from exc
            videos.append(
                {
                    "id": record["id"],
                    "title": record["title"],
                    "status": record["status"],
                }
            )
        return sorted(videos, key=lambda item: item["title"].casefold())

    def get(self, video_id: str) -> dict[str, Any]:
        record = self._read_record(video_id)
        cues = self._cues(video_id)
        return {
            "id": video_id,
            "title": record["title"],
            "status": record["status"],
            "stage": record.get("stage"),
            "error": record.get("error"),
            "warnings": record.get("warnings", []),
            "descriptions": [self._description(cue) for cue in cues],
            "audioGenerated": record.get("audioGenerated", 0),
            "videoUrl": f"/api/videos/{video_id}/content",
            "audioUrls": [
                f"/api/videos/{video_id}/audio/{index}"
                f"?v={self._preview_hash(cue)}"
                for index, cue in enumerate(cues)
            ],
        }

    def source(self, video_id: str) -> Path:
        self._read_record(video_id)
        path = self._directory(video_id) / "source.mp4"
        if not path.is_file():
            raise VideoError("Video content was not found.", 404)
        return path

    def audio(self, video_id: str, index: int) -> Path:
        cues = self._cues(video_id)
        if index < 0 or index >= len(cues):
            raise VideoError("Audio preview was not found.", 404)
        path = self._preview_path(video_id, cues[index])
        if not path.is_file():
            raise VideoError("Audio preview was not found.", 404)
        return path

    def start_processing(self, video_id: str) -> None:
        record = self._read_record(video_id)
        if not self.source(video_id).is_file():
            raise VideoError("Upload the video before processing it.", 409)

        with self.lock:
            if video_id in self.active:
                return
            record.update(
                {
                    "status": "processing",
                    "stage": "preparing",
                    "error": None,
                    "warnings": [],
                    "audioGenerated": 0,
                }
            )
            self._write_record(video_id, record)
            future = self.executor.submit(self._generate, video_id)
            self.active[video_id] = future
            future.add_done_callback(
                lambda _future: self._remove_active(video_id)
            )

    def update_descriptions(
        self, video_id: str, descriptions: Sequence[dict[str, Any]]
    ) -> dict[str, Any]:
        self._ensure_not_active(video_id)
        record = self._read_record(video_id)
        cues = self._validated_cues(descriptions)
        self._write_vtt(video_id, cues)
        record.update(
            {
                "status": "processing",
                "stage": "synthesizing",
                "error": None,
                "audioGenerated": 0,
                "renderFingerprint": None,
            }
        )
        self._write_record(video_id, record)
        try:
            self._ensure_previews(video_id, cues, record)
        except Exception as exc:
            record.update(
                {"status": "failed", "stage": None, "error": str(exc)}
            )
            self._write_record(video_id, record)
            raise VideoError(str(exc), 500) from exc
        record.update({"status": "ready", "stage": None, "error": None})
        self._write_record(video_id, record)
        return self.get(video_id)

    def render(self, video_id: str) -> tuple[Path, str]:
        self._ensure_not_active(video_id)
        record = self._read_record(video_id)
        draft = self._draft(video_id)
        if not draft.is_file() or not self._cues(video_id):
            raise VideoError("The video has no audio descriptions to render.")

        fingerprint = self._render_fingerprint(draft)
        output = self._directory(video_id) / f"rendered-{fingerprint}.mp4"
        if (
            output.is_file()
            and record.get("renderFingerprint") == fingerprint
        ):
            return output, f"{record['title']}_output.mp4"

        workspace = self._workspace(video_id, "render")
        try:
            self.services.render_ad(
                self.source(video_id),
                draft,
                output,
                speech=self.services.speech,
                voice=self.voice,
                workspace=workspace,
            )
        except Exception as exc:
            raise VideoError(str(exc), 400) from exc
        record["renderFingerprint"] = fingerprint
        self._write_record(video_id, record)
        return output, f"{record['title']}_output.mp4"

    def delete(self, video_id: str) -> None:
        self._read_record(video_id)
        self._ensure_not_active(video_id)
        try:
            shutil.rmtree(self._directory(video_id))
        except PermissionError as exc:
            raise VideoError(
                "Close the video player and try deleting again.", 409
            ) from exc

    def wait(self, video_id: str, timeout: float = 10.0) -> None:
        with self.lock:
            future = self.active.get(video_id)
        if future is not None:
            future.result(timeout=timeout)

    def _generate(self, video_id: str) -> None:
        record = self._read_record(video_id)
        draft = self._draft(video_id)
        workspace = self._workspace(video_id, "generate")

        def progress(stage: str, current: int, total: int) -> None:
            latest = self._read_record(video_id)
            latest.update(
                {
                    "stage": stage,
                    "progress": {"current": current, "total": total},
                }
            )
            self._write_record(video_id, latest)

        try:
            result = self.services.generate_ad(
                self.source(video_id),
                draft,
                speech=self.services.speech,
                openai_client=self.services.openai_client,
                model=self.services.model,
                workspace=workspace,
                progress=progress,
            )
            record = self._read_record(video_id)
            record["warnings"] = [
                {
                    "stage": warning.stage,
                    "start": warning.start,
                    "end": warning.end,
                    "error": warning.error,
                }
                for warning in result.warnings
            ]
            record["stage"] = "synthesizing"
            record["audioGenerated"] = 0
            self._write_record(video_id, record)
            self._ensure_previews(video_id, result.cues, record)
            record.update({"status": "ready", "stage": None, "error": None})
            self._write_record(video_id, record)
        except Exception as exc:
            record = self._read_record(video_id)
            record.update(
                {"status": "failed", "stage": None, "error": str(exc)}
            )
            self._write_record(video_id, record)

    def _ensure_previews(
        self,
        video_id: str,
        cues: Sequence[vtt.Cue],
        record: dict[str, Any],
    ) -> None:
        preview = self._directory(video_id) / "preview"
        preview.mkdir(exist_ok=True)
        for index, cue in enumerate(cues, start=1):
            output = self._preview_path(video_id, cue)
            if not output.is_file():
                temporary = output.with_suffix(".tmp.wav")
                temporary.unlink(missing_ok=True)
                try:
                    self.services.speech.synthesize(
                        cue.text,
                        temporary,
                        self.voice,
                        rate_pct=0,
                    )
                    temporary.replace(output)
                finally:
                    temporary.unlink(missing_ok=True)
            record["audioGenerated"] = index
            self._write_record(video_id, record)

    def _preview_path(self, video_id: str, cue: vtt.Cue) -> Path:
        return (
            self._directory(video_id)
            / "preview"
            / f"{self._preview_hash(cue)}.wav"
        )

    def _preview_hash(self, cue: vtt.Cue) -> str:
        return hashlib.sha256(
            (
                "preview-v1\0"
                + self.voice
                + "\0rate=0\0"
                + cue.text
            ).encode("utf-8")
        ).hexdigest()

    def _render_fingerprint(self, draft: Path) -> str:
        digest = hashlib.sha256()
        digest.update(b"render-v1\0")
        digest.update(self.voice.encode("utf-8"))
        digest.update(b"\0")
        digest.update(draft.read_bytes())
        return digest.hexdigest()

    def _validated_cues(
        self, descriptions: Sequence[dict[str, Any]]
    ) -> tuple[vtt.Cue, ...]:
        if not isinstance(descriptions, list):
            raise VideoError("Descriptions must be an array.")
        cues = []
        for number, description in enumerate(descriptions, start=1):
            try:
                start = self._parse_time(description["startTime"])
                end = self._parse_time(description["endTime"])
                text = str(description["description"]).strip()
            except (KeyError, TypeError, vtt.VTTError) as exc:
                raise VideoError(
                    f"Description {number} is invalid: {exc}"
                ) from exc
            if not text:
                raise VideoError(f"Description {number} has no text.")
            cues.append(vtt.Cue(start, end, text))
        return tuple(sorted(cues, key=lambda cue: cue.start))

    @staticmethod
    def _parse_time(value: Any) -> float:
        text = str(value).strip()
        if ":" not in text:
            try:
                seconds = float(text)
            except ValueError as exc:
                raise vtt.VTTError(f"Malformed timestamp: {text!r}.") from exc
        else:
            if "." not in text:
                text += ".000"
            seconds = vtt.parse_timestamp(text)
        if not math.isfinite(seconds) or seconds < 0:
            raise vtt.VTTError(f"Malformed timestamp: {text!r}.")
        return seconds

    def _write_vtt(self, video_id: str, cues: Sequence[vtt.Cue]) -> None:
        draft = self._draft(video_id)
        temporary = draft.with_suffix(".tmp.vtt")
        try:
            vtt.write(cues, temporary)
            vtt.read(temporary)
            temporary.replace(draft)
        except (OSError, vtt.VTTError) as exc:
            raise VideoError(str(exc)) from exc
        finally:
            temporary.unlink(missing_ok=True)

    def _cues(self, video_id: str) -> tuple[vtt.Cue, ...]:
        draft = self._draft(video_id)
        if not draft.is_file():
            return ()
        try:
            return vtt.read(draft)
        except vtt.VTTError as exc:
            raise VideoError(str(exc), 500) from exc

    @staticmethod
    def _description(cue: vtt.Cue) -> dict[str, Any]:
        return {
            "startTime": vtt.format_timestamp(cue.start),
            "endTime": vtt.format_timestamp(cue.end),
            "description": cue.text,
        }

    def _workspace(self, video_id: str, name: str) -> Path:
        workspace = self._directory(video_id) / "work" / name
        shutil.rmtree(workspace, ignore_errors=True)
        workspace.mkdir(parents=True)
        return workspace

    def _draft(self, video_id: str) -> Path:
        return self._directory(video_id) / "draft.vtt"

    def _directory(self, video_id: str) -> Path:
        if (
            not video_id
            or any(character not in "0123456789abcdef" for character in video_id)
            or len(video_id) != 32
        ):
            raise VideoError("Video not found.", 404)
        return self.root / video_id

    def _record_path(self, video_id: str) -> Path:
        return self._directory(video_id) / "video.json"

    def _read_record(self, video_id: str) -> dict[str, Any]:
        path = self._record_path(video_id)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise VideoError("Video not found.", 404) from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise VideoError("Video metadata could not be read.", 500) from exc

    def _write_record(
        self, video_id: str, record: dict[str, Any]
    ) -> None:
        path = self._record_path(video_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".video.",
            suffix=".json",
            delete=False,
        ) as handle:
            json.dump(record, handle, indent=2)
            temporary = Path(handle.name)
        temporary.replace(path)

    def _remove_active(self, video_id: str) -> None:
        with self.lock:
            self.active.pop(video_id, None)

    def _ensure_not_active(self, video_id: str) -> None:
        with self.lock:
            if video_id in self.active:
                raise VideoError(
                    "The video cannot be changed while it is processing.", 409
                )

    def _mark_interrupted(self) -> None:
        for summary in self.list():
            record = self._read_record(summary["id"])
            if record["status"] == "processing":
                record.update(
                    {
                        "status": "failed",
                        "stage": None,
                        "error": "Processing was interrupted when the server stopped.",
                    }
                )
                self._write_record(summary["id"], record)

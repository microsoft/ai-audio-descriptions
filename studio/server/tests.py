from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path

from engine import vtt
from engine.ad import ADWarning, GenerateADResult, RenderADResult
from studio.server.app import create_app
from studio.server.videos import Services, VideoStore


class FakeSpeech:
    def __init__(self) -> None:
        self.texts: list[str] = []

    def synthesize(
        self,
        text: str,
        output: str | Path,
        _voice: str,
        rate_pct: int = 0,
    ) -> Path:
        self.texts.append(f"{rate_pct}:{text}")
        path = Path(output)
        path.write_bytes(b"wav")
        return path


class FakeEngine:
    def __init__(self) -> None:
        self.generate_calls = 0
        self.render_calls = 0

    def generate(self, _source, output, **options):
        self.generate_calls += 1
        cues = (
            vtt.Cue(1.0, 3.0, "She opens the door."),
            vtt.Cue(5.0, 7.0, "A dog runs inside."),
        )
        vtt.write(cues, output)
        progress = options.get("progress")
        if progress:
            progress("describing", 2, 2)
        return GenerateADResult(
            Path(output),
            cues,
            (ADWarning("frames", 1.0, 3.0, "One frame failed."),),
        )

    def render(self, _source, _draft, output, **_options):
        self.render_calls += 1
        path = Path(output)
        path.write_bytes(b"rendered")
        return RenderADResult(path, ())


class StudioServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.speech = FakeSpeech()
        self.engine = FakeEngine()
        self.store = VideoStore(
            self.root,
            Services(
                self.speech,
                object(),
                "model",
                self.engine.generate,
                self.engine.render,
            ),
        )
        self.app = create_app(self.store)
        self.app.testing = True
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.store.close()
        self.temporary.cleanup()

    def upload(self, title: str = "Example") -> dict:
        response = self.client.post(
            "/api/videos",
            data={
                "title": title,
                "video": (io.BytesIO(b"video"), "example.mp4"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def test_upload_list_content_and_delete(self):
        video = self.upload()
        self.assertEqual(video["status"], "uploaded")
        self.assertEqual(
            self.client.get("/api/videos").get_json(),
            [{"id": video["id"], "status": "uploaded", "title": "Example"}],
        )
        content = self.client.get(video["videoUrl"], buffered=True)
        try:
            self.assertEqual(content.status_code, 200)
            self.assertEqual(content.data, b"video")
        finally:
            content.close()
        self.assertEqual(
            self.client.delete(f"/api/videos/{video['id']}").status_code,
            204,
        )
        self.assertEqual(self.client.get("/api/videos").get_json(), [])

    def test_video_content_supports_range_requests(self):
        video = self.upload()
        response = self.client.get(
            video["videoUrl"],
            headers={"Range": "bytes=1-3"},
            buffered=True,
        )
        try:
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.data, b"ide")
        finally:
            response.close()

    def test_duplicate_titles_are_rejected(self):
        self.upload()
        response = self.client.post(
            "/api/videos",
            data={
                "title": "example",
                "video": (io.BytesIO(b"video"), "other.mp4"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 409)

    def test_process_generates_draft_previews_and_progress(self):
        video = self.upload()
        response = self.client.post(f"/api/videos/{video['id']}/process")
        self.assertEqual(response.status_code, 202)
        self.store.wait(video["id"])

        processed = self.client.get(f"/api/videos/{video['id']}").get_json()
        self.assertEqual(processed["status"], "ready")
        self.assertEqual(processed["audioGenerated"], 2)
        self.assertEqual(len(processed["descriptions"]), 2)
        self.assertEqual(len(processed["audioUrls"]), 2)
        self.assertEqual(len(self.speech.texts), 2)
        self.assertEqual(self.engine.generate_calls, 1)
        self.assertEqual(processed["warnings"][0]["stage"], "frames")
        preview = self.client.get(processed["audioUrls"][0], buffered=True)
        try:
            self.assertEqual(preview.data, b"wav")
        finally:
            preview.close()

    def test_unchanged_descriptions_reuse_preview_audio(self):
        video = self.upload()
        self.client.post(f"/api/videos/{video['id']}/process")
        self.store.wait(video["id"])
        current = self.client.get(f"/api/videos/{video['id']}").get_json()
        initial_calls = len(self.speech.texts)

        response = self.client.put(
            f"/api/videos/{video['id']}/descriptions",
            json={"descriptions": current["descriptions"]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.speech.texts), initial_calls)

        changed = current["descriptions"]
        changed[0]["description"] = "She closes the door."
        response = self.client.put(
            f"/api/videos/{video['id']}/descriptions",
            json={"descriptions": changed},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.speech.texts), initial_calls + 1)

    def test_overlapping_descriptions_are_rejected(self):
        video = self.upload()
        response = self.client.put(
            f"/api/videos/{video['id']}/descriptions",
            json={
                "descriptions": [
                    {
                        "startTime": "00:00:01.000",
                        "endTime": "00:00:03.000",
                        "description": "First.",
                    },
                    {
                        "startTime": "00:00:02.000",
                        "endTime": "00:00:04.000",
                        "description": "Second.",
                    },
                ]
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlaps", response.get_json()["error"])

    def test_render_is_reused_until_descriptions_change(self):
        video = self.upload()
        self.client.post(f"/api/videos/{video['id']}/process")
        self.store.wait(video["id"])

        first = self.client.post(
            f"/api/videos/{video['id']}/render", buffered=True
        )
        second = self.client.post(
            f"/api/videos/{video['id']}/render", buffered=True
        )
        try:
            self.assertEqual(first.data, b"rendered")
            self.assertEqual(second.data, b"rendered")
        finally:
            first.close()
            second.close()
        self.assertEqual(self.engine.render_calls, 1)

        current = self.client.get(f"/api/videos/{video['id']}").get_json()
        current["descriptions"][0]["description"] = "Changed."
        self.client.put(
            f"/api/videos/{video['id']}/descriptions",
            json={"descriptions": current["descriptions"]},
        )
        rendered = self.client.post(
            f"/api/videos/{video['id']}/render", buffered=True
        )
        rendered.close()
        self.assertEqual(self.engine.render_calls, 2)

    def test_rerender_does_not_replace_an_active_download(self):
        video = self.upload()
        self.client.post(f"/api/videos/{video['id']}/process")
        self.store.wait(video["id"])
        download = self.client.post(f"/api/videos/{video['id']}/render")
        try:
            current = self.client.get(
                f"/api/videos/{video['id']}"
            ).get_json()
            current["descriptions"][0]["description"] = "Changed."
            self.client.put(
                f"/api/videos/{video['id']}/descriptions",
                json={"descriptions": current["descriptions"]},
            )
            rerendered = self.client.post(
                f"/api/videos/{video['id']}/render",
                buffered=True,
            )
            try:
                self.assertEqual(rerendered.status_code, 200)
                self.assertEqual(rerendered.data, b"rendered")
            finally:
                rerendered.close()
        finally:
            download.close()

    def test_invalid_video_id_cannot_escape_data_directory(self):
        response = self.client.get("/api/videos/..%2F..%2Fsecret")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file, send_from_directory
from werkzeug.exceptions import HTTPException

from engine.ad import DEFAULT_VOICE, generate_ad, render_ad
from engine.speech import AzureSpeech
from studio.server.videos import Services, VideoError, VideoStore


ROOT = Path(__file__).resolve().parents[2]
WEB_DIST = ROOT / "studio" / "web" / "dist"
OPENAI_API_VERSION = "2025-04-01-preview"
COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default"


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing server configuration: {name}")
    return value


def _services() -> Services:
    try:
        from azure.identity import (
            DefaultAzureCredential,
            get_bearer_token_provider,
        )
        from openai import AzureOpenAI
    except ImportError as exc:
        raise RuntimeError("Install the dependencies in requirements.txt.") from exc

    resource = _required("FOUNDRY_RESOURCE")
    resource_id = _required("FOUNDRY_RESOURCE_ID")
    model = _required("GPT_DEPLOYMENT")
    credential = DefaultAzureCredential()
    speech = AzureSpeech(
        credential,
        f"https://{resource}.cognitiveservices.azure.com/",
        resource_id,
    )
    token_provider = get_bearer_token_provider(credential, COGNITIVE_SCOPE)
    openai_client = AzureOpenAI(
        azure_endpoint=f"https://{resource}.openai.azure.com/",
        azure_ad_token_provider=token_provider,
        api_version=OPENAI_API_VERSION,
        timeout=90.0,
        max_retries=3,
    )
    return Services(speech, openai_client, model, generate_ad, render_ad)


def create_app(store: VideoStore | None = None) -> Flask:
    load_dotenv(ROOT / ".env")
    app = Flask(__name__, static_folder=None)
    video_store = store or VideoStore(
        Path(os.environ.get("AIAD_DATA_DIR", ROOT / "data")),
        _services(),
        os.environ.get("SPEECH_VOICE", DEFAULT_VOICE),
    )
    app.extensions["video_store"] = video_store

    @app.get("/api/videos")
    def list_videos() -> Any:
        return jsonify(video_store.list())

    @app.post("/api/videos")
    def create_video() -> Any:
        video = video_store.create(
            request.form.get("title", ""),
            request.files.get("video"),
        )
        return jsonify(video), 201

    @app.get("/api/videos/<video_id>")
    def get_video(video_id: str) -> Any:
        return jsonify(video_store.get(video_id))

    @app.get("/api/videos/<video_id>/content")
    def get_video_content(video_id: str) -> Any:
        return send_file(video_store.source(video_id), conditional=True)

    @app.get("/api/videos/<video_id>/audio/<int:index>")
    def get_audio(video_id: str, index: int) -> Any:
        return send_file(
            video_store.audio(video_id, index),
            mimetype="audio/wav",
            conditional=True,
        )

    @app.post("/api/videos/<video_id>/process")
    def process_video(video_id: str) -> Any:
        video_store.start_processing(video_id)
        return "", 202

    @app.put("/api/videos/<video_id>/descriptions")
    def update_descriptions(video_id: str) -> Any:
        payload = request.get_json(silent=True) or {}
        descriptions = payload.get("descriptions")
        if not isinstance(descriptions, list):
            raise VideoError("Descriptions must be an array.")
        return jsonify(
            video_store.update_descriptions(video_id, descriptions)
        )

    @app.post("/api/videos/<video_id>/render")
    def render_video(video_id: str) -> Any:
        path, name = video_store.render(video_id)
        return send_file(path, as_attachment=True, download_name=name)

    @app.delete("/api/videos/<video_id>")
    def delete_video(video_id: str) -> Any:
        video_store.delete(video_id)
        return "", 204

    @app.errorhandler(VideoError)
    def video_error(error: VideoError) -> Any:
        return jsonify({"error": str(error)}), error.status

    @app.errorhandler(413)
    def upload_too_large(_error: Any) -> Any:
        return jsonify({"error": "The uploaded video is too large."}), 413

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception) -> Any:
        if isinstance(error, HTTPException):
            return error
        app.logger.exception("Request failed")
        return jsonify({"error": str(error) or "The request failed."}), 500

    @app.route(
        "/api/<path:_path>",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    )
    def api_not_found(_path: str) -> Any:
        return jsonify({"error": "API endpoint not found."}), 404

    @app.get("/")
    @app.get("/<path:path>")
    def frontend(path: str = "") -> Any:
        requested = WEB_DIST / path
        if path and requested.is_file():
            return send_from_directory(WEB_DIST, path)
        index = WEB_DIST / "index.html"
        if not index.is_file():
            return (
                "Studio frontend has not been built. Run npm run build in "
                "studio/web.",
                404,
            )
        return send_from_directory(WEB_DIST, "index.html")

    return app

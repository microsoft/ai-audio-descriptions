from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default"
FAST_TRANSCRIPTION_API_VERSION = "2025-10-15"
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 300.0
RETRIES = 3
VOICE_STYLE = "narration-professional"


class SpeechError(RuntimeError):
    pass


@dataclass(frozen=True)
class TranscriptSegment:
    start: float
    end: float
    text: str
    speech_spans: tuple[tuple[float, float], ...] = ()


def _transcript_segments(payload: dict[str, Any]) -> tuple[TranscriptSegment, ...]:
    segments = []
    for phrase in payload.get("phrases", []) or []:
        start = float(phrase.get("offsetMilliseconds", 0)) / 1000.0
        duration = float(phrase.get("durationMilliseconds", 0)) / 1000.0
        text = (phrase.get("text") or "").strip()
        speech_spans = []
        for word in phrase.get("words", []) or []:
            word_start = float(word.get("offsetMilliseconds", 0)) / 1000.0
            word_duration = (
                float(word.get("durationMilliseconds", 0)) / 1000.0
            )
            if word_duration > 0:
                speech_spans.append(
                    (word_start, word_start + word_duration)
                )
        if duration <= 0 and not text and not speech_spans:
            continue
        spans = tuple(sorted(speech_spans))
        end = start + duration
        if spans and duration <= 0:
            start, end = spans[0][0], spans[-1][1]
        if not spans and duration > 0:
            spans = ((start, end),)
        segments.append(
            TranscriptSegment(start, end, text, spans)
        )
    return tuple(sorted(segments, key=lambda segment: segment.start))


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _ssml(text: str, voice: str, rate_pct: int = 0) -> str:
    body = _xml_escape(text)
    if rate_pct:
        body = f'<prosody rate="{rate_pct:+d}%">{body}</prosody>'
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">'
        f'<voice name="{_xml_escape(voice)}">'
        f'<mstts:express-as style="{VOICE_STYLE}">{body}</mstts:express-as>'
        "</voice></speak>"
    )


def _speech_config(
    speechsdk: Any, endpoint: str, resource_id: str, token: str
) -> Any:
    config = speechsdk.SpeechConfig(endpoint=endpoint.rstrip("/") + "/")
    config.authorization_token = f"aad#{resource_id}#{token}"
    return config


def _session() -> Any:
    try:
        import requests
        from requests.adapters import HTTPAdapter
        from urllib3.util import Retry
    except ImportError as exc:
        raise SpeechError(
            "requests and urllib3 are required for transcription."
        ) from exc

    retry = Retry(
        total=RETRIES,
        backoff_factor=0.5,
        backoff_jitter=0.5,
        status_forcelist=(408, 429, 500, 502, 503, 504),
        allowed_methods={"POST"},
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


class AzureSpeech:
    def __init__(self, credential: Any, endpoint: str, resource_id: str) -> None:
        if credential is None:
            raise ValueError("credential is required")
        if not endpoint:
            raise ValueError("endpoint is required")
        if not resource_id:
            raise ValueError("resource_id is required")
        self.credential = credential
        self.endpoint = endpoint.rstrip("/")
        self.resource_id = resource_id

    def _token(self) -> str:
        return self.credential.get_token(COGNITIVE_SCOPE).token

    def transcribe(
        self, wav: str | Path, locale: str = "en-US"
    ) -> tuple[TranscriptSegment, ...]:
        path = Path(wav)
        try:
            token = self._token()
            with path.open("rb") as handle:
                response = _session().post(
                    (
                        f"{self.endpoint}/speechtotext/transcriptions:transcribe"
                        f"?api-version={FAST_TRANSCRIPTION_API_VERSION}"
                    ),
                    headers={"Authorization": f"Bearer {token}"},
                    files={
                        "audio": (path.name, handle, "audio/wav"),
                        "definition": (
                            None,
                            json.dumps({"locales": [locale]}),
                            "application/json",
                        ),
                    },
                    timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                )
            if response.status_code >= 400:
                detail = (response.text or "").strip()[:500]
                raise SpeechError(
                    f"Transcription failed with HTTP {response.status_code}"
                    + (f": {detail}" if detail else ".")
                )
            payload = response.json()
        except SpeechError:
            raise
        except Exception as exc:
            raise SpeechError(f"Transcription failed: {exc}") from exc

        return _transcript_segments(payload)

    def synthesize(
        self,
        text: str,
        output_wav: str | Path,
        voice: str,
        rate_pct: int = 0,
    ) -> Path:
        try:
            import azure.cognitiveservices.speech as speechsdk
        except ImportError as exc:
            raise SpeechError(
                "azure-cognitiveservices-speech is required for synthesis."
            ) from exc

        output = Path(output_wav)
        try:
            config = _speech_config(
                speechsdk,
                self.endpoint,
                self.resource_id,
                self._token(),
            )
            config.speech_synthesis_voice_name = voice
            config.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
            )
            audio = speechsdk.audio.AudioOutputConfig(filename=str(output))
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=config, audio_config=audio
            )
            result = synthesizer.speak_ssml_async(
                _ssml(text, voice, rate_pct)
            ).get()
        except Exception as exc:
            raise SpeechError(f"Speech synthesis failed: {exc}") from exc

        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            detail = ""
            if result.reason == speechsdk.ResultReason.Canceled:
                detail = str(result.cancellation_details.error_details or "")
            raise SpeechError(
                f"Speech synthesis failed: {result.reason}"
                + (f" {detail}" if detail else "")
            )
        del synthesizer
        return output

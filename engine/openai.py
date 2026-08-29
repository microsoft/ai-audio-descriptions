from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any, Sequence


def encode_frame(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def generate_description(
    client: Any,
    model: str,
    system_prompt: str,
    text_prompt: str,
    frame_paths: Sequence[Path],
) -> str:
    content: list[dict[str, Any]] = [{"type": "text", "text": text_prompt}]
    content.extend(
        {
            "type": "image_url",
            "image_url": {"url": encode_frame(frame)},
        }
        for frame in frame_paths
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        max_completion_tokens=4000,
    )
    choices = getattr(response, "choices", None) or ()
    if not choices:
        raise RuntimeError("The model returned no choices.")
    text = getattr(choices[0].message, "content", "") or ""
    normalized = re.sub(r"\s+", " ", text).strip().strip(' "')
    return "" if normalized.upper().startswith("SKIP") else normalized

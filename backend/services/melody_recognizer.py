"""
Melody (query-by-humming) recognition.

Lyric search needs words; a hummed or "la la la" clip has none, so Whisper
returns nothing useful. When ACRCloud credentials are configured, the
upload pipeline sends such clips here instead. ACRCloud's humming bucket
matches the melody itself (free trial at https://www.acrcloud.com/ — create
an "Audio & Video Recognition" project with the humming bucket enabled).

Protocol: https://docs.acrcloud.com/reference/identification-api
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from typing import Callable, Optional

import requests

logger = logging.getLogger(__name__)


@dataclass
class MelodyMatch:
    song: str
    artist: str
    score: float  # 0..100
    offset_seconds: Optional[float]
    spotify_track_id: Optional[str]
    source: str  # "humming" | "music"


def sign(access_key: str, access_secret: str, timestamp: str) -> str:
    """HMAC-SHA1 request signature defined by the ACRCloud identify API."""
    string_to_sign = "\n".join(["POST", "/v1/identify", access_key, "audio", "1", timestamp])
    digest = hmac.new(access_secret.encode("ascii"), string_to_sign.encode("ascii"), hashlib.sha1).digest()
    return base64.b64encode(digest).decode("ascii")


def _score(raw) -> float:
    """ACRCloud reports humming scores in 0..1 and music scores in 0..100."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.0
    return value * 100 if value <= 1 else value


def parse_response(payload: dict) -> list[MelodyMatch]:
    """Turn an ACRCloud identify response into ranked matches (pure)."""
    status = (payload or {}).get("status") or {}
    if status.get("code") != 0:
        return []
    metadata = payload.get("metadata") or {}
    out: list[MelodyMatch] = []
    seen: set[tuple[str, str]] = set()
    for source in ("music", "humming"):
        for item in metadata.get(source) or []:
            title = str(item.get("title") or "").strip()
            artists = ", ".join(a.get("name", "") for a in (item.get("artists") or []) if a.get("name"))
            if not title:
                continue
            key = (title.lower(), artists.lower())
            if key in seen:
                continue
            seen.add(key)
            spotify = ((item.get("external_metadata") or {}).get("spotify") or {}).get("track") or {}
            offset = item.get("play_offset_ms")
            out.append(MelodyMatch(
                song=title,
                artist=artists,
                score=round(_score(item.get("score")), 1),
                offset_seconds=(float(offset) / 1000.0) if isinstance(offset, (int, float)) and offset > 0 else None,
                spotify_track_id=spotify.get("id") or None,
                source=source,
            ))
    out.sort(key=lambda m: m.score, reverse=True)
    return out


class MelodyRecognizer:
    """Thin ACRCloud client. `post` is injectable for tests."""

    def __init__(self, host: str, access_key: str, access_secret: str,
                 post: Optional[Callable[..., requests.Response]] = None, timeout: float = 15.0):
        self.host = host.replace("https://", "").replace("http://", "").strip("/")
        self.access_key = access_key
        self.access_secret = access_secret
        self._post = post or requests.post
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.host and self.access_key and self.access_secret)

    def recognize(self, audio_path: str) -> list[MelodyMatch]:
        """Identify a clip by melody. Returns [] on any failure (fail-soft)."""
        if not self.configured:
            return []
        try:
            with open(audio_path, "rb") as f:
                sample = f.read()
        except OSError:
            return []
        timestamp = str(int(time.time()))
        data = {
            "access_key": self.access_key,
            "sample_bytes": str(len(sample)),
            "timestamp": timestamp,
            "signature": sign(self.access_key, self.access_secret, timestamp),
            "data_type": "audio",
            "signature_version": "1",
        }
        try:
            response = self._post(
                f"https://{self.host}/v1/identify",
                data=data,
                files={"sample": ("sample.wav", sample, "audio/wav")},
                timeout=self.timeout,
            )
            return parse_response(response.json())
        except Exception as exc:  # network, JSON, provider errors
            logger.warning("Melody recognition failed: %s", exc)
            return []

"""
Runtime configuration for the LyricSpot backend, read once from the
environment (and backend/.env). Every tunable lives here so modules never
parse os.environ themselves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # HTTP
    cors_origins: list[str] = field(default_factory=lambda: _list(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,https://shashwat1729.github.io",
    ))

    # Input limits
    max_lyrics_length: int = _int("MAX_LYRICS_LENGTH", 1000)
    max_upload_bytes: int = _int("MAX_UPLOAD_BYTES", 5_000_000)
    identify_timeout_s: float = _float("IDENTIFY_TIMEOUT", 45.0)

    # Pipeline breadth
    candidate_pool: int = _int("CANDIDATE_POOL", 20)
    candidates_verified: int = _int("CANDIDATES_VERIFIED", 15)
    max_results: int = _int("MAX_RESULTS", 12)

    # Confidence bands
    transcription_min_confidence: float = _float("TRANSCRIPTION_MIN_CONFIDENCE", 0.35)
    confidence_high_threshold: int = _int("CONFIDENCE_HIGH_THRESHOLD", 70)
    confidence_high_margin: float = _float("CONFIDENCE_HIGH_MARGIN", 10)

    # Voice
    whisper_model: str = os.getenv("WHISPER_MODEL", "base")
    whisper_preload: bool = os.getenv("WHISPER_PRELOAD", "1") != "0"

    # Melody (humming) recognition via ACRCloud — optional.
    acr_host: str = os.getenv("ACRCLOUD_HOST", "").strip()
    acr_access_key: str = os.getenv("ACRCLOUD_ACCESS_KEY", "").strip()
    acr_access_secret: str = os.getenv("ACRCLOUD_ACCESS_SECRET", "").strip()

    @property
    def spotify_configured(self) -> bool:
        return bool(os.getenv("SPOTIFY_CLIENT_ID") and os.getenv("SPOTIFY_CLIENT_SECRET"))

    @property
    def melody_configured(self) -> bool:
        return bool(self.acr_host and self.acr_access_key and self.acr_access_secret)


settings = Settings()

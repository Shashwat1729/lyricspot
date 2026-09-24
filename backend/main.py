"""
LyricSpot - FastAPI backend (HTTP layer only).

Routes validate input and delegate to services:
  - services.pipeline.IdentificationPipeline: transcript -> ranked songs
  - services.transcriber / audio_processor: voice clip -> transcript (Whisper)
  - services.melody_recognizer: hummed clip -> songs (optional, ACRCloud)

Text search works with requirements-core.txt alone. Voice input needs
ffmpeg + openai-whisper; /health reports which capabilities are live so the
frontend picks the right input path.
"""

import asyncio
import json
import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
from services.audio_processor import AudioProcessor
from services.confidence_calculator import confidence_label
from services.feedback_store import FeedbackStore
from services.lyrics_fetcher import LyricsFetcher
from services.melody_recognizer import MelodyRecognizer
from services.pipeline import IdentificationPipeline
from services.song_identifier import SongIdentifier
from services.spotify_linker import SpotifyLinker
from services.timestamp_matcher import TimestampMatcher
from services.transcriber import TranscriptionService

APP_VERSION = "2.0.0"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ---- services (module-level singletons, patched in tests) -------------------

audio_processor = AudioProcessor()
transcriber = TranscriptionService()
spotify_linker = SpotifyLinker()
feedback_store = FeedbackStore()
melody_recognizer = MelodyRecognizer(settings.acr_host, settings.acr_access_key, settings.acr_access_secret)
pipeline = IdentificationPipeline(
    identifier=SongIdentifier(),
    lyrics=LyricsFetcher(),
    matcher=TimestampMatcher(),
    spotify=spotify_linker,
    feedback=feedback_store,
    settings=settings,
)

# Whisper is CPU/RAM heavy: cap concurrent transcriptions.
_upload_semaphore = asyncio.Semaphore(4)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(Path(__file__).parent / "uploads")))
try:
    UPLOAD_DIR.mkdir(exist_ok=True)
except OSError:
    UPLOAD_DIR = Path("/tmp/lyricspot_uploads")
    UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_AUDIO_TYPES = {
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/mp4",
    "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/x-m4a",
    "video/webm", "video/mp4", "video/ogg",
    "application/ogg", "application/octet-stream",
}


def _voice_enabled() -> bool:
    """Voice input needs both the whisper package and the ffmpeg binary."""
    return TranscriptionService.is_available() and AudioProcessor.ffmpeg_available()


def _confidence_label(top_confidence: int, margin: float) -> str:
    """UX band from absolute score + top-1/top-2 margin (env thresholds)."""
    return confidence_label(
        top_confidence, margin,
        high_threshold=settings.confidence_high_threshold,
        high_margin=settings.confidence_high_margin,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    executor = ThreadPoolExecutor(max_workers=6)
    pipeline.executor = executor
    if _voice_enabled() and settings.whisper_preload:
        logger.info("Preloading Whisper model '%s'...", settings.whisper_model)
        try:
            await asyncio.to_thread(transcriber._load_model)
            logger.info("Whisper model loaded.")
        except Exception:
            # Non-fatal: text search still works; /upload retries the load.
            logger.exception("Whisper preload failed — voice input will retry on first upload")
    elif not TranscriptionService.is_available():
        logger.warning("openai-whisper not installed — text-only mode (voice input disabled).")
    elif not AudioProcessor.ffmpeg_available():
        logger.warning("ffmpeg not found on PATH — voice input disabled.")
    if not settings.spotify_configured:
        logger.info("SPOTIFY_CLIENT_ID/SECRET not set — Spotify links are search URLs (frontend resolves tracks).")
    if settings.melody_configured:
        logger.info("ACRCloud configured — hummed clips are matched by melody.")
    yield
    executor.shutdown(wait=False)
    from services.song_identifier import _identify_executor
    _identify_executor.shutdown(wait=False)


app = FastAPI(
    title="LyricSpot",
    description="Sing or type a lyric, find the song and the second it plays.",
    version=APP_VERSION,
    lifespan=lifespan,
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # no cookies/sessions
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# ---- schemas -------------------------------------------------------------------

class LyricsQuery(BaseModel):
    lyrics: str = Field(..., max_length=1000)


class FeedbackIn(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    song: str = Field(..., min_length=1, max_length=300)
    artist: str = Field("", max_length=300)
    action: Literal["up", "down"]


# ---- routes -------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """Health check + capability report used by the frontend engine picker."""
    voice = _voice_enabled()
    return {
        "status": "healthy",
        "version": APP_VERSION,
        "voice": voice,
        "melody": voice and melody_recognizer.configured,
        "whisper_model": transcriber.model_name if voice else None,
        "whisper_loaded": transcriber.is_loaded,
        "spotify": settings.spotify_configured,
    }


@app.post("/identify")
@limiter.limit("60/minute")
async def identify_text(request: Request, body: LyricsQuery):
    """Typed lyrics -> ranked songs with timestamps."""
    try:
        result = await asyncio.wait_for(pipeline.identify(body.lyrics), timeout=settings.identify_timeout_s)
    except asyncio.TimeoutError:
        logger.warning("identify timed out after %.0fs", settings.identify_timeout_s)
        result = pipeline.failure("The search took too long. Try again with a shorter line.", body.lyrics[:100])
    except Exception:
        logger.exception("identify failed")
        return JSONResponse(status_code=500, content=pipeline.failure("Processing failed. Please try again."))
    return JSONResponse(content=result)


@app.post("/identify/stream")
@limiter.limit("20/minute")
async def identify_text_stream(request: Request, body: LyricsQuery):
    """Server-sent events version of /identify (progress per stage)."""
    async def generate():
        async for event in pipeline.identify_stream(body.lyrics):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


def _melody_response(matches, transcript: str) -> dict:
    """Shape melody matches like lyric results (no lyric evidence available)."""
    results = []
    for m in matches[: settings.max_results]:
        spotify_url = (
            f"https://open.spotify.com/track/{m.spotify_track_id}" if m.spotify_track_id
            else spotify_linker.generate_url(m.song, m.artist, None)
        )
        results.append({
            "song": m.song,
            "artist": m.artist,
            "confidence": int(min(95, max(1, round(m.score)))),
            "timestamp": m.offset_seconds,
            "timestamp_display": spotify_linker.format_timestamp(m.offset_seconds) if m.offset_seconds else None,
            "timestamp_estimated": True,
            "lyrics_context": None,
            "occurrences": [],
            "spotify_url": spotify_url,
            "album_art": spotify_linker.get_artwork(m.song, m.artist) or "",
            "strategy": "melody",
        })
    response = pipeline.response(transcript, results, input_kind="melody")
    response.pop("debug", None)
    return response


def _looks_wordless(transcription) -> bool:
    """Humming / 'la la la': no usable words for lyric search."""
    words = [w.lower().strip(".,!?'\"") for w in (transcription.text or "").split()]
    words = [w for w in words if len(w) > 1]
    return len(words) < 3 or len(set(words)) <= 2 or transcription.no_speech_probability > 0.6


@app.post("/upload")
@limiter.limit("10/minute")
async def upload_audio(request: Request, file: UploadFile = File(...)):
    """Voice clip -> Whisper transcript -> lyric search (melody match for humming)."""
    limit_mb = settings.max_upload_bytes // 1_000_000
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > settings.max_upload_bytes + 10_000:
        raise HTTPException(status_code=400, detail=f"File too large ({limit_mb}MB max).")
    ct = (file.content_type or "").lower().split(";")[0].strip()
    if ct and ct not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid file type: {ct}. Upload audio files only.")
    content = await file.read(settings.max_upload_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=400, detail=f"File too large ({limit_mb}MB max).")
    if not _voice_enabled():
        raise HTTPException(
            status_code=503,
            detail="Voice input is disabled on this server (needs ffmpeg + openai-whisper). Type the lyric instead.",
        )

    try:
        await asyncio.wait_for(_upload_semaphore.acquire(), timeout=15)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Server busy, try again shortly.")

    file_id = uuid.uuid4().hex
    input_path = UPLOAD_DIR / f"{file_id}_input"
    wav_path = UPLOAD_DIR / f"{file_id}.wav"
    try:
        input_path.write_bytes(content)
        # CPU-bound/blocking steps run off the event loop.
        await asyncio.to_thread(audio_processor.convert_to_wav, str(input_path), str(wav_path))
        await asyncio.to_thread(audio_processor.normalize_audio, str(wav_path))
        transcription = await asyncio.to_thread(transcriber.transcribe_result, str(wav_path))
        wordless = _looks_wordless(transcription)

        melody_tried = False
        if melody_recognizer.configured and wordless:
            melody_tried = True
            matches = await asyncio.to_thread(melody_recognizer.recognize, str(wav_path))
            if matches:
                return JSONResponse(content=_melody_response(matches, transcription.text))

        if wordless and len(transcription.text.split()) < 2:
            hint = (
                "We couldn't match the melody either — sing the words or type them."
                if melody_tried else
                "Humming can't be matched on this server (melody recognition isn't configured) — sing the words or type them."
            )
            return JSONResponse(content=pipeline.failure("We didn't hear any words. " + hint, transcription.text))

        result = await pipeline.identify(
            transcription.text,
            language=transcription.language,
            transcription_confidence=transcription.confidence,
            input_kind="voice",
        )
        # Lyric search found nothing for a sung clip: the melody may still match.
        if melody_recognizer.configured and not melody_tried and not result.get("results"):
            matches = await asyncio.to_thread(melody_recognizer.recognize, str(wav_path))
            if matches:
                return JSONResponse(content=_melody_response(matches, transcription.text))
        return JSONResponse(content=result)
    except Exception:
        logger.exception("upload failed")
        return JSONResponse(status_code=500, content=pipeline.failure("Processing failed. Please try again."))
    finally:
        _upload_semaphore.release()
        for path in (input_path, wav_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


@app.post("/feedback")
@limiter.limit("30/minute")
async def submit_feedback(request: Request, body: FeedbackIn):
    """Record thumbs up/down; nudges future ranking for similar queries."""
    await asyncio.to_thread(
        feedback_store.record_feedback, body.query.strip(), body.song.strip(), body.artist.strip(), body.action
    )
    return {"status": "ok", "action": body.action}


@app.get("/feedback/stats")
async def feedback_stats():
    return feedback_store.get_stats()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), reload=True)

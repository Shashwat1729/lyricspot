"""
ContinueMySong AI - FastAPI Backend
Main application entry point with audio upload and processing pipeline.
"""

import os
import re
import uuid
import json
import asyncio
import logging
from pathlib import Path
from typing import Optional
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

# These are initialized in lifespan; declared here for type reference
_candidate_executor: Optional[ThreadPoolExecutor] = None
_upload_semaphore: Optional[asyncio.Semaphore] = None

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from services.audio_processor import AudioProcessor
from services.transcriber import TranscriptionService
from services.song_identifier import SongIdentifier
from services.lyrics_fetcher import LyricsFetcher
from services.timestamp_matcher import TimestampMatcher
from services.spotify_linker import SpotifyLinker
from services.confidence_calculator import confidence_calculator
from services.feedback_store import FeedbackStore

_feedback_store = FeedbackStore()

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# Initialize services
audio_processor = AudioProcessor()
transcriber = TranscriptionService()
song_identifier = SongIdentifier()
lyrics_fetcher = LyricsFetcher()
timestamp_matcher = TimestampMatcher()
spotify_linker = SpotifyLinker()


@asynccontextmanager
async def lifespan(app):
    """Preload Whisper model and warn about missing credentials."""
    global _candidate_executor, _upload_semaphore
    _candidate_executor = ThreadPoolExecutor(max_workers=6)
    _upload_semaphore = asyncio.Semaphore(20)
    logger.info("Preloading Whisper model...")
    transcriber._load_model()
    logger.info("Whisper model loaded successfully.")
    if not os.getenv("SPOTIFY_CLIENT_ID") or not os.getenv("SPOTIFY_CLIENT_SECRET"):
        logger.warning("⚠️  SPOTIFY_CLIENT_ID/SECRET not set — Spotify links will be search URLs only.")
    if not os.getenv("MUSIXMATCH_API_KEY"):
        logger.info("MUSIXMATCH_API_KEY not set — Musixmatch search/lyrics disabled (optional).")
    yield
    # Shutdown executors cleanly on app teardown
    _candidate_executor.shutdown(wait=False)
    # Import lazily for teardown only so startup stays decoupled while we still shut down the shared executor cleanly.
    from services.song_identifier import _identify_executor
    _identify_executor.shutdown(wait=False)


# Initialize FastAPI app
app = FastAPI(
    title="ContinueMySong AI",
    description="AI-powered lyric continuation engine",
    version="1.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - configurable via environment
cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")]
# Credentials cannot be used with wildcard origins (browser security)
allow_creds = False  # No session auth — no credentials needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_creds,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure uploads directory exists (use /tmp fallback for read-only containers)
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(Path(__file__).parent / "uploads")))
try:
    UPLOAD_DIR.mkdir(exist_ok=True)
except OSError:
    UPLOAD_DIR = Path("/tmp/continuemysong_uploads")
    UPLOAD_DIR.mkdir(exist_ok=True)


# Security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response



class TextInput(BaseModel):
    """Request body for text-based lyric identification."""
    lyrics: str = Field(..., max_length=1000)


MAX_LYRICS_LENGTH = 1000  # characters (generous for multi-line lyric transcripts)
MAX_FILE_SIZE = 5_000_000  # 5MB upload limit


def _sanitize_lyrics(text: str) -> str:
    """Sanitize user input before passing to external APIs."""
    # Strip control characters (keep newlines/spaces)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    # Limit length
    text = text[:MAX_LYRICS_LENGTH].strip()
    return text


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "whisper_model": os.getenv("WHISPER_MODEL", "base"),
    }


@app.post("/feedback")
@limiter.limit("30/minute")
async def submit_feedback(request: Request):
    """Record user feedback (thumbs up/down) for a result."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    query = body.get("query", "").strip()
    song = body.get("song", "").strip()
    artist = body.get("artist", "").strip()
    action = body.get("action", "")
    if not query or not song or action not in ("up", "down"):
        raise HTTPException(status_code=400, detail="Missing required fields: query, song, action (up/down)")
    await asyncio.to_thread(_feedback_store.record_feedback, query, song, artist, action)
    return {"status": "ok", "action": action}


@app.get("/feedback/stats")
async def feedback_stats():
    """Get feedback statistics."""
    return _feedback_store.get_stats()


def _normalize_song_title(title: str) -> str:
    """Normalize song title for duplicate detection."""
    t = title.lower().strip()
    # Remove version suffixes like "9.1", "(remastered)", etc.
    t = re.sub(r'\s*\d+\.\d+$', '', t)
    t = re.sub(r'\s*\(.*?(remaster|remix|version|live|cover|edit).*?\)', '', t, flags=re.IGNORECASE)
    return t.strip()


def _prefer_original_artist(results: list) -> list:
    """Reorder near-duplicate song matches to prefer the most likely original recording.

    Results are first grouped by normalized song title so alternate versions of the same
    track can be compared together. When a group has multiple candidates with confidence
    scores within a small range, this favors the entry that looks most canonical by using
    Spotify popularity, direct track links, known artist names, and an iTunes canonical
    artist lookup as tie-breakers while penalizing cover/karaoke-style metadata.
    """
    if len(results) <= 1:
        return results

    # Group by normalized title
    groups: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(results):
        groups[_normalize_song_title(r["song"])].append(i)

    # For groups with >1 entry and similar confidence, pick the best
    reordered = []
    used = set()

    # Pre-fetch canonical artist from iTunes for disambiguation
    _itunes_canonical_cache: dict[str, str] = {}
    def _get_canonical_artist(song_title: str) -> str:
        """Query iTunes with just the song title — top result is usually the original."""
        if song_title in _itunes_canonical_cache:
            return _itunes_canonical_cache[song_title]
        try:
            import requests as _req
            resp = _req.get(
                "https://itunes.apple.com/search",
                params={"term": song_title, "media": "music", "entity": "song", "limit": 1},
                timeout=3
            )
            if resp.status_code == 200:
                itunes_results = resp.json().get("results", [])
                if itunes_results:
                    canonical = itunes_results[0].get("artistName", "").lower()
                    _itunes_canonical_cache[song_title] = canonical
                    return canonical
        except Exception:
            pass
        _itunes_canonical_cache[song_title] = ""
        return ""

    for i, r in enumerate(results):
        if i in used:
            continue
        norm = _normalize_song_title(r["song"])
        group_indices = groups[norm]
        if len(group_indices) > 1:
            # Get all in this group not yet used
            candidates_in_group = [idx for idx in group_indices if idx not in used]
            if len(candidates_in_group) > 1:
                # Check if they're within 5 confidence points
                confs = [results[idx]["confidence"] for idx in candidates_in_group]
                if max(confs) - min(confs) <= 5:
                    # Score each: prefer Spotify popularity, direct track URL, known artist
                    def _rank(idx):
                        res = results[idx]
                        score = 0
                        # PRIMARY: Spotify popularity (0-100) — strongest signal for originals
                        popularity = spotify_linker.get_popularity(res["song"], res.get("artist", ""))
                        if popularity is not None:
                            score += popularity  # 0-100 boost
                        else:
                            # FALLBACK: iTunes canonical artist match
                            canonical = _get_canonical_artist(res["song"])
                            if canonical and res.get("artist"):
                                artist_lower = res["artist"].lower()
                                if artist_lower == canonical or canonical in artist_lower or artist_lower in canonical:
                                    score += 50  # Strong boost for matching iTunes #1 artist
                                else:
                                    score += 5  # Small boost for existing but non-canonical
                        # SECONDARY: Direct track URL (verified on Spotify)
                        url = res.get("spotify_url", "")
                        if "/track/" in url:
                            score += 15
                        # Has a known artist
                        if res.get("artist") and res["artist"].lower() not in ("", "unknown"):
                            score += 5
                        # Penalize cover/karaoke/compilation indicators
                        artist_lower = (res.get("artist") or "").lower()
                        if any(kw in artist_lower for kw in ("cover", "karaoke", "tribute", "compilation", "tv", "url")):
                            score -= 30
                        song_lower = res["song"].lower()
                        if any(kw in song_lower for kw in ("cover", "karaoke", "tribute", "remix")):
                            score -= 20
                        return (-score, -res["confidence"], idx)  # idx as stable tiebreaker

                    candidates_in_group.sort(key=_rank)
                for idx in candidates_in_group:
                    reordered.append(results[idx])
                    used.add(idx)
            else:
                reordered.append(results[candidates_in_group[0]])
                used.add(candidates_in_group[0])
        else:
            reordered.append(r)
            used.add(i)
    return reordered


def _process_candidate(candidate: dict, transcript: str) -> dict:
    """Process a single candidate: lyrics → timestamp → spotify → layered confidence scoring."""
    song = candidate["song"]
    artist = candidate["artist"]
    search_confidence = candidate.get("confidence", 50)
    strategy = candidate.get("strategy", "unknown")

    timestamp = 0
    timestamp_estimated = False
    lyrics_context = None
    lyrics_match_score = None
    exact_lyrics_match = False

    try:
        lyrics_lines = lyrics_fetcher.fetch_synced_lyrics(song, artist)
        synced_match_result = None
        if lyrics_lines:
            synced_match_result = timestamp_matcher.find_match(transcript, lyrics_lines)
            if synced_match_result and synced_match_result["confidence"] >= 30:
                timestamp = synced_match_result["timestamp"]
                lyrics_match_score = synced_match_result["confidence"]
                lyrics_context = synced_match_result.get("lyrics_context")

        # Always check if transcript appears verbatim in synced lyrics text
        # This catches cases where partial_ratio is only 80 but the text IS there
        if lyrics_lines and not exact_lyrics_match:
            all_lyrics_text = " ".join(line.get("text", "") for line in lyrics_lines).lower()
            if transcript.lower().strip() in all_lyrics_text:
                exact_lyrics_match = True
                if lyrics_match_score is not None and lyrics_match_score < 95:
                    lyrics_match_score = 95

        # If synced lyrics were missing OR matched poorly (<70%), also try plain lyrics
        synced_conf = synced_match_result["confidence"] if synced_match_result else 0
        if synced_conf < 70:
            plain_lyrics = lyrics_fetcher.fetch_plain_lyrics(song, artist)
            transcript_lower = transcript.lower().strip()
            plain_lower = plain_lyrics.lower() if plain_lyrics else ""

            # Normalize contractions for comparison
            def _normalize_contractions(text: str) -> str:
                """Expand common contractions so 'must've' matches 'must have'."""
                import re as _re
                text = _re.sub(r"(\w)'ve\b", r"\1 have", text)
                text = _re.sub(r"(\w)'re\b", r"\1 are", text)
                text = _re.sub(r"(\w)'ll\b", r"\1 will", text)
                text = _re.sub(r"(\w)'d\b", r"\1 would", text)
                text = _re.sub(r"(\w)n't\b", r"\1 not", text)
                text = _re.sub(r"(\w)'m\b", r"\1 am", text)
                text = _re.sub(r"(\w)'s\b", r"\1 is", text)
                text = _re.sub(r"[''`]", "", text)
                return text

            norm_transcript = _normalize_contractions(transcript_lower)
            norm_plain = _normalize_contractions(plain_lower)
            # Normalize newlines/whitespace so multi-line lyrics match single-line transcript
            norm_plain = re.sub(r'\s+', ' ', norm_plain)
            norm_transcript = re.sub(r'\s+', ' ', norm_transcript)
            found_in_plain = norm_transcript in norm_plain if plain_lyrics else False

            # If LRCLIB plain didn't contain the transcript, try Genius directly
            if not found_in_plain:
                genius_lyrics = lyrics_fetcher._fetch_genius_lyrics(song, artist)
                if genius_lyrics and transcript_lower in genius_lyrics.lower():
                    plain_lyrics = genius_lyrics
                    found_in_plain = True

            if plain_lyrics and found_in_plain:
                # Exact substring match — very strong signal
                plain_len = len(plain_lyrics)
                if plain_len < 10000:  # Not a compilation page
                    exact_lyrics_match = True
                # Override lyrics_match_score if plain match is stronger
                if lyrics_match_score is None or lyrics_match_score < 90:
                    lyrics_match_score = 95 if plain_len < 5000 else 80
                # Try to estimate timestamp from plain lyrics
                estimate = lyrics_fetcher.estimate_timestamp_from_plain(
                    transcript, plain_lyrics
                )
                if estimate:
                    timestamp = estimate["timestamp"]
                    timestamp_estimated = True
                    lyrics_context = estimate.get("lyrics_context")
            elif not lyrics_lines and plain_lyrics:
                # No synced lyrics at all — use plain estimation
                estimate = lyrics_fetcher.estimate_timestamp_from_plain(
                    transcript, plain_lyrics
                )
                if estimate:
                    timestamp = estimate["timestamp"]
                    lyrics_match_score = estimate["confidence"]
                    timestamp_estimated = True
        
        # If we fetched lyrics but transcript was NOT found in them → negative signal
        if not exact_lyrics_match and lyrics_match_score is None:
            # We tried but couldn't confirm lyrics contain the transcript
            lyrics_were_available = bool(lyrics_lines)
            if lyrics_were_available:
                # Synced lyrics exist but don't match well → penalize
                lyrics_match_score = 20
    except Exception as e:
        logger.warning(f"Lyrics/timestamp error for {song}: {e}")

    spotify_url = spotify_linker.generate_url(
        song, artist, timestamp if timestamp > 0 else None
    )

    # Get Spotify popularity (cached from generate_url call above)
    spotify_popularity = spotify_linker.get_popularity(song, artist)

    # Get feedback boost
    feedback_boost = 0
    try:
        feedback_boost = _feedback_store.get_boost(transcript, song, artist)
    except Exception:
        pass

    # === LAYERED CONFIDENCE CALCULATION ===
    match_confidence = confidence_calculator.calculate(
        transcript=transcript,
        song=song,
        artist=artist,
        lyrics_match_score=lyrics_match_score,
        exact_lyrics_match=exact_lyrics_match,
        search_confidence=search_confidence,
        source_count=1,  # Per-candidate; source agreement handled at ranking stage
        spotify_popularity=spotify_popularity,
        feedback_boost=feedback_boost,
        has_timestamp=(timestamp > 0),
        strategy=strategy,
    )

    return {
        "song": song,
        "artist": artist if artist and artist.lower() != "unknown" else "",
        "confidence": match_confidence,
        "timestamp": timestamp,
        "timestamp_display": spotify_linker.format_timestamp(timestamp),
        "timestamp_estimated": timestamp_estimated,
        "lyrics_context": lyrics_context,
        "spotify_url": spotify_url,
        "album_art": spotify_linker.get_artwork(song, artist) or "",
        "strategy": strategy,
    }


def _make_fallback_result(transcript: str, confidence: int = 30) -> dict:
    """Create a consistent fallback result when identification fails."""
    fallback_url = spotify_linker.generate_url(transcript[:50], "", None)
    return {
        "song": transcript[:50],
        "artist": "",
        "confidence": confidence,
        "timestamp": 0,
        "timestamp_display": "0:00",
        "timestamp_estimated": True,
        "spotify_url": fallback_url,
        "album_art": "",
        "lyrics_context": None,
        "strategy": "fallback_search",
    }


async def _build_results(transcript: str) -> dict:
    """
    Core pipeline: identify songs from transcript text.
    Always returns top results (never "not found").
    """
    transcript = _sanitize_lyrics(transcript)
    if not transcript or len(transcript.strip()) < 3:
        return {
            "success": False,
            "error": "No lyrics detected. Please try again with more words.",
            "transcript": transcript or "",
            "results": [],
        }

    # Get ALL candidate songs (up to 7 for better lyrics-verification coverage)
    candidates = await asyncio.to_thread(song_identifier.identify_multiple, transcript, 7)

    if not candidates:
        # No identification match — provide a Spotify search fallback
        return {
            "success": True,
            "partial": True,
            "transcript": transcript,
            "results": [_make_fallback_result(transcript)],
        }

    # Source agreement bonus: if multiple strategies found the same song, boost confidence
    _title_counts: dict[str, int] = {}
    for c in candidates:
        normalized = _normalize_song_title(c.get("song", ""))
        _title_counts[normalized] = _title_counts.get(normalized, 0) + 1
    for c in candidates:
        normalized = _normalize_song_title(c.get("song", ""))
        if _title_counts.get(normalized, 0) >= 2:
            # Multiple sources agree — boost confidence by up to 10
            agreement_bonus = min(10, (_title_counts[normalized] - 1) * 5)
            c["confidence"] = min(95, c.get("confidence", 50) + agreement_bonus)

    # For each candidate, process lyrics + timestamp + spotify (parallel via executor)
    results = []
    if _candidate_executor is not None:
        loop = asyncio.get_running_loop()
        tasks = [loop.run_in_executor(_candidate_executor, _process_candidate, c, transcript) for c in candidates[:5]]
        settled = await asyncio.gather(*tasks, return_exceptions=True)
        for r in settled:
            if isinstance(r, Exception):
                logger.warning(f"Candidate processing error in /identify: {r}")
            else:
                results.append(r)
    else:
        for c in candidates[:5]:
            try:
                results.append(_process_candidate(c, transcript))
            except Exception as e:
                logger.warning(f"Candidate processing error in /identify: {e}")

    # Sort by confidence (highest first)
    results.sort(key=lambda x: x["confidence"], reverse=True)

    # Prefer original artists: when two results share the same song title (normalized)
    # and similar confidence (within 5 pts), prefer the one with a cleaner title
    # (no version suffixes like "9.1") and a direct Spotify track URL.
    results = _prefer_original_artist(results)

    # Deduplicate: remove entries where normalized song+artist pair matches (either order)
    seen_pairs = set()
    deduped = []
    for r in results:
        s = _normalize_song_title(r.get("song", ""))
        a = r.get("artist", "").lower().strip()
        # Normalize: key by sorted (song, artist) to catch swapped song/artist
        key = tuple(sorted([s, a]))
        if key not in seen_pairs:
            seen_pairs.add(key)
            deduped.append(r)
    results = deduped

    # Guard against all candidates failing
    if not results:
        results = [_make_fallback_result(transcript, confidence=20)]

    return {
        "success": True,
        "partial": results[0]["confidence"] < 50,
        "transcript": transcript,
        "results": results,
        # Also provide the top result in flat format for backward compatibility
        "song": results[0]["song"],
        "artist": results[0]["artist"],
        "confidence": results[0]["confidence"],
        "timestamp": results[0]["timestamp"],
        "spotify_url": results[0]["spotify_url"],
    }


@app.post("/upload")
@limiter.limit("10/minute")
async def upload_audio(request: Request, file: UploadFile = File(...)):
    """
    Main pipeline endpoint.
    Accepts audio file, processes through the full AI pipeline,
    and returns top song matches with Spotify continuation URLs.
    """
    file_id = str(uuid.uuid4())
    input_path = UPLOAD_DIR / f"{file_id}_input.webm"
    wav_path = UPLOAD_DIR / f"{file_id}.wav"

    sem = _upload_semaphore or asyncio.Semaphore(20)
    try:
        await asyncio.wait_for(sem.acquire(), timeout=10)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Server busy, try again shortly.")
    try:
        # Advisory early rejection based on Content-Length header (not a security boundary;
        # actual enforcement is via capped file.read below)
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_FILE_SIZE:
                    raise HTTPException(status_code=400, detail=f"File too large ({MAX_FILE_SIZE // 1_000_000}MB max).")
            except ValueError:
                pass  # Malformed header — ignore, read-cap will enforce

        # Validate content type (allowlist approach)
        ALLOWED_AUDIO_TYPES = {
            "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/mp4",
            "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/x-m4a",
            "video/webm", "video/mp4", "video/ogg",
            "application/ogg", "application/octet-stream",
        }
        ct = (file.content_type or "").lower().split(";")[0].strip()
        if ct and ct not in ALLOWED_AUDIO_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid file type: {ct}. Upload audio files only.")

        # Step 1: Save uploaded file (max 5MB, read capped to prevent RAM exhaustion)
        content = await file.read(5_000_001)
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")
        if len(content) > 5_000_000:
            raise HTTPException(status_code=400, detail="File too large (5MB max)")

        with open(input_path, "wb") as f:
            f.write(content)

        # Step 2: Convert to WAV (mono, 16kHz)
        audio_processor.convert_to_wav(str(input_path), str(wav_path))

        # Step 3: Normalize audio
        audio_processor.normalize_audio(str(wav_path))

        # Step 4: Transcribe with Whisper
        transcript = transcriber.transcribe(str(wav_path))

        # Step 5-8: Identify, lyrics, timestamp, Spotify URL
        return JSONResponse(content=await _build_results(transcript))

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unhandled error")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Processing failed. Please try again.",
                "results": [],
            },
        )
    finally:
        sem.release()
        # Cleanup temporary files
        for path in [input_path, wav_path]:
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass


@app.post("/identify")
@limiter.limit("200/minute")
async def identify_text(request: Request, body: TextInput):
    """
    Text-based lyric identification endpoint.
    Accepts typed lyrics and returns song matches.
    No audio processing needed.
    """
    try:
        result = await asyncio.wait_for(_build_results(body.lyrics), timeout=45.0)
        return JSONResponse(content=result)
    except asyncio.TimeoutError:
        logger.warning("Identify endpoint timed out after 45s")
        return JSONResponse(
            content={
                "success": False,
                "partial": True,
                "error": "Request timed out. Please try again with shorter lyrics.",
                "transcript": body.lyrics[:100] if body.lyrics else "",
                "results": [],
            },
        )
    except Exception as e:
        logger.exception("Unhandled error")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Processing failed. Please try again.",
                "results": [],
            },
        )


@app.post("/identify/stream")
@limiter.limit("20/minute")
async def identify_text_stream(request: Request, body: TextInput):
    """
    SSE streaming endpoint for text-based identification.
    Sends progress events as each pipeline stage completes.
    Parallelizes per-candidate processing and streams results incrementally.
    """
    async def generate():
        import time as _time
        _deadline = _time.monotonic() + 120  # 2 min max connection duration

        def emit(data: dict):
            return f"data: {json.dumps(data)}\n\n"

        def _past_deadline():
            return _time.monotonic() > _deadline

        transcript = _sanitize_lyrics(body.lyrics)
        if not transcript or len(transcript) < 3:
            yield emit({"stage": "error", "message": "No lyrics detected. Please try again."})
            return

        # Stage 1: Searching (already parallel internally via ThreadPoolExecutor)
        yield emit({"stage": "searching", "message": "Searching song databases..."})

        try:
            candidates = await asyncio.wait_for(
                asyncio.to_thread(song_identifier.identify_multiple, transcript, 7),
                timeout=60.0
            )
        except asyncio.TimeoutError:
            yield emit({"stage": "error", "message": "Search timed out. Please try again."})
            return

        if not candidates:
            yield emit({"stage": "complete", "results": [_make_fallback_result(transcript)]})
            return

        top_candidates = candidates[:5]
        
        # Source agreement bonus for SSE path
        _title_counts_sse: dict[str, int] = {}
        for c in top_candidates:
            normalized = _normalize_song_title(c.get("song", ""))
            _title_counts_sse[normalized] = _title_counts_sse.get(normalized, 0) + 1
        for c in top_candidates:
            normalized = _normalize_song_title(c.get("song", ""))
            if _title_counts_sse.get(normalized, 0) >= 2:
                agreement_bonus = min(10, (_title_counts_sse[normalized] - 1) * 5)
                c["confidence"] = min(95, c.get("confidence", 50) + agreement_bonus)
        
        yield emit({
            "stage": "found",
            "message": f"Found {len(candidates)} candidates",
            "candidates_count": len(candidates),
            "candidates": [{"song": c["song"], "artist": c.get("artist", "")} for c in top_candidates],
        })

        # Stage 2+3: Process each candidate in parallel (lyrics + timestamp + spotify)
        if _past_deadline():
            yield emit({"stage": "error", "message": "Request timed out."})
            return
        yield emit({"stage": "lyrics", "message": "Analyzing lyrics & resolving tracks..."})

        # Run all candidates in parallel via shared executor
        loop = asyncio.get_running_loop()
        async def process_one(candidate):
            return await loop.run_in_executor(_candidate_executor, _process_candidate, candidate, transcript)

        tasks = [asyncio.create_task(process_one(c)) for c in top_candidates]
        results = []
        for coro in asyncio.as_completed(tasks):
            try:
                result = await coro
                results.append(result)
                yield emit({
                    "stage": "candidate_ready",
                    "message": f"Matched: {result['song']}",
                    "result": result,
                    "completed": len(results),
                    "total": len(top_candidates),
                })
            except Exception as e:
                logger.warning(f"Candidate processing error: {e}")
                yield emit({
                    "stage": "candidate_error",
                    "message": f"Failed to process a candidate: {str(e)[:100]}",
                    "completed": len(results),
                    "total": len(top_candidates),
                })

        results.sort(key=lambda x: x["confidence"], reverse=True)

        # Apply same post-processing as non-streaming path
        results = _prefer_original_artist(results)

        # Deduplicate: use same logic as non-streaming path
        seen_pairs = set()
        deduped = []
        for r in results:
            s = _normalize_song_title(r.get("song", ""))
            a = r.get("artist", "").lower().strip()
            key = tuple(sorted([s, a]))
            if key not in seen_pairs:
                seen_pairs.add(key)
                deduped.append(r)
        results = _prefer_original_artist(deduped)

        yield emit({
            "stage": "complete",
            "results": results,
            "transcript": transcript,
            "success": True,
        })

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)

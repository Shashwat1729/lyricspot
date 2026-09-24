"""
Identification pipeline: transcript -> candidate songs -> lyric evidence ->
ranked, deduplicated results.

Kept independent of FastAPI so it is unit-testable and shared by every
endpoint (/identify, /identify/stream, /upload). Services are injected.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, AsyncIterator, Optional

from config import Settings
from services.candidate_ranker import candidate_ranker, compute_confidence_label

logger = logging.getLogger(__name__)

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_lyrics(text: str, max_length: int = 1000) -> str:
    """Strip control characters and cap length before any external call."""
    return _CONTROL_CHARS.sub("", text or "")[:max_length].strip()


def normalize_song_title(title: str) -> str:
    """Normalize song title for duplicate detection."""
    t = title.lower().strip()
    # Remove version suffixes like "9.1", "(remastered)", etc.
    t = re.sub(r'\s*\d+\.\d+$', '', t)
    t = re.sub(r'\s*\(.*?(remaster|remix|version|live|cover|edit).*?\)', '', t, flags=re.IGNORECASE)
    return t.strip()


def score_canonical(res: dict, popularity: Optional[int]) -> int:
    """Tie-break score preferring the most likely original recording.

    Pure function of already-fetched metadata (no network calls): Spotify
    popularity, direct track URL, known artist, minus cover/karaoke penalties.
    Used only to order same-title versions whose lyric evidence is tied.
    """
    score = 0
    if popularity is not None:
        score += popularity  # 0-100 boost
    url = res.get("spotify_url", "")
    if "/track/" in url:
        score += 15
    if res.get("artist") and res["artist"].lower() not in ("", "unknown"):
        score += 5
    artist_lower = (res.get("artist") or "").lower()
    if any(kw in artist_lower for kw in ("cover", "karaoke", "tribute", "compilation", "tv", "url")):
        score -= 30
    song_lower = (res.get("song") or "").lower()
    if any(kw in song_lower for kw in ("cover", "karaoke", "tribute", "remix")):
        score -= 20
    return score


def prefer_original_artist(results: list, popularity_of=lambda song, artist: None) -> list:
    """Order same-title versions to prefer the most likely original recording.

    Only swaps entries that share a normalized song title AND whose lyric-based
    ranking scores are within a small margin. Swaps happen in place (members take
    over each other's positions) so the global ranked order is otherwise stable:
    a same-title group never jumps ahead of differently-titled songs that
    outranked it on lyric evidence.
    """
    if len(results) <= 1:
        return results

    def _rank_score(r: dict) -> int:
        for key in ("ranking_score", "confidence", "search_confidence"):
            try:
                return int(r.get(key, 0) or 0)
            except (TypeError, ValueError):
                continue
        return 0

    # Group positions by normalized title
    groups: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(results):
        groups[normalize_song_title(r.get("song", ""))].append(i)

    reordered = list(results)
    for norm, positions in groups.items():
        if len(positions) < 2:
            continue
        scores = [_rank_score(results[idx]) for idx in positions]
        if max(scores) - min(scores) > 5:
            continue  # lyric evidence clearly separates them — keep ranker order
        ordered = sorted(
            positions,
            key=lambda idx: (-score_canonical(results[idx], _safe_pop(popularity_of, results[idx])), -scores[positions.index(idx)], idx),
        )
        for pos, idx in zip(sorted(positions), ordered):
            reordered[pos] = results[idx]
    return reordered



def _safe_pop(popularity_of, res: dict) -> Optional[int]:
    try:
        return popularity_of(res.get("song", ""), res.get("artist", ""))
    except Exception:
        return None


def dedupe(results: list) -> list:
    """Drop repeated songs (normalized title+artist, either field order)."""
    seen, out = set(), []
    for r in results:
        key = tuple(sorted([normalize_song_title(r.get("song", "")), (r.get("artist") or "").lower().strip()]))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _normalize_contractions(text: str) -> str:
    """Expand common contractions so 'must've' matches 'must have'."""
    text = re.sub(r"(\w)'ve\b", r"\1 have", text)
    text = re.sub(r"(\w)'re\b", r"\1 are", text)
    text = re.sub(r"(\w)'ll\b", r"\1 will", text)
    text = re.sub(r"(\w)'d\b", r"\1 would", text)
    text = re.sub(r"(\w)n't\b", r"\1 not", text)
    text = re.sub(r"(\w)'m\b", r"\1 am", text)
    text = re.sub(r"(\w)'s\b", r"\1 is", text)
    return re.sub(r"[''`]", "", text)


class IdentificationPipeline:
    """Candidate retrieval, lyric verification, ranking and response shaping."""

    def __init__(self, *, identifier, lyrics, matcher, spotify, feedback, settings: Settings,
                 executor: Optional[ThreadPoolExecutor] = None):
        self.identifier = identifier
        self.lyrics = lyrics
        self.matcher = matcher
        self.spotify = spotify
        self.feedback = feedback
        self.settings = settings
        self.executor = executor

    def process_candidate(
        self,
        candidate: dict,
        transcript: str,
        language: Optional[str] = None,
    ) -> dict:
        """Process a single candidate: lyrics → timestamp → spotify → metadata collection.

        Args:
            candidate: Raw candidate with song/artist plus optional
                `source_count` (real distinct-strategy count attached by the
                caller after grouping). Falls back to len(sources) or 1.
            transcript: Sanitized transcript text.
            language: Whisper-detected language tag (gates phonetic rules).

        Returns:
            Enriched candidate with lyric evidence, timestamp, Spotify metadata.
            Ranking happens later in the pipeline via candidate_ranker.
        """
        song = candidate["song"]
        artist = candidate["artist"]
        search_confidence = candidate.get("confidence", 50)
        strategy = candidate.get("strategy", "unknown")
        sources = candidate.get("sources") or ([strategy] if strategy != "unknown" else [])
        try:
            source_count = int(candidate.get("source_count", len(sources) or 1))
        except (TypeError, ValueError):
            source_count = 1
        source_count = max(1, source_count)

        timestamp = 0
        timestamp_estimated = False
        lyrics_context = None
        lyrics_match_score = None
        exact_lyrics_match = False
        lyrics_available = False
        occurrences: list = []

        try:
            lyrics_lines = self.lyrics.fetch_synced_lyrics(song, artist)
            synced_match_result = None
            if lyrics_lines:
                lyrics_available = True
                synced_match_result = self.matcher.find_match(transcript, lyrics_lines, language)
                occurrences = self.matcher.find_occurrences(transcript, lyrics_lines, language)
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
                plain_lyrics = self.lyrics.fetch_plain_lyrics(song, artist)
                if plain_lyrics:
                    lyrics_available = True
                transcript_lower = transcript.lower().strip()
                plain_lower = plain_lyrics.lower() if plain_lyrics else ""

                norm_transcript = _normalize_contractions(transcript_lower)
                norm_plain = _normalize_contractions(plain_lower)
                # Normalize newlines/whitespace so multi-line lyrics match single-line transcript
                norm_plain = re.sub(r'\s+', ' ', norm_plain)
                norm_transcript = re.sub(r'\s+', ' ', norm_transcript)
                found_in_plain = norm_transcript in norm_plain if plain_lyrics else False

                # If LRCLIB plain didn't contain the transcript, try Genius directly
                if not found_in_plain:
                    genius_lyrics = self.lyrics._fetch_genius_lyrics(song, artist)
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
                    estimate = self.lyrics.estimate_timestamp_from_plain(
                        transcript, plain_lyrics
                    )
                    if estimate:
                        timestamp = estimate["timestamp"]
                        timestamp_estimated = True
                        lyrics_context = estimate.get("lyrics_context")
                elif not lyrics_lines and plain_lyrics:
                    # No synced lyrics at all — use plain estimation
                    estimate = self.lyrics.estimate_timestamp_from_plain(
                        transcript, plain_lyrics
                    )
                    if estimate:
                        timestamp = estimate["timestamp"]
                        lyrics_match_score = estimate["confidence"]
                        timestamp_estimated = True

            # If we fetched lyrics but transcript was NOT found in them → negative signal
            if not exact_lyrics_match and lyrics_match_score is None and lyrics_available:
                # We tried but couldn't confirm lyrics contain the transcript
                # Lyrics exist but don't match well → set low score as negative signal
                lyrics_match_score = 20
        except Exception as e:
            logger.warning(f"Lyrics/timestamp error for {song}: {e}")

        spotify_url = self.spotify.generate_url(
            song, artist, timestamp if timestamp > 0 else None
        )

        # Get Spotify popularity (cached from generate_url call above)
        spotify_popularity = self.spotify.get_popularity(song, artist)

        # Get feedback boost
        feedback_boost = 0
        try:
            feedback_boost = self.feedback.get_boost(transcript, song, artist)
        except Exception:
            pass

        # Return enriched candidate with all evidence for downstream ranking.
        # The new ranking system will score this using candidate_ranker.
        return {
            "song": song,
            "artist": artist if artist and artist.lower() != "unknown" else "",
            "timestamp": timestamp,
            "timestamp_display": self.spotify.format_timestamp(timestamp),
            "timestamp_estimated": timestamp_estimated,
            "lyrics_context": lyrics_context,
            "occurrences": occurrences,
            "ambiguous": len(occurrences) > 1,
            "spotify_url": spotify_url,
            "album_art": self.spotify.get_artwork(song, artist) or "",
            "strategy": strategy,
            "sources": sorted(sources),
            "source_count": source_count,
            # Evidence for ranking (used by candidate_ranker)
            "lyrics_match_score": lyrics_match_score,
            "exact_lyrics_match": exact_lyrics_match,
            "lyrics_available": lyrics_available,
            "search_confidence": search_confidence,
            "spotify_popularity": spotify_popularity,
            "feedback_boost": feedback_boost,
            "debug": {
                "lyrics_match_score": lyrics_match_score,
                "exact_lyrics_match": exact_lyrics_match,
                "search_prior": search_confidence,
                "source_count": source_count,
                "timestamp_quality": synced_match_result["confidence"] if synced_match_result else None,
                "lyrics_available": lyrics_available,
            },
        }



    # ---- shared stages -------------------------------------------------

    def _retrieve(self, transcript: str) -> list[dict]:
        """Broad candidate pool with true per-song source coverage attached."""
        candidates = self.identifier.identify_multiple(transcript, self.settings.candidate_pool) or []
        coverage: dict[tuple[str, str], set] = {}
        for c in candidates:
            key = (c.get("song", "").lower().strip(), c.get("artist", "").lower().strip())
            coverage.setdefault(key, set()).update(c.get("sources") or [c.get("strategy", "unknown")])
        for c in candidates:
            key = (c.get("song", "").lower().strip(), c.get("artist", "").lower().strip())
            c["source_count"] = len(coverage.get(key, {c.get("strategy", "unknown")}))
        return candidates[: self.settings.candidates_verified]

    def _finalize(self, processed: list[dict], transcript: str, language: Optional[str]) -> list[dict]:
        """Rank on lyric evidence, prefer originals on ties, dedupe, cap."""
        ranked = candidate_ranker.rank_candidates(processed, transcript, language)
        ranked = prefer_original_artist(ranked, self.spotify.get_popularity)
        ranked = dedupe(ranked)
        for r in ranked:
            if "ranking_score" in r:
                r["confidence"] = int(r["ranking_score"])
        return ranked[: self.settings.max_results]

    def confidence_label(self, results: list[dict], transcript: str) -> tuple[str, float]:
        if not results:
            return "low", 0.0
        top = int(results[0].get("confidence", 0))
        second = int(results[1].get("confidence", 0)) if len(results) > 1 else 0
        return compute_confidence_label(
            top, second, transcript,
            high_threshold=self.settings.confidence_high_threshold,
            high_margin=self.settings.confidence_high_margin,
        )

    def response(self, transcript: str, results: list[dict], language: Optional[str] = None,
                 transcription_confidence: Optional[float] = None, input_kind: str = "lyrics") -> dict:
        label, margin = self.confidence_label(results, transcript)
        if results:
            logger.info(
                "identification_complete input=%s transcript_len=%d language=%s top=%s - %s score=%s margin=%.1f label=%s",
                input_kind, len(transcript), language, results[0].get("song"), results[0].get("artist"),
                results[0].get("confidence"), margin, label,
            )
        return {
            "success": True,
            "input": input_kind,
            "transcript": transcript,
            "confidence_label": label,
            "margin": margin,
            "results": results,
            "debug": {
                "language": language,
                "transcription_confidence": transcription_confidence,
                "candidate_count": len(results),
                "top_score_breakdown": results[0].get("score_breakdown", {}) if results else {},
            },
        }

    @staticmethod
    def failure(message: str, transcript: str = "") -> dict:
        return {"success": False, "confidence_label": "low", "error": message, "transcript": transcript, "results": []}

    async def _process_all(self, candidates: list[dict], transcript: str, language: Optional[str]) -> AsyncIterator[Any]:
        """Verify candidates in parallel; yields each result (or exception) as it completes."""
        loop = asyncio.get_running_loop()
        tasks = [
            loop.run_in_executor(self.executor, self.process_candidate, c, transcript, language)
            for c in candidates
        ]
        for fut in asyncio.as_completed(tasks):
            try:
                yield await fut
            except Exception as exc:  # one bad candidate never sinks the search
                logger.warning("Candidate processing error: %s", exc)
                yield exc

    # ---- entry points ------------------------------------------------------

    async def identify(self, transcript: str, language: Optional[str] = None,
                       transcription_confidence: Optional[float] = None, input_kind: str = "lyrics") -> dict:
        transcript = sanitize_lyrics(transcript, self.settings.max_lyrics_length)
        if len(transcript) < 3:
            return self.failure("No lyrics detected. Please try again with more words.", transcript)
        if transcription_confidence is not None and transcription_confidence < self.settings.transcription_min_confidence:
            return self.failure("Couldn't hear that clearly. Try singing a little longer.", transcript)

        candidates = await asyncio.to_thread(self._retrieve, transcript)
        processed = [r async for r in self._process_all(candidates, transcript, language) if not isinstance(r, Exception)]
        results = self._finalize(processed, transcript, language)
        return self.response(transcript, results, language, transcription_confidence, input_kind)

    async def identify_stream(self, raw_transcript: str) -> AsyncIterator[dict]:
        """Same pipeline as identify(), emitting progress events (SSE)."""
        transcript = sanitize_lyrics(raw_transcript, self.settings.max_lyrics_length)
        if len(transcript) < 3:
            yield {"stage": "error", "message": "No lyrics detected. Please try again."}
            return
        yield {"stage": "searching", "message": "Searching song databases..."}
        try:
            candidates = await asyncio.wait_for(asyncio.to_thread(self._retrieve, transcript), timeout=60.0)
        except asyncio.TimeoutError:
            yield {"stage": "error", "message": "Search timed out. Please try again."}
            return
        yield {
            "stage": "found",
            "message": f"Found {len(candidates)} candidates",
            "candidates_count": len(candidates),
            "candidates": [{"song": c["song"], "artist": c.get("artist", "")} for c in candidates],
        }
        yield {"stage": "lyrics", "message": "Analyzing lyrics & resolving tracks..."}
        processed: list[dict] = []
        async for r in self._process_all(candidates, transcript, None):
            if isinstance(r, Exception):
                continue
            processed.append(r)
            yield {
                "stage": "candidate_ready",
                "message": f"Matched: {r['song']}",
                "completed": len(processed),
                "total": len(candidates),
            }
        results = self._finalize(processed, transcript, None)
        final = self.response(transcript, results)
        final.pop("debug", None)
        yield {"stage": "complete", **final}

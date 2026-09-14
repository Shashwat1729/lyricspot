"""
Multi-strategy song identification service for ContinueMySong AI.
Identifies songs from transcribed lyrics using multiple sources.

Free sources (no API key required):
- YouTube search (reliable for popular songs)
- Genius search (good metadata and lyrics)
- iTunes Search (good metadata)
- Deezer search (free, no key, good metadata)
- MusicBrainz (free, no key, strict 1 req/s rate limit — metadata validation)
- DuckDuckGo HTML (catches what Genius API misses)

Optional (API key required):
- AudD Music Recognition API (best for lyrics-based text search)
- Musixmatch (largest lyrics database, 14M+ songs, 80+ languages)

Every strategy is fail-soft: any single source failing (timeout, 429,
parse error) returns [] and never fails the pipeline.
"""

import os
import logging
import re
import threading
import time
import urllib.parse
from typing import Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor

import requests
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from utils.title_cleaner import clean_title
from services.query_expansion import expand_queries

logger = logging.getLogger(__name__)

# Module-level executor for identification strategies
_identify_executor = ThreadPoolExecutor(max_workers=4)

# Fixed strategy order — completion order must never determine ranking.
STRATEGY_ORDER = (
    "audd", "musixmatch", "youtube", "genius",
    "itunes", "deezer", "musicbrainz", "duckduckgo",
)


class _RateLimiter:
    """Minimal per-host rate limiter (fail-soft, thread-safe).

    Enforces a minimum interval between calls per key by sleeping the
    calling thread. Never raises: on clock issues it simply proceeds.
    """

    def __init__(self, min_interval_ms: dict[str, int] | None = None):
        self._min_interval = min_interval_ms or {}
        self._last_call: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, key: str) -> None:
        interval = self._min_interval.get(key, 0) / 1000.0
        if interval <= 0:
            return
        try:
            with self._lock:
                now = time.monotonic()
                last = self._last_call.get(key, 0.0)
                delay = interval - (now - last)
                if delay > 0:
                    time.sleep(delay)
                self._last_call[key] = time.monotonic()
        except Exception:
            pass


def canonical_key(song: str, artist: str) -> tuple[str, str]:
    """Deterministic dedup key for a candidate."""
    song_key = " ".join((song or "").lower().split())
    artist_key = " ".join((artist or "").lower().split())
    return (song_key, artist_key)


def merge_candidates(
    jobs_results: list[tuple[str, str, list]],
    max_results: int = 5,
) -> list:
    """Merge per-strategy results deterministically.

    Args:
        jobs_results: Ordered list of (strategy, variant, results).
        max_results: Cap on returned candidates.

    Returns:
        Merged candidates sorted by (-confidence, song, artist, strategy),
        each with `sources` (all producing strategies) and `matched_variant`.
    """
    merged: dict[tuple[str, str], dict] = {}
    for strategy, variant, results in jobs_results:
        for r in results or []:
            song = (r.get("song") or "").strip()
            if not song:
                continue
            artist = (r.get("artist") or "").strip()
            key = canonical_key(song, artist)
            entry = merged.get(key)
            if entry is None:
                merged[key] = {
                    "song": song,
                    "artist": artist,
                    "confidence": int(r.get("confidence", 0)),
                    "strategy": strategy,
                    "sources": [strategy],
                    "matched_variant": variant,
                }
            else:
                if strategy not in entry["sources"]:
                    entry["sources"].append(strategy)
                if int(r.get("confidence", 0)) > entry["confidence"]:
                    entry["confidence"] = int(r.get("confidence", 0))
                    entry["strategy"] = strategy
                    entry["matched_variant"] = variant

    candidates = list(merged.values())
    for c in candidates:
        c["sources"] = sorted(
            c["sources"],
            key=lambda s: STRATEGY_ORDER.index(s) if s in STRATEGY_ORDER else 99,
        )

    candidates.sort(
        key=lambda x: (
            -int(x.get("confidence", 0)),
            x.get("song", "").lower(),
            x.get("artist", "").lower(),
            x.get("strategy", ""),
        )
    )
    return candidates[:max_results]


class SongIdentifier:
    """
    Song identification service using multiple search strategies.

    Strategy 1: Genius.com search (primary)
    Strategy 2: YouTube search (fallback)
    """

    # Minimum confidence threshold to accept a result
    MIN_CONFIDENCE = 50

    # Request timeout in seconds
    REQUEST_TIMEOUT = (2, 4)  # (connect_timeout, read_timeout)

    # User agent for web requests
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    def __init__(self):
        """Initialize song identifier with API keys."""
        self._session_local = threading.local()
        self._session_headers = {
            "User-Agent": self.USER_AGENT,
            "Accept": "application/json, text/html",
            "Accept-Language": "en-US,en;q=0.9",
        }
        # Optional API keys for enhanced identification
        self._audd_token = os.getenv("AUDD_API_TOKEN", "")
        self._musixmatch_key = os.getenv("MUSIXMATCH_API_KEY", "")
        # Per-host rate limits (ms). MusicBrainz requires >=1000ms.
        self._rate_limiter = _RateLimiter({
            "musicbrainz": 1100,
            "genius": 250,
            "youtube": 250,
            "itunes": 250,
            "deezer": 250,
            "duckduckgo": 500,
            "musixmatch": 500,
            "audd": 250,
        })

    @property
    def _session(self) -> requests.Session:
        """Thread-local requests session for safe concurrent use."""
        if not hasattr(self._session_local, 'session'):
            s = requests.Session()
            s.headers.update(self._session_headers)
            self._session_local.session = s
        return self._session_local.session

    def identify_multiple(self, transcript: str, max_results: int = 5) -> list:
        """
        Return multiple candidate songs from all strategies.

        The transcript is treated as an uncertain sensor reading: it is
        normalized and expanded into a small set of query variants, and
        query-based strategies (YouTube/Genius/iTunes) fan out across those
        variants. Candidates are merged deterministically by canonical
        (song, artist) key, tracking every distinct strategy that produced
        them as `sources`. `confidence` here is a *search prior* only —
        the real score comes from lyric verification downstream.

        Runs search strategies in parallel for speed.

        Args:
            transcript: Transcribed lyrics text
            max_results: Maximum number of results to return

        Returns:
            List of dicts with song, artist, confidence (search prior),
            strategy (first producing strategy, for compatibility),
            sources (all producing strategies), and matched_variant.
        """
        if not transcript or len(transcript.strip()) < 3:
            return []

        variants = expand_queries(transcript)
        if not variants:
            return []
        base_query = variants[0]

        # Submit in fixed strategy order; await in the same order so
        # thread completion order never affects ranking (deterministic).
        jobs: list[tuple[str, str]] = []  # (strategy, variant)
        futures: dict[tuple[str, str], object] = {}
        executor = _identify_executor

        def _submit(strategy: str, variant: str, fn, *args):
            futures[(strategy, variant)] = executor.submit(fn, *args)
            jobs.append((strategy, variant))

        # Transcript-based strategies run once on the raw transcript.
        if self._audd_token:
            _submit("audd", transcript, self._audd_lyrics_search, transcript)
        if self._musixmatch_key:
            _submit("musixmatch", transcript, self._musixmatch_search, base_query, transcript)
        _submit("duckduckgo", transcript, self._duckduckgo_search, transcript)

        # Query-based strategies fan out across expansion variants.
        for variant in variants:
            _submit("youtube", variant, self._youtube_search_multiple, variant, transcript)
            _submit("genius", variant, self._genius_search_multiple, variant, transcript)
            _submit("itunes", variant, self._itunes_search, variant, transcript)
            _submit("deezer", variant, self._deezer_search, variant, transcript)
        # MusicBrainz is strict 1 req/s: run once on the base query as
        # metadata validation, not per variant.
        _submit("musicbrainz", base_query, self._musicbrainz_search, base_query, transcript)

        # Await in fixed submission order (not completion order) so
        # ranking is deterministic regardless of thread scheduling.
        jobs_results: list[tuple[str, str, list]] = []
        for strategy, variant in jobs:
            try:
                results = futures[(strategy, variant)].result()
            except Exception as e:
                logger.debug(f"Strategy '{strategy}' failed: {e}")
                results = []
            jobs_results.append((strategy, variant, results or []))

        return merge_candidates(jobs_results, max_results)

    def _audd_lyrics_search(self, transcript: str) -> list:
        """
        Search AudD Music Recognition API by lyrics text.
        Free tier: 10 requests/day without token, 300 with token.
        Best accuracy for lyrics-to-song matching.
        """
        try:
            self._rate_limiter.wait("audd")
            url = "https://api.audd.io/findLyrics/"
            params = {"q": transcript}
            if self._audd_token:
                params["api_token"] = self._audd_token

            response = self._session.get(url, params=params, timeout=self.REQUEST_TIMEOUT)
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "success":
                return []

            results = []
            for item in data.get("result", [])[:5]:
                song = item.get("title", "").strip()
                artist = item.get("artist", "").strip()

                if not song:
                    continue

                # Calculate confidence — use token_set_ratio to avoid inflation for short titles
                title_score = fuzz.token_set_ratio(transcript.lower(), song.lower())
                # Penalize very short titles that trivially match
                if len(song.split()) <= 2:
                    title_score = int(title_score * 0.85)
                # AudD results are pre-ranked by relevance, so boost early results
                confidence = min(100, title_score + 10)

                results.append({
                    "song": song,
                    "artist": artist or "",
                    "confidence": confidence,
                })

            return results
        except Exception as e:
            logging.getLogger(__name__).warning(f"AudD search error: {e}")
            return []

    def _musixmatch_search(self, query: str, original_transcript: str) -> list:
        """
        Search Musixmatch for song matches.
        Uses the community API (no key needed) or official API with key.
        14M+ songs, 80+ languages including Hindi, Spanish, Korean, etc.
        """
        try:
            # Use the community endpoint (works without API key)
            base_url = "https://api.musixmatch.com/ws/1.1"

            # Try with API key if available
            api_key = self._musixmatch_key

            self._rate_limiter.wait("musixmatch")
            # Search by lyrics content
            params = {
                "apikey": api_key,
                "q_lyrics": original_transcript,
                "page_size": 5,
                "page": 1,
                "s_track_rating": "desc",
            }

            response = self._session.get(
                f"{base_url}/track.search",
                params=params,
                timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()

            track_list = (
                data.get("message", {})
                .get("body", {})
            )

            # Handle 401 or empty body (returned as [] instead of {})
            if isinstance(track_list, list) or not track_list:
                return []

            track_list = track_list.get("track_list", [])

            results = []
            for item in track_list:
                track = item.get("track", {})
                song = track.get("track_name", "").strip()
                artist = track.get("artist_name", "").strip()

                if not song:
                    continue

                # Calculate confidence
                title_match = fuzz.partial_ratio(original_transcript.lower(), song.lower())
                rating = track.get("track_rating", 0)
                # Boost confidence for highly-rated tracks
                confidence = min(100, int(title_match * 0.7 + (rating / 100) * 30))

                results.append({
                    "song": song,
                    "artist": artist or "",
                    "confidence": confidence,
                })

            return results
        except Exception:
            logging.getLogger(__name__).warning("Musixmatch search error (details suppressed to protect API key)")
            return []

    def _genius_search_multiple(self, query: str, original_transcript: str) -> list:
        """Search Genius and return multiple results."""
        try:
            self._rate_limiter.wait("genius")
            encoded_query = urllib.parse.quote(query)
            url = f"https://genius.com/api/search?q={encoded_query}"

            response = self._session.get(url, timeout=self.REQUEST_TIMEOUT)
            response.raise_for_status()

            data = response.json()
            hits = data.get("response", {}).get("hits", [])

            results = []
            for hit_data in hits[:5]:
                hit = hit_data.get("result", {})
                song_title = hit.get("title", "")
                artist_name = hit.get("primary_artist", {}).get("name", "")

                if not song_title or not artist_name:
                    continue
                if len(song_title) > 50:
                    continue
                parody_markers = ["but ", "except", "however", "alphabetical", "reversed"]
                if any(m in song_title.lower() for m in parody_markers):
                    continue

                confidence = self._calculate_confidence(
                    original_transcript, song_title, artist_name
                )
                results.append({
                    "song": song_title,
                    "artist": artist_name,
                    "confidence": confidence,
                })

            return results
        except Exception as e:
            logging.getLogger(__name__).warning(f"Genius multi-search error: {e}")
            return []

    def _youtube_search_multiple(self, query: str, original_transcript: str) -> list:
        """Search YouTube using yt-dlp for structured results (no HTML scraping)."""
        try:
            import subprocess
            import json as json_mod

            # Sanitize query for yt-dlp — allowlist approach: only alphanumeric, spaces, apostrophes, hyphens
            safe_query = re.sub(r"[^a-zA-Z0-9\s'\-]", '', query)[:200].strip()
            if not safe_query:
                return self._youtube_search_multiple_fallback(query, original_transcript)
            search_query = f"ytsearch5:{safe_query} lyrics"
            self._rate_limiter.wait("youtube")
            ytdlp_timeout = min(int(os.getenv("YTDLP_TIMEOUT", "5")), 15)
            # Safe: no shell=True, args passed as list — no shell injection possible
            result = subprocess.run(
                ["yt-dlp", "--flat-playlist", "--dump-json", "--no-download", "--no-warnings",
                 "--no-exec", "--restrict-filenames", "--no-config", "--ignore-config",
                 "--no-playlist", "--", search_query],
                capture_output=True, text=True, timeout=ytdlp_timeout
            )

            if result.returncode != 0:
                # Fallback to HTML scraping if yt-dlp not available
                return self._youtube_search_multiple_fallback(query, original_transcript)

            results = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                try:
                    entry = json_mod.loads(line)
                    title = entry.get("title", "")
                    channel = entry.get("channel", entry.get("uploader", ""))

                    if not title:
                        continue

                    cleaned = clean_title(title, channel)
                    song_name = cleaned.get("song", "")
                    artist_name = cleaned.get("artist", "")

                    if song_name:
                        confidence = self._calculate_confidence(
                            original_transcript, song_name, artist_name or song_name
                        )
                        if confidence >= 20:
                            results.append({
                                "song": song_name,
                                "artist": artist_name or channel or "Unknown",
                                "confidence": confidence,
                            })
                except (json_mod.JSONDecodeError, KeyError):
                    continue

            return results

        except (FileNotFoundError, subprocess.TimeoutExpired):
            # yt-dlp not installed or timed out — fall back to HTML scraping
            return self._youtube_search_multiple_fallback(query, original_transcript)
        except Exception as e:
            logging.getLogger(__name__).warning(f"YouTube yt-dlp search error: {e}")
            return self._youtube_search_multiple_fallback(query, original_transcript)

    def _youtube_search_multiple_fallback(self, query: str, original_transcript: str) -> list:
        """Fallback: Search YouTube via HTML scraping (less reliable)."""
        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://www.youtube.com/results?search_query={encoded_query}"

            response = self._session.get(url, timeout=self.REQUEST_TIMEOUT)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            scripts = soup.find_all("script")

            for script in scripts:
                if script.string and "var ytInitialData" in script.string:
                    titles = self._extract_youtube_titles(script.string)
                    results = []

                    for title in titles[:8]:
                        cleaned = clean_title(title)
                        song_name = cleaned.get("song", "")
                        artist_name = cleaned.get("artist", "")

                        if song_name:
                            confidence = self._calculate_confidence(
                                original_transcript,
                                song_name,
                                artist_name or song_name
                            )
                            if confidence >= 20:
                                results.append({
                                    "song": song_name,
                                    "artist": artist_name or "Unknown",
                                    "confidence": confidence,
                                })

                    return results

            return []
        except Exception as e:
            logging.getLogger(__name__).warning(f"YouTube fallback search error: {e}")
            return []

    def _itunes_search(self, query: str, original_transcript: str) -> list:
        """Search iTunes Store (free, no API key, good metadata)."""
        try:
            self._rate_limiter.wait("itunes")
            params = {
                "term": query,
                "media": "music",
                "entity": "song",
                "limit": 5,
            }
            response = self._session.get(
                "https://itunes.apple.com/search",
                params=params,
                timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
            results = []
            for item in data.get("results", []):
                title = item.get("trackName", "")
                artist = item.get("artistName", "")
                if not title:
                    continue
                confidence = self._calculate_confidence(original_transcript, title, artist)
                results.append({
                    "song": title,
                    "artist": artist,
                    "confidence": confidence,
                })
            return results
        except Exception as e:
            logging.getLogger(__name__).debug(f"iTunes search error: {e}")
            return []

    def _throttled_get(self, rate_key: str, url: str, **kwargs) -> requests.Response:
        """GET with per-host rate limiting. Raises on HTTP/network errors."""
        self._rate_limiter.wait(rate_key)
        return self._session.get(url, **kwargs)

    def _deezer_search(self, query: str, original_transcript: str) -> list:
        """Search Deezer API (free, no key, good metadata). Fail-soft."""
        try:
            response = self._throttled_get(
                "deezer",
                "https://api.deezer.com/search",
                params={"q": query, "limit": 5},
                timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
            results = []
            for item in (data.get("data") or [])[:5]:
                title = (item.get("title") or "").strip()
                artist = ((item.get("artist") or {}).get("name") or "").strip()
                if not title:
                    continue
                results.append({
                    "song": title,
                    "artist": artist,
                    "confidence": self._search_prior(original_transcript, title, artist or title),
                })
            return results
        except Exception as e:
            logging.getLogger(__name__).debug(f"Deezer search error: {e}")
            return []

    def _musicbrainz_search(self, query: str, original_transcript: str) -> list:
        """Search MusicBrainz recordings (free, no key, 1 req/s limit).

        Used as metadata validation rather than a primary source: recording
        titles/artists are canonical, so a match here is strong evidence the
        song exists even when lyric coverage is thin. Fail-soft on 429/5xx.
        """
        try:
            response = self._throttled_get(
                "musicbrainz",
                "https://musicbrainz.org/ws/2/recording/",
                params={"query": f'recording:"{query}"', "fmt": "json", "limit": 5},
                headers={"User-Agent": "LyricSpot/1.0 (research project; contact: admin@example.com)"},
                timeout=(3, 6),
            )
            if response.status_code == 429:
                logger.debug("MusicBrainz rate limited (429), skipping")
                return []
            response.raise_for_status()
            data = response.json()
            results = []
            for item in (data.get("recordings") or [])[:5]:
                title = (item.get("title") or "").strip()
                artists = item.get("artist-credit") or []
                artist = ""
                if artists and isinstance(artists[0], dict):
                    artist = ((artists[0].get("artist") or {}).get("name") or "").strip()
                if not title:
                    continue
                results.append({
                    "song": title,
                    "artist": artist,
                    "confidence": self._search_prior(original_transcript, title, artist or title),
                })
            return results
        except Exception as e:
            logging.getLogger(__name__).debug(f"MusicBrainz search error: {e}")
            return []

    def _prepare_search_query(self, transcript: str) -> str:
        """
        Prepare transcript for search query.

        Cleans and truncates text for optimal search results.
        Only appends 'lyrics' for short/ambiguous queries.
        """
        # Remove extra whitespace
        query = " ".join(transcript.split())

        # Take first ~100 characters for search (most distinctive part)
        if len(query) > 100:
            # Try to break at word boundary
            query = query[:100].rsplit(" ", 1)[0]

        # Only add "lyrics" keyword for short queries where it helps disambiguation
        word_count = len(query.split())
        if word_count <= 10:
            return f"{query} lyrics"
        return query

    def _genius_search(self, query: str, original_transcript: str) -> Optional[Dict[str, Any]]:
        """
        Search Genius.com for song matching lyrics.
        Returns the single best match from multiple results.
        """
        results = self._genius_search_multiple(query, original_transcript)
        if not results:
            return None
        # Return highest confidence result
        return max(results, key=lambda r: r["confidence"])

    def _youtube_search(self, query: str, original_transcript: str) -> Optional[Dict[str, Any]]:
        """
        Search YouTube for song matching lyrics.

        Scrapes YouTube search results page.

        Args:
            query: Search query string
            original_transcript: Original transcript for confidence scoring

        Returns:
            Dict with song, artist, confidence or None
        """
        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://www.youtube.com/results?search_query={encoded_query}"

            response = self._session.get(url, timeout=self.REQUEST_TIMEOUT)
            response.raise_for_status()

            # Parse HTML to find video titles
            soup = BeautifulSoup(response.text, "html.parser")

            # YouTube embeds video data in script tags
            # Look for video titles in the page
            scripts = soup.find_all("script")

            for script in scripts:
                if script.string and "var ytInitialData" in script.string:
                    # Extract video titles from ytInitialData
                    titles = self._extract_youtube_titles(script.string)

                    for title in titles[:5]:  # Check top 5 results
                        cleaned = clean_title(title)

                        if cleaned.get("song") and cleaned.get("artist"):
                            confidence = self._calculate_confidence(
                                original_transcript,
                                cleaned["song"],
                                cleaned["artist"]
                            )

                            if confidence >= 30:  # Lower threshold for YouTube
                                return {
                                    "song": cleaned["song"],
                                    "artist": cleaned["artist"],
                                    "confidence": confidence
                                }

                    # If no clean title found, try first result anyway
                    if titles:
                        cleaned = clean_title(titles[0])
                        return {
                            "song": cleaned.get("song", titles[0]),
                            "artist": cleaned.get("artist", "Unknown"),
                            "confidence": 40  # Low confidence for unclean match
                        }

            return None

        except requests.RequestException as e:
            logging.getLogger(__name__).warning(f"YouTube search error: {e}")
            return None
        except Exception as e:
            logging.getLogger(__name__).warning(f"YouTube parsing error: {e}")
            return None

    def _extract_youtube_titles(self, script_content: str) -> list:
        """
        Extract video titles from YouTube's ytInitialData JSON.
        Also extracts channel names as potential artist info.

        Returns:
            List of video title strings (may include "title | channel" format)
        """
        titles = []
        channels = []

        try:
            # Extract titles from "title":{"runs":[{"text":"..."}]}
            pattern = r'"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"'
            matches = re.findall(pattern, script_content)

            for match in matches:
                try:
                    decoded = match.encode('utf-8').decode('unicode_escape', errors='replace')
                except (UnicodeDecodeError, UnicodeEncodeError):
                    decoded = match
                if self._is_likely_song_title(decoded):
                    titles.append(decoded)

            # Extract channel/artist names
            channel_pattern = r'"ownerText":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"'
            channel_matches = re.findall(channel_pattern, script_content)
            channels = channel_matches[:10]

            # Also try accessibility text ("Song by Artist - duration")
            pattern2 = r'"accessibilityData":\s*\{\s*"label":\s*"([^"]+)"'
            matches2 = re.findall(pattern2, script_content)

            for match in matches2:
                if "by" in match.lower() and self._is_likely_song_title(match):
                    titles.append(match)

            # Combine titles with channel info for better parsing
            # If a title has no " - " but we have a channel, append it
            enhanced_titles = []
            for i, title in enumerate(titles):
                if " - " not in title and " | " not in title and i < len(channels):
                    channel = channels[i] if i < len(channels) else ""
                    if channel and channel.lower() not in title.lower():
                        enhanced_titles.append(f"{channel} - {title}")
                enhanced_titles.append(title)

            return enhanced_titles if enhanced_titles else titles

        except Exception as e:
            logging.getLogger(__name__).warning(f"Title extraction error: {e}")

        return titles

    def _is_likely_song_title(self, title: str) -> bool:
        """Check if string is likely a song title."""
        if not title or len(title) < 3:
            return False

        # Filter out common non-song content
        skip_patterns = [
            "subscribe",
            "views",
            "ago",
            "channel",
            "playlist",
            "mix -",
            "topic",
        ]

        title_lower = title.lower()
        for pattern in skip_patterns:
            if pattern in title_lower:
                return False

        return True

    def _calculate_confidence(
        self,
        transcript: str,
        song_title: str,
        artist_name: str
    ) -> int:
        """Backward-compatible alias for _search_prior (kept for existing callers/tests)."""
        return self._search_prior(transcript, song_title, artist_name)

    def _search_prior(
        self,
        transcript: str,
        song_title: str,
        artist_name: str
    ) -> int:
        """
        Calculate the initial *search prior* for a match.

        This is deliberately weak: the user sings lyrics, not the song title,
        so title/transcript overlap must never dominate lyric verification.
        The real confidence is determined later by lyrics matching.
        """
        transcript_lower = transcript.lower().strip()
        song_lower = song_title.lower().strip()

        # Check if song title words appear in transcript
        title_words = [w for w in song_lower.split() if len(w) > 2]
        if title_words:
            title_match = sum(1 for word in title_words if word in transcript_lower) / len(title_words)
        else:
            title_match = 0.3

        # Fuzzy match transcript against song title
        title_ratio = fuzz.partial_ratio(transcript_lower, song_lower)
        token_sort = fuzz.token_sort_ratio(transcript_lower, song_lower)
        best_fuzzy = max(title_ratio, token_sort)

        # Base confidence: search engines returned this, so it's at least plausible
        base = 45
        confidence = base + (title_match * 25) + (best_fuzzy * 0.25)

        # Bonus: if the song title is a well-known short phrase that appears in transcript
        if len(song_lower) > 3 and song_lower in transcript_lower:
            confidence += 15

        # Penalize when the song title is essentially the transcript itself
        if title_ratio > 90 and len(song_title) > 20:
            title_word_count = len(song_title.split())
            transcript_word_count = len(transcript.split())
            if title_word_count >= transcript_word_count * 0.8:
                confidence = max(confidence * 0.5, 25)

        return int(min(100, max(30, confidence)))

    def _duckduckgo_search(self, transcript: str) -> list:
        """Search DuckDuckGo HTML for quoted lyrics to find the original song."""
        try:
            # Use quoted lyrics search for better precision
            snippet = transcript[:60].strip()
            query = f'"{snippet}" lyrics song'

            self._rate_limiter.wait("duckduckgo")
            response = self._session.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.text, "html.parser")
            results = []

            for result in soup.select(".result__a")[:5]:
                title = result.get_text(strip=True)
                href = result.get("href", "")

                if not title:
                    continue

                # Parse "Song - Artist Lyrics" or "Artist - Song Lyrics" patterns
                # Common patterns in search results:
                # "Don't Stop Believin' Lyrics - Journey"
                # "Journey – Don't Stop Believin' Lyrics | Genius Lyrics"
                import re
                # Remove common suffixes
                clean_title = re.sub(r'\s*\|.*$', '', title)
                clean_title = re.sub(r'\s*[-–]\s*(Genius|AZLyrics|Lyrics\.com|MetroLyrics).*$', '', clean_title, flags=re.IGNORECASE)
                clean_title = re.sub(r'\s+Lyrics?\s*$', '', clean_title, flags=re.IGNORECASE)

                # Try "Song - Artist" or "Artist - Song" split
                parts = re.split(r'\s*[-–—]\s*', clean_title, maxsplit=1)
                if len(parts) == 2:
                    # Determine which is song vs artist
                    # If one part is a subset of the transcript, that's probably the song
                    p1, p2 = parts[0].strip(), parts[1].strip()
                    song, artist = p1, p2
                    # Heuristic: lyrics sites often put "Song Lyrics - Artist" or "Artist - Song"
                    if "genius.com" in href or "azlyrics" in href:
                        # Genius format: "Artist – Song"
                        artist, song = p1, p2
                else:
                    song = clean_title.strip()
                    artist = ""

                if song and len(song) > 2:
                    confidence = self._calculate_confidence(transcript, song, artist or song)
                    results.append({"song": song, "artist": artist, "confidence": confidence})

            return results
        except Exception as e:
            logger.debug(f"DuckDuckGo search error: {e}")
            return []

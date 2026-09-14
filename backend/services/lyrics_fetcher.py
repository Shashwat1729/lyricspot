"""
Lyrics fetching service for ContinueMySong AI.
Fetches synced lyrics from multiple sources:
- LRCLIB (free, no key required)
- Musixmatch (14M+ songs, 80+ languages)
- Genius (plain lyrics fallback)
"""

import logging
import os
import re
import threading
import time
import urllib.parse
from typing import Optional, List, Dict, Any

from bs4 import BeautifulSoup
from rapidfuzz import fuzz

import requests


class LyricsFetcher:
    """
    Lyrics fetching service using LRCLIB API.
    
    LRCLIB provides free synced lyrics (LRC format) without API key.
    """

    # LRCLIB API base URL
    API_BASE = "https://lrclib.net/api"

    # Request timeout in seconds (reduced to avoid blocking when LRCLIB is down)
    REQUEST_TIMEOUT = 3

    # Circuit breaker: skip LRCLIB after N consecutive failures
    _lrclib_failures = 0
    _lrclib_circuit_open_until = 0.0
    _lrclib_lock = threading.Lock()
    _LRCLIB_MAX_FAILURES = 1
    _LRCLIB_CIRCUIT_COOLDOWN = 120  # seconds - longer cooldown since full outages last minutes

    # User agent for requests (LRCLIB recommends identifying your app)
    USER_AGENT = "LyricSpot/1.0 (https://github.com/Shashwat1729/lyricspot)"
    # Browser-like UA for Genius scraping (they block bot UAs)
    BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    def __init__(self):
        """Initialize lyrics fetcher."""
        self._session_local = threading.local()
        self._session_headers = {
            "User-Agent": self.USER_AGENT,
            "Accept": "application/json",
        }
        self._musixmatch_key = os.getenv("MUSIXMATCH_API_KEY", "")
        # In-memory cache for lyrics results (bounded LRU)
        self._synced_cache: dict[str, Any] = {}
        self._plain_cache: dict[str, Any] = {}
        self._cache_lock = threading.Lock()
        self._cache_max = 500

    @property
    def _session(self) -> requests.Session:
        """Thread-local requests session for safe concurrent use."""
        if not hasattr(self._session_local, 'session'):
            s = requests.Session()
            s.headers.update(self._session_headers)
            self._session_local.session = s
        return self._session_local.session

    def fetch_synced_lyrics(
        self,
        song: str,
        artist: str
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch synced lyrics for a song from multiple sources.
        
        Priority:
        1. LRCLIB (free, no key, good coverage for English/mainstream)
        2. Musixmatch (14M+ songs, 80+ languages, best for non-English)
        
        Args:
            song: Song title
            artist: Artist name
            
        Returns:
            List of lyrics lines with timestamps:
            [{"timestamp_seconds": float, "text": str}, ...]
            Returns None if no synced lyrics found.
        """
        # Cache check
        cache_key = f"{song.lower().strip()}|{artist.lower().strip()}"
        with self._cache_lock:
            if cache_key in self._synced_cache:
                return self._synced_cache[cache_key]

        # Try LRCLIB first (free, no rate limits)
        lyrics_data = self._search_lyrics(song, artist)

        if not lyrics_data:
            lyrics_data = self._search_lyrics(song, "")

        if lyrics_data:
            synced_lyrics = lyrics_data.get("syncedLyrics")
            if synced_lyrics:
                result = self.parse_lrc(synced_lyrics)
                self._store_synced_cache(cache_key, result)
                return result

        # Fallback to Musixmatch (better for non-English/Bollywood, requires API key)
        if self._musixmatch_key:
            mxm_lyrics = self._musixmatch_synced_lyrics(song, artist)
            if mxm_lyrics:
                self._store_synced_cache(cache_key, mxm_lyrics)
                return mxm_lyrics

        self._store_synced_cache(cache_key, None)
        return None

    def _store_synced_cache(self, key: str, value: Any) -> None:
        """Store result in synced lyrics cache (bounded)."""
        with self._cache_lock:
            if len(self._synced_cache) >= self._cache_max:
                # Remove oldest entry
                oldest = next(iter(self._synced_cache))
                del self._synced_cache[oldest]
            self._synced_cache[key] = value

    def _is_lrclib_available(self) -> bool:
        """Check circuit breaker for LRCLIB (thread-safe)."""
        with LyricsFetcher._lrclib_lock:
            if LyricsFetcher._lrclib_failures >= self._LRCLIB_MAX_FAILURES:
                if time.time() < LyricsFetcher._lrclib_circuit_open_until:
                    return False
                # Reset after cooldown
                LyricsFetcher._lrclib_failures = 0
            return True

    def _search_lyrics(self, song: str, artist: str) -> Optional[Dict]:
        """
        Search LRCLIB for lyrics.
        
        Args:
            song: Song title
            artist: Artist name (can be empty)
            
        Returns:
            Lyrics data dict or None
        """
        if not self._is_lrclib_available():
            logging.getLogger(__name__).debug("LRCLIB circuit breaker open, skipping")
            return None
        try:
            # Use structured search parameters for better precision
            params = {"track_name": song}
            if artist:
                params["artist_name"] = artist

            url = f"{self.API_BASE}/search"

            response = self._session.get(url, params=params, timeout=self.REQUEST_TIMEOUT,
                                         headers={"User-Agent": "LyricSpot/1.0 (https://github.com/Shashwat1729/lyricspot)"})
            response.raise_for_status()

            results = response.json()

            if not results or not isinstance(results, list):
                return None

            # Find best match with synced lyrics
            with LyricsFetcher._lrclib_lock:
                LyricsFetcher._lrclib_failures = 0  # Reset on success
            for result in results:
                if result.get("syncedLyrics"):
                    # Verify it's a reasonable match
                    result_title = result.get("trackName", "").lower()
                    result_artist = result.get("artistName", "").lower()

                    if self._fuzzy_match(song, result_title):
                        return result

            # Return first result with synced lyrics even if not perfect match
            for result in results:
                if result.get("syncedLyrics"):
                    return result

            return None

        except requests.RequestException as e:
            with LyricsFetcher._lrclib_lock:
                LyricsFetcher._lrclib_failures += 1
                LyricsFetcher._lrclib_circuit_open_until = time.time() + self._LRCLIB_CIRCUIT_COOLDOWN
            logging.getLogger(__name__).warning(f"LRCLIB search error: {e}")
            return None
        except (ValueError, KeyError) as e:
            logging.getLogger(__name__).warning(f"LRCLIB response parsing error: {e}")
            return None

    def _fuzzy_match(self, s1: str, s2: str) -> bool:
        """Simple fuzzy match - check if most words match."""
        words1 = set(s1.lower().split())
        words2 = set(s2.lower().split())

        if not words1 or not words2:
            return False

        common = words1 & words2
        return len(common) >= min(len(words1), len(words2)) * 0.5

    def _musixmatch_synced_lyrics(self, song: str, artist: str) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch synced lyrics from Musixmatch API.
        Musixmatch has 14M+ songs across 80+ languages.
        """
        try:
            base_url = "https://api.musixmatch.com/ws/1.1"

            # First find the track
            params = {
                "apikey": self._musixmatch_key,
                "q_track": song,
                "q_artist": artist,
                "f_has_subtitles": 1,
                "page_size": 3,
                "page": 1,
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
                return None

            track_list = track_list.get("track_list", [])

            if not track_list:
                return None

            # Get the first track's subtitles (synced lyrics)
            track_id = track_list[0].get("track", {}).get("track_id")
            if not track_id:
                return None

            # Fetch subtitles for this track
            sub_params = {
                "apikey": self._musixmatch_key,
                "track_id": track_id,
                "subtitle_format": "lrc",
            }

            sub_response = self._session.get(
                f"{base_url}/track.subtitle.get",
                params=sub_params,
                timeout=self.REQUEST_TIMEOUT,
            )
            sub_response.raise_for_status()
            sub_data = sub_response.json()

            subtitle_body = (
                sub_data.get("message", {})
                .get("body", {})
                .get("subtitle", {})
                .get("subtitle_body", "")
            )

            if subtitle_body:
                return self.parse_lrc(subtitle_body)

            return None

        except Exception:
            logging.getLogger(__name__).warning("Musixmatch lyrics error (details suppressed to protect API key)")
            return None

    def parse_lrc(self, lrc_string: str) -> List[Dict[str, Any]]:
        """
        Parse LRC format lyrics to list of timestamped lines.
        
        LRC format: [mm:ss.xx]Lyrics text
        
        Args:
            lrc_string: LRC formatted lyrics string
            
        Returns:
            List of dicts: [{"timestamp_seconds": float, "text": str}, ...]
        """
        if not lrc_string:
            return []

        lines = []

        # LRC timestamp pattern: [mm:ss.xx] or [mm:ss]
        pattern = r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$'

        for line in lrc_string.split('\n'):
            line = line.strip()
            if not line:
                continue

            match = re.match(pattern, line)
            if match:
                minutes = int(match.group(1))
                seconds = int(match.group(2))

                # Handle milliseconds (may be 2 or 3 digits)
                ms_str = match.group(3)
                if ms_str:
                    # Normalize to 3 digits
                    ms_str = ms_str.ljust(3, '0')[:3]
                    milliseconds = int(ms_str)
                else:
                    milliseconds = 0

                text = match.group(4).strip()

                # Skip empty lines or metadata
                if not text or text.startswith('['):
                    continue

                timestamp_seconds = minutes * 60 + seconds + milliseconds / 1000

                lines.append({
                    "timestamp_seconds": round(timestamp_seconds, 3),
                    "text": text
                })

        # Sort by timestamp
        lines.sort(key=lambda x: x["timestamp_seconds"])

        return lines

    def fetch_plain_lyrics(self, song: str, artist: str) -> Optional[str]:
        """
        Fetch plain (non-synced) lyrics for a song.
        Tries LRCLIB first, then Genius as fallback.
        """
        # Try LRCLIB (skip if circuit breaker is open)
        if self._is_lrclib_available():
            try:
                params = {"track_name": song}
                if artist:
                    params["artist_name"] = artist
                url = f"{self.API_BASE}/search"

                response = self._session.get(url, params=params, timeout=self.REQUEST_TIMEOUT,
                                             headers={"User-Agent": "LyricSpot/1.0 (https://github.com/Shashwat1729/lyricspot)"})
                response.raise_for_status()

                results = response.json()
                with LyricsFetcher._lrclib_lock:
                    LyricsFetcher._lrclib_failures = 0
                if results and isinstance(results, list):
                    for result in results:
                        plain_lyrics = result.get("plainLyrics")
                        if plain_lyrics:
                            return plain_lyrics
            except requests.RequestException as e:
                with LyricsFetcher._lrclib_lock:
                    LyricsFetcher._lrclib_failures += 1
                    LyricsFetcher._lrclib_circuit_open_until = time.time() + self._LRCLIB_CIRCUIT_COOLDOWN
                logging.getLogger(__name__).warning(f"LRCLIB plain lyrics error: {e}")
            except Exception as e:
                logging.getLogger(__name__).warning(f"LRCLIB plain lyrics error: {e}")

        # Fallback: Lyrics.ovh (free, no auth, fast)
        if artist:
            ovh_lyrics = self._fetch_lyrics_ovh(song, artist)
            if ovh_lyrics:
                return ovh_lyrics

        # Fallback: Genius lyrics scraping
        return self._fetch_genius_lyrics(song, artist)

    def _fetch_lyrics_ovh(self, song: str, artist: str) -> Optional[str]:
        """Fetch plain lyrics from Lyrics.ovh (free, no API key)."""
        try:
            url = f"https://api.lyrics.ovh/v1/{urllib.parse.quote(artist)}/{urllib.parse.quote(song)}"
            response = self._session.get(url, timeout=self.REQUEST_TIMEOUT)
            if response.status_code == 200:
                data = response.json()
                lyrics = data.get("lyrics", "")
                if lyrics and len(lyrics) > 50:
                    return lyrics
        except Exception as e:
            logging.getLogger(__name__).debug(f"Lyrics.ovh error: {e}")
        return None

    def _fetch_genius_lyrics(self, song: str, artist: str) -> Optional[str]:
        """Scrape lyrics from Genius as a fallback."""
        try:
            query = f"{song} {artist}" if artist else song
            encoded_query = urllib.parse.quote(query)
            search_url = f"https://genius.com/api/search?q={encoded_query}"

            response = self._session.get(search_url, timeout=self.REQUEST_TIMEOUT)
            response.raise_for_status()

            data = response.json()
            hits = data.get("response", {}).get("hits", [])
            if not hits:
                return None

            # Get the lyrics page URL
            lyrics_path = hits[0].get("result", {}).get("path", "")
            if not lyrics_path:
                return None

            # SSRF protection: validate path is a safe Genius lyrics path
            decoded_lyrics_path = urllib.parse.unquote(lyrics_path)
            if not decoded_lyrics_path.startswith("/") or not re.match(r'^/[a-zA-Z0-9][a-zA-Z0-9\-]*(/[a-zA-Z0-9][a-zA-Z0-9\-]*)*$', decoded_lyrics_path):
                logging.getLogger(__name__).warning(f"Suspicious Genius path rejected: {lyrics_path[:50]}")
                return None
            suspicious_patterns = ("..", "@", "//", "?", "%", "#", "\\")
            if any(pattern in lyrics_path for pattern in suspicious_patterns) or any(pattern in decoded_lyrics_path for pattern in suspicious_patterns):
                logging.getLogger(__name__).warning(f"Suspicious Genius path rejected: {lyrics_path[:50]}")
                return None

            lyrics_url = f"https://genius.com{decoded_lyrics_path}"
            page_headers = {
                "User-Agent": self.BROWSER_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            }
            page_resp = self._session.get(lyrics_url, timeout=(5, 10), stream=True, headers=page_headers)
            page_resp.raise_for_status()

            # Cap response size to 1MB and wall-clock to 30s
            content_chunks = []
            bytes_read = 0
            deadline = time.monotonic() + 30
            for chunk in page_resp.iter_content(chunk_size=65536):
                content_chunks.append(chunk)
                bytes_read += len(chunk)
                if bytes_read > 1_000_000 or time.monotonic() > deadline:
                    break
            page_resp.close()
            content = b''.join(content_chunks)

            # Extract lyrics from the page (between Lyrics__Container divs)
            soup = BeautifulSoup(content, "html.parser")

            lyrics_divs = soup.find_all("div", attrs={"data-lyrics-container": "true"})
            if not lyrics_divs:
                return None

            lyrics_text = ""
            for div in lyrics_divs:
                # Replace <br> with newlines
                for br in div.find_all("br"):
                    br.replace_with("\n")
                lyrics_text += div.get_text() + "\n"

            return lyrics_text.strip() if lyrics_text.strip() else None

        except Exception as e:
            logging.getLogger(__name__).warning(f"Genius lyrics scrape error: {e}")
            return None

    def estimate_timestamp_from_plain(
        self, transcript: str, plain_lyrics: str, avg_duration: float = 210.0
    ) -> Optional[Dict[str, Any]]:
        """
        Estimate a timestamp from plain (unsynced) lyrics using line position.
        
        Args:
            transcript: The user's sung/typed lyrics
            plain_lyrics: Full plain lyrics text
            avg_duration: Estimated song duration in seconds (default 3:30)
            
        Returns:
            Dict with estimated timestamp and confidence, or None
        """

        if not transcript or not plain_lyrics:
            return None

        lines = [l.strip() for l in plain_lyrics.split("\n") if l.strip()]
        if not lines:
            return None

        transcript_lower = transcript.lower().strip()
        best_score = 0
        best_line_idx = 0

        for i, line in enumerate(lines):
            line_lower = line.lower().strip()
            if len(line_lower) < 3:
                continue
            score = max(
                fuzz.partial_ratio(transcript_lower, line_lower),
                fuzz.token_set_ratio(transcript_lower, line_lower),
            )
            if score > best_score:
                best_score = score
                best_line_idx = i

        if best_score < 30:
            return None

        # Estimate timestamp: position in lyrics × song duration
        position_ratio = best_line_idx / max(len(lines), 1)
        estimated_timestamp = position_ratio * avg_duration

        return {
            "timestamp": round(estimated_timestamp, 1),
            "confidence": min(best_score, 70),  # Cap at 70 since it's estimated
            "matched_line": lines[best_line_idx] if best_line_idx < len(lines) else "",
            "estimated": True,
        }

"""
Spotify URL generation service for ContinueMySong AI.
Uses Spotify Web API (client_credentials flow) for real track IDs.
Falls back to search URLs when API credentials aren't configured.
"""

import logging
import os
import time
import threading
import urllib.parse
from typing import Optional
from collections import OrderedDict

import requests


class SpotifyLinker:
    """Generates Spotify URLs with real track IDs via Web API."""

    def __init__(self):
        self.client_id = os.getenv("SPOTIFY_CLIENT_ID", "")
        self.client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "")
        self._token: Optional[str] = None
        self._token_expires: float = 0
        self._cache: OrderedDict[str, Optional[str]] = OrderedDict()
        self._popularity_cache: dict[str, int] = {}
        self._artwork_cache: dict[str, str] = {}
        self._cache_max = 1000
        self._lock = threading.Lock()
        self._session_local = threading.local()

    @property
    def _session(self) -> requests.Session:
        """Thread-local session to avoid sharing connection state across threads."""
        if not hasattr(self._session_local, "session"):
            self._session_local.session = requests.Session()
        return self._session_local.session

    def _get_token(self) -> Optional[str]:
        """Get or refresh Spotify access token via client_credentials."""
        if not self.client_id or not self.client_secret:
            return None

        with self._lock:
            if self._token and time.time() < self._token_expires:
                return self._token

            try:
                import base64
                auth = base64.b64encode(
                    f"{self.client_id}:{self.client_secret}".encode()
                ).decode()

                resp = self._session.post(
                    "https://accounts.spotify.com/api/token",
                    data={"grant_type": "client_credentials"},
                    headers={"Authorization": f"Basic {auth}"},
                    timeout=5,
                )
                resp.raise_for_status()
                data = resp.json()
                self._token = data["access_token"]
                self._token_expires = time.time() + data.get("expires_in", 3600) - 60
                return self._token
            except Exception as e:
                logging.getLogger(__name__).warning(f"Spotify token error: {e}")
                return None

    def generate_url(
        self,
        song: str,
        artist: str,
        timestamp_seconds: Optional[float] = None
    ) -> str:
        """
        Generate Spotify URL for a song with optional timestamp.
        Tries real track URL first, falls back to search.
        """
        cache_key = f"{song}|{artist}"

        # Check cache first (under lock)
        with self._lock:
            if cache_key in self._cache:
                self._cache.move_to_end(cache_key)
                track_id = self._cache[cache_key]
            else:
                track_id = None  # sentinel: need to fetch

        # Network call OUTSIDE lock to avoid blocking concurrent requests
        if track_id is None:
            fetched_id = self._find_track_id(song, artist)
            with self._lock:
                if len(self._cache) >= self._cache_max:
                    self._cache.popitem(last=False)
                self._cache[cache_key] = fetched_id
            track_id = fetched_id

        if track_id:
            base_url = f"https://open.spotify.com/track/{track_id}"
            # Append timestamp — works on mobile and some desktop clients
            if timestamp_seconds is not None and timestamp_seconds > 0:
                return f"{base_url}?t={int(timestamp_seconds)}"
            return base_url

        # Fallback: search URL
        query = f"{song} {artist}" if artist and artist.lower() not in ("unknown", "") else song
        encoded_query = urllib.parse.quote(query)
        return f"https://open.spotify.com/search/{encoded_query}"

    def _find_track_id(self, song: str, artist: str) -> Optional[str]:
        """Search Spotify Web API for a track ID. Tries structured query first, then plain."""
        token = self._get_token()
        if not token:
            return None

        queries = []
        if artist and artist.lower() not in ("unknown", ""):
            queries.append(f"track:{song} artist:{artist}")
            queries.append(f"{song} {artist}")
        queries.append(song)

        for query in queries:
            try:
                resp = self._session.get(
                    "https://api.spotify.com/v1/search",
                    params={"q": query, "type": "track", "limit": 5},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5,
                )
                # Handle rate limiting gracefully — wait and retry once
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", "2"))
                    import time as _time
                    _time.sleep(min(retry_after, 5))
                    resp = self._session.get(
                        "https://api.spotify.com/v1/search",
                        params={"q": query, "type": "track", "limit": 5},
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=5,
                    )
                resp.raise_for_status()
                data = resp.json()
                tracks = data.get("tracks", {}).get("items", [])
                if tracks:
                    # Prefer the most popular track (original > remix/cover)
                    # Also prefer tracks whose artist matches the requested artist
                    best_track = tracks[0]
                    best_score = 0
                    artist_lower = (artist or "").lower()
                    for t in tracks:
                        score = t.get("popularity", 0)
                        # Bonus if artist name matches
                        track_artists = " ".join(a.get("name", "").lower() for a in t.get("artists", []))
                        if artist_lower and artist_lower in track_artists:
                            score += 50
                        # Penalize remixes, covers, mixes
                        track_name = t.get("name", "").lower()
                        if any(kw in track_name for kw in ("remix", "cover", "mix", "karaoke", "tribute")):
                            score -= 30
                        if score > best_score:
                            best_score = score
                            best_track = t
                    # Cache popularity for ranking use (under lock)
                    cache_key_pop = f"{song}|{artist}"
                    with self._lock:
                        if len(self._popularity_cache) >= self._cache_max:
                            keys = list(self._popularity_cache.keys())[:len(self._popularity_cache)//2]
                            for k in keys:
                                del self._popularity_cache[k]
                        self._popularity_cache[cache_key_pop] = best_track.get("popularity", 0)
                        # Cache album artwork URL
                        images = best_track.get("album", {}).get("images", [])
                        if images:
                            self._artwork_cache[cache_key_pop] = images[0].get("url", "")
                    return best_track["id"]
            except Exception as e:
                logging.getLogger(__name__).warning(f"Spotify search error for '{query}': {e}")
                continue

        return None

    def get_popularity(self, song: str, artist: str) -> Optional[int]:
        """Get cached Spotify popularity for a song. Returns None if not available."""
        cache_key = f"{song}|{artist}"
        with self._lock:
            return self._popularity_cache.get(cache_key)

    def get_artwork(self, song: str, artist: str) -> Optional[str]:
        """Get cached album artwork URL for a song. Returns None if not available."""
        cache_key = f"{song}|{artist}"
        with self._lock:
            return self._artwork_cache.get(cache_key)

    def generate_app_uri(
        self, song: str, artist: str, timestamp_seconds: Optional[float] = None
    ) -> str:
        """Generate spotify: URI for mobile/desktop app deep link."""
        cache_key = f"{song}|{artist}"
        with self._lock:
            if cache_key in self._cache:
                track_id = self._cache[cache_key]
            else:
                track_id = None
        if track_id is None:
            fetched_id = self._find_track_id(song, artist)
            with self._lock:
                self._cache[cache_key] = fetched_id
            track_id = fetched_id
        if track_id:
            return f"spotify:track:{track_id}"
        
        query = f"{song} {artist}" if artist else song
        return f"spotify:search:{urllib.parse.quote(query)}"

    def format_timestamp(self, seconds: Optional[float]) -> str:
        """Format timestamp in mm:ss format for display."""
        if seconds is None or seconds < 0:
            return "0:00"
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}:{secs:02d}"

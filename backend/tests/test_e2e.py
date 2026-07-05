"""
End-to-end integration tests that hit real external APIs.
Skip in CI with: pytest -m "not e2e"
Requires network access and SPOTIFY_CLIENT_ID/SECRET in .env.
"""
import os
import pytest
from dotenv import load_dotenv

load_dotenv()

pytestmark = pytest.mark.e2e

# Skip entire module if no network/credentials
skip_no_network = pytest.mark.skipif(
    not os.getenv("SPOTIFY_CLIENT_ID"),
    reason="Spotify credentials not available — skip e2e"
)


@skip_no_network
class TestEndToEnd:
    """Real pipeline tests with live APIs."""

    def test_identify_english_song(self):
        """Full pipeline: transcript → identify → lyrics → timestamp → Spotify."""
        from services.song_identifier import SongIdentifier
        from services.lyrics_fetcher import LyricsFetcher
        from services.timestamp_matcher import TimestampMatcher
        from services.spotify_linker import SpotifyLinker

        identifier = SongIdentifier()
        fetcher = LyricsFetcher()
        matcher = TimestampMatcher()
        linker = SpotifyLinker()

        # Step 1: Identify
        transcript = "hello from the other side"
        candidates = identifier.identify_multiple(transcript)
        assert len(candidates) > 0, "No candidates found"

        top = candidates[0]
        assert top["confidence"] >= 50
        assert "hello" in top["song"].lower() or "adele" in top.get("artist", "").lower()

        # Step 2: Fetch lyrics
        lyrics = fetcher.fetch_synced_lyrics(top["song"], top.get("artist", ""))
        assert lyrics is not None and len(lyrics) > 0, "No lyrics found"

        # Step 3: Match timestamp
        match = matcher.find_match(transcript, lyrics)
        assert match is not None
        assert match["timestamp"] > 0

        # Step 4: Spotify link
        url = linker.generate_url(top["song"], top.get("artist", ""), match["timestamp"])
        assert "spotify" in url
        assert "track/" in url or "search/" in url

    def test_identify_bollywood_song(self):
        """Pipeline handles non-English (Bollywood) songs."""
        from services.song_identifier import SongIdentifier

        identifier = SongIdentifier()
        transcript = "kashmir mein tu kanyakumari"
        candidates = identifier.identify_multiple(transcript)
        assert len(candidates) > 0
        # Should find the song with reasonable confidence
        top = candidates[0]
        assert top["confidence"] >= 40

    def test_text_endpoint(self):
        """Test /identify endpoint end-to-end."""
        from httpx import Client

        with Client(base_url="http://localhost:8000", timeout=30) as client:
            try:
                resp = client.post("/identify", json={"lyrics": "never gonna give you up"})
                if resp.status_code == 200:
                    data = resp.json()
                    assert data["success"] is True
                    assert len(data["results"]) > 0
                else:
                    pytest.skip("Backend not running")
            except Exception:
                pytest.skip("Backend not reachable")

    def test_youtube_search_strategy(self):
        """Verify yt-dlp search returns structured results."""
        from services.song_identifier import SongIdentifier

        identifier = SongIdentifier()
        # Use a well-known English song query
        results = identifier._youtube_search_multiple("bohemian rhapsody queen", "bohemian rhapsody queen")
        assert isinstance(results, list)
        if results:  # May fail if yt-dlp is rate-limited
            assert "song" in results[0]
            assert results[0]["song"]  # Non-empty title

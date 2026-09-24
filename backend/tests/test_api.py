"""Integration tests for API endpoints with mocked services."""
import sys
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, ".")


@pytest.fixture
def client():
    """Create test client with mocked Whisper."""
    with patch.dict("os.environ", {
        "SPOTIFY_CLIENT_ID": "test_id",
        "SPOTIFY_CLIENT_SECRET": "test_secret",
    }):
        # Mock whisper before importing main
        mock_whisper = MagicMock()
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {"text": "hello from the other side"}
        mock_whisper.load_model.return_value = mock_model
        sys.modules["whisper"] = mock_whisper

        from main import app
        from fastapi.testclient import TestClient
        yield TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "healthy"


class TestUploadEndpoint:
    def test_empty_file_returns_400(self, client):
        r = client.post("/upload", files={"file": ("test.wav", b"", "audio/wav")})
        assert r.status_code == 400
        assert "Empty" in r.json()["detail"]

    def test_oversized_file_returns_400(self, client):
        r = client.post("/upload", files={"file": ("test.wav", b"x" * 6_000_000, "audio/wav")})
        assert r.status_code == 400
        assert "5MB" in r.json()["detail"]

    @pytest.mark.skip(reason="Mocks don't propagate into thread-pool executor; tested via e2e")
    @patch("main.audio_processor")
    @patch("main.transcriber")
    @patch("main.song_identifier")
    @patch("main.lyrics_fetcher")
    @patch("main.spotify_linker")
    def test_upload_happy_path(self, mock_spotify, mock_lyrics, mock_identifier, mock_transcriber, mock_audio, client):
        mock_audio.convert_to_wav.return_value = "/tmp/test.wav"
        mock_audio.normalize_audio.return_value = "/tmp/test.wav"
        mock_transcriber.transcribe.return_value = "hello from the other side"
        mock_identifier.identify_multiple.return_value = [
            {"song": "Hello", "artist": "Adele", "confidence": 95, "strategy": "youtube"}
        ]
        mock_lyrics.fetch_synced_lyrics.return_value = [
            {"timestamp_seconds": 79, "text": "Hello from the other side"}
        ]
        mock_spotify.generate_url.return_value = "https://open.spotify.com/track/abc?t=79"
        mock_spotify.format_timestamp.return_value = "1:19"

        r = client.post("/upload", files={"file": ("test.webm", b"fake_audio_data", "audio/webm")})
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["song"] == "Hello"
        assert len(data["results"]) >= 1


class TestCapabilities:
    def test_health_reports_capabilities(self, client):
        data = client.get("/health").json()
        assert isinstance(data["voice"], bool)
        assert isinstance(data["spotify"], bool)
        assert data["version"]

    def test_upload_returns_503_when_voice_disabled(self, client):
        with patch("main._voice_enabled", return_value=False):
            r = client.post("/upload", files={"file": ("a.webm", b"fake_audio", "audio/webm")})
        assert r.status_code == 503
        assert "Type the lyric" in r.json()["detail"]

    def test_empty_upload_still_400_when_voice_disabled(self, client):
        # Input validation runs before the capability check.
        with patch("main._voice_enabled", return_value=False):
            r = client.post("/upload", files={"file": ("a.webm", b"", "audio/webm")})
        assert r.status_code == 400


class TestIdentifyEndpoint:
    @pytest.mark.skip(reason="Mocks don't propagate into thread-pool executor; tested via e2e")
    @patch("main.song_identifier")
    @patch("main.lyrics_fetcher")
    @patch("main.spotify_linker")
    def test_identify_happy_path(self, mock_spotify, mock_lyrics, mock_identifier, client):
        mock_identifier.identify_multiple.return_value = [
            {"song": "Hello", "artist": "Adele", "confidence": 95, "strategy": "youtube"}
        ]
        mock_lyrics.fetch_synced_lyrics.return_value = [
            {"timestamp_seconds": 79, "text": "Hello from the other side"}
        ]
        mock_spotify.generate_url.return_value = "https://open.spotify.com/track/abc?t=79"
        mock_spotify.format_timestamp.return_value = "1:19"

        r = client.post("/identify", json={"lyrics": "hello from the other side"})
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["results"][0]["song"] == "Hello"

    def test_identify_empty_lyrics_returns_error(self, client):
        r = client.post("/identify", json={"lyrics": ""})
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is False

    def test_identify_short_lyrics_returns_error(self, client):
        r = client.post("/identify", json={"lyrics": "hi"})
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is False


def _stub_missing_third_party():
    """Stub third-party modules absent in minimal test envs (no new deps)."""
    if "whisper" not in sys.modules:
        sys.modules["whisper"] = MagicMock()
    for name in ("bs4", "slowapi", "slowapi.errors", "slowapi.middleware", "slowapi.util"):
        try:
            __import__(name)
        except ImportError:
            sys.modules[name] = MagicMock()


def _import_main():
    """Import main, auto-stubbing any missing third-party modules.

    Minimal envs may lack audio/web deps (librosa, etc.) that main pulls in
    transitively. Pure ranking helpers under test don't touch those, so stub
    and retry instead of adding dependencies.
    """
    import importlib
    import importlib.util
    _stub_missing_third_party()
    last_error = None
    for _ in range(40):
        try:
            with patch.dict("os.environ", {
                "SPOTIFY_CLIENT_ID": "test_id",
                "SPOTIFY_CLIENT_SECRET": "test_secret",
            }):
                return importlib.import_module("main")
        except ModuleNotFoundError as e:
            missing = e.name
            if not missing or missing in sys.modules:
                raise
            if importlib.util.find_spec(missing) is not None:
                raise  # real module that failed internally — don't mask it
            sys.modules[missing] = MagicMock()
            last_error = e
    raise last_error  # pragma: no cover


class TestPreferOriginalArtist:
    """Post-ranking same-title tie-break must be stable and crash-free."""

    def test_no_crash_on_ranking_score_dicts(self):
        """Regression: enriched candidates carry ranking_score, not confidence."""
        _import_main()
        results = [
            {"song": "Imagine", "artist": "John Lennon", "ranking_score": 88,
             "search_confidence": 70, "spotify_url": "https://open.spotify.com/track/abc"},
            {"song": "Imagine", "artist": "Karaoke Hits", "ranking_score": 86,
             "search_confidence": 65, "spotify_url": "https://open.spotify.com/search/x"},
        ]
        from services.pipeline import prefer_original_artist
        reordered = prefer_original_artist(results)
        assert len(reordered) == 2
        # Original (direct track URL + known artist) wins the tie
        assert reordered[0]["artist"] == "John Lennon"

    def test_global_order_preserved_across_titles(self):
        """A same-title group must not jump ahead of higher-ranked other titles."""
        _import_main()
        results = [
            {"song": "Hey Jude", "artist": "The Beatles", "ranking_score": 92,
             "search_confidence": 60, "spotify_url": "https://open.spotify.com/track/a"},
            {"song": "Sad Song", "artist": "We The Kings", "ranking_score": 60,
             "search_confidence": 88, "spotify_url": "https://open.spotify.com/track/b"},
            {"song": "Hey Jude", "artist": "Cover Band", "ranking_score": 90,
             "search_confidence": 58, "spotify_url": "https://open.spotify.com/search/c"},
        ]
        from services.pipeline import prefer_original_artist
        reordered = prefer_original_artist(results)
        songs = [r["song"] for r in reordered]
        # Positions 0 and 2 hold the Hey Jude versions (swapped in place);
        # Sad Song stays at position 1 — never leapfrogged.
        assert songs[1] == "Sad Song", f"Global order broken: {songs}"
        assert songs[0] == "Hey Jude" and songs[2] == "Hey Jude"

    def test_clear_lyric_gap_not_reordered(self):
        """When lyric evidence clearly separates versions, keep ranker order."""
        _import_main()
        results = [
            {"song": "Imagine", "artist": "Cover Band", "ranking_score": 90,
             "search_confidence": 60, "spotify_url": "https://open.spotify.com/track/x"},
            {"song": "Imagine", "artist": "John Lennon", "ranking_score": 70,
             "search_confidence": 70, "spotify_url": "https://open.spotify.com/track/y"},
        ]
        from services.pipeline import prefer_original_artist
        reordered = prefer_original_artist(results)
        # 20-point gap: lyric evidence wins, no swap despite popularity signals
        assert reordered[0]["artist"] == "Cover Band"


class TestMergeCandidatesProviderAgreement:
    """Retrieval merge must prefer multi-provider candidates over lone title hits."""

    def test_multi_source_beats_single_source_confidence(self):
        _stub_missing_third_party()
        import importlib.util
        try:
            from services.song_identifier import merge_candidates
        except ModuleNotFoundError as e:
            if importlib.util.find_spec(e.name or "") is None:
                sys.modules[e.name] = MagicMock()
                from services.song_identifier import merge_candidates
            else:
                raise
        jobs = [
            ("youtube", "take a sad song", [
                {"song": "Sad Song", "artist": "We The Kings", "confidence": 95},
            ]),
            ("genius", "take a sad song", [
                {"song": "Hey Jude", "artist": "The Beatles", "confidence": 55},
            ]),
            ("itunes", "take a sad song", [
                {"song": "Hey Jude", "artist": "The Beatles", "confidence": 58},
            ]),
        ]
        merged = merge_candidates(jobs, 5)
        assert merged[0]["song"] == "Hey Jude", \
            f"Multi-provider candidate should lead merge, got {merged[0]['song']}"
        assert merged[0]["sources"] == ["genius", "itunes"]

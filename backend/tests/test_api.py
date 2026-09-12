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

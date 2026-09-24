"""Melody (humming) recognition: signing, parsing, and the /upload fallback."""
import base64
import hashlib
import hmac
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, ".")
sys.modules.setdefault("whisper", MagicMock())

from services.melody_recognizer import MelodyRecognizer, parse_response, sign  # noqa: E402

SAMPLE = {
    "status": {"code": 0, "msg": "Success"},
    "metadata": {
        "humming": [
            {"title": "Yesterday", "artists": [{"name": "The Beatles"}], "score": 0.82, "play_offset_ms": 12000},
            {"title": "Let It Be", "artists": [{"name": "The Beatles"}], "score": 0.41},
        ],
        "music": [
            {"title": "Yesterday", "artists": [{"name": "The Beatles"}], "score": 100,
             "external_metadata": {"spotify": {"track": {"id": "3BQHpFgAp4l80e1XslIjNI"}}}},
        ],
    },
}


def test_signature_matches_acrcloud_spec():
    expected = base64.b64encode(hmac.new(
        b"secret", b"POST\n/v1/identify\nkey\naudio\n1\n1700000000", hashlib.sha1).digest()).decode()
    assert sign("key", "secret", "1700000000") == expected


def test_parse_merges_and_ranks():
    matches = parse_response(SAMPLE)
    assert [m.song for m in matches] == ["Yesterday", "Let It Be"]
    assert matches[0].score == 100 and matches[0].spotify_track_id == "3BQHpFgAp4l80e1XslIjNI"
    assert matches[1].score == 41.0


def test_parse_no_result():
    assert parse_response({"status": {"code": 1001, "msg": "No result"}}) == []


def test_recognizer_posts_signed_form(tmp_path):
    clip = tmp_path / "a.wav"
    clip.write_bytes(b"RIFFfake")
    post = MagicMock(return_value=SimpleNamespace(json=lambda: SAMPLE))
    rec = MelodyRecognizer("identify-eu-west-1.acrcloud.com", "key", "secret", post=post)
    matches = rec.recognize(str(clip))
    assert matches and matches[0].song == "Yesterday"
    url = post.call_args.args[0]
    data = post.call_args.kwargs["data"]
    assert url == "https://identify-eu-west-1.acrcloud.com/v1/identify"
    assert data["data_type"] == "audio" and data["sample_bytes"] == str(len(b"RIFFfake"))


def test_unconfigured_recognizer_is_noop():
    assert MelodyRecognizer("", "", "").recognize("/nope.wav") == []


def _client():
    from fastapi.testclient import TestClient
    import main
    return main, TestClient(main.app)


def _transcription(text, no_speech=0.1):
    return SimpleNamespace(text=text, language="en", confidence=0.9, no_speech_probability=no_speech)


def test_humming_upload_uses_melody_when_configured():
    main, client = _client()
    rec = MagicMock(configured=True)
    rec.recognize.return_value = parse_response(SAMPLE)
    with patch.object(main, "_voice_enabled", return_value=True), \
         patch.object(main, "audio_processor"), \
         patch.object(main, "transcriber") as tr, \
         patch.object(main, "melody_recognizer", rec), \
         patch.object(main.spotify_linker, "get_artwork", return_value=""):
        tr.transcribe_result.return_value = _transcription("mm mm mm", no_speech=0.8)
        r = client.post("/upload", files={"file": ("a.webm", b"audio", "audio/webm")})
    body = r.json()
    assert r.status_code == 200 and body["success"] is True
    assert body["input"] == "melody"
    assert body["results"][0]["song"] == "Yesterday"
    assert body["results"][0]["spotify_url"].endswith("3BQHpFgAp4l80e1XslIjNI")


def test_humming_upload_without_melody_is_honest():
    main, client = _client()
    with patch.object(main, "_voice_enabled", return_value=True), \
         patch.object(main, "audio_processor"), \
         patch.object(main, "transcriber") as tr, \
         patch.object(main, "melody_recognizer", MagicMock(configured=False)):
        tr.transcribe_result.return_value = _transcription("", no_speech=0.9)
        r = client.post("/upload", files={"file": ("a.webm", b"audio", "audio/webm")})
    body = r.json()
    assert body["success"] is False
    assert "didn't hear any words" in body["error"]
    assert "Humming" in body["error"]

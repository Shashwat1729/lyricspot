"""IdentificationPipeline end-to-end with in-memory fake services (no network)."""
import asyncio
import sys
from unittest.mock import MagicMock

sys.path.insert(0, ".")
sys.modules.setdefault("whisper", MagicMock())

from config import Settings  # noqa: E402
from services.pipeline import IdentificationPipeline, dedupe, sanitize_lyrics  # noqa: E402
from services.timestamp_matcher import TimestampMatcher  # noqa: E402

LYRICS = {
    ("hello", "adele"): [
        {"timestamp_seconds": 10.0, "text": "Hello, it's me"},
        {"timestamp_seconds": 15.0, "text": "I was wondering if after all these years you'd like to meet"},
        {"timestamp_seconds": 79.3, "text": "Hello from the other side"},
        {"timestamp_seconds": 84.0, "text": "I must've called a thousand times"},
    ],
    ("hello", "lionel richie"): [
        {"timestamp_seconds": 20.0, "text": "Hello, is it me you're looking for?"},
        {"timestamp_seconds": 30.0, "text": "I can see it in your eyes"},
    ],
}


class FakeIdentifier:
    def identify_multiple(self, transcript, n):
        return [
            {"song": "Hello", "artist": "Lionel Richie", "confidence": 80, "strategy": "itunes", "sources": ["itunes"]},
            {"song": "Hello", "artist": "Adele", "confidence": 70, "strategy": "genius", "sources": ["genius", "musixmatch"]},
            {"song": "Hello", "artist": "Adele", "confidence": 65, "strategy": "musixmatch", "sources": ["musixmatch"]},
        ]


class FakeLyrics:
    def fetch_synced_lyrics(self, song, artist):
        return LYRICS.get((song.lower(), artist.lower()), [])

    def fetch_plain_lyrics(self, song, artist):
        return "\n".join(line["text"] for line in LYRICS.get((song.lower(), artist.lower()), []))

    def _fetch_genius_lyrics(self, song, artist):
        return None

    def estimate_timestamp_from_plain(self, transcript, plain):
        return None


class FakeSpotify:
    def generate_url(self, song, artist, ts):
        return "https://open.spotify.com/search/" + song

    def get_popularity(self, song, artist):
        return None

    def get_artwork(self, song, artist):
        return ""

    def format_timestamp(self, s):
        s = int(s or 0)
        return f"{s // 60}:{s % 60:02d}"


class FakeFeedback:
    def get_boost(self, *a):
        return 0


def make_pipeline():
    return IdentificationPipeline(
        identifier=FakeIdentifier(), lyrics=FakeLyrics(), matcher=TimestampMatcher(),
        spotify=FakeSpotify(), feedback=FakeFeedback(), settings=Settings(),
    )


def test_lyric_evidence_beats_retrieval_order_and_finds_timestamp():
    res = asyncio.run(make_pipeline().identify("hello from the other side"))
    assert res["success"] is True
    top = res["results"][0]
    assert (top["song"], top["artist"]) == ("Hello", "Adele")
    assert abs(top["timestamp"] - 79.3) < 0.01
    assert top["lyrics_context"]["matched"] == "Hello from the other side"
    # Adele appears once despite two retrieval entries.
    assert sum(1 for r in res["results"] if r["artist"] == "Adele") == 1
    assert res["confidence_label"] in ("high", "uncertain", "low")


def test_stream_emits_stages_and_same_top_result():
    async def collect():
        return [e async for e in make_pipeline().identify_stream("hello from the other side")]
    events = asyncio.run(collect())
    stages = [e["stage"] for e in events]
    assert stages[0] == "searching" and stages[-1] == "complete"
    assert "candidate_ready" in stages
    assert events[-1]["results"][0]["artist"] == "Adele"


def test_short_input_fails_cleanly():
    res = asyncio.run(make_pipeline().identify("hi"))
    assert res["success"] is False and res["results"] == []


def test_no_candidates_returns_empty_not_fake_result():
    p = make_pipeline()
    p.identifier = MagicMock(identify_multiple=MagicMock(return_value=[]))
    res = asyncio.run(p.identify("some words nobody ever sang"))
    assert res["success"] is True
    assert res["results"] == []
    assert res["confidence_label"] == "low"


def test_low_transcription_confidence_asks_to_retry():
    res = asyncio.run(make_pipeline().identify("hello from the other side", transcription_confidence=0.05))
    assert res["success"] is False
    assert "clearly" in res["error"]


def test_sanitize_and_dedupe():
    assert sanitize_lyrics("he\x00llo\x07 world  ") == "hello world"
    rows = [{"song": "Hey Jude (Remastered)", "artist": "The Beatles"}, {"song": "Hey Jude", "artist": "the beatles"}]
    assert len(dedupe(rows)) == 1

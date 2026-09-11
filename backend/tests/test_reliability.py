"""Reliability tests: uncertainty preservation, query expansion, evidence ranking."""
import sys
from unittest.mock import MagicMock

sys.path.insert(0, ".")

# Stub heavy/optional third-party modules missing from minimal envs.
# setdefault() never overrides real installs (CI has the real packages).
sys.modules.setdefault("whisper", MagicMock())
_bs4_stub = MagicMock()
_bs4_stub.BeautifulSoup = MagicMock()
sys.modules.setdefault("bs4", _bs4_stub)

import pytest

from services.transcriber import TranscriptionService, TranscriptionResult
from services.query_expansion import normalize_query, expand_queries, deduplicate_words
from services.song_identifier import SongIdentifier, canonical_key, merge_candidates
from services.timestamp_matcher import TimestampMatcher


def _mock_model(payload):
    model = MagicMock()
    model.transcribe.return_value = payload
    return model


class TestTranscriptionResult:
    def test_structured_result_preserves_uncertainty(self):
        svc = TranscriptionService()
        svc._model = _mock_model({
            "text": "hello from the other side",
            "language": "en",
            "segments": [
                {"start": 0.0, "end": 2.0, "avg_logprob": -0.1, "no_speech_prob": 0.05, "text": "hello from"},
                {"start": 2.0, "end": 4.0, "avg_logprob": -0.2, "no_speech_prob": 0.02, "text": "the other side"},
            ],
        })
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"fake")
            path = f.name
        try:
            result = svc.transcribe_result(path)
        finally:
            os.unlink(path)
        assert isinstance(result, TranscriptionResult)
        assert result.text == "hello from the other side"
        assert result.language == "en"
        assert 0.0 < result.confidence <= 1.0
        assert result.duration == pytest.approx(4.0)
        assert len(result.segments) == 2

    def test_empty_result_is_zero_confidence(self):
        svc = TranscriptionService()
        svc._model = _mock_model({"text": "   ", "language": "en", "segments": []})
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"fake")
            path = f.name
        try:
            result = svc.transcribe_result(path)
        finally:
            os.unlink(path)
        assert result.text == ""
        assert result.confidence == 0.0

    def test_silent_recording_has_low_confidence(self):
        svc = TranscriptionService()
        svc._model = _mock_model({
            "text": "you",
            "language": "en",
            "segments": [
                {"start": 0.0, "end": 3.0, "avg_logprob": -0.5, "no_speech_prob": 0.95, "text": "you"},
            ],
        })
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"fake")
            path = f.name
        try:
            result = svc.transcribe_result(path)
        finally:
            os.unlink(path)
        assert result.confidence < 0.35

    def test_missing_metadata_is_robust(self):
        svc = TranscriptionService()
        svc._model = _mock_model({"text": "hello"})
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"fake")
            path = f.name
        try:
            result = svc.transcribe_result(path)
        finally:
            os.unlink(path)
        assert result.text == "hello"
        assert result.confidence >= 0.0

    def test_transcribe_still_returns_string(self):
        """Backward compatibility: transcribe() returns str."""
        svc = TranscriptionService()
        svc._model = _mock_model({"text": "hello world", "segments": []})
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"fake")
            path = f.name
        try:
            assert svc.transcribe(path) == "hello world"
        finally:
            os.unlink(path)


class TestQueryExpansion:
    def test_normalize(self):
        assert normalize_query("  Hello,   WORLD! ") == "hello world"
        assert normalize_query("") == ""

    def test_deduplicate_stutter(self):
        assert deduplicate_words("hello hello hello world") == "hello world"

    def test_short_query_gets_lyrics_suffix(self):
        variants = expand_queries("hello from the other side")
        assert any(v.endswith("lyrics") for v in variants)
        assert len(variants) <= 3

    def test_long_query_gets_prefix_variant(self):
        long_text = " ".join(["word%d" % i for i in range(20)])
        variants = expand_queries(long_text)
        assert len(variants) <= 3
        assert any(len(v.split()) <= 12 for v in variants)

    def test_imperfect_transcript_still_searchable(self):
        # Whisper mishearing must not collapse the query to nothing.
        variants = expand_queries("i see cheese of green")
        assert variants and all(len(v) >= 3 for v in variants)


class TestSearchPrior:
    def test_lyric_without_title_overlap_gets_weak_prior(self):
        """Regression: 'i see trees of green' vs 'What a Wonderful World'
        must NOT score high on title overlap — lyric verification decides."""
        ident = SongIdentifier()
        prior = ident._search_prior(
            "i see trees of green", "What a Wonderful World", "Louis Armstrong"
        )
        assert prior < 70, f"search prior too high: {prior}"

    def test_calculate_confidence_alias_preserved(self):
        ident = SongIdentifier()
        assert ident._calculate_confidence("hello", "Hello", "Adele") == \
            ident._search_prior("hello", "Hello", "Adele")


class TestMergeAndCoverage:
    def test_sources_tracked_across_strategies(self):
        merged = merge_candidates([
            ("youtube", "hello lyrics", [{"song": "Hello", "artist": "Adele", "confidence": 60}]),
            ("genius", "hello lyrics", [{"song": "Hello", "artist": "Adele", "confidence": 70}]),
            ("itunes", "hello lyrics", [{"song": "Hello", "artist": "Adele", "confidence": 65}]),
        ])
        assert len(merged) == 1
        assert merged[0]["sources"] == ["youtube", "genius", "itunes"]
        assert merged[0]["confidence"] == 70

    def test_deterministic_ranking_on_ties(self):
        a = [("youtube", "v", [{"song": "B Song", "artist": "Zed", "confidence": 60}]),
             ("genius", "v", [{"song": "A Song", "artist": "Zed", "confidence": 60}])]
        b = list(reversed(a))
        assert [c["song"] for c in merge_candidates(a)] == \
               [c["song"] for c in merge_candidates(b)] == ["A Song", "B Song"]


class TestTimestampOccurrences:
    @pytest.fixture
    def chorus_lyrics(self):
        return [
            {"timestamp_seconds": 0, "text": "intro instrumental"},
            {"timestamp_seconds": 44, "text": "hello from the other side"},
            {"timestamp_seconds": 104, "text": "hello from the other side"},
            {"timestamp_seconds": 164, "text": "hello from the other side"},
            {"timestamp_seconds": 200, "text": "goodbye now"},
        ]

    def test_repeated_chorus_returns_all_occurrences(self, chorus_lyrics):
        matcher = TimestampMatcher()
        occ = matcher.find_occurrences("hello from the other side", chorus_lyrics)
        timestamps = [o["timestamp"] for o in occ]
        assert 44 in timestamps and 104 in timestamps and 164 in timestamps
        # Deterministic: best score first, then earliest.
        assert occ == sorted(occ, key=lambda o: (-o["match_score"], o["timestamp"]))

    def test_best_match_still_prefers_first(self, chorus_lyrics):
        matcher = TimestampMatcher()
        result = matcher.find_match("hello from the other side", chorus_lyrics)
        assert result["timestamp"] == 44

    def test_hindi_phonetic_gating(self):
        matcher = TimestampMatcher()
        lyrics = [{"timestamp_seconds": 10, "text": "tu hai mera"}]
        # Language-gated: Hindi rules apply for hi / unknown.
        assert matcher.find_match("too hai mera", lyrics, language="hi")["confidence"] >= \
               matcher.find_match("too hai mera", lyrics, language="en")["confidence"]
        # Unknown preserves legacy behavior.
        assert matcher.find_match("too hai mera", lyrics)["confidence"] >= 60


class TestConfidenceMargin:
    def test_bands(self):
        from services.confidence_calculator import confidence_label
        assert confidence_label(85, 17) == "high"
        assert confidence_label(85, 3) == "uncertain"
        assert confidence_label(55, 20) == "uncertain"
        assert confidence_label(30, 5) == "low"

    def test_main_delegates_to_calculator(self):
        # main._confidence_label must stay consistent with the calculator
        # (import main only where full deps exist; guarded for minimal envs).
        pytest.importorskip("slowapi")
        pytest.importorskip("bs4")
        import main as app_main
        from services.confidence_calculator import confidence_label
        for top, margin in [(85, 17), (85, 3), (55, 20), (30, 5)]:
            assert app_main._confidence_label(top, margin) == confidence_label(top, margin)


class TestSpotifyDeepLinkUnchanged:
    def test_timestamp_deep_link_format(self):
        sys.path.insert(0, ".")
        from services.spotify_linker import SpotifyLinker
        linker = SpotifyLinker()
        linker._find_track_id = lambda song, artist: "abc123"
        url = linker.generate_url("Hello", "Adele", 79)
        assert url == "https://open.spotify.com/track/abc123?t=79"

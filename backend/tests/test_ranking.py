"""
Comprehensive ranking tests for lyric-based song identification.

Tests cover:
- Exact lyric matches vs coincidental title matches
- Short/ambiguous queries vs long distinctive phrases
- Popular songs vs obscure covers
- Multiple languages (romanized)
- Edge cases (repeated lyrics, common words, partial matches)
- Real-world scenarios from user feedback
"""

import pytest
import sys
sys.path.insert(0, ".")

from services.candidate_ranker import candidate_ranker, compute_confidence_label


class TestLyricVsTitleRanking:
    """Test that lyric content beats coincidental title matches."""

    def test_exact_lyric_beats_title_match(self):
        """Query appears in Song A's lyrics but matches Song B's title exactly."""
        candidates = [
            {
                "song": "Never Gonna Give You Up",
                "artist": "Rick Astley",
                "lyrics_match_score": 95,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 60,
                "source_count": 2,
                "spotify_popularity": 85,
            },
            {
                "song": "Give You Up",  # Title matches query substring
                "artist": "Some Cover Artist",
                "lyrics_match_score": 25,  # Lyrics don't contain the query
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 90,  # High search prior due to title match
                "source_count": 1,
                "spotify_popularity": 30,
            },
        ]

        query = "never gonna give you up"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Never Gonna Give You Up", \
            "Song with actual lyric match should rank first, not title match"
        assert ranked[0]["ranking_score"] > ranked[1]["ranking_score"] + 20, \
            "Lyric match should have significant score advantage"

    def test_partial_lyric_beats_exact_title(self):
        """Query is part of Song A's lyrics but IS Song B's title."""
        candidates = [
            {
                "song": "Hello",
                "artist": "Adele",
                "lyrics_match_score": 92,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 3,
                "spotify_popularity": 90,
            },
            {
                "song": "Hello from the other side",  # Title = query
                "artist": "Unknown Cover",
                "lyrics_match_score": None,  # No lyrics available
                "exact_lyrics_match": False,
                "lyrics_available": False,
                "search_confidence": 95,
                "source_count": 1,
                "spotify_popularity": 10,
            },
        ]

        query = "hello from the other side"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Hello", \
            "Song with verified lyric content should beat title-only match"

    def test_strong_lyric_beats_weak_title_popular(self):
        """Strong lyric match beats weak title match even when title match is popular."""
        candidates = [
            {
                "song": "Shape of You",
                "artist": "Ed Sheeran",
                "lyrics_match_score": 88,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 2,
                "spotify_popularity": 95,
            },
            {
                "song": "I'm in Love",  # Contains word "love" from query
                "artist": "Popular Artist",
                "lyrics_match_score": 30,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 85,
                "source_count": 3,
                "spotify_popularity": 80,
            },
        ]

        query = "I'm in love with the shape of you"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Shape of You", \
            "Strong lyric match should beat weak match despite lower popularity"


class TestShortVsLongQueries:
    """Test handling of short ambiguous queries vs long distinctive phrases."""

    def test_short_ambiguous_query_low_confidence(self):
        """Short generic query should have capped confidence."""
        candidates = [
            {
                "song": "Hello",
                "artist": "Adele",
                "lyrics_match_score": 85,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 3,
                "spotify_popularity": 90,
            },
        ]

        query = "hello"  # Very short, ambiguous
        ranked = candidate_ranker.rank_candidates(candidates, query)

        # Should be capped due to short query
        assert ranked[0]["ranking_score"] <= 75, \
            f"Short ambiguous query should be capped, got {ranked[0]['ranking_score']}"

        label, margin = compute_confidence_label(ranked[0]["ranking_score"], 0, query)
        assert label != "high", "Short ambiguous query should not have high confidence"

    def test_long_distinctive_query_high_confidence(self):
        """Long distinctive phrase should allow high confidence."""
        candidates = [
            {
                "song": "Bohemian Rhapsody",
                "artist": "Queen",
                "lyrics_match_score": 95,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 75,
                "source_count": 3,
                "spotify_popularity": 92,
            },
        ]

        query = "is this the real life is this just fantasy"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["ranking_score"] >= 85, \
            "Long distinctive phrase with exact match should score high"

    def test_common_words_only_low_confidence(self):
        """Query with only common words should have low confidence."""
        candidates = [
            {
                "song": "I Will Always Love You",
                "artist": "Whitney Houston",
                "lyrics_match_score": 75,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 2,
                "spotify_popularity": 88,
            },
        ]

        query = "i will you"  # All common words
        ranked = candidate_ranker.rank_candidates(candidates, query)

        # Should be capped due to lack of distinctive words
        assert ranked[0]["ranking_score"] <= 70, \
            "Common words only should be capped"


class TestMultipleResults:
    """Test that multiple plausible results are preserved."""

    def test_multiple_candidates_preserved(self):
        """System should return multiple ranked results, not just top-1."""
        candidates = [
            {
                "song": "Let It Be",
                "artist": "The Beatles",
                "lyrics_match_score": 88,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 3,
                "spotify_popularity": 90,
            },
            {
                "song": "Let It Be",
                "artist": "Cover Band",
                "lyrics_match_score": 87,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 60,
                "source_count": 1,
                "spotify_popularity": 20,
            },
            {
                "song": "Be Free",
                "artist": "Another Artist",
                "lyrics_match_score": 45,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 2,
                "spotify_popularity": 50,
            },
        ]

        query = "let it be"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert len(ranked) == 3, "All candidates should be preserved"
        assert ranked[0]["song"] == "Let It Be", "Original should rank first"
        assert ranked[0]["artist"] == "The Beatles", "Popular original beats cover"
        assert ranked[1]["song"] == "Let It Be", "Cover should rank second"

    def test_similar_scores_show_uncertainty(self):
        """When multiple results have similar scores, margin should be small."""
        candidates = [
            {
                "song": "Yesterday",
                "artist": "The Beatles",
                "lyrics_match_score": 82,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 2,
                "spotify_popularity": 85,
            },
            {
                "song": "Yesterday",
                "artist": "Cover Artist",
                "lyrics_match_score": 80,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 1,
                "spotify_popularity": 30,
            },
        ]

        query = "yesterday all my troubles"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        margin = ranked[0]["ranking_score"] - ranked[1]["ranking_score"]
        assert margin < 15, f"Similar matches should have small margin, got {margin}"

        label, _ = compute_confidence_label(
            ranked[0]["ranking_score"],
            ranked[1]["ranking_score"],
            query
        )
        # With small margin, shouldn't be high confidence
        assert label != "high" or margin >= 10, \
            "Small margin should prevent high confidence"


class TestMultilingualRomanized:
    """Test ranking for non-English queries (romanized)."""

    def test_hindi_romanized_lyric_match(self):
        """Hindi lyrics (romanized) should match correctly."""
        candidates = [
            {
                "song": "Tum Hi Ho",
                "artist": "Arijit Singh",
                "lyrics_match_score": 90,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 2,
                "spotify_popularity": 75,
            },
            {
                "song": "Tum",  # Title matches part of query
                "artist": "Random Artist",
                "lyrics_match_score": 35,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 80,
                "source_count": 1,
                "spotify_popularity": 20,
            },
        ]

        query = "tum hi ho bandhu sakha tumhi"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Tum Hi Ho", \
            "Hindi song with lyric match should rank first"
        assert ranked[0]["ranking_score"] > ranked[1]["ranking_score"] + 15

    def test_korean_romanized_lyric_match(self):
        """Korean lyrics (romanized) should match correctly."""
        candidates = [
            {
                "song": "Dynamite",
                "artist": "BTS",
                "lyrics_match_score": 92,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 3,
                "spotify_popularity": 95,
            },
            {
                "song": "Light",  # Contains word from query
                "artist": "Other Artist",
                "lyrics_match_score": 40,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 75,
                "source_count": 1,
                "spotify_popularity": 30,
            },
        ]

        query = "cause i i i'm in the stars tonight"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Dynamite"
        assert ranked[0]["ranking_score"] > 80

    def test_spanish_romanized_lyric_match(self):
        """Spanish lyrics (naturally romanized) should match correctly."""
        candidates = [
            {
                "song": "Despacito",
                "artist": "Luis Fonsi",
                "lyrics_match_score": 88,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 68,
                "source_count": 3,
                "spotify_popularity": 92,
            },
            {
                "song": "Suave",  # Contains word from query
                "artist": "Cover Artist",
                "lyrics_match_score": 38,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 1,
                "spotify_popularity": 25,
            },
        ]

        query = "suave suavecito"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Despacito"


class TestEdgeCases:
    """Test edge cases and corner scenarios."""

    def test_no_lyrics_available_neutral_ranking(self):
        """When no lyrics available, rank by metadata without penalty."""
        candidates = [
            {
                "song": "New Unreleased Song",
                "artist": "Famous Artist",
                "lyrics_match_score": None,
                "exact_lyrics_match": False,
                "lyrics_available": False,
                "search_confidence": 75,
                "source_count": 2,
                "spotify_popularity": 80,
            },
            {
                "song": "Old Song",
                "artist": "Unknown Artist",
                "lyrics_match_score": None,
                "exact_lyrics_match": False,
                "lyrics_available": False,
                "search_confidence": 70,
                "source_count": 1,
                "spotify_popularity": 30,
            },
        ]

        query = "some lyrics"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        # Should rank by popularity when lyrics unavailable for both
        assert ranked[0]["song"] == "New Unreleased Song"
        assert ranked[0]["ranking_score"] > ranked[1]["ranking_score"]

    def test_lyrics_exist_but_no_match_negative_signal(self):
        """Lyrics available but don't match query = strong negative signal."""
        candidates = [
            {
                "song": "Wrong Song",
                "artist": "Artist A",
                "lyrics_match_score": 18,  # Very low - lyrics don't match
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 85,
                "source_count": 2,
                "spotify_popularity": 80,
            },
            {
                "song": "Right Song",
                "artist": "Artist B",
                "lyrics_match_score": 75,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 60,
                "source_count": 1,
                "spotify_popularity": 50,
            },
        ]

        query = "distinctive lyric phrase"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Right Song", \
            "Song with matching lyrics should beat non-matching lyrics"
        assert ranked[1]["ranking_score"] < 50, \
            "Song with lyrics that don't match should score low"

    def test_repeated_chorus_multiple_occurrences(self):
        """Song with repeated chorus should still rank correctly."""
        candidates = [
            {
                "song": "Hey Jude",
                "artist": "The Beatles",
                "lyrics_match_score": 94,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 3,
                "spotify_popularity": 90,
            },
        ]

        query = "na na na na"  # Repeated in song many times
        ranked = candidate_ranker.rank_candidates(candidates, query)

        # Should still score high even though lyrics repeat
        assert ranked[0]["ranking_score"] >= 70

    def test_karaoke_compilation_penalty(self):
        """Karaoke/compilation versions should be penalized."""
        candidates = [
            {
                "song": "Imagine",
                "artist": "John Lennon",
                "lyrics_match_score": 88,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 2,
                "spotify_popularity": 85,
            },
            {
                "song": "Imagine Karaoke Version",
                "artist": "Karaoke Hits",
                "lyrics_match_score": 87,  # Similar lyric match
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 1,
                "spotify_popularity": 20,
            },
        ]

        query = "imagine there's no heaven"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Imagine"
        assert ranked[0]["artist"] == "John Lennon"
        # Karaoke version should be penalized despite similar lyric match
        assert ranked[0]["ranking_score"] > ranked[1]["ranking_score"]


class TestRealWorldScenarios:
    """Test cases from real user scenarios and reported issues."""

    def test_i_part_scenario(self):
        """
        Original bug report: query "I part" returns song titled "I Part"
        instead of songs whose lyrics contain "I part".
        """
        candidates = [
            {
                "song": "I Part",  # Title matches query exactly
                "artist": "Unknown Artist",
                "lyrics_match_score": 25,  # Lyrics don't contain query
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 95,  # High due to exact title match
                "source_count": 1,
                "spotify_popularity": 15,
            },
            {
                "song": "Some Other Song",
                "artist": "Famous Artist",
                "lyrics_match_score": 88,  # Lyrics DO contain "I part"
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 55,
                "source_count": 2,
                "spotify_popularity": 75,
            },
        ]

        query = "i part"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Some Other Song", \
            "Song with lyric match should beat coincidental title match"
        assert ranked[0]["ranking_score"] > ranked[1]["ranking_score"] + 20, \
            f"Lyric match should dominate: {ranked[0]['ranking_score']} vs {ranked[1]['ranking_score']}"

    def test_partial_line_not_full_song_title(self):
        """User remembers part of a line, not the full song title."""
        candidates = [
            {
                "song": "Lose Yourself",
                "artist": "Eminem",
                "lyrics_match_score": 92,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 2,
                "spotify_popularity": 88,
            },
            {
                "song": "Moment",  # Title contains word from query
                "artist": "Other Artist",
                "lyrics_match_score": 30,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 75,
                "source_count": 1,
                "spotify_popularity": 40,
            },
        ]

        query = "you only get one shot one moment"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert ranked[0]["song"] == "Lose Yourself"

    def test_misheard_lyrics_fuzzy_match(self):
        """User sings slightly wrong lyrics (common with voice input)."""
        candidates = [
            {
                "song": "Purple Haze",
                "artist": "Jimi Hendrix",
                "lyrics_match_score": 78,  # Not perfect due to mishearing
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 60,
                "source_count": 2,
                "spotify_popularity": 82,
            },
            {
                "song": "Purple Days",  # Title closer to misheard version
                "artist": "Cover Band",
                "lyrics_match_score": 35,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 1,
                "spotify_popularity": 20,
            },
        ]

        query = "purple days all in my brain"  # Misheard "haze" as "days"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        # Should still prefer the song with better lyric match
        assert ranked[0]["song"] == "Purple Haze", \
            "Fuzzy lyric match should beat exact title match of misheard word"


class TestScoreBreakdown:
    """Test that score breakdown is transparent and debuggable."""

    def test_score_breakdown_present(self):
        """Each ranked candidate should have score breakdown for debugging."""
        candidates = [
            {
                "song": "Test Song",
                "artist": "Test Artist",
                "lyrics_match_score": 85,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 2,
                "spotify_popularity": 75,
            },
        ]

        query = "test lyrics"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        assert "score_breakdown" in ranked[0], "Score breakdown should be present"
        breakdown = ranked[0]["score_breakdown"]

        # Check all components are present
        required_components = [
            "lyric_content",
            "query_coverage",
            "match_locality",
            "title_relevance",
            "popularity",
            "provider_agreement",
        ]
        for component in required_components:
            assert component in breakdown, f"Missing component: {component}"
            assert isinstance(breakdown[component], int), \
                f"{component} should be an integer score"

    def test_ranking_score_in_valid_range(self):
        """Ranking score should always be 10-99."""
        candidates = [
            {
                "song": "Test Song",
                "artist": "Test Artist",
                "lyrics_match_score": 95,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 85,
                "source_count": 3,
                "spotify_popularity": 90,
            },
        ]

        query = "test lyrics query"
        ranked = candidate_ranker.rank_candidates(candidates, query)

        score = ranked[0]["ranking_score"]
        assert 10 <= score <= 99, f"Score {score} outside valid range [10, 99]"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])

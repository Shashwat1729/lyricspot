"""
Comprehensive evaluation using curated dataset (eval_dataset.json).

This test does NOT hit network — it validates the RANKING LOGIC in isolation:
For each case we construct a realistic candidate pool where:
  - correct song: lyrics_match_score high / exact match
  - distractors: title-similar but lyric-poor, or popular but lyric-poor
Then we verify candidate_ranker prefers lyric evidence.

Also tests feedback handling: single vote must not dominate.
"""

import json
import sys
from pathlib import Path
sys.path.insert(0, ".")

import pytest
from services.candidate_ranker import candidate_ranker, compute_confidence_label


DATASET_PATH = Path(__file__).parent / "eval_dataset.json"


def _load_dataset():
    with open(DATASET_PATH, encoding="utf-8") as f:
        return json.loads(f.read())


def _make_distractors(correct_song, correct_artist):
    """Build plausible distractor candidates for a case."""
    return [
        {
            "song": correct_song.split()[-1] if len(correct_song.split()) > 1 else "Similar Title",
            "artist": "Cover Band / Karaoke Hits",
            "lyrics_match_score": 22,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 92,  # high title prior to tempt old ranker
            "source_count": 1,
            "spotify_popularity": 18,
        },
        {
            "song": "Popular Unrelated Song",
            "artist": "Famous Artist",
            "lyrics_match_score": 28,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 88,
            "source_count": 3,  # many providers but lyric-poor
            "spotify_popularity": 95,
        },
        {
            "song": "Lyric Snippet Karaoke",
            "artist": "Karaoke Version",
            "lyrics_match_score": 85,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 60,
            "source_count": 1,
            "spotify_popularity": 12,
        },
    ]


@pytest.mark.parametrize("case", _load_dataset()["cases"], ids=lambda c: c["id"])
def test_dataset_case_ranking(case):
    query = case["query"]
    expected_song = case.get("expected_song")

    # Cases expecting low confidence (ambiguous queries) — test separately
    if case.get("expect_low_confidence"):
        # For ambiguous query, any ranking should be capped
        candidates = [
            {
                "song": f"Candidate {i}",
                "artist": f"Artist {i}",
                "lyrics_match_score": 60 + i*5,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 2,
                "spotify_popularity": 70 - i*10,
            } for i in range(3)
        ]
        ranked = candidate_ranker.rank_candidates(candidates, query)
        top_score = ranked[0]["ranking_score"]
        # Short ambiguous query must be capped
        assert top_score <= 75, f"Ambiguous query '{query}' should be capped, got {top_score}"
        label, _ = compute_confidence_label(top_score, ranked[1]["ranking_score"] if len(ranked) > 1 else 0, query)
        assert label != "high", f"Ambiguous query '{query}' should not be high confidence"
        return

    # Normal case: correct song should outrank distractors even when distractors have high title/prior
    correct = {
        "song": expected_song,
        "artist": case["expected_artist"] or "",
        "lyrics_match_score": 92,
        "exact_lyrics_match": True,
        "lyrics_available": True,
        "search_confidence": 65,  # deliberately modest prior
        "source_count": 2,
        "spotify_popularity": 78,
    }
    distractors = _make_distractors(expected_song, case["expected_artist"] or "")

    candidates = [correct] + distractors
    ranked = candidate_ranker.rank_candidates(candidates, query, language=case.get("language"))

    # Correct song must rank first despite lower search_confidence / popularity in distractors
    assert ranked[0]["song"] == expected_song, \
        f"[{case['id']}] lyric match should beat title/popularity. Query='{query}' -> top='{ranked[0]['song']}' expected='{expected_song}'. Scores: {[(c['song'], c['ranking_score']) for c in ranked]}"

    # Margin should be meaningful when lyric evidence is strong
    if ranked[0].get("exact_lyrics_match"):
        margin = ranked[0]["ranking_score"] - ranked[1]["ranking_score"]
        assert margin >= 10, f"[{case['id']}] exact lyric match should have clear margin, got {margin}"

    # Score breakdown should be present and sensible
    assert "score_breakdown" in ranked[0]
    assert ranked[0]["score_breakdown"]["lyric_content"] >= 90


def test_dataset_fuzzy_misheard_still_ranks():
    """Dataset case en_11: misheard lyric with fuzzy match should still prefer correct."""
    query = "there's a bathroom on the right"  # misheard Bad Moon Rising
    correct = {
        "song": "Bad Moon Rising",
        "artist": "Creedence Clearwater Revival",
        "lyrics_match_score": 74,  # fuzzy, not exact
        "exact_lyrics_match": False,
        "lyrics_available": True,
        "search_confidence": 58,
        "source_count": 2,
        "spotify_popularity": 80,
    }
    distractor = {
        "song": "Bathroom on the Right",  # title matches mishearing exactly
        "artist": "Unknown",
        "lyrics_match_score": 20,
        "exact_lyrics_match": False,
        "lyrics_available": True,
        "search_confidence": 96,
        "source_count": 1,
        "spotify_popularity": 10,
    }
    ranked = candidate_ranker.rank_candidates([correct, distractor], query)
    assert ranked[0]["song"] == "Bad Moon Rising", "Fuzzy lyric match should beat coincidental title match for misheard query"


def test_dataset_punctuation_normalization():
    """Dataset case en_10: dont vs don't"""
    query = "dont stop believin"
    correct = {
        "song": "Don't Stop Believin'",
        "artist": "Journey",
        "lyrics_match_score": 92,
        "exact_lyrics_match": True,
        "lyrics_available": True,
        "search_confidence": 65,
        "source_count": 3,
        "spotify_popularity": 88,
    }
    distractor = {
        "song": "Dont Stop",
        "artist": "Other",
        "lyrics_match_score": 30,
        "exact_lyrics_match": False,
        "lyrics_available": True,
        "search_confidence": 90,
        "source_count": 1,
        "spotify_popularity": 40,
    }
    ranked = candidate_ranker.rank_candidates([correct, distractor], query)
    assert ranked[0]["song"] == "Don't Stop Believin'"


class TestFeedbackNonDominance:
    """Verify single like/dislike does not dominate ranking."""

    def test_single_like_small_bonus(self):
        base = {
            "song": "Correct Song",
            "artist": "Artist A",
            "lyrics_match_score": 82,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 65,
            "source_count": 2,
            "spotify_popularity": 70,
            "feedback_boost": 0,
        }
        liked = dict(base, feedback_boost=8)  # single exact like = +8
        disliked = dict(base, feedback_boost=-8)

        ranked_base = candidate_ranker.rank_candidates([dict(base)], "test query distinct phrase here")
        ranked_liked = candidate_ranker.rank_candidates([dict(liked)], "test query distinct phrase here")
        ranked_disliked = candidate_ranker.rank_candidates([dict(disliked)], "test query distinct phrase here")

        base_score = ranked_base[0]["ranking_score"]
        liked_score = ranked_liked[0]["ranking_score"]
        disliked_score = ranked_disliked[0]["ranking_score"]

        # Single vote should be small effect
        assert 2 <= liked_score - base_score <= 6, f"Single like bonus should be 2-6, got {liked_score - base_score}"
        assert 2 <= base_score - disliked_score <= 6, f"Single dislike penalty should be 2-6, got {base_score - disliked_score}"

    def test_feedback_cannot_override_strong_lyric_evidence(self):
        """A downvoted correct lyric match should still beat an upvoted wrong lyric match."""
        correct_downvoted = {
            "song": "Correct Song",
            "artist": "Correct Artist",
            "lyrics_match_score": 92,
            "exact_lyrics_match": True,
            "lyrics_available": True,
            "search_confidence": 60,
            "source_count": 2,
            "spotify_popularity": 70,
            "feedback_boost": -8,  # single dislike (maybe trolling)
        }
        wrong_upvoted = {
            "song": "Wrong Song Title Match",
            "artist": "Other Artist",
            "lyrics_match_score": 25,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 90,
            "source_count": 3,
            "spotify_popularity": 95,
            "feedback_boost": 8,
        }
        ranked = candidate_ranker.rank_candidates([correct_downvoted, wrong_upvoted], "distinctive long lyric phrase here with many words")
        assert ranked[0]["song"] == "Correct Song", \
            f"Strong lyric match should still win despite single dislike vs single like. Scores: {[(c['song'], c['ranking_score'], c.get('feedback_boost')) for c in ranked]}"

    def test_many_likes_diminishing_returns(self):
        base = {
            "song": "Song A",
            "artist": "Artist",
            "lyrics_match_score": 75,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 65,
            "source_count": 2,
            "spotify_popularity": 60,
        }
        one_like = dict(base, feedback_boost=8)
        three_likes = dict(base, feedback_boost=20)  # capped max

        r0 = candidate_ranker.rank_candidates([dict(base)], "distinctive phrase test query long enough")
        r1 = candidate_ranker.rank_candidates([dict(one_like)], "distinctive phrase test query long enough")
        r3 = candidate_ranker.rank_candidates([dict(three_likes)], "distinctive phrase test query long enough")

        s0, s1, s3 = r0[0]["ranking_score"], r1[0]["ranking_score"], r3[0]["ranking_score"]
        # Diminishing returns: 3 likes should not be 3x one like
        assert s3 - s0 < 2 * (s1 - s0) + 1, f"Diminishing returns violated: s0={s0} s1={s1} s3={s3}"
        # Max bonus capped
        assert s3 - s0 <= 7, f"Max feedback bonus should be <=7, got {s3 - s0}"

    def test_feedback_tie_breaker(self):
        """When lyric evidence is equal, feedback can break tie."""
        a_no_fb = {
            "song": "Song A",
            "artist": "Artist A",
            "lyrics_match_score": 80,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 65,
            "source_count": 2,
            "spotify_popularity": 70,
            "feedback_boost": 0,
        }
        b_with_like = {
            "song": "Song B",
            "artist": "Artist B",
            "lyrics_match_score": 80,
            "exact_lyrics_match": False,
            "lyrics_available": True,
            "search_confidence": 65,
            "source_count": 2,
            "spotify_popularity": 70,
            "feedback_boost": 8,
        }
        ranked = candidate_ranker.rank_candidates([a_no_fb, b_with_like], "distinctive long phrase for tie test")
        assert ranked[0]["song"] == "Song B", "Feedback should break tie when lyric evidence equal"


class TestRomanizedAccentHandling:
    def test_french_accent_stripping(self):
        candidates = [
            {
                "song": "La Vie en Rose",
                "artist": "Édith Piaf",
                "lyrics_match_score": 90,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 2,
                "spotify_popularity": 80,
            },
            {
                "song": "Garage Days",
                "artist": "Other",
                "lyrics_match_score": 30,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 70,
                "source_count": 1,
                "spotify_popularity": 50,
            },
        ]
        query = "quand il me prend dans ses bras"  # without accents, query normalized strips accents
        ranked = candidate_ranker.rank_candidates(candidates, query)
        assert ranked[0]["song"] == "La Vie en Rose"

    def test_hindi_phonetic_too_tu(self):
        candidates = [
            {
                "song": "Tum Hi Ho",
                "artist": "Arijit Singh",
                "lyrics_match_score": 88,
                "exact_lyrics_match": False,
                "lyrics_available": True,
                "search_confidence": 65,
                "source_count": 2,
                "spotify_popularity": 78,
            }
        ]
        # "too" should normalize to "tu" internally — ranking uses same normalization
        query_with_too = "too hi ho bandhu"
        query_with_tu = "tu hi ho bandhu"
        r_too = candidate_ranker.rank_candidates([dict(c) for c in candidates], query_with_too)
        r_tu = candidate_ranker.rank_candidates([dict(c) for c in candidates], query_with_tu)
        # Both should score similarly high (within 5 pts) due to phonetic handling
        assert abs(r_too[0]["ranking_score"] - r_tu[0]["ranking_score"]) <= 5


class TestRankingMetrics:
    """Aggregate measurable ranking evaluation: Top-1/Top-3/Top-5, MRR, Recall@5."""

    def test_ranking_metrics_topk_mrr_recall(self):
        """Rank every decisive dataset case against its hard negatives.

        Correct song gets exact lyric evidence with a modest search prior;
        hard negatives (or synthetic distractors) get high title priors but
        poor lyric evidence. A lyric-content-first ranker must still put the
        correct song on top.
        """
        dataset = _load_dataset()["cases"]
        decisive = [c for c in dataset if not c.get("expect_low_confidence") and c.get("expected_song")]
        assert len(decisive) >= 20, f"Dataset needs >=20 decisive cases, has {len(decisive)}"

        top1 = top3 = top5 = 0
        reciprocal_ranks = []
        failures = []
        for case in decisive:
            query = case["query"]
            correct = {
                "song": case["expected_song"],
                "artist": case.get("expected_artist") or "",
                "lyrics_match_score": 92,
                "exact_lyrics_match": True,
                "lyrics_available": True,
                "search_confidence": 62,
                "source_count": 2,
                "spotify_popularity": 78,
            }
            negatives = case.get("hard_negatives") or []
            if negatives:
                distractors = [
                    {
                        "song": n["song"],
                        "artist": n.get("artist", "Unknown Artist"),
                        "lyrics_match_score": 25,
                        "exact_lyrics_match": False,
                        "lyrics_available": True,
                        "search_confidence": 90,  # high title prior to tempt weak rankers
                        "source_count": 1,
                        "spotify_popularity": 40,
                    }
                    for n in negatives
                ]
            else:
                distractors = _make_distractors(case["expected_song"], case.get("expected_artist") or "")
            ranked = candidate_ranker.rank_candidates(
                [correct] + distractors, query, language=case.get("language")
            )
            rank = next(
                (i + 1 for i, c in enumerate(ranked) if c["song"] == case["expected_song"]),
                len(ranked) + 1,
            )
            if rank == 1:
                top1 += 1
            else:
                failures.append((case["id"], rank))
            if rank <= 3:
                top3 += 1
            if rank <= 5:
                top5 += 1
            reciprocal_ranks.append(1.0 / rank)

        n = len(decisive)
        mrr = sum(reciprocal_ranks) / n
        print(
            f"\nRanking metrics over {n} cases: "
            f"Top-1={top1}/{n} ({top1/n:.3f}) "
            f"Top-3={top3}/{n} ({top3/n:.3f}) "
            f"Top-5={top5}/{n} ({top5/n:.3f}) "
            f"MRR={mrr:.3f} Recall@5={top5/n:.3f} "
            f"failures={failures}"
        )
        assert top1 / n >= 0.85, f"Top-1 accuracy {top1}/{n} below 0.85: {failures}"
        assert top3 / n >= 0.95, f"Top-3 accuracy {top3}/{n} below 0.95: {failures}"
        assert top5 / n >= 0.95, f"Top-5 accuracy {top5}/{n} below 0.95 (Recall@5): {failures}"
        assert mrr >= 0.90, f"MRR {mrr:.3f} below 0.90"

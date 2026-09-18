"""
Multi-signal candidate ranking for lyric-based song identification.

RANKING ARCHITECTURE:

The user provides a lyric fragment (typed or sung). Our job is to find which
song contains those lyrics. The ranking system must:

1. Retrieve enough candidates from search providers
2. Verify which candidates actually contain the query in their lyrics
3. Rank based on lyric content match quality (primary signal)
4. Use metadata (title, artist, popularity) as secondary signals
5. Handle ambiguous queries without false confidence
6. Return multiple plausible results, not just Top-1

CORE PRINCIPLE:

    Lyric content match > Everything else

A song whose lyrics contain the query should rank above a song whose title
happens to match the query but whose lyrics do not.

SCORING MODEL:

Final score = weighted combination of:
    - Lyric content relevance (50% weight) - does the query appear in lyrics?
    - Query coverage (20% weight) - how much of the query is matched?
    - Match locality (10% weight) - contiguous phrase vs scattered words?
    - Title relevance (10% weight) - does title help?
    - Popularity (5% weight) - famous original vs obscure cover?
    - Provider agreement (5% weight) - multiple sources found this?

Each component returns 0-100. Final score is capped at 99.

CONFIDENCE vs RANKING:

Ranking score determines order. Confidence is a separate UX signal:
    - "high": strong absolute evidence + large margin from #2
    - "uncertain": plausible but weak margin
    - "low": very weak candidate

Short generic queries remain uncertain even if one result ranks highest.
"""

import re
import logging
import math
import unicodedata
from typing import Optional
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

# Romanized phonetic equivalence for Hindi (applied lightly in ranking)
_HINDI_PHONETIC_MAP = [
    (r'\btoo\b', 'tu'),
    (r'\bmein\b', 'main'),
    (r'\bmai\b', 'main'),
    (r'\bhain\b', 'hai'),
    (r'\bkee\b', 'ki'),
    (r'\bhee\b', 'hi'),
]


def _strip_accents(text: str) -> str:
    """Remove diacritics for French/Spanish/Portuguese matching (é->e, ñ->n etc)."""
    return ''.join(
        c for c in unicodedata.normalize('NFD', text)
        if unicodedata.category(c) != 'Mn'
    )


def _is_devanagari(text: str) -> bool:
    return any(0x0900 <= ord(ch) <= 0x097F for ch in text)


def _romanize_devanagari(text: str) -> str:
    """Syllable romanization with Hindi schwa deletion (sapne→sapne, not sapane)."""
    CONS = {
        "\u0915": "k", "\u0916": "kh", "\u0917": "g", "\u0918": "gh", "\u0919": "ng",
        "\u091A": "ch", "\u091B": "chh", "\u091C": "j", "\u091D": "jh", "\u091E": "ny",
        "\u091F": "t", "\u0920": "th", "\u0921": "d", "\u0922": "dh", "\u0923": "n",
        "\u0924": "t", "\u0925": "th", "\u0926": "d", "\u0927": "dh", "\u0928": "n",
        "\u092A": "p", "\u092B": "ph", "\u092C": "b", "\u092D": "bh", "\u092E": "m",
        "\u092F": "y", "\u0930": "r", "\u0932": "l", "\u0935": "v",
        "\u0936": "sh", "\u0937": "sh", "\u0938": "s", "\u0939": "h",
    }
    SIGN = {
        "\u093E": "aa", "\u093F": "i", "\u0940": "ii", "\u0941": "u", "\u0942": "uu",
        "\u0947": "e", "\u0948": "ai", "\u094B": "o", "\u094C": "au",
    }
    IND = {
        "\u0905": "a", "\u0906": "aa", "\u0907": "i", "\u0908": "ii", "\u0909": "u", "\u090A": "uu",
        "\u090F": "e", "\u0910": "ai", "\u0913": "o", "\u0914": "au",
    }
    HALANT, ANUSVARA, CHANDRA, NUKTA, VISARGA = "\u094D", "\u0902", "\u0901", "\u093C", "\u0903"
    words = []
    for word in text.split():
        if not word:
            continue
        syls = []
        chars = list(word)
        i = 0
        while i < len(chars):
            ch, nxt = chars[i], chars[i + 1] if i + 1 < len(chars) else None
            if ch in CONS:
                if nxt in SIGN:
                    syls.append((CONS[ch], SIGN[nxt]))
                    i += 2
                    continue
                if nxt == HALANT:
                    syls.append((CONS[ch], ""))
                    i += 2
                    continue
                if nxt in (ANUSVARA, CHANDRA):
                    syls.append((CONS[ch], "a"))
                    syls.append(("n", None))
                    i += 2
                    continue
                if nxt == VISARGA:
                    syls.append((CONS[ch], "a"))
                    i += 2
                    continue
                syls.append((CONS[ch], "a"))
                i += 1
                continue
            if ch in IND:
                syls.append(("", IND[ch]))
                i += 1
                continue
            if ch in (HALANT, NUKTA, VISARGA):
                i += 1
                continue
            if "\u0900" <= ch <= "\u097F":
                syls.append((" ", None))
                i += 1
                continue
            syls.append((ch, None))
            i += 1
        out = []
        for k, (base, vowel) in enumerate(syls):
            if vowel == "a":
                is_final = k == len(syls) - 1
                prev_has_vowel = k > 0 and syls[k - 1][1] not in (None, "")
                nxt = syls[k + 1] if k + 1 < len(syls) else None
                before_explicit = (
                    nxt and nxt[0] and nxt[0][0] in "bcdfghjklmnpqrstvwxyz"
                    and nxt[1] not in (None, "", "a")
                )
                if is_final or (prev_has_vowel and before_explicit):
                    out.append(base)
                    continue
            out.append(base + (vowel or ""))
        words.append("".join(out))
    return re.sub(r"\s+", " ", " ".join(words)).strip()


class CandidateRanker:
    """Ranks song candidates using multi-signal lyric-content-first scoring."""

    # Component weights (must sum to 1.0) — core signals.
    # Feedback is applied as a small additive bonus/penalty AFTER weighting
    # so it can break ties but never dominate lyric evidence.
    WEIGHTS = {
        "lyric_content": 0.50,   # Strongest: query in lyrics?
        "query_coverage": 0.20,  # How much of query matched?
        "match_locality": 0.10,  # Contiguous phrase vs scattered?
        "title_relevance": 0.10, # Title helps but doesn't dominate
        "popularity": 0.05,      # Famous vs obscure
        "provider_agreement": 0.05,  # Multiple sources agree?
    }

    # Feedback: max additive points from community votes.
    # Single upvote = ~+3.5, single downvote = ~-4.0, capped at ±7.
    # Diminishing returns via log scaling prevent brigading.
    FEEDBACK_MAX_BONUS = 7.0
    FEEDBACK_MAX_PENALTY = 7.0

    # Common English words (low discriminative power)
    COMMON_WORDS = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
        "been", "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "can", "i", "you", "he",
        "she", "it", "we", "they", "me", "him", "her", "us", "them", "my",
        "your", "his", "its", "our", "their", "this", "that", "these", "those",
        "am", "so", "if", "than", "then", "now", "just", "like", "get", "go",
        "yeah", "oh", "ooh", "ah", "la", "na", "da",
    }

    def rank_candidates(
        self,
        candidates: list[dict],
        query: str,
        query_language: Optional[str] = None,
        language: Optional[str] = None,
        **kwargs,
    ) -> list[dict]:
        """
        Rank candidates using multi-signal scoring.

        Each candidate must have:
            - song: str
            - artist: str
            - lyrics_match_score: Optional[int] (0-100, from timestamp_matcher)
            - exact_lyrics_match: bool (query substring in lyrics?)
            - lyrics_available: bool (were lyrics fetched?)
            - search_confidence: int (search prior from provider)
            - source_count: int (distinct providers)
            - spotify_popularity: Optional[int] (0-100)

        Args:
            candidates: List of candidate dicts with metadata
            query: User's normalized lyric query
            query_language: Whisper language hint (e.g. "en", "hi")

        Returns:
            Ranked candidates with added "ranking_score" and "score_breakdown"
        """
        if not candidates:
            return []
        # Accept both query_language and language kwargs
        effective_language = query_language or language or kwargs.get("query_language")
        _ = effective_language  # reserved for language-gated phonetic rules

        query_normalized = self._normalize_text(query)
        query_tokens = self._tokenize(query_normalized)
        query_distinctive_tokens = [t for t in query_tokens if t not in self.COMMON_WORDS]

        for candidate in candidates:
            score_breakdown = {}

            # === LYRIC CONTENT RELEVANCE ===
            score_breakdown["lyric_content"] = self._score_lyric_content(
                candidate, query_normalized, query_tokens
            )

            # === QUERY COVERAGE ===
            score_breakdown["query_coverage"] = self._score_query_coverage(
                candidate, query_tokens, query_distinctive_tokens
            )

            # === MATCH LOCALITY ===
            score_breakdown["match_locality"] = self._score_match_locality(
                candidate, query_normalized
            )

            # === TITLE RELEVANCE ===
            score_breakdown["title_relevance"] = self._score_title_relevance(
                candidate, query_normalized, query_tokens
            )

            # === POPULARITY ===
            score_breakdown["popularity"] = self._score_popularity(candidate)

            # === PROVIDER AGREEMENT ===
            score_breakdown["provider_agreement"] = self._score_provider_agreement(
                candidate
            )

            # === FEEDBACK (community signal) ===
            score_breakdown["feedback"] = self._score_feedback(candidate)

            # Weighted combination of core signals
            final_score = sum(
                score_breakdown[component] * self.WEIGHTS[component]
                for component in self.WEIGHTS
            )

            # Additive feedback adjustment — small, diminishing, never dominant
            feedback_adj = self._feedback_adjustment(candidate)
            final_score += feedback_adj
            score_breakdown["feedback_adj"] = round(feedback_adj, 1)

            # Apply floors and ceilings based on evidence quality
            final_score = self._apply_constraints(final_score, candidate, query_normalized)

            candidate["ranking_score"] = int(min(99, max(10, final_score)))
            candidate["score_breakdown"] = {k: int(v) if isinstance(v, (int, float)) and k != "feedback_adj" else v for k, v in score_breakdown.items()}

        # Lyric-tie rule (mirrors the browser engine's Rule 5): when several
        # candidates carry equally strong lyric evidence (same lyric attached
        # to multiple entries), the more popular original must win over
        # same-lyric covers/mislabels. Bounded adjustment, ties only.
        self._apply_lyric_tiebreak(candidates)

        # Sort deterministically: ranking_score desc, then song/artist alphabetically
        candidates.sort(
            key=lambda c: (
                -c.get("ranking_score", 0),
                c.get("song", "").lower(),
                c.get("artist", "").lower(),
            )
        )

        return candidates

    def _score_lyric_content(
        self, candidate: dict, query: str, query_tokens: list[str]
    ) -> float:
        """
        Score based on whether/how well the query appears in the song's lyrics.

        This is the PRIMARY signal. A strong lyric match should dominate everything else.
        """
        exact_match = candidate.get("exact_lyrics_match", False)
        lyrics_score = candidate.get("lyrics_match_score")  # 0-100 from timestamp_matcher
        lyrics_available = candidate.get("lyrics_available", False)

        # Perfect: exact substring in lyrics
        if exact_match:
            return 98

        # Strong: high fuzzy match score from lyrics
        if lyrics_score is not None:
            if lyrics_score >= 95:
                return 95
            elif lyrics_score >= 90:
                return 90
            elif lyrics_score >= 85:
                return 85
            elif lyrics_score >= 80:
                return 78
            elif lyrics_score >= 70:
                return 70
            elif lyrics_score >= 60:
                return 58
            elif lyrics_score >= 50:
                return 45
            elif lyrics_score >= 40:
                return 32
            else:
                # Lyrics exist but match poorly - STRONG NEGATIVE SIGNAL
                return 15

        # Lyrics were not available - neutral (doesn't help or hurt)
        if not lyrics_available:
            return 50

        # Lyrics available but no match attempted - treat as neutral
        return 50

    def _score_query_coverage(
        self,
        candidate: dict,
        query_tokens: list[str],
        distinctive_tokens: list[str],
    ) -> float:
        """
        Score based on what fraction of the query is matched.

        A candidate matching "you were the reason I stayed" on most tokens
        should beat one matching only "reason".
        """
        lyrics_score = candidate.get("lyrics_match_score")

        # If we have a direct lyrics match score, use it as a proxy for coverage
        if lyrics_score is not None:
            # High lyrics_score implies good coverage
            if lyrics_score >= 90:
                return 95
            elif lyrics_score >= 80:
                return 85
            elif lyrics_score >= 70:
                return 75
            elif lyrics_score >= 60:
                return 65
            elif lyrics_score >= 50:
                return 55
            else:
                return max(30, lyrics_score * 0.5)

        # No lyrics verification - estimate from title/metadata
        # (this is a weak signal)
        song = candidate.get("song", "").lower()
        artist = candidate.get("artist", "").lower()
        combined = f"{song} {artist}"

        if not distinctive_tokens:
            return 50  # No distinctive words to check

        matched_distinctive = sum(1 for token in distinctive_tokens if token in combined)
        coverage = matched_distinctive / len(distinctive_tokens)

        return int(30 + coverage * 40)  # 30-70 range

    def _score_match_locality(self, candidate: dict, query: str) -> float:
        """
        Score based on whether matching words appear contiguously or scattered.

        A contiguous phrase match is stronger evidence than scattered words.
        """
        lyrics_score = candidate.get("lyrics_match_score")
        exact_match = candidate.get("exact_lyrics_match", False)

        # Exact substring = perfect locality
        if exact_match:
            return 95

        # High fuzzy score implies good locality
        if lyrics_score is not None:
            if lyrics_score >= 90:
                return 85
            elif lyrics_score >= 80:
                return 75
            elif lyrics_score >= 70:
                return 65
            elif lyrics_score >= 60:
                return 55
            else:
                return 40

        # No lyrics - check title locality as weak signal
        song = candidate.get("song", "").lower()
        query_lower = query.lower()

        # Substring in title?
        if query_lower in song or song in query_lower:
            return 70

        # Partial ratio (contiguous subsequence)
        partial = fuzz.partial_ratio(query_lower, song)
        if partial >= 90:
            return 65
        elif partial >= 80:
            return 55
        else:
            return 40

    def _score_title_relevance(
        self, candidate: dict, query: str, query_tokens: list[str]
    ) -> float:
        """
        Score based on title similarity to query.

        This is a WEAK signal. Titles help, but they should never dominate
        strong lyric evidence.
        """
        song = candidate.get("song", "").lower().strip()
        query_lower = query.lower().strip()

        if not song:
            return 30

        # Exact title = query (rare but meaningful)
        if song == query_lower:
            return 85

        # Title substring of query or vice versa
        if song in query_lower or query_lower in song:
            return 75

        # Token overlap
        song_tokens = self._tokenize(song)
        common_tokens = set(query_tokens) & set(song_tokens)
        if song_tokens:
            token_overlap = len(common_tokens) / max(len(query_tokens), len(song_tokens))
        else:
            token_overlap = 0

        # Fuzzy similarity
        partial = fuzz.partial_ratio(query_lower, song)
        token_sort = fuzz.token_sort_ratio(query_lower, song)

        # Combine signals
        fuzzy_score = max(partial, token_sort)
        title_score = (token_overlap * 40) + (fuzzy_score * 0.4)

        return int(min(80, max(20, title_score)))

    def _score_popularity(self, candidate: dict) -> float:
        """
        Score based on track popularity.

        Famous originals should rank above obscure covers when lyric match is similar.
        """
        popularity = candidate.get("spotify_popularity")

        if popularity is None:
            return 50  # Unknown - neutral

        # Spotify popularity is 0-100
        if popularity >= 80:
            return 90
        elif popularity >= 70:
            return 80
        elif popularity >= 60:
            return 70
        elif popularity >= 50:
            return 60
        elif popularity >= 40:
            return 50
        elif popularity >= 30:
            return 40
        else:
            return 35

    def _score_provider_agreement(self, candidate: dict) -> float:
        """
        Score based on how many independent providers found this song.

        Multiple sources agreeing is positive evidence, but not decisive.
        """
        source_count = candidate.get("source_count", 1)

        if source_count >= 5:
            return 95
        elif source_count >= 4:
            return 85
        elif source_count >= 3:
            return 75
        elif source_count == 2:
            return 65
        else:
            return 50  # Single source - neutral

    def _score_feedback(self, candidate: dict) -> float:
        """
        Score component for feedback (for breakdown visibility).
        Returns 50 neutral baseline; actual boost is additive via _feedback_adjustment.
        """
        boost = int(candidate.get("feedback_boost", 0) or 0)
        if boost > 0:
            # Map 1..20 to 52..65 (small positive lean)
            return min(65, 50 + math.log1p(boost) * 4)
        elif boost < 0:
            return max(35, 50 + math.log1p(abs(boost)) * -4)
        return 50

    def _feedback_adjustment(self, candidate: dict) -> float:
        """
        Compute additive ranking adjustment from community feedback.

        Design goals:
        - Single like/dislike must NOT dominate (small effect).
        - Multiple consistent votes have diminishing returns (log scale).
        - Feedback can tip close ties but cannot override strong lyric evidence.
        - Asymmetric: downvotes slightly stronger to surface quality issues.

        feedback_boost is int from FeedbackStore.get_boost(): -20..+20
          (exact match +8 per vote, similar query +5 per vote, capped at ±20).
        Returns float in [-7, +7].
        """
        boost = int(candidate.get("feedback_boost", 0) or 0)
        if boost == 0:
            return 0.0
        # Diminishing returns: log1p(|boost|/4) scaled to max bonus/penalty
        # boost=5  -> ~+2.8, boost=8 -> ~+3.8, boost=16 -> ~+5.6, boost=20 -> ~+6.3
        magnitude = math.log1p(abs(boost) / 4.0)
        # Normalize: log1p(20/4)=log1p(5)=1.79 => maps to max
        max_log = math.log1p(20 / 4.0)
        if boost > 0:
            return (magnitude / max_log) * self.FEEDBACK_MAX_BONUS
        else:
            return -(magnitude / max_log) * self.FEEDBACK_MAX_PENALTY

    def _apply_lyric_tiebreak(self, candidates: list[dict]) -> None:
        """
        Bounded popularity adjustment inside a lyric-evidence tie.

        When several candidates carry equally strong lyric evidence (top
        lyric_content scores within 5, all >= 60 — e.g. the same lyric
        attached to multiple entries), the more popular original must win
        over same-lyric covers/mislabels. Adjustment is at most +8 and only
        applies inside the tied band, so it can flip noise gaps but never
        jump evidence bands. Deterministic; recorded in the breakdown.
        """
        if len(candidates) < 2:
            return
        lyric_scores = [
            c.get("score_breakdown", {}).get("lyric_content", 0)
            for c in candidates
        ]
        top = max(lyric_scores)
        if top < 60:
            return  # weak-evidence zone: popularity must not invent winners
        for candidate, lyric in zip(candidates, lyric_scores):
            if top - lyric > 5:
                candidate["score_breakdown"]["tiebreak_popularity"] = 0
                continue
            pop = candidate.get("spotify_popularity")
            pop01 = (pop / 100.0) if isinstance(pop, (int, float)) else 0.5
            adj = round(8 * max(0.0, min(1.0, pop01)), 1)
            candidate["ranking_score"] = int(min(99, candidate["ranking_score"] + adj))
            candidate["score_breakdown"]["tiebreak_popularity"] = adj

    def _apply_constraints(
        self, score: float, candidate: dict, query: str
    ) -> float:
        """
        Apply minimum floors and maximum ceilings based on evidence quality.

        Prevents weak signals from artificially inflating/deflating strong evidence.
        """
        exact_match = candidate.get("exact_lyrics_match", False)
        lyrics_score = candidate.get("lyrics_match_score")
        lyrics_available = candidate.get("lyrics_available", False)

        # FLOOR: Exact lyric match cannot score below 88
        if exact_match:
            score = max(score, 88)

        # FLOOR: Very strong lyric match cannot score below 85
        if lyrics_score is not None and lyrics_score >= 95:
            score = max(score, 85)

        # FLOOR: Strong lyric match cannot score below 75
        if lyrics_score is not None and lyrics_score >= 85:
            score = max(score, 75)

        # CEILING: If lyrics exist but match poorly (<40), cap score
        if lyrics_available and lyrics_score is not None and lyrics_score < 40:
            score = min(score, 45)

        # CEILING: If lyrics exist but match weakly (40-60), cap score
        if lyrics_available and lyrics_score is not None and 40 <= lyrics_score < 60:
            score = min(score, 60)

        # PENALTY: Very short query (<=3 words) - ambiguous, scale down to preserve ordering
        # Use scaling not hard cap so that popularity still breaks ties.
        query_words = query.split()
        if len(query_words) <= 3:
            # Scale to keep under 75 but preserve relative order
            # e.g., 88 -> 71, 87 -> 70, 60 -> 48
            score = score * 0.82
            score = min(score, 74)

        # PENALTY: Generic common words only
        distinctive_words = [w for w in query_words if w.lower() not in self.COMMON_WORDS]
        if not distinctive_words or len(distinctive_words) <= 1:
            score = score * 0.88
            score = min(score, 71)

        # PENALTY: Artist credibility check
        artist = candidate.get("artist", "").lower()
        song = candidate.get("song", "").lower()

        spam_indicators = [
            "lyric", "lyrics", "karaoke", "cover version", "tribute",
            "compilation", "best of", "reaction", "mashup",
        ]
        if any(kw in artist for kw in spam_indicators) or any(kw in song for kw in spam_indicators):
            score = min(score, 55)

        # PENALTY: Very long title (likely a description, not a song)
        if len(song) > 60:
            score = min(score, 50)

        return score

    @staticmethod
    def _normalize_text(text: str) -> str:
        """Normalize text for comparison: NFKC, lowercase, strip accents/punct, collapse ws."""
        # Cross-script: romanize Devanagari before any other normalization
        if _is_devanagari(text):
            text = _romanize_devanagari(text)
        # Unicode normalize
        text = unicodedata.normalize('NFKC', text)
        text = text.lower().strip()
        # Light phonetic for romanized Hindi queries: normalize common variants
        # (don't over-normalize — only word-boundary safe subs)
        for pat, repl in _HINDI_PHONETIC_MAP:
            text = re.sub(pat, repl, text)
        # Strip accents for cross-language matching (French/Spanish etc)
        # Keep original tokenization intact — we do this for matching only
        text = _strip_accents(text)
        text = re.sub(r"[^\w\s']", " ", text, flags=re.UNICODE)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        """Split into tokens (words), filter empty."""
        return [t for t in text.split() if t]


def compute_confidence_label(
    top_score: int,
    second_score: int,
    query: str,
    high_threshold: int = 70,
    high_margin: float = 10,
) -> tuple[str, float]:
    """
    Map ranking scores to UX confidence labels.

    Short/ambiguous queries are never 'high' even if score is high — they
    need more context. This prevents false certainty for "hello", "let it be", etc.
    Returns:
        (label, margin) where label is "high" | "uncertain" | "low"
    """
    margin = float(top_score - second_score)

    # Query-aware gating: short or non-distinctive queries cannot be high
    query_words = query.strip().split()
    # Use same COMMON_WORDS set for consistency
    common = CandidateRanker.COMMON_WORDS
    distinctive = [w for w in query_words if w.lower() not in common]
    is_short = len(query_words) <= 3
    is_generic = not distinctive or len(distinctive) <= 1
    if is_short or is_generic:
        # Require substantially higher evidence for high confidence
        # effectively never high for these queries unless score >=82 and margin >=12
        if top_score >= 82 and margin >= 12:
            return ("high", margin)
        if top_score >= 50:
            return ("uncertain", margin)
        return ("low", margin)

    # High confidence requires BOTH strong absolute score AND clear margin
    if top_score >= high_threshold and margin >= high_margin:
        return ("high", margin)

    # Uncertain: plausible but not decisive
    if top_score >= 50:
        return ("uncertain", margin)

    # Low: very weak evidence
    return ("low", margin)


# Module-level singleton
candidate_ranker = CandidateRanker()

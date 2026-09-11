"""
Multi-layered confidence scoring engine for ContinueMySong AI.

Computes a final confidence score by combining multiple independent signals:
  Layer 1: LYRICS MATCH — How well does the song's lyrics match the user's input?
  Layer 2: SEARCH RELEVANCE — How relevant was the search result to the query?
  Layer 3: ARTIST CREDIBILITY — Is this a legitimate artist/song or a compilation/cover?
  Layer 4: SOURCE AGREEMENT — Did multiple search strategies find the same song?
  Layer 5: POPULARITY — How popular/established is this track?
  Layer 6: FEEDBACK — What did previous users say about this match?

Each layer produces a score 0-100 and a weight. The final score is a weighted
combination with minimum floors to prevent any single weak signal from
destroying confidence when other signals are strong.
"""

import re
import logging
from typing import Optional, Dict
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)


def confidence_label(top_confidence: int, margin: float, high_threshold: int = 70, high_margin: float = 10) -> str:
    """Map absolute score + top-1/top-2 margin to a UX band.

    - "high": strong absolute score AND sufficiently large margin
    - "uncertain": plausible result but weak margin
    - "low": very weak candidate
    """
    if top_confidence >= high_threshold and margin >= high_margin:
        return "high"
    if top_confidence >= 50:
        return "uncertain"
    return "low"


class ConfidenceCalculator:
    """Multi-layered confidence scoring engine."""

    # Layer weights (must sum to ~1.0 for active layers)
    WEIGHTS = {
        "lyrics_match": 0.45,      # Strongest signal — does the song contain these lyrics?
        "search_relevance": 0.15,  # How well did search find this?
        "artist_credibility": 0.15,  # Is this a real artist/song?
        "source_agreement": 0.10,  # Did multiple sources agree?
        "popularity": 0.10,        # Track popularity
        "feedback": 0.05,          # User feedback history
    }

    # Minimum floor: if lyrics match >= 90, final score cannot go below this
    LYRICS_CERTAINTY_FLOOR = 88
    # If lyrics match >= 70, floor is:
    LYRICS_LIKELY_FLOOR = 68

    def calculate(
        self,
        transcript: str,
        song: str,
        artist: str,
        lyrics_match_score: Optional[int] = None,
        exact_lyrics_match: bool = False,
        search_confidence: int = 50,
        source_count: int = 1,
        spotify_popularity: Optional[int] = None,
        feedback_boost: int = 0,
        has_timestamp: bool = False,
        strategy: str = "unknown",
    ) -> int:
        """
        Calculate final confidence score combining all available signals.
        
        Signals with no data are EXCLUDED from the weighted average
        (not penalized as neutral) so missing lyrics verification
        doesn't drag down an otherwise strong identification.
        """
        layers = {}
        # Track which layers have real data vs are unknown/neutral
        layer_has_data = {}

        # === LAYER 1: LYRICS MATCH (most important signal) ===
        layers["lyrics_match"] = self._score_lyrics_match(
            lyrics_match_score, exact_lyrics_match, has_timestamp
        )
        # Has data if we actually checked lyrics
        layer_has_data["lyrics_match"] = (lyrics_match_score is not None or exact_lyrics_match)

        # === LAYER 2: SEARCH RELEVANCE (always has data — we found the candidate somehow) ===
        layers["search_relevance"] = self._score_search_relevance(
            transcript, song, artist, search_confidence
        )
        layer_has_data["search_relevance"] = True

        # === LAYER 3: ARTIST CREDIBILITY (always has data — we can analyze the name) ===
        layers["artist_credibility"] = self._score_artist_credibility(song, artist)
        layer_has_data["artist_credibility"] = True

        # === LAYER 4: SOURCE AGREEMENT ===
        layers["source_agreement"] = self._score_source_agreement(source_count)
        # Only meaningful if multiple sources were checked
        layer_has_data["source_agreement"] = (source_count >= 2)

        # === LAYER 5: POPULARITY ===
        layers["popularity"] = self._score_popularity(spotify_popularity)
        layer_has_data["popularity"] = (spotify_popularity is not None)

        # === LAYER 6: FEEDBACK ===
        layers["feedback"] = self._score_feedback(feedback_boost)
        layer_has_data["feedback"] = (feedback_boost != 0)

        # === COMBINE LAYERS ===
        final = self._combine_layers(layers, layer_has_data, lyrics_match_score, exact_lyrics_match)

        return int(min(99, max(10, final)))

    def _score_lyrics_match(
        self,
        lyrics_match_score: Optional[int],
        exact_lyrics_match: bool,
        has_timestamp: bool,
    ) -> int:
        """Score based on how well the song's lyrics match the user input."""
        if exact_lyrics_match:
            return 98  # Verbatim match in lyrics — near certain

        if lyrics_match_score is None:
            # No lyrics available to check — neutral (doesn't help or hurt)
            return 50

        if lyrics_match_score >= 95:
            return 97
        elif lyrics_match_score >= 90:
            return 93
        elif lyrics_match_score >= 85:
            return 88
        elif lyrics_match_score >= 80:
            return 82
        elif lyrics_match_score >= 70:
            return 75
        elif lyrics_match_score >= 60:
            return 65
        elif lyrics_match_score >= 50:
            return 55
        elif lyrics_match_score >= 40:
            return 42
        else:
            return max(20, lyrics_match_score)

    def _score_search_relevance(
        self, transcript: str, song: str, artist: str, search_confidence: int
    ) -> int:
        """Score based on title/transcript relevance."""
        transcript_lower = transcript.lower().strip()
        song_lower = song.lower().strip()

        # Direct title-in-transcript check
        title_words = [w for w in song_lower.split() if len(w) > 2]
        if title_words:
            words_in_transcript = sum(1 for w in title_words if w in transcript_lower)
            word_ratio = words_in_transcript / len(title_words)
        else:
            word_ratio = 0.5

        # Fuzzy title match
        partial = fuzz.partial_ratio(transcript_lower, song_lower)
        token_sort = fuzz.token_sort_ratio(transcript_lower, song_lower)

        # If search found this via a proper engine, it's at least somewhat relevant
        base_relevance = max(search_confidence, 50)

        # Combine: word overlap + fuzzy + base
        score = (word_ratio * 30) + (max(partial, token_sort) * 0.4) + (base_relevance * 0.2)

        return int(min(100, max(30, score)))

    def _score_artist_credibility(self, song: str, artist: str) -> int:
        """Score based on whether artist/song look legitimate."""
        score = 75  # Start neutral-positive (search engines return real songs most of the time)

        artist_lower = (artist or "").lower()
        song_lower = song.lower()

        # === PENALTIES ===
        # Lyric/compilation indicators
        bad_keywords = (
            "lyric", "lyrics", "compilation", "best of", "greatest", "karaoke",
            "cover version", "tribute", "instrumental", "midi", "reaction",
            "playlist", "soundtrack", "full album", "mashup", "vs.",
        )
        if any(kw in artist_lower for kw in bad_keywords):
            score -= 35
        if any(kw in song_lower for kw in bad_keywords):
            score -= 25

        # Random username patterns (digits mixed with letters)
        if re.search(r'[a-z]\d|\d[a-z]', artist_lower) and len(artist) > 3:
            score -= 20

        # ALL CAPS (spam/non-artist uploads)
        if artist and artist == artist.upper() and len(artist) > 4:
            score -= 15
        if song == song.upper() and len(song) > 8:
            score -= 15

        # Very long titles (descriptions, not real song names)
        if len(song) > 60:
            score -= 20
        elif len(song) > 40:
            score -= 10

        # Emoji in title (user uploads)
        if any(ord(c) > 0x2600 for c in song):
            score -= 15

        # No artist at all
        if not artist or artist.lower() in ("unknown", ""):
            score -= 15

        # === BONUSES ===
        # Clean, short artist name (likely a real musician)
        if artist and 2 <= len(artist) <= 20 and not re.search(r'\d', artist):
            score += 10

        # Clean, short song title
        if 2 <= len(song) <= 30:
            score += 5

        return int(min(100, max(10, score)))

    def _score_source_agreement(self, source_count: int) -> int:
        """Score based on how many independent sources found this song."""
        if source_count >= 4:
            return 95
        elif source_count >= 3:
            return 85
        elif source_count == 2:
            return 70
        else:
            return 50  # Only one source — neutral

    def _score_popularity(self, spotify_popularity: Optional[int]) -> int:
        """Score based on track popularity."""
        if spotify_popularity is None:
            return 50  # Unknown — neutral
        # Spotify popularity is 0-100
        if spotify_popularity >= 70:
            return 90
        elif spotify_popularity >= 50:
            return 75
        elif spotify_popularity >= 30:
            return 60
        elif spotify_popularity >= 10:
            return 45
        else:
            return 35

    def _score_feedback(self, feedback_boost: int) -> int:
        """Score based on user feedback history."""
        if feedback_boost > 5:
            return 90
        elif feedback_boost > 0:
            return 70
        elif feedback_boost == 0:
            return 50  # Neutral
        elif feedback_boost > -3:
            return 30
        else:
            return 15

    def _combine_layers(
        self,
        layers: Dict[str, int],
        layer_has_data: Dict[str, bool],
        lyrics_match_score: Optional[int],
        exact_lyrics_match: bool,
    ) -> float:
        """Combine layer scores with weights. Exclude layers with no real data."""
        # Only include layers that have actual data
        total = 0.0
        total_weight = 0.0
        for layer_name, score in layers.items():
            if not layer_has_data.get(layer_name, False):
                continue  # Skip — no real data for this signal
            weight = self.WEIGHTS.get(layer_name, 0.1)
            total += score * weight
            total_weight += weight

        if total_weight > 0:
            weighted_score = total / total_weight
        else:
            weighted_score = 50

        # Apply minimum floors based on lyrics certainty
        # If lyrics match is very strong, don't let other weak signals drag it below a floor
        if exact_lyrics_match:
            weighted_score = max(weighted_score, self.LYRICS_CERTAINTY_FLOOR + 4)
        elif lyrics_match_score is not None:
            if lyrics_match_score >= 95:
                weighted_score = max(weighted_score, self.LYRICS_CERTAINTY_FLOOR)
            elif lyrics_match_score >= 85:
                weighted_score = max(weighted_score, self.LYRICS_CERTAINTY_FLOOR - 5)
            elif lyrics_match_score >= 70:
                weighted_score = max(weighted_score, self.LYRICS_LIKELY_FLOOR)
            elif lyrics_match_score >= 50:
                weighted_score = max(weighted_score, 52)

        # Apply credibility ceiling: if artist credibility is very low, cap the score
        credibility = layers.get("artist_credibility", 75)
        if credibility < 30:
            weighted_score = min(weighted_score, 45)
        elif credibility < 50:
            weighted_score = min(weighted_score, 65)

        return weighted_score


# Module-level singleton
confidence_calculator = ConfidenceCalculator()

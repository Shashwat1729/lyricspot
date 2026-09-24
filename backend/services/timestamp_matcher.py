"""
Timestamp matching service for LyricSpot.
Uses RapidFuzz to align transcribed lyrics against synced lyric lines.
"""

import re
from typing import Optional, List, Dict

from rapidfuzz import fuzz


# Common phonetic equivalences in romanized Hindi/multilingual lyrics
_PHONETIC_NORMALIZATIONS = [
    (r'\btoo\b', 'tu'),
    (r'\bmein\b', 'main'),
    (r'\bmai\b', 'main'),
    (r'\bhain\b', 'hai'),
    (r'\bkee\b', 'ki'),
    (r'\bhee\b', 'hi'),
    (r'\bsaaree\b', 'sari'),
    (r'\bdekho\b', 'dekho'),
    (r'\bnahi\b', 'nahi'),
    (r'\bnahin\b', 'nahi'),
]


def _normalize_phonetic(text: str, language: Optional[str] = None) -> str:
    """Normalize common romanization variants for better fuzzy matching.

    Hindi-specific rules apply only when the language is unknown or Hindi
    (e.g. "hi", "hi-Latn"). They are never forced onto other languages.
    """
    text = text.lower().strip()
    lang = (language or "").lower()
    apply_hindi = not lang or lang.startswith("hi")
    if not apply_hindi:
        return text
    for pattern, replacement in _PHONETIC_NORMALIZATIONS:
        text = re.sub(pattern, replacement, text)
    return text


def _score_line(
    transcript_lower: str,
    transcript_normalized: str,
    line_text: str,
    language: Optional[str] = None,
) -> int:
    """Score one lyric line with the standard multi-metric combination."""
    line_normalized = _normalize_phonetic(line_text, language)
    score = max(fuzz.ratio(transcript_lower, line_text),
                fuzz.ratio(transcript_normalized, line_normalized))
    partial_score = max(fuzz.partial_ratio(transcript_lower, line_text),
                        fuzz.partial_ratio(transcript_normalized, line_normalized))
    token_score = max(fuzz.token_sort_ratio(transcript_lower, line_text),
                      fuzz.token_sort_ratio(transcript_normalized, line_normalized))
    token_set_score = max(fuzz.token_set_ratio(transcript_lower, line_text),
                          fuzz.token_set_ratio(transcript_normalized, line_normalized))
    effective = max(score, partial_score, token_score, token_set_score)
    if effective == token_set_score and len(line_text) > len(transcript_lower) * 1.3:
        effective = max(score, partial_score, token_score)
    return int(effective)


class TimestampMatcher:
    """Finds the best matching lyric line and its timestamp using fuzzy matching."""

    def find_match(
        self, transcript: str, lyrics_lines: List[Dict], language: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Compare transcript against every lyric line to find the best match.
        Always returns the best match found (never None if lyrics exist).

        Args:
            transcript: Transcribed text from user's singing
            lyrics_lines: List of dicts with 'timestamp_seconds' and 'text'
            language: Whisper-detected language tag (gates phonetic rules)

        Returns:
            Dict with matched_line, timestamp, confidence
        """
        if not transcript or not lyrics_lines:
            return None

        transcript_lower = transcript.lower().strip()
        transcript_normalized = _normalize_phonetic(transcript, language)
        # Extract words for cheap pre-filter
        transcript_words = set(transcript_lower.split())
        best_match = None
        best_score = 0

        # Pre-filter: only match lines sharing at least one word with transcript
        # If no lines pass, fall back to all lines (handles complete mismatch gracefully)
        filtered_lines = [
            line for line in lyrics_lines
            if line.get("text", "").strip() and len(line.get("text", "").strip()) >= 3
            and set(line.get("text", "").lower().split()) & transcript_words
        ]
        if not filtered_lines:
            filtered_lines = [ln for ln in lyrics_lines if ln.get("text", "").strip() and len(ln.get("text", "").strip()) >= 3]

        # Pre-compute normalized text for all filtered lines
        precomputed = [(line, line.get("text", "").lower().strip(), _normalize_phonetic(line.get("text", "").lower().strip(), language)) for line in filtered_lines]

        for line, line_text, line_normalized in precomputed:

            # Multiple matching strategies (run on both raw and normalized text)
            score = max(fuzz.ratio(transcript_lower, line_text),
                       fuzz.ratio(transcript_normalized, line_normalized))
            partial_score = max(fuzz.partial_ratio(transcript_lower, line_text),
                              fuzz.partial_ratio(transcript_normalized, line_normalized))
            # Token sort handles word reordering
            token_score = max(fuzz.token_sort_ratio(transcript_lower, line_text),
                            fuzz.token_sort_ratio(transcript_normalized, line_normalized))
            # Token set handles extra/missing words
            token_set_score = max(fuzz.token_set_ratio(transcript_lower, line_text),
                                fuzz.token_set_ratio(transcript_normalized, line_normalized))

            effective_score = max(score, partial_score, token_score, token_set_score)

            # Penalize token_set_score when line is much longer than transcript
            # (prevents inflated scores from lines with repeated/extra words)
            if effective_score == token_set_score and len(line_text) > len(transcript_lower) * 1.3:
                effective_score = max(score, partial_score, token_score)

            if effective_score > best_score:
                best_score = effective_score
                best_match = {
                    "matched_line": line.get("text", ""),
                    "timestamp": line.get("timestamp_seconds", line.get("timestamp", 0)),
                    "confidence": int(effective_score),
                }
                # Early exit on very high confidence match
                if best_score >= 95:
                    break
            elif best_match:
                candidate_ts = line.get("timestamp_seconds", line.get("timestamp", 0))
                # Prefer earlier occurrence if:
                # 1. Same score (exact tie), OR
                # 2. Score is very close (within 3 pts) AND the lines are textually
                #    very similar (>85% ratio) — handles "Tu"/"Too" type variations
                if candidate_ts < best_match["timestamp"]:
                    is_same_score = (effective_score == best_score)
                    is_near_score = (effective_score >= best_score - 3)
                    lines_similar = fuzz.ratio(
                        line.get("text", "").lower().strip(),
                        best_match["matched_line"].lower().strip()
                    ) > 85
                    if is_same_score or (is_near_score and lines_similar):
                        best_score = effective_score
                        best_match = {
                            "matched_line": line.get("text", ""),
                            "timestamp": candidate_ts,
                            "confidence": int(effective_score),
                        }

        # Also try matching against consecutive line pairs (skip if already high confidence)
        if best_score < 95:
            for i in range(len(filtered_lines) - 1):
                text_a = filtered_lines[i].get("text", "")
                text_b = filtered_lines[i + 1].get("text", "")
                combined_text = (text_a + " " + text_b).lower().strip()
                if not combined_text or len(combined_text) < 3:
                    continue

                # Cheap pre-filter: skip pairs sharing no words with transcript
                combined_words = set(combined_text.split())
                if not transcript_words & combined_words and best_score > 0:
                    continue

                combined_normalized = _normalize_phonetic(combined_text, language)
                score = fuzz.ratio(transcript_normalized, combined_normalized)
                partial_score = fuzz.partial_ratio(transcript_normalized, combined_normalized)
                token_set_score = fuzz.token_set_ratio(transcript_normalized, combined_normalized)
                effective_score = max(score, partial_score, token_set_score)

                if effective_score > best_score:
                    best_score = effective_score
                    best_match = {
                        "matched_line": text_a,
                        "timestamp": filtered_lines[i].get("timestamp_seconds", filtered_lines[i].get("timestamp", 0)),
                        "confidence": int(effective_score),
                    }
                    if best_score >= 90:
                        break  # Early termination on high-confidence pair match

        # If best match timestamp is 0 and confidence is low,
        # try to find a better non-zero timestamp match
        if best_match and best_match["timestamp"] == 0 and best_match["confidence"] < 60:
            # Look for the best match that's NOT at the start
            second_best = None
            second_score = 0
            for line in lyrics_lines:
                ts = line.get("timestamp_seconds", line.get("timestamp", 0))
                if ts < 10:  # Skip intro lines
                    continue
                line_text = line.get("text", "").lower().strip()
                if not line_text or len(line_text) < 3:
                    continue
                score = max(
                    fuzz.partial_ratio(transcript_lower, line_text),
                    fuzz.token_set_ratio(transcript_lower, line_text),
                )
                if score > second_score:
                    second_score = score
                    second_best = {
                        "matched_line": line.get("text", ""),
                        "timestamp": ts,
                        "confidence": int(score),
                    }
            # If the non-intro match is close enough, prefer it
            if second_best and second_score >= best_score * 0.7:
                best_match = second_best

        # Add lyrics context (surrounding lines around the match)
        if best_match and lyrics_lines:
            matched_text = best_match.get("matched_line", "").lower().strip()
            matched_ts = best_match.get("timestamp", 0)
            match_idx = None
            # Find by timestamp first (exact line), fall back to text match
            for i, line in enumerate(lyrics_lines):
                ts = line.get("timestamp_seconds", line.get("timestamp", 0))
                if ts == matched_ts and line.get("text", "").lower().strip() == matched_text:
                    match_idx = i
                    break
            if match_idx is None:
                for i, line in enumerate(lyrics_lines):
                    if line.get("text", "").lower().strip() == matched_text:
                        match_idx = i
                        break
            if match_idx is not None:
                context_before = [lyrics_lines[j].get("text", "") for j in range(max(0, match_idx - 2), match_idx)]
                context_after = [lyrics_lines[j].get("text", "") for j in range(match_idx + 1, min(len(lyrics_lines), match_idx + 3))]
                best_match["lyrics_context"] = {
                    "before": context_before,
                    "matched": best_match["matched_line"],
                    "after": context_after,
                }

        return best_match

    def find_occurrences(
        self,
        transcript: str,
        lyrics_lines: List[Dict],
        language: Optional[str] = None,
        min_score: int = 70,
        dedupe_seconds: float = 5.0,
    ) -> List[Dict]:
        """Find all strong occurrences of the transcript in synced lyrics.

        Repeated choruses produce multiple near-identical lines at different
        timestamps; returning only one can look like a wrong answer. This
        scores every line with the same multi-metric combination as
        find_match, keeps lines at or above min_score, deduplicates
        timestamps within dedupe_seconds, and ranks deterministically by
        (-score, timestamp).

        Args:
            transcript: Transcribed text from user's singing
            lyrics_lines: List of dicts with 'timestamp_seconds' and 'text'
            language: Whisper-detected language tag (gates phonetic rules)
            min_score: Minimum match score (0-100) to include
            dedupe_seconds: Timestamps closer than this are one occurrence

        Returns:
            List of {"timestamp": float, "match_score": int, "matched_line": str}
        """
        if not transcript or not lyrics_lines:
            return []

        transcript_lower = transcript.lower().strip()
        if len(transcript_lower) < 3:
            return []
        transcript_normalized = _normalize_phonetic(transcript, language)

        scored = []
        for line in lyrics_lines:
            text = (line.get("text") or "").strip()
            if not text or len(text) < 3:
                continue
            try:
                ts = float(line.get("timestamp_seconds", line.get("timestamp", 0)) or 0)
            except (TypeError, ValueError):
                ts = 0.0
            score = _score_line(transcript_lower, transcript_normalized, text.lower().strip(), language)
            if score >= min_score:
                scored.append({"timestamp": ts, "match_score": int(score), "matched_line": text})

        # Deterministic rank: best score first, then earliest timestamp.
        scored.sort(key=lambda o: (-o["match_score"], o["timestamp"]))

        # Deduplicate near-identical timestamps (same occurrence).
        deduped = []
        for occ in scored:
            if all(abs(occ["timestamp"] - kept["timestamp"]) > dedupe_seconds for kept in deduped):
                deduped.append(occ)

        return deduped

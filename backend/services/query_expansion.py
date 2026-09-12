"""Query normalization and expansion for lyric search.

Whisper output for singing is an uncertain sensor reading, not ground truth.
Searching a single raw transcript (especially one containing a mishearing like
"cheese" instead of "trees") collapses recall. This module normalizes the
transcript and generates a small set of complementary search variants:

- normalized full transcript (punctuation/whitespace cleaned)
- phrase-prefix variant for long transcripts (first ~12 words)
- deduplicated/stutter-cleaned variant ("hello hello hello" -> "hello")
- lyrics-suffixed variant for short, ambiguous queries

Variant count is deliberately capped (default 3) to keep the existing
parallel search fan-out efficient. Language-specific normalization is
gated on the detected language; generic cleanup is language-agnostic.
"""

import re

MAX_VARIANTS = 3
PHRASE_PREFIX_WORDS = 12
SHORT_QUERY_WORDS = 10


def normalize_query(text: str) -> str:
    """Lowercase, strip punctuation (keep apostrophes), collapse whitespace."""
    if not text:
        return ""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s']", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def deduplicate_words(text: str) -> str:
    """Collapse consecutive repeated words (stutter/repetition from singing)."""
    if not text:
        return ""
    words = text.split()
    deduped = [words[0]]
    for word in words[1:]:
        if word != deduped[-1]:
            deduped.append(word)
    return " ".join(deduped)


def expand_queries(transcript: str, language: str | None = None, max_variants: int = MAX_VARIANTS) -> list[str]:
    """Generate a small, ordered list of search query variants.

    Args:
        transcript: Raw (sanitized) transcript text.
        language: BCP-47-ish language tag from Whisper (e.g. "en", "hi").
            Reserved for future language-specific normalization; generic
            cleanup below is language-agnostic and safe for all inputs.
        max_variants: Hard cap on returned variants.

    Returns:
        Ordered, deduplicated list of query strings (longest/most
        informative first).
    """
    _ = language  # Reserved: language-gated normalization lives here.
    base = normalize_query(transcript)
    if not base:
        return []

    words = base.split()
    variants: list[str] = [base]

    deduped = deduplicate_words(base)
    if deduped and deduped != base:
        variants.append(deduped)

    if len(words) > PHRASE_PREFIX_WORDS:
        variants.append(" ".join(words[:PHRASE_PREFIX_WORDS]))

    if len(words) <= SHORT_QUERY_WORDS and not base.endswith("lyrics"):
        variants.append(f"{base} lyrics")

    # Deduplicate preserving order, then cap.
    seen: set[str] = set()
    ordered: list[str] = []
    for variant in variants:
        variant = variant.strip()
        if variant and variant not in seen:
            seen.add(variant)
            ordered.append(variant)

    return ordered[:max(1, max_variants)]

"""
Title cleaning utility for LyricSpot.
Parses and cleans noisy video/song titles into structured song + artist data.
"""

import re


def _fix_mojibake(text: str) -> str:
    """Attempt to fix UTF-8 double-encoded as Latin-1 (common in yt-dlp data)."""
    try:
        fixed = text.encode('latin-1').decode('utf-8')
        if fixed != text:
            return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return text


def clean_title(raw_title: str, channel: str = "") -> dict:
    """
    Clean a raw video/search title into structured song and artist info.

    Examples:
        "Adele - Hello (Official Video)" → {"song": "Hello", "artist": "Adele"}
        "Kashmir Mein Tu Kanyakumari Full Video Song | Chennai Express"
            → {"song": "Kashmir Mein Tu Kanyakumari", "artist": "Chennai Express"}

    Args:
        raw_title: Raw title string from YouTube/search results

    Returns:
        Dict with 'song' and 'artist' keys
    """
    title = _fix_mojibake(raw_title.strip())

    # Remove common noise patterns (case-insensitive)
    noise_patterns = [
        r"\(Official\s*(Music\s*)?Video\)",
        r"\(Official\s*Audio\)",
        r"\(Lyrics?\s*Video\)",
        r"\(Lyrics?\)",
        r"\(Live\s*.*?\)",
        r"\(Acoustic\s*.*?\)",
        r"\(HD\)",
        r"\(HQ\)",
        r"\(4K\)",
        r"\(Audio\)",
        r"\[Official\s*(Music\s*)?Video\]",
        r"\[Lyrics?\]",
        r"\[Live\]",
        r"\[HD\]",
        r"\[HQ\]",
        r"\[4K\]",
        r"\[Audio\]",
        r"Official\s*(Music\s*)?Video",
        r"Official\s*Audio",
        r"Lyrics?\s*Video",
        r"\bLyrics?\b",
        r"\bHD\b",
        r"\b4K\b",
        r"\bHQ\b",
        r"\bRemix\b",
        r"\bft\.?\s+.*",
        r"\bfeat\.?\s+.*",
        r"\bvevo\b",
        r"\bFull\s*(Video\s*)?Song\b",
        r"\bVideo\s*Song\b",
        r"\bFull\s*Song\b",
        r"\bFull\s*Audio\b",
        r"\bAudio\s*Song\b",
        r"\bvideo\b",
        r"[🎤🎵🎶🎧🔥💯👑❤️]",
        r"[ð\x00-\x1f]",  # Broken emoji bytes
    ]

    for pattern in noise_patterns:
        title = re.sub(pattern, "", title, flags=re.IGNORECASE)

    # Clean up extra whitespace, stray characters, and trailing punctuation
    title = re.sub(r"[\\]", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    title = re.sub(r"[\|\-\–\—]\s*$", "", title).strip()
    title = re.sub(r"^\s*[\|\-\–\—]", "", title).strip()

    # Try pipe separator first: "Song | Artist/Label" (Bollywood/Indian format)
    if " | " in title:
        parts = [p.strip() for p in title.split("|") if p.strip()]
        if len(parts) >= 2:
            return {"song": parts[0], "artist": parts[1]}

    # Try to split into artist - song (most common YouTube format)
    separators = [" - ", " – ", " — "]
    for sep in separators:
        if sep in title:
            parts = title.split(sep, 1)
            if len(parts) == 2:
                artist = parts[0].strip()
                song = parts[1].strip()
                # Remove any remaining brackets
                song = re.sub(r"[\(\[\{].*?[\)\]\}]", "", song).strip()
                artist = re.sub(r"[\(\[\{].*?[\)\]\}]", "", artist).strip()
                if artist and song:
                    return {"song": song, "artist": artist}

    # Try "Song Name by Artist" pattern
    by_match = re.match(r"^(.+?)\s+by\s+(.+)$", title, re.IGNORECASE)
    if by_match:
        song = by_match.group(1).strip()
        artist = by_match.group(2).strip()
        if song and artist:
            return {"song": song, "artist": artist}

    # Try pipe-separated: "Song | Artist | Movie" (common in Bollywood)
    if "|" in title:
        parts = [p.strip() for p in title.split("|") if p.strip()]
        if len(parts) >= 2:
            return {"song": parts[0], "artist": parts[1]}

    # If no separator found, return title as song
    clean = re.sub(r"[\(\[\{].*?[\)\]\}]", "", title).strip()
    # Remove trailing/leading dashes and pipes
    clean = re.sub(r"^[\-\|]+|[\-\|]+$", "", clean).strip()
    # Use channel name as fallback artist
    fallback_artist = channel.strip() if channel else ""
    return {"song": clean if clean else raw_title.strip(), "artist": fallback_artist}

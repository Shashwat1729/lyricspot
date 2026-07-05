"""Tests for title_cleaner, timestamp_matcher, and spotify_linker."""
import sys
import pytest

sys.path.insert(0, ".")

from utils.title_cleaner import clean_title
from services.timestamp_matcher import TimestampMatcher


class TestTitleCleaner:
    @pytest.mark.parametrize("title,expected_song,expected_artist", [
        ("Adele - Hello (Official Video)", "Hello", "Adele"),
        ("Adele - Hello [Official Music Video] HD", "Hello", "Adele"),
        ("Kashmir Mein Tu Kanyakumari Full Video Song | Chennai Express", "Kashmir Mein Tu Kanyakumari", "Chennai Express"),
        ("Rick Astley - Never Gonna Give You Up", "Never Gonna Give You Up", "Rick Astley"),
        ("Queen - Bohemian Rhapsody (Official Video)", "Bohemian Rhapsody", "Queen"),
        ("Sunidhi Chauhan - Sheila Ki Jawani Full Song", "Sheila Ki Jawani", "Sunidhi Chauhan"),
        ("Shape of You by Ed Sheeran", "Shape of You", "Ed Sheeran"),
        ("Despacito", "Despacito", ""),
    ])
    def test_title_cleaning(self, title, expected_song, expected_artist):
        result = clean_title(title)
        assert result["song"] == expected_song, f"Song mismatch for '{title}': got '{result['song']}'"
        assert result["artist"] == expected_artist, f"Artist mismatch for '{title}': got '{result['artist']}'"


class TestTimestampMatcher:
    @pytest.fixture
    def matcher(self):
        return TimestampMatcher()

    @pytest.fixture
    def lyrics(self):
        return [
            {"timestamp_seconds": 0, "text": "Hello, it's me"},
            {"timestamp_seconds": 15, "text": "I was wondering if after all these years"},
            {"timestamp_seconds": 30, "text": "You'd like to meet"},
            {"timestamp_seconds": 42, "text": "To go over everything"},
            {"timestamp_seconds": 55, "text": "They say that time's supposed to heal ya"},
            {"timestamp_seconds": 63, "text": "But I ain't done much healing"},
            {"timestamp_seconds": 79, "text": "Hello from the other side"},
            {"timestamp_seconds": 88, "text": "I must have called a thousand times"},
        ]

    @pytest.mark.parametrize("transcript,expected_ts,min_conf", [
        ("hello from the other side", 79, 90),
        ("I must have called a thousand times", 88, 90),
        ("hello it's me", 0, 80),
        ("time supposed to heal", 55, 60),
    ])
    def test_match(self, matcher, lyrics, transcript, expected_ts, min_conf):
        result = matcher.find_match(transcript, lyrics)
        assert result is not None, f"No match found for '{transcript}'"
        assert result["timestamp"] == expected_ts, f"Timestamp mismatch: got {result['timestamp']}, expected {expected_ts}"
        assert result["confidence"] >= min_conf, f"Confidence too low: {result['confidence']} < {min_conf}"

    def test_no_match_returns_best_guess(self, matcher, lyrics):
        """Even nonsense input returns a result (best guess)."""
        result = matcher.find_match("xyzzy gibberish nothing", lyrics)
        # Should still return something (we never return None anymore)
        assert result is not None

    def test_prefers_first_occurrence(self, matcher):
        """When same line repeats, prefers the first occurrence."""
        lyrics = [
            {"timestamp_seconds": 63, "text": "Kashmir Main Tu Kanyakumari"},
            {"timestamp_seconds": 153, "text": "Kashmir Main Tu Kanyakumari"},
            {"timestamp_seconds": 225, "text": "Kashmir Main Tu Kanyakumari"},
        ]
        result = matcher.find_match("kashmir mein tu kanyakumari", lyrics)
        assert result is not None
        assert result["timestamp"] == 63, f"Should prefer first occurrence, got {result['timestamp']}"

    def test_empty_lyrics(self, matcher):
        result = matcher.find_match("hello", [])
        assert result is None

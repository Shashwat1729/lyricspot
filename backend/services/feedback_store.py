"""
Feedback learning store — lightweight SQLite-backed system that records
user thumbs-up/down on identification results and uses that history to
boost or penalize future candidates for similar queries.
"""

import hashlib
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

_DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_DB_PATH = os.path.join(_DB_DIR, "feedback.db")
_lock = threading.Lock()


def _normalize(text: str) -> str:
    """Normalize text for comparison: lowercase, strip punctuation, collapse spaces."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _query_hash(normalized_query: str) -> str:
    return hashlib.sha256(normalized_query.encode()).hexdigest()[:16]


def _token_overlap(a: str, b: str) -> float:
    """Compute Jaccard-like token overlap ratio between two normalized strings."""
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


class FeedbackStore:
    """Thread-safe SQLite feedback store."""

    def __init__(self, db_path: Optional[str] = None):
        self._db_path = db_path or _DB_PATH
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with _lock:
            conn = self._get_conn()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS feedback (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        query_normalized TEXT NOT NULL,
                        query_hash TEXT NOT NULL,
                        song_title TEXT NOT NULL,
                        artist TEXT NOT NULL DEFAULT '',
                        action TEXT NOT NULL CHECK(action IN ('up', 'down')),
                        created_at REAL NOT NULL
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_feedback_hash
                    ON feedback(query_hash)
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_feedback_song
                    ON feedback(song_title, artist)
                """)
                conn.commit()
            finally:
                conn.close()

    def record_feedback(self, query: str, song: str, artist: str, action: str) -> None:
        """Record a thumbs-up or thumbs-down for a result."""
        if action not in ("up", "down"):
            return
        normalized = _normalize(query)
        qhash = _query_hash(normalized)
        with _lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    "INSERT INTO feedback (query_normalized, query_hash, song_title, artist, action, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (normalized, qhash, song, artist, action, time.time()),
                )
                conn.commit()
            finally:
                conn.close()
        logger.info(f"Feedback recorded: {action} for '{song}' on query '{query[:50]}'")

    def get_boost(self, query: str, song: str, artist: str) -> int:
        """
        Get a confidence adjustment based on historical feedback for similar queries.
        Returns a value from -20 to +20.
        """
        normalized = _normalize(query)
        qhash = _query_hash(normalized)
        song_lower = song.lower().strip()
        artist_lower = (artist or "").lower().strip()

        try:
            conn = self._get_conn()
            try:
                # Exact query match
                rows = conn.execute(
                    "SELECT action, song_title, artist FROM feedback WHERE query_hash = ?",
                    (qhash,),
                ).fetchall()

                score = 0
                for row in rows:
                    row_song = row["song_title"].lower().strip()
                    row_artist = (row["artist"] or "").lower().strip()
                    is_same_song = (row_song == song_lower) or (
                        row_artist == artist_lower and row_artist != ""
                    )
                    if is_same_song:
                        if row["action"] == "up":
                            score += 8
                        else:
                            score -= 8

                # If no exact match, check similar queries
                if score == 0:
                    recent = conn.execute(
                        "SELECT query_normalized, action, song_title, artist FROM feedback ORDER BY created_at DESC LIMIT 200"
                    ).fetchall()
                    for row in recent:
                        overlap = _token_overlap(normalized, row["query_normalized"])
                        if overlap >= 0.6:
                            row_song = row["song_title"].lower().strip()
                            row_artist = (row["artist"] or "").lower().strip()
                            is_same_song = (row_song == song_lower) or (
                                row_artist == artist_lower and row_artist != ""
                            )
                            if is_same_song:
                                if row["action"] == "up":
                                    score += 5
                                else:
                                    score -= 5

                return max(-20, min(20, score))
            finally:
                conn.close()
        except Exception as e:
            logger.debug(f"Feedback boost error: {e}")
            return 0

    def get_similar_query_results(self, query: str) -> List[Dict]:
        """Find past successful (thumbs-up) identifications for similar queries."""
        normalized = _normalize(query)
        results = []
        try:
            conn = self._get_conn()
            try:
                rows = conn.execute(
                    "SELECT DISTINCT query_normalized, song_title, artist FROM feedback WHERE action = 'up' ORDER BY created_at DESC LIMIT 100"
                ).fetchall()
                for row in rows:
                    overlap = _token_overlap(normalized, row["query_normalized"])
                    if overlap >= 0.5:
                        results.append({
                            "song": row["song_title"],
                            "artist": row["artist"],
                            "overlap": overlap,
                        })
            finally:
                conn.close()
        except Exception as e:
            logger.debug(f"Similar query lookup error: {e}")
        return sorted(results, key=lambda x: x["overlap"], reverse=True)[:5]

    def get_stats(self) -> Dict:
        """Return feedback statistics."""
        try:
            conn = self._get_conn()
            try:
                total = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
                ups = conn.execute("SELECT COUNT(*) FROM feedback WHERE action='up'").fetchone()[0]
                downs = conn.execute("SELECT COUNT(*) FROM feedback WHERE action='down'").fetchone()[0]
                unique_queries = conn.execute("SELECT COUNT(DISTINCT query_hash) FROM feedback").fetchone()[0]
                return {
                    "total_feedback": total,
                    "thumbs_up": ups,
                    "thumbs_down": downs,
                    "unique_queries": unique_queries,
                }
            finally:
                conn.close()
        except Exception as e:
            logger.debug(f"Feedback stats error: {e}")
            return {"total_feedback": 0, "thumbs_up": 0, "thumbs_down": 0, "unique_queries": 0}

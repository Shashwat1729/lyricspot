"""
Whisper-based audio transcription service for ContinueMySong AI.
Transcribes sung lyrics from audio files.
"""
import logging
import math

import os
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path

import whisper


@dataclass
class TranscriptionResult:
    """Structured Whisper transcription with uncertainty preserved.

    confidence is a heuristic 0..1 score (duration-weighted exp(avg_logprob)
    penalized by no-speech probability). It is NOT a calibrated probability.
    """

    text: str = ""
    language: Optional[str] = None
    confidence: float = 0.0
    segments: list = field(default_factory=list)
    duration: float = 0.0
    no_speech_probability: float = 1.0


class TranscriptionService:
    """
    Audio transcription service using OpenAI's Whisper model.
    
    Uses lazy singleton pattern - model is loaded on first transcription request.
    """

    _instance: Optional["TranscriptionService"] = None
    _model = None  # Class-level model cache (shared across instances)

    def __new__(cls) -> "TranscriptionService":
        """Singleton pattern implementation."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        """Initialize transcription service."""
        # Only set model name on first initialization
        if not hasattr(self, '_model_name'):
            self._model_name = os.getenv("WHISPER_MODEL", "base")

    def _load_model(self):
        """
        Lazy load the Whisper model.
        
        Model is loaded on first use to avoid startup delay.
        
        Returns:
            Loaded Whisper model
        """
        if self._model is None:
            logging.getLogger(__name__).info(f"Loading Whisper model: {self._model_name}")
            self._model = whisper.load_model(self._model_name)
            logging.getLogger(__name__).info("Whisper model loaded successfully")
        return self._model

    def transcribe(self, wav_path: str) -> str:
        """
        Transcribe audio file to text.

        Kept for backward compatibility — delegates to transcribe_result()
        and returns only the cleaned text.

        Args:
            wav_path: Path to WAV audio file

        Returns:
            Transcribed text string, or empty string if transcription fails

        Raises:
            FileNotFoundError: If audio file doesn't exist
        """
        return self.transcribe_result(wav_path).text

    def transcribe_result(self, wav_path: str) -> TranscriptionResult:
        """
        Transcribe audio file, preserving Whisper uncertainty signals.

        Whisper is treated as an uncertain sensor: segment-level avg_logprob,
        no_speech_prob, durations, and the detected language are preserved
        instead of collapsing everything to a bare string.

        Args:
            wav_path: Path to WAV audio file

        Returns:
            TranscriptionResult with text, language, heuristic confidence,
            segments, duration, and no-speech probability.

        Raises:
            FileNotFoundError: If audio file doesn't exist
        """
        wav_path = Path(wav_path)

        if not wav_path.exists():
            raise FileNotFoundError(f"Audio file not found: {wav_path}")

        try:
            model = self._load_model()

            # Transcribe with Whisper
            # fp16=False for CPU compatibility
            # language=None keeps auto-detection; detected language is preserved
            result = model.transcribe(
                str(wav_path),
                fp16=False,  # Use FP32 for CPU compatibility
                language=None,  # Auto-detect language
                task="transcribe"
            ) or {}

            return self._build_result(result)

        except Exception as e:
            logging.getLogger(__name__).error(f"Transcription error: {e}")
            return TranscriptionResult()

    @staticmethod
    def _build_result(result: dict) -> TranscriptionResult:
        """Build a TranscriptionResult from a raw Whisper result dict, defensively."""
        if not isinstance(result, dict):
            return TranscriptionResult()

        language = result.get("language")
        if language is not None:
            language = str(language).strip().lower() or None

        raw_segments = result.get("segments")
        segments = raw_segments if isinstance(raw_segments, list) else []

        cleaned_segments = []
        total_duration = 0.0
        weighted_logprob = 0.0
        no_speech_values = []
        fallback_text_parts = []

        for seg in segments:
            if not isinstance(seg, dict):
                continue
            try:
                start = float(seg.get("start", 0.0) or 0.0)
            except (TypeError, ValueError):
                start = 0.0
            try:
                end = float(seg.get("end", start) or start)
            except (TypeError, ValueError):
                end = start
            duration = max(0.0, end - start)

            try:
                avg_logprob = float(seg.get("avg_logprob", -1.0))
            except (TypeError, ValueError):
                avg_logprob = -1.0
            if not math.isfinite(avg_logprob):
                avg_logprob = -1.0

            try:
                no_speech = float(seg.get("no_speech_prob", 0.0))
            except (TypeError, ValueError):
                no_speech = 0.0
            if not math.isfinite(no_speech):
                no_speech = 0.0
            no_speech = min(max(no_speech, 0.0), 1.0)

            seg_text = seg.get("text", "")
            seg_text = seg_text if isinstance(seg_text, str) else str(seg_text)
            if seg_text.strip():
                fallback_text_parts.append(seg_text.strip())

            cleaned_segments.append({
                "start": start,
                "end": end,
                "avg_logprob": avg_logprob,
                "no_speech_prob": no_speech,
                "text": seg_text.strip(),
            })
            total_duration += duration
            weighted_logprob += avg_logprob * duration
            no_speech_values.append(no_speech)

        raw_text = result.get("text", "")
        raw_text = raw_text if isinstance(raw_text, str) else str(raw_text)
        text = TranscriptionService._clean_static(raw_text)
        if not text and fallback_text_parts:
            text = TranscriptionService._clean_static(" ".join(fallback_text_parts))

        if total_duration > 0:
            mean_logprob = weighted_logprob / total_duration
        elif cleaned_segments:
            mean_logprob = sum(s["avg_logprob"] for s in cleaned_segments) / len(cleaned_segments)
        else:
            mean_logprob = -1.0

        try:
            token_confidence = math.exp(mean_logprob)
        except (OverflowError, ValueError):
            token_confidence = 0.0
        token_confidence = min(max(token_confidence, 0.0), 1.0)

        avg_no_speech = (
            sum(no_speech_values) / len(no_speech_values)
            if no_speech_values else 1.0
        )

        # Heuristic only: penalize likely-silence; empty text forces 0.
        confidence = token_confidence * (1.0 - min(max(avg_no_speech, 0.0), 0.8))
        if not text:
            confidence = 0.0

        return TranscriptionResult(
            text=text,
            language=language,
            confidence=round(float(confidence), 4),
            segments=cleaned_segments,
            duration=round(float(total_duration), 3),
            no_speech_probability=round(float(avg_no_speech), 4),
        )

    @staticmethod
    def _clean_static(text: str) -> str:
        """Shared artifact cleanup usable without an instance."""
        if not text:
            return ""
        artifacts = [
            "[Music]",
            "[Applause]",
            "[Laughter]",
            "(Music)",
            "(Applause)",
            "♪",
            "♫",
            "[BLANK_AUDIO]",
            "[MUSIC PLAYING]",
            "[SINGING]",
        ]
        for artifact in artifacts:
            text = text.replace(artifact, "")
        return " ".join(text.split()).strip()

    def _clean_transcription(self, text: str) -> str:
        """
        Clean up common Whisper transcription artifacts.
        
        Args:
            text: Raw transcription text
            
        Returns:
            Cleaned text
        """
        return self._clean_static(text)

    def transcribe_with_timestamps(self, wav_path: str) -> list:
        """
        Transcribe audio with word-level timestamps.
        
        Args:
            wav_path: Path to WAV audio file
            
        Returns:
            List of segments with timestamps: [{"start": float, "end": float, "text": str}, ...]
        """
        wav_path = Path(wav_path)

        if not wav_path.exists():
            raise FileNotFoundError(f"Audio file not found: {wav_path}")

        try:
            model = self._load_model()

            result = model.transcribe(
                str(wav_path),
                fp16=False,
                language=None,
                task="transcribe",
                word_timestamps=True
            )

            segments = []
            for segment in result.get("segments", []):
                segments.append({
                    "start": segment.get("start", 0),
                    "end": segment.get("end", 0),
                    "text": self._clean_transcription(segment.get("text", ""))
                })

            return segments

        except Exception as e:
            logging.getLogger(__name__).info(f"Transcription with timestamps error: {e}")
            return []

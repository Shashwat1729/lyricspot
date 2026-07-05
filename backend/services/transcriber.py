"""
Whisper-based audio transcription service for ContinueMySong AI.
Transcribes sung lyrics from audio files.
"""
import logging

import os
from typing import Optional
from pathlib import Path

import whisper


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
        
        Args:
            wav_path: Path to WAV audio file
            
        Returns:
            Transcribed text string, or empty string if transcription fails
            
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
            # language="en" can be set for English-only, but auto-detect is more flexible
            result = model.transcribe(
                str(wav_path),
                fp16=False,  # Use FP32 for CPU compatibility
                language=None,  # Auto-detect language
                task="transcribe"
            )
            
            text = result.get("text", "").strip()
            
            # Handle common Whisper artifacts
            text = self._clean_transcription(text)
            
            return text
            
        except Exception as e:
            logging.getLogger(__name__).error(f"Transcription error: {e}")
            return ""
    
    def _clean_transcription(self, text: str) -> str:
        """
        Clean up common Whisper transcription artifacts.
        
        Args:
            text: Raw transcription text
            
        Returns:
            Cleaned text
        """
        if not text:
            return ""
        
        # Remove common artifacts
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
        
        # Clean up extra whitespace
        text = " ".join(text.split())
        
        return text.strip()
    
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

"""
Audio processing service for ContinueMySong AI.
Handles conversion (webm → wav) and normalization using ffmpeg and librosa.
"""

import subprocess
import numpy as np
import librosa
import soundfile as sf


class AudioProcessor:
    """Handles audio format conversion and normalization."""

    @staticmethod
    def _validate_path(path: str) -> None:
        """Ensure path doesn't contain shell metacharacters (defense-in-depth)."""
        if not path or any(c in path for c in ';|&$`\n\r'):
            raise ValueError(f"Invalid file path: {path!r}")

    def convert_to_wav(self, input_path: str, output_path: str) -> None:
        """
        Convert any audio format to WAV (mono, 16kHz) using ffmpeg.

        Args:
            input_path: Path to input audio file (webm, mp3, etc.)
            output_path: Path for output WAV file
        """
        self._validate_path(input_path)
        self._validate_path(output_path)
        cmd = [
            "ffmpeg",
            "-y",              # Overwrite output
            "-i", input_path,  # Input file
            "-vn",             # No video
            "-acodec", "pcm_s16le",  # 16-bit PCM
            "-ar", "16000",    # 16kHz sample rate
            "-ac", "1",        # Mono
            output_path,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg conversion failed: {result.stderr[:500]}"
            )

    def normalize_audio(self, wav_path: str) -> None:
        """
        Normalize audio amplitude using librosa.
        Improves Whisper transcription accuracy for quiet recordings.

        Args:
            wav_path: Path to WAV file (modified in place)
        """
        # Load audio
        audio, sr = librosa.load(wav_path, sr=16000, mono=True)

        # Normalize amplitude to [-1, 1] range
        max_amplitude = np.max(np.abs(audio))
        # Silence gate: near-silent recordings must NOT be amplified —
        # boosting the noise floor makes Whisper hallucinate lyrics instead
        # of correctly reporting no-speech (see TranscriptionResult).
        if max_amplitude < 0.02:
            return
        if max_amplitude > 0:
            audio = audio / max_amplitude * 0.95  # Leave slight headroom

        # Save normalized audio back
        sf.write(wav_path, audio, sr)

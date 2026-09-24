/**
 * Voice capture helpers.
 *
 * Two paths, picked by the caller from backend capabilities:
 * - Live browser speech recognition (Web Speech API) with interim text,
 *   used when no Whisper backend is available (static site).
 * - Raw audio recording (MediaRecorder) with a live input level, uploaded
 *   to the backend for Whisper transcription.
 */

export const SPEECH_LANGUAGES: { code: string; label: string }[] = [
  { code: "en-US", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "es-ES", label: "Spanish" },
  { code: "pt-BR", label: "Portuguese" },
  { code: "fr-FR", label: "French" },
  { code: "ko-KR", label: "Korean" },
  { code: "ja-JP", label: "Japanese" },
];

const LANG_KEY = "lyricspot.speechLang";

export function getSpeechLang(): string {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    if (v && SPEECH_LANGUAGES.some((l) => l.code === v)) return v;
  } catch {
    // storage blocked
  }
  return "en-US";
}

export function setSpeechLang(code: string): void {
  try {
    window.localStorage.setItem(LANG_KEY, code);
  } catch {
    // storage blocked
  }
}

export function isSpeechRecognitionAvailable(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function isRecordingAvailable(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface SpeechSession {
  /** Stop listening and deliver the final transcript via onEnd. */
  stop: () => void;
  /** Stop listening and discard everything. */
  abort: () => void;
}

export interface SpeechCallbacks {
  /** Live text: finalized words + the current interim guess. */
  onText: (finalText: string, interim: string) => void;
  /** Recognition ended; transcript is everything finalized (plus any trailing interim). */
  onEnd: (transcript: string) => void;
  onError: (message: string) => void;
}

/** Human message for a SpeechRecognition error code. */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow it in your browser's site settings, or type the lyric instead.";
    case "no-speech":
      return "We didn't hear anything. Get closer to the mic and sing a clear line.";
    case "audio-capture":
      return "No microphone was found. Plug one in, or type the lyric instead.";
    case "network":
      return "Your browser's speech service is unreachable (it needs an internet connection). Type the lyric instead.";
    case "language-not-supported":
      return "Your browser can't recognise that language. Pick another one or type the lyric.";
    default:
      return "Voice recognition failed (" + code + "). Try again or type the lyric.";
  }
}

/**
 * Start continuous recognition with interim results. Returns null when the
 * API is missing. Text is rebuilt from the full result list on every event,
 * which avoids the duplicated phrases some engines emit with continuous mode.
 */
export function startSpeech(lang: string, cb: SpeechCallbacks): SpeechSession | null {
  const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.lang = lang;

  let finalText = "";
  let interim = "";
  let aborted = false;
  let errored = false;
  let ended = false;

  rec.onresult = (e: any) => {
    let fin = "";
    let tmp = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      const text = (r[0] && r[0].transcript) || "";
      if (r.isFinal) fin += text + " ";
      else tmp += text + " ";
    }
    finalText = fin.replace(/\s+/g, " ").trim();
    interim = tmp.replace(/\s+/g, " ").trim();
    cb.onText(finalText, interim);
  };
  rec.onerror = (e: any) => {
    const code = e?.error || "unknown";
    if (code === "aborted" || aborted) return;
    // "no-speech" after some words were already heard is just a pause.
    if (code === "no-speech" && (finalText || interim)) return;
    errored = true;
    cb.onError(speechErrorMessage(code));
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    if (aborted || errored) return;
    const transcript = (finalText + " " + interim).replace(/\s+/g, " ").trim();
    cb.onEnd(transcript);
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try { rec.stop(); } catch { /* already stopped */ }
    },
    abort: () => {
      aborted = true;
      try { rec.abort(); } catch { /* already stopped */ }
    },
  };
}

export interface Recording {
  stop: () => void;
  cancel: () => void;
}

export interface RecordingCallbacks {
  /** 0..1 input level, ~20 times per second. */
  onLevel: (level: number) => void;
  onDone: (blob: Blob, seconds: number) => void;
  onError: (message: string) => void;
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in your browser's site settings, or type the lyric instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Plug one in, or type the lyric instead.";
  if (name === "NotReadableError") return "Your microphone is busy in another app. Close it and try again.";
  return "Couldn't start the microphone. Try again, or type the lyric instead.";
}

/** Record raw audio with a live level meter. Rejects with a readable message. */
export async function startRecording(cb: RecordingCallbacks): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    throw new Error(micErrorMessage(err));
  }
  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
    (t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t)
  );
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Your browser can't record audio here. Type the lyric instead.");
  }

  // Level meter (best effort; recording works without it).
  let ctx: AudioContext | null = null;
  let raf = 0;
  try {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return;
      last = t;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      cb.onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    };
    raf = requestAnimationFrame(tick);
  } catch {
    ctx = null;
  }

  const chunks: Blob[] = [];
  const started = Date.now();
  let cancelled = false;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  };
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    cleanup();
    if (cancelled) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    cb.onDone(blob, (Date.now() - started) / 1000);
  };
  recorder.onerror = () => {
    cleanup();
    if (!cancelled) cb.onError("Recording failed (microphone error). Please try again.");
  };
  recorder.start(250);

  return {
    stop: () => {
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { cleanup(); }
      }
    },
    cancel: () => {
      cancelled = true;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* ignore */ }
      }
      cleanup();
    },
  };
}

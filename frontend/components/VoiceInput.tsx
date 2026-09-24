"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import type { BackendState } from "./App";
import {
  SPEECH_LANGUAGES,
  getSpeechLang,
  setSpeechLang,
  isRecordingAvailable,
  isSpeechRecognitionAvailable,
  startRecording,
  startSpeech,
  type Recording,
  type SpeechSession,
} from "@/lib/speech";

const MAX_SECONDS = 15;
const MIN_SECONDS = 3;

type Path = "checking" | "record" | "speech" | "none";
type State =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "finishing" }
  | { kind: "problem"; message: string; heard?: string };

/** Voice capture: Whisper upload when a backend has it, else live browser speech. */
export function VoiceInput({ backend, onTranscript, onAudio, onSwitchToText, onOpenSources, onActiveChange }: {
  backend: BackendState;
  /** true while the mic is live, so the page can make room on small screens. */
  onActiveChange?: (active: boolean) => void;
  onTranscript: (text: string) => void;
  onAudio: (blob: Blob) => void;
  onSwitchToText: (prefill?: string) => void;
  onOpenSources: () => void;
}) {
  const [path, setPath] = useState<Path>("checking");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [heardFinal, setHeardFinal] = useState("");
  const [heardInterim, setHeardInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [lang, setLang] = useState("en-US");

  const speechRef = useRef<SpeechSession | null>(null);
  const recRef = useRef<Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);

  useEffect(() => { setLang(getSpeechLang()); }, []);
  const active = state.kind === "listening" || state.kind === "finishing";
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  useEffect(() => {
    if (backend.status === "checking") { setPath("checking"); return; }
    if (backend.ok && backend.voice && isRecordingAvailable()) setPath("record");
    else if (isSpeechRecognitionAvailable()) setPath("speech");
    else setPath("none");
  }, [backend]);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Tear down any live capture when unmounting (tab switch, navigation).
  useEffect(() => () => {
    stopTimer();
    speechRef.current?.abort();
    recRef.current?.cancel();
  }, []);

  const stop = useCallback(() => {
    stopTimer();
    if (speechRef.current) {
      setState({ kind: "finishing" });
      speechRef.current.stop();
    } else if (recRef.current) {
      const secs = (Date.now() - startedRef.current) / 1000;
      if (secs < MIN_SECONDS) {
        recRef.current.cancel();
        recRef.current = null;
        setState({ kind: "problem", message: "That was too short. Sing for at least " + MIN_SECONDS + " seconds — a full line works best." });
        return;
      }
      setState({ kind: "finishing" });
      recRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    stopTimer();
    speechRef.current?.abort();
    speechRef.current = null;
    recRef.current?.cancel();
    recRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const startTimer = (onMax: () => void) => {
    startedRef.current = Date.now();
    setElapsed(0);
    stopTimer();
    timerRef.current = setInterval(() => {
      const s = (Date.now() - startedRef.current) / 1000;
      setElapsed(Math.min(s, MAX_SECONDS));
      if (s >= MAX_SECONDS) onMax();
    }, 200);
  };

  const start = useCallback(async () => {
    setHeardFinal("");
    setHeardInterim("");
    setLevel(0);
    if (path === "speech") {
      const session = startSpeech(lang, {
        onText: (fin, interim) => { setHeardFinal(fin); setHeardInterim(interim); },
        onEnd: (transcript) => {
          stopTimer();
          speechRef.current = null;
          const words = transcript.split(/\s+/).filter(Boolean);
          if (!words.length) {
            setState({
              kind: "problem",
              message: "We didn't catch any words. Lyric search needs the words — humming or “la la la” can't be matched in the browser.",
            });
          } else if (words.length < 3) {
            setState({ kind: "problem", message: "We only caught “" + transcript + "”. A longer line gives a much better match.", heard: transcript });
          } else {
            setState({ kind: "idle" });
            onTranscript(transcript);
          }
        },
        onError: (message) => {
          stopTimer();
          speechRef.current = null;
          setState({ kind: "problem", message });
        },
      });
      if (!session) {
        setState({ kind: "problem", message: "Your browser couldn't start speech recognition. Type the lyric instead." });
        return;
      }
      speechRef.current = session;
      setState({ kind: "listening" });
      startTimer(() => stop());
    } else if (path === "record") {
      try {
        const rec = await startRecording({
          onLevel: setLevel,
          onDone: (blob) => {
            recRef.current = null;
            setState({ kind: "idle" });
            onAudio(blob);
          },
          onError: (message) => {
            stopTimer();
            recRef.current = null;
            setState({ kind: "problem", message });
          },
        });
        recRef.current = rec;
        setState({ kind: "listening" });
        startTimer(() => stop());
      } catch (err) {
        setState({ kind: "problem", message: err instanceof Error ? err.message : "Couldn't start the microphone." });
      }
    }
  }, [path, lang, onTranscript, onAudio, stop]);

  if (path === "none") {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <p className="text-[17px] font-semibold">This browser can't turn singing into text</p>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Voice search here needs Chrome, Edge or Safari (built-in speech recognition), or a LyricSpot backend running Whisper.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => onSwitchToText()} className="btn-light h-11 rounded-full px-5 text-sm">Type the lyric instead</button>
          <button type="button" onClick={onOpenSources} className="btn-ghost h-11 rounded-full px-5 text-sm">Connect a backend</button>
        </div>
      </div>
    );
  }

  const listening = state.kind === "listening";
  const finishing = state.kind === "finishing";
  const pct = Math.min(100, (elapsed / MAX_SECONDS) * 100);
  const secs = Math.floor(elapsed);

  if (listening || finishing) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 pb-6 pt-8 sm:px-8">
        <div className="flex h-8 items-center gap-2 rounded-full bg-alert/[0.12] px-3 font-mono text-[13px] text-alert-text" aria-live="polite">
          <span className="h-2 w-2 rounded-full bg-alert" aria-hidden="true" />
          {finishing ? "Finishing up…" : "Listening · 0:" + String(secs).padStart(2, "0") + " / 0:" + MAX_SECONDS}
        </div>
        <Bars level={path === "record" ? level : null} active={listening} />
        {path === "speech" ? (
          <div className="flex w-full flex-col gap-2">
            <p className="eyebrow">What we are hearing</p>
            <p className="min-h-[76px] font-lyric text-[26px] italic leading-tight sm:text-[30px]" aria-live="polite">
              {heardFinal || heardInterim ? (
                <>
                  {heardFinal} <span className="text-dim">{heardInterim}</span>
                </>
              ) : (
                <span className="text-dim">Start singing the words…</span>
              )}
            </p>
          </div>
        ) : (
          <p className="text-center text-sm text-muted">
            {backend.status === "ready" && backend.melody
              ? "Sing the words or hum the tune. We'll work it out when you stop."
              : "Sing the words clearly. We'll transcribe them with Whisper when you stop."}
          </p>
        )}
        <div className="h-1 w-full rounded-full bg-line" aria-hidden="true">
          <div className="h-1 rounded-full bg-go transition-[width] duration-200" style={{ width: pct + "%" }} />
        </div>
        <div className="flex w-full gap-2.5">
          <button type="button" onClick={cancel} className="btn-ghost h-14 rounded-[18px] px-5 text-[15px]">Cancel</button>
          <button type="button" onClick={stop} disabled={finishing} className="btn-light h-14 flex-1 rounded-[18px] text-base">
            {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
            Stop and find song
          </button>
        </div>
      </div>
    );
  }

  const problem = state.kind === "problem" ? state : null;

  return (
    <div className="flex flex-col items-center gap-5 px-4 pb-8 pt-10 sm:px-8">
      <div className="relative flex h-[132px] w-[132px] items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-go/20 animate-halo" aria-hidden="true" />
        <button
          type="button"
          onClick={start}
          disabled={path === "checking"}
          aria-label="Start listening"
          className="relative flex h-[132px] w-[132px] items-center justify-center rounded-full bg-go text-ink shadow-[0_0_0_14px_rgba(30,215,96,0.10)] transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-60"
        >
          {path === "checking" ? <Loader2 className="h-10 w-10 animate-spin" /> : <Mic className="h-12 w-12" strokeWidth={2} />}
        </button>
      </div>
      {problem ? (
        <div className="flex max-w-md flex-col items-center gap-3 pt-2 text-center" role="alert">
          <p className="text-[15px] leading-relaxed text-soft">{problem.message}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {problem.heard && (
              <button type="button" onClick={() => { setState({ kind: "idle" }); onTranscript(problem.heard!); }} className="btn-ghost h-10 rounded-full px-4 text-sm">
                Search anyway
              </button>
            )}
            <button type="button" onClick={() => onSwitchToText(problem.heard)} className="btn-ghost h-10 rounded-full px-4 text-sm">
              Type it instead
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 pt-2 text-center">
          <p className="text-[17px] font-semibold">Tap and sing a line</p>
          <p className="text-sm text-faint">
            Sing the words for 5–10 seconds.{" "}
            {path === "record"
              ? (backend.status === "ready" && backend.melody ? "Transcribed by Whisper; humming is matched by melody." : "Transcribed by Whisper on your server.")
              : "Uses your browser's speech recognition."}
          </p>
        </div>
      )}
      {path === "speech" && (
        <label className="flex items-center gap-2 text-[13px] text-faint">
          Lyrics language
          <select
            value={lang}
            onChange={(e) => { setLang(e.target.value); setSpeechLang(e.target.value); }}
            className="h-9 rounded-full border border-line bg-ink px-3 text-[13px] text-soft"
          >
            {SPEECH_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/** Live level bars (record path) or a gentle idle animation (speech path). */
function Bars({ level, active }: { level: number | null; active: boolean }) {
  const shape = [0.3, 0.55, 0.85, 0.7, 0.4, 0.78, 0.95, 0.62, 0.33, 0.5, 0.8, 0.44, 0.25, 0.58, 0.37, 0.2];
  return (
    <div className="flex h-24 items-center gap-1" aria-hidden="true">
      {shape.map((h, i) => {
        const height = level != null ? Math.max(8, 96 * Math.min(1, h * (0.25 + level * 1.4))) : 96 * h;
        return (
          <span
            key={i}
            className={"w-[5px] origin-center rounded-[3px] bg-go transition-[height] duration-100 " + (level == null && active ? "animate-bar" : "")}
            style={{ height, animationDelay: level == null ? i * 70 + "ms" : undefined }}
          />
        );
      })}
    </div>
  );
}

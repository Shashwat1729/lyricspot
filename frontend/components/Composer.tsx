"use client";

import { useState } from "react";
import { Keyboard, Mic, X } from "lucide-react";
import type { BackendState } from "./App";
import { VoiceInput } from "./VoiceInput";
import { LyricsInput } from "./LyricsInput";
import { clearRecent, type RecentSearch } from "@/lib/engine";

export type InputMode = "voice" | "text";

const EXAMPLES = [
  "is this the real life, is this just fantasy",
  "hello from the other side",
  "never gonna give you up",
  "tum hi ho ab tum hi ho",
];

export function Composer(props: {
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
  draft: string;
  onDraftChange: (t: string) => void;
  backend: BackendState;
  recent: RecentSearch[];
  onRecentCleared: () => void;
  onSearchText: (text: string) => void;
  onSearchAudio: (blob: Blob) => void;
  error: { message: string; hint?: string } | null;
  onDismissError: () => void;
  onOpenSources: () => void;
}) {
  const { mode, onModeChange, error } = props;
  const [listening, setListening] = useState(false);
  const tab = (m: InputMode, label: string, Icon: typeof Mic) => (
    <button
      type="button"
      role="tab"
      id={"tab-" + m}
      aria-selected={mode === m}
      aria-controls={"panel-" + m}
      onClick={() => { onModeChange(m); props.onDismissError(); }}
      className={
        "flex h-11 flex-1 items-center justify-center gap-2 rounded-[18px] text-[15px] font-semibold transition-colors " +
        (mode === m ? "bg-text text-ink" : "text-muted hover:text-text")
      }
    >
      <Icon className="h-4 w-4" strokeWidth={2.2} />
      {label}
    </button>
  );

  return (
    <div className="flex w-full flex-col items-center gap-8 sm:gap-10">
      <div className={"flex-col items-center gap-4 text-center " + (listening && mode === "voice" ? "hidden sm:flex" : "flex")}>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-amber sm:text-[13px]">
          Sing it · Find it · Pick up where you left off
        </p>
        <h1 className="max-w-[820px] font-display text-[40px] font-bold leading-none tracking-[-0.035em] sm:text-[64px]">
          Got one line stuck in your head?
        </h1>
        <p className="max-w-[560px] text-base leading-relaxed text-muted sm:text-lg">
          Sing the words or type them. We find the song and drop you at the exact second that line plays.
        </p>
      </div>

      <section className="card w-full p-2" aria-label="Search input">
        <div role="tablist" aria-label="Input mode" className="flex gap-1 rounded-[22px] bg-ink p-1">
          {tab("voice", "Sing", Mic)}
          {tab("text", "Type lyrics", Keyboard)}
        </div>

        {error && (
          <div role="alert" className="mx-2 mt-3 flex items-start gap-3 rounded-xl2 border border-alert/30 bg-alert/[0.08] p-4">
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-alert-text">{error.message}</p>
              {error.hint && <p className="mt-1 text-sm leading-relaxed text-soft">{error.hint}</p>}
            </div>
            <button type="button" onClick={props.onDismissError} className="rounded-full p-1.5 text-soft hover:text-text" aria-label="Dismiss message">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div role="tabpanel" id={"panel-" + mode} aria-labelledby={"tab-" + mode}>
          {mode === "voice" ? (
            <VoiceInput
              backend={props.backend}
              onTranscript={(t) => props.onSearchText(t)}
              onAudio={props.onSearchAudio}
              onSwitchToText={(prefill) => { if (prefill) props.onDraftChange(prefill); onModeChange("text"); }}
              onOpenSources={props.onOpenSources}
              onActiveChange={setListening}
            />
          ) : (
            <LyricsInput value={props.draft} onChange={props.onDraftChange} onSubmit={props.onSearchText} />
          )}
        </div>
      </section>

      <div className={"w-full flex-col items-center gap-5 " + (listening && mode === "voice" ? "hidden sm:flex" : "flex")}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-[13px] text-faint">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => props.onSearchText(ex)}
              className="min-h-[36px] rounded-full border border-line px-3.5 font-lyric text-[17px] italic text-soft transition-colors hover:border-faint hover:text-text"
            >
              {ex}
            </button>
          ))}
        </div>
        {props.recent.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Recent</p>
              <button type="button" onClick={() => { clearRecent(); props.onRecentCleared(); }} className="text-[13px] text-faint hover:text-text">
                Clear
              </button>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {props.recent.map((r) => (
                <li key={r.query}>
                  <button
                    type="button"
                    onClick={() => props.onSearchText(r.query)}
                    className="flex w-full flex-col gap-0.5 rounded-xl2 border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-faint"
                  >
                    <span className="truncate font-lyric text-lg italic text-text">&ldquo;{r.query}&rdquo;</span>
                    {r.song && <span className="truncate text-[13px] text-muted">{r.song}{r.artist ? " · " + r.artist : ""}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

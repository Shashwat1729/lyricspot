"use client";

import { Check, Loader2 } from "lucide-react";
import type { Progress, Stage } from "@/lib/engine";

const STEPS: { stage: Stage; label: string }[] = [
  { stage: "transcribing", label: "Hearing the words" },
  { stage: "searching", label: "Searching lyric databases" },
  { stage: "verifying", label: "Checking lines against real lyrics" },
  { stage: "ranking", label: "Ranking and finding the timestamp" },
];

export function SearchProgress({ query, progress, onCancel }: {
  query: string | null;
  progress: Progress;
  onCancel: () => void;
}) {
  const steps = query === null || progress.stage === "transcribing" ? STEPS : STEPS.slice(1);
  const current = steps.findIndex((s) => s.stage === progress.stage);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6" aria-busy="true">
      <div className="card flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">{query ? "Looking for" : "Listening back"}</p>
          <p className="font-lyric text-[26px] italic leading-tight">
            {query ? "“" + query + "”" : "Your recording"}
          </p>
        </div>
        <ol className="flex flex-col gap-3.5" aria-live="polite">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.stage} className="flex items-center gap-3">
                <span
                  className={
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border " +
                    (done ? "border-go bg-go text-ink" : active ? "border-go text-go" : "border-line text-dim")
                  }
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                </span>
                <span className={active ? "font-semibold text-text" : done ? "text-soft" : "text-dim"}>
                  {active && progress.message ? progress.message.replace(/\.\.\.$/, "…") : s.label}
                </span>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={onCancel} className="btn-ghost h-11 self-start rounded-full px-5 text-sm">
          Cancel
        </button>
      </div>
      <div className="flex flex-col gap-3" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl2 border border-line bg-surface p-4">
            <div className="skeleton h-14 w-14 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

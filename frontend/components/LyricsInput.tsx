"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

export function LyricsInput({ value, onChange, onSubmit }: {
  value: string;
  onChange: (t: string) => void;
  onSubmit: (t: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const text = value.replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  const ready = text.length >= 3;

  const submit = () => {
    // Read the live DOM value so a fast type-then-Enter still submits.
    const live = (ref.current?.value ?? value).replace(/\s+/g, " ").trim();
    if (live.length >= 3) onSubmit(live);
  };

  return (
    <form
      className="flex flex-col gap-4 px-3 pb-4 pt-5 sm:px-5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <label htmlFor="lyrics" className="eyebrow px-1">The line you remember</label>
      <textarea
        id="lyrics"
        ref={ref}
        value={value}
        maxLength={300}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder="e.g. is this the real life, is this just fantasy"
        className="min-h-[120px] w-full resize-none rounded-xl2 border border-line bg-ink px-4 py-3.5 font-lyric text-[24px] italic leading-snug text-text placeholder:text-dim focus:border-faint focus:outline-none"
      />
      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="px-1 text-[13px] text-faint">
          {words === 0 ? "Any language or spelling. Romanized Hindi works too." : words < 4 ? "A few more words will sharpen the match." : "Press Enter to search."}
        </p>
        <button type="submit" disabled={!ready} className="btn-go h-12 rounded-[16px] px-6 text-[15px]">
          <Search className="h-4 w-4" strokeWidth={2.4} />
          Find the song
        </button>
      </div>
    </form>
  );
}

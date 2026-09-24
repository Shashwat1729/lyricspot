"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Pencil, Play, ThumbsDown, ThumbsUp } from "lucide-react";
import type { BackendState } from "./App";
import { SpotifyPlayer } from "./SpotifyPlayer";
import { submitFeedback } from "@/lib/api";
import { resolveLinks, spotifyLinkAt, type StreamingLinks } from "@/lib/links";
import type { Match, SearchResponse } from "@/lib/engine";

const SOURCE_LABEL: Record<string, string> = {
  genius: "Genius",
  musixmatch: "Musixmatch",
  lrclib: "LRCLIB",
  "lrclib-title": "Title match",
  web: "Web search",
};

function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] || s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function Results({ response, backend, onEdit, onNewSearch, onOpenSources }: {
  response: SearchResponse;
  backend: BackendState;
  onEdit: (text: string) => void;
  onNewSearch: () => void;
  onOpenSources: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setSelected(0); setShowAll(false); }, [response]);

  const { matches } = response;
  if (!matches.length) {
    return (
      <div className="card mx-auto flex max-w-xl flex-col items-center gap-4 p-10 text-center">
        <p className="font-display text-2xl font-bold">No song matched</p>
        <p className="text-muted">Try a longer or more distinctive line, or check the spelling.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => onEdit(response.transcript)} className="btn-light h-11 rounded-full px-5 text-sm">Edit the line</button>
          <button type="button" onClick={onOpenSources} className="btn-ghost h-11 rounded-full px-5 text-sm">Add sources</button>
        </div>
      </div>
    );
  }

  const main = matches[Math.min(selected, matches.length - 1)];
  const others = matches.map((m, i) => ({ m, i })).filter(({ i }) => i !== selected);
  const visibleOthers = showAll ? others : others.slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl2 border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
        <p className="eyebrow shrink-0">{response.matchedBy === "melody" ? "Matched by" : "Searched for"}</p>
        <p className="flex-1 font-lyric text-[22px] italic leading-snug">
          {response.matchedBy === "melody" ? "the melody you hummed" : <>&ldquo;{response.transcript}&rdquo;</>}
        </p>
        <button type="button" onClick={() => onEdit(response.transcript)} className="btn-ghost h-9 self-start rounded-full px-3.5 text-[13px] sm:self-auto">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      </div>

      {response.notice && (
        <p className="rounded-xl2 border border-amber/30 bg-amber/[0.07] px-5 py-3 text-sm text-soft">{response.notice}</p>
      )}
      {response.label !== "high" && (
        <div className="rounded-xl2 border border-line bg-raised px-5 py-3.5">
          <p className="text-[15px] font-semibold">{response.label === "uncertain" ? "Close call" : "Low confidence"}</p>
          <p className="mt-0.5 text-sm text-muted">
            {response.label === "uncertain"
              ? "A few songs fit this line. Check the lyrics below; a longer line settles it."
              : "Nothing matched strongly. These are the nearest songs; try a longer or clearer line."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1">
          <TopMatch key={main.id} match={main} rank={selected} query={response.transcript} backend={backend} />
        </div>
        {others.length > 0 && (
          <aside className="flex w-full flex-col gap-3 lg:w-[380px] lg:shrink-0">
            <p className="eyebrow">{selected === 0 ? "Other possibilities" : "Other results"}</p>
            <ul className="flex flex-col gap-2.5">
              {visibleOthers.map(({ m, i }) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => { setSelected(i); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className="flex w-full items-center gap-3.5 rounded-xl2 border border-line bg-surface p-3.5 text-left transition-colors hover:border-faint"
                  >
                    <Art src={m.albumArt} title={m.song} size={52} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-semibold">{m.song}</span>
                      <span className="truncate text-sm text-muted">
                        {m.artist || "Unknown artist"}
                        {i === 0 ? " · top match" : ""}
                        {!m.context ? " · no lyric check" : ""}
                      </span>
                    </span>
                    <span className="font-mono text-[13px] text-muted">{m.confidence}%</span>
                  </button>
                </li>
              ))}
            </ul>
            {others.length > 5 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="btn-ghost h-10 rounded-full text-sm">
                {showAll ? "Show fewer" : "Show " + (others.length - 5) + " more"}
              </button>
            )}
            <div className="flex flex-col gap-1.5 rounded-xl2 border border-dashed border-line p-4">
              <p className="text-sm font-semibold">Not it?</p>
              <p className="text-sm leading-relaxed text-muted">
                Try a longer line, or{" "}
                <button type="button" onClick={onOpenSources} className="text-go-text underline decoration-go/40 underline-offset-4 hover:text-text">
                  add free keys
                </button>{" "}
                to search more lyric databases.
              </p>
            </div>
          </aside>
        )}
      </div>
      <div className="flex justify-center pt-2">
        <button type="button" onClick={onNewSearch} className="btn-ghost h-11 rounded-full px-6 text-sm">Start a new search</button>
      </div>
    </div>
  );
}

function Art({ src, title, size }: { src: string; title: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} className="shrink-0 rounded-[10px] object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[10px] bg-well font-display font-bold text-dim" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {(title || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

function TopMatch({ match, rank, query, backend }: { match: Match; rank: number; query: string; backend: BackendState }) {
  const [links, setLinks] = useState<StreamingLinks | null>(null);
  const [copied, setCopied] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    let alive = true;
    setLinks(null);
    resolveLinks(match.song, match.artist, match.spotifyUrl).then((l) => { if (alive) setLinks(l); });
    return () => { alive = false; };
  }, [match.song, match.artist, match.spotifyUrl]);

  const ts = match.timestamp;
  const tsLabel = match.timestampDisplay ? (match.timestampEstimated ? "~" : "") + match.timestampDisplay : null;
  const spotifyHref = links?.spotifyTrackId ? spotifyLinkAt(links.spotifyTrackId, ts) : links?.spotifyUrl;

  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("q", query);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — nothing else to do
    }
  };

  const sendVote = (v: "up" | "down") => {
    if (vote) return;
    setVote(v);
    submitFeedback(query, match.song, match.artist, v);
  };

  return (
    <article className="card flex flex-col gap-6 p-5 sm:p-7">
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="hidden sm:block"><Art src={match.albumArt} title={match.song} size={132} /></div>
        <div className="sm:hidden"><Art src={match.albumArt} title={match.song} size={84} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <span className="flex h-[26px] items-center rounded-full bg-go/[0.14] px-2.5 text-xs font-semibold text-go-text">
              {rank === 0 ? "Best match" : "Match #" + (rank + 1)} · {match.confidence}%
            </span>
            <span className="flex h-[26px] items-center rounded-full bg-well px-2.5 text-xs font-medium text-muted">
              {match.source === "melody" ? "Melody match" : match.context ? (match.timestampEstimated ? "Lyrics matched · time estimated" : "Synced lyrics") : "Found via " + sourceLabel(match.source)}
            </span>
          </div>
          <h2 className="break-words font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[44px]">{match.song}</h2>
          <p className="truncate text-base text-muted sm:text-lg">{match.artist || "Unknown artist"}</p>
        </div>
      </div>

      {match.context ? (
        <div className="flex flex-col gap-1 rounded-[20px] bg-ink px-3 py-5 sm:px-6">
          <p className="eyebrow mb-2 px-3">{tsLabel ? "Your line plays at " + tsLabel : "Your line in the song"}</p>
          {match.context.before.map((l, i) => (
            <p key={"b" + i} className="px-3 py-1 font-lyric text-[19px] italic text-dim sm:text-[21px]">{l}</p>
          ))}
          <p className="flex items-baseline gap-4 rounded-xl bg-amber/[0.12] px-3 py-2">
            {tsLabel && <span className="w-12 shrink-0 font-mono text-[13px] text-amber">{tsLabel}</span>}
            <span className="font-lyric text-[21px] italic text-amber sm:text-[24px]">{match.context.matched}</span>
          </p>
          {match.context.after.map((l, i) => (
            <p key={"a" + i} className={"px-3 py-1 font-lyric text-[19px] italic sm:text-[21px] " + (i === 0 ? "text-muted" : "text-dim")}>{l}</p>
          ))}
          {match.occurrences.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 px-3">
              <span className="text-[13px] text-faint">Also at</span>
              {match.occurrences.slice(0, 4).map((o) => (
                <span key={o.timestamp} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-soft">
                  {Math.floor(o.timestamp / 60)}:{String(Math.floor(o.timestamp % 60)).padStart(2, "0")}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : match.source === "melody" ? (
        <p className="rounded-[20px] bg-ink px-5 py-4 text-sm leading-relaxed text-muted">
          Matched by the tune you hummed{tsLabel ? ", around " + tsLabel + " into the song" : ""}.
        </p>
      ) : (
        <p className="rounded-[20px] bg-ink px-5 py-4 text-sm leading-relaxed text-muted">
          A lyric index matched your words to this song, but we couldn't load its lyrics to confirm the line or find the timestamp.
        </p>
      )}

      {links === null ? (
        <div className="skeleton h-[152px] rounded-2xl" aria-label="Finding the track on Spotify" />
      ) : links.spotifyTrackId ? (
        <SpotifyPlayer trackId={links.spotifyTrackId} startAt={ts} />
      ) : null}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <a
          href={spotifyHref || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-go h-14 w-full shrink-0 rounded-[18px] px-5 text-base sm:w-auto sm:flex-1"
        >
          <Play className="h-4 w-4 fill-current" />
          {links?.spotifyTrackId ? "Open in Spotify" : "Search on Spotify"}
        </a>
        <div className="flex gap-2.5">
          <a href={links?.youtubeUrl || "https://www.youtube.com/results?search_query=" + encodeURIComponent(match.song + " " + match.artist)} target="_blank" rel="noopener noreferrer" className="btn-ghost h-14 flex-1 rounded-[18px] px-5 text-[15px] text-text sm:flex-none">
            YouTube <ExternalLink className="h-3.5 w-3.5 opacity-60" />
          </a>
          {links?.appleUrl && (
            <a href={links.appleUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost h-14 flex-1 rounded-[18px] px-5 text-[15px] text-text sm:flex-none">
              Apple Music
            </a>
          )}
          <button type="button" onClick={copyLink} className="btn-ghost h-14 w-14 shrink-0 rounded-[18px]" aria-label={copied ? "Link copied" : "Copy link to this search"}>
            {copied ? <Check className="h-[18px] w-[18px] text-go" /> : <Copy className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>

      {links && !links.spotifyTrackId && (
        <p className="-mt-2 text-[13px] text-faint">
          We couldn't pin down the exact Spotify track, so the button opens a search. Add Spotify keys under Sources for exact tracks.
        </p>
      )}

      {match.covers.length > 0 && (
        <details className="group rounded-xl2 border border-line px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-soft marker:hidden">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
            {match.covers.length} other version{match.covers.length === 1 ? "" : "s"} of this song
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {match.covers.map((c) => (
              <li key={c.artist} className="flex flex-col text-sm">
                <span className="text-text">
                  {c.artist}
                  {c.timestamp_display ? <span className="font-mono text-xs text-faint"> · {c.timestamp_display}</span> : null}
                </span>
                {c.matched && <span className="truncate font-lyric italic text-muted">&ldquo;{c.matched}&rdquo;</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {backend.status === "ready" && backend.ok && (
        <div className="flex items-center gap-2 border-t border-line pt-4 text-sm text-faint">
          <span className="flex-1">{vote ? "Thanks — this improves future ranking." : "Was this the right song?"}</span>
          <button type="button" onClick={() => sendVote("up")} disabled={!!vote} aria-label="Yes, right song" className={"btn-ghost h-10 w-10 rounded-full " + (vote === "up" ? "border-go text-go" : "")}>
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => sendVote("down")} disabled={!!vote} aria-label="No, wrong song" className={"btn-ghost h-10 w-10 rounded-full " + (vote === "down" ? "border-alert text-alert-text" : "")}>
            <ThumbsDown className="h-4 w-4" />
          </button>
        </div>
      )}
    </article>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

/* Spotify iFrame API (https://developer.spotify.com/documentation/embeds). */
type Controller = {
  loadUri: (uri: string, preferVideo?: boolean, startAt?: number) => void;
  seek: (seconds: number) => void;
  resume: () => void;
  play: () => void;
  destroy: () => void;
  addListener: (event: string, cb: (e: any) => void) => void;
};
type IFrameAPI = {
  createController: (el: HTMLElement, opts: Record<string, unknown>, cb: (c: Controller) => void) => void;
};

let apiPromise: Promise<IFrameAPI> | null = null;

function loadApi(): Promise<IFrameAPI> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<IFrameAPI>((resolve, reject) => {
    const w = window as any;
    if (w.__spotifyIFrameAPI) { resolve(w.__spotifyIFrameAPI); return; }
    const timer = setTimeout(() => reject(new Error("timeout")), 12000);
    w.onSpotifyIframeApiReady = (api: IFrameAPI) => {
      clearTimeout(timer);
      w.__spotifyIFrameAPI = api;
      resolve(api);
    };
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.async = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error("load failed")); };
    document.body.appendChild(s);
  }).catch((err) => {
    apiPromise = null; // allow a retry on the next mount
    throw err;
  });
  return apiPromise;
}

/**
 * Spotify player cued to the matched line. Uses the iFrame API so we can
 * seek; falls back to a plain embed iframe when the API can't load.
 * Note: Spotify only plays full tracks for logged-in users; others get a
 * 30-second preview from the start.
 */
export function SpotifyPlayer({ trackId, startAt }: { trackId: string; startAt: number | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<Controller | null>(null);
  const [mode, setMode] = useState<"api" | "plain">("api");
  const [ready, setReady] = useState(false);
  const start = startAt && startAt > 0 ? Math.floor(startAt) : 0;

  useEffect(() => {
    let alive = true;
    setReady(false);
    loadApi()
      .then((api) => {
        if (!alive || !hostRef.current) return;
        const el = document.createElement("div");
        hostRef.current.innerHTML = "";
        hostRef.current.appendChild(el);
        api.createController(el, { uri: "spotify:track:" + trackId, width: "100%", height: 152 }, (c) => {
          if (!alive) { c.destroy(); return; }
          ctrlRef.current = c;
          c.addListener("ready", () => { if (alive) setReady(true); });
        });
      })
      .catch(() => { if (alive) setMode("plain"); });
    return () => {
      alive = false;
      try { ctrlRef.current?.destroy(); } catch { /* ignore */ }
      ctrlRef.current = null;
    };
  }, [trackId]);

  const playFromLine = () => {
    const c = ctrlRef.current;
    if (!c) return;
    try {
      c.loadUri("spotify:track:" + trackId, false, start);
      c.play();
    } catch {
      try { c.seek(start); c.resume(); } catch { /* ignore */ }
    }
  };

  const mm = Math.floor(start / 60) + ":" + String(start % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-2">
      {mode === "plain" ? (
        <iframe
          title="Spotify player"
          src={"https://open.spotify.com/embed/track/" + trackId}
          width="100%"
          height="152"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          className="rounded-2xl border-0"
        />
      ) : (
        <div ref={hostRef} className="min-h-[152px] overflow-hidden rounded-2xl bg-well" />
      )}
      {mode === "api" && start > 0 && (
        <button
          type="button"
          onClick={playFromLine}
          disabled={!ready}
          className="btn-ghost h-11 self-start rounded-full px-4 text-sm text-text"
        >
          <Play className="h-3.5 w-3.5 fill-current" /> Play from your line ({mm})
        </button>
      )}
    </div>
  );
}

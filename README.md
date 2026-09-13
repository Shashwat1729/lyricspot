# [Music] LyricSpot

**Sing a lyric. We'll find the song. Keep listening right where you left off.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-1DB954?logo=github)](https://shashwat1729.github.io/lyricspot/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is this?

Ever had a song stuck in your head but only remember one line? LyricSpot listens to you sing (or reads what you type), identifies the song using local AI, finds the exact second your lyric appears, and opens Spotify right at that timestamp.

**No cloud, no tracking, no paid APIs.** Everything runs on your machine.

## Features

- **Voice Input** - Sing into your mic (3s min, 5-10s recommended, 15s max)
- **Text Input** - Type whatever lyrics you remember
- **Local AI** - OpenAI Whisper runs entirely on your computer
- **Multi-Source Search** - YouTube + Genius + iTunes + Musixmatch in parallel
- **Precise Timestamps** - Finds the exact second your lyric appears
- **Spotify Deep Link** - One click opens Spotify at the right timestamp
- **Multilingual input** - English, Hindi, Korean, Spanish, French, Portuguese, Japanese; accuracy is highest for English and varies by language and singing style

## Quick Start

### Prerequisites
- Node.js 18+, Python 3.9+, ffmpeg

### One command (Linux/WSL)
```bash
chmod +x start.sh && ./start.sh
```

### Manual

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

**Frontend:**
```bash
cd frontend
npm install && npm run dev
```

Open **http://localhost:3000**

## Environment Variables

Copy backend/.env.example to backend/.env:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SPOTIFY_CLIENT_ID | Recommended | - | Spotify API client ID |
| SPOTIFY_CLIENT_SECRET | Recommended | - | Spotify API client secret |
| WHISPER_MODEL | No | base | Model size: tiny, base, small, medium |
| CORS_ORIGINS | No | - | Comma-separated allowed origins |
| TRANSCRIPTION_MIN_CONFIDENCE | No | 0.35 | Below this, the backend asks for a longer clip instead of searching |
| CONFIDENCE_HIGH_THRESHOLD | No | 70 | Absolute score needed for a "high" confidence result |
| CONFIDENCE_HIGH_MARGIN | No | 10 | Top-1/top-2 gap needed for a "high" confidence result |

## GitHub Pages vs Local

The GitHub Pages site is a **static frontend build** — it cannot run the Python backend.

- **Lyrics tab**: demo responses for 3 well-known example phrases work with no backend; anything else needs one (it says so instead of guessing)
- **Voice tab**: needs a reachable backend. On Pages it explains this instead of failing silently. Open **Backend settings** (top right on the site) to point at your server — the URL is saved on your device.

### Making voice work for everyone (hosted backend)

To make the public site work end-to-end with zero setup, host the backend once and bake its URL into the Pages build:

1. **Deploy `backend/`** to HuggingFace Spaces (Docker SDK), Render, or Railway. The Dockerfile already respects the platform-provided `PORT`. Set `CORS_ORIGINS=https://shashwat1729.github.io` on the host so the browser is allowed to call it. Whisper downloads its model (~140MB) on first start, so expect the first request to be slow.
2. **Rebuild the frontend** with the hosted URL: `NEXT_PUBLIC_API_URL=https://your-backend-host npm run build`, then copy `frontend/out/*` into `docs/` and push. From then on every visitor gets working voice with no configuration. Individual overrides in Backend settings still take precedence.

Why API keys in settings wouldn't help: transcription needs Whisper *running somewhere* — a key alone can't transcribe audio in the browser. The hosted backend is the equivalent of that, with no keys needed from visitors.


## Screenshots

| Voice Mode | Lyrics Mode | Results |
|:---:|:---:|:---:|
| ![Voice](docs/screenshots/homepage.png) | ![Lyrics](docs/screenshots/lyrics-input.png) | ![Results](docs/screenshots/results.png) |

## Demo

**Live site:** [shashwat1729.github.io/lyricspot/](https://shashwat1729.github.io/lyricspot/)
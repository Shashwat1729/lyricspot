<h1 align="center">🎵 ContinueMySong AI</h1>

<p align="center">
  <em>Sing a lyric. We'll find the song. Continue playing from exactly where you left off.</em>
</p>

<p align="center">
  <a href=\"#\"><img src=\"https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white\" alt=\"Python\"></a>
  <a href=\"#\"><img src=\"https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white\" alt=\"Next.js\"></a>
  <a href=\"#\"><img src=\"https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white\" alt=\"TypeScript\"></a>
  <a href=\"#\"><img src=\"https://img.shields.io/badge/FastAPI-0.104-009688?logo=fastapi&logoColor=white\" alt=\"FastAPI\"></a>
  <a href=\"LICENSE\"><img src=\"https://img.shields.io/badge/License-MIT-yellow.svg\" alt=\"License: MIT\"></a>
</p>

---

## 📖 Table of Contents

- [✨ Features](#-features)
- [📸 Screenshots](#-screenshots)
- [🚀 How It Works](#-how-it-works)
- [🏗️ Tech Stack](#️-tech-stack)
- [⚡ Quick Start](#-quick-start)
- [🔧 Configuration](#-configuration)
- [📡 API Endpoints](#-api-endpoints)
- [🧪 Accuracy](#-accuracy)
- [🏛️ Architecture](#️-architecture)
- [📁 Project Structure](#-project-structure)
- [🐳 Docker](#-docker)
- [🔒 Security & Privacy](#-security--privacy)
- [📋 Limitations](#-limitations)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎤 **Voice Input** | Record lyrics via microphone with real-time waveform visualization |
| ⌨️ **Text Input** | Type or paste lyrics directly with example suggestions |
| 🧠 **Local AI Transcription** | OpenAI Whisper runs locally — no data sent to third parties |
| 🔍 **Multi-Strategy Search** | Parallel search across YouTube, Genius, iTunes, and Musixmatch |
| ⏱️ **Precise Timestamps** | RapidFuzz aligns lyrics against synced time-coded lines |
| 🎧 **Spotify Integration** | Embedded preview + deep link to continue from the exact timestamp |
| 📊 **Confidence Scoring** | Multi-signal confidence with source agreement bonuses |
| 👍 **Feedback Learning** | Thumbs up/down buttons improve future results over time |
| 🌍 **Multilingual** | Works with English, Hindi, Korean, Spanish, French, Portuguese, Japanese |
| ⚡ **Real-time Streaming** | SSE-powered progressive results — see candidates as they're found |

---

## 📸 Screenshots

<table align="center">
  <tr>
    <td align="center"><strong>Home Screen</strong></td>
    <td align="center"><strong>Lyrics Input</strong></td>
    <td align="center"><strong>Results</strong></td>
  </tr>
  <tr>
    <td><img src=\"docs/screenshots/homepage.png\" alt=\"Home Screen\" width=\"300\"></td>
    <td><img src=\"docs/screenshots/lyrics-input.png\" alt=\"Lyrics Input\" width=\"300\"></td>
    <td><img src=\"docs/screenshots/results.png\" alt=\"Results\" width=\"300\"></td>
  </tr>
</table>

---

## 🚀 How It Works

\\\
  🎤 Sing / ⌨️ Type
        │
        ▼
  ┌─────────────────────────────────────────────────────┐
  │                   FastAPI Backend                     │
  │                                                     │
  │  Audio → ffmpeg → Whisper → transcript              │
  │                        │                            │
  │                        ▼                            │
  │  ┌──────────────────────────────────────────┐       │
  │  │     PARALLEL SEARCH (all run at once)    │       │
  │  │  • YouTube/yt-dlp  • Genius scraping     │       │
  │  │  • iTunes Search   • Musixmatch (opt)    │       │
  │  └──────────────────────────────────────────┘       │
  │                        │                            │
  │                        ▼                            │
  │  Lyrics Fetch: LRCLIB (synced) → Genius (plain)     │
  │                        │                            │
  │                        ▼                            │
  │  RapidFuzz Timestamp Alignment + Phonetic Matching  │
  │                        │                            │
  │                        ▼                            │
  │  Spotify Resolution → Embed + Deep Link @ timestamp │
  └─────────────────────────────────────────────────────┘
        │
        ▼
  🎧 Song continues from your lyric on Spotify
\\\

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14, TypeScript, Tailwind CSS, Framer Motion |
| **Backend** | Python 3.9+, FastAPI, Uvicorn |
| **Audio** | ffmpeg, librosa (mono 16kHz normalization) |
| **Transcription** | OpenAI Whisper (local, \"base\" model) |
| **Search** | YouTube/yt-dlp, Genius, iTunes Search API |
| **Lyrics** | LRCLIB (synced), Genius (plain), Lyrics.ovh |
| **Matching** | RapidFuzz (partial_ratio + token_set_ratio) |
| **Output** | Spotify IFrame API + deep links with \?t=seconds\ |

---

## ⚡ Quick Start

### Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.9+
- **ffmpeg** installed and on PATH (\pt install ffmpeg\ / \rew install ffmpeg\)

### One-Command Start (Linux/WSL)

\\\ash
chmod +x start.sh && ./start.sh
\\\

This starts both backend (port 8000) and frontend (port 3000).

### Manual Setup

**Backend:**

\\\ash
cd backend
python -m venv venv
source venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env  # Add Spotify credentials for direct track links
uvicorn main:app --host 0.0.0.0 --port 8000
\\\

> Whisper downloads its model (~140MB) on first startup.

**Frontend:**

\\\ash
cd frontend
npm install
npm run dev
\\\

Open **http://localhost:3000** in your browser.

---

## 🔧 Configuration

### Backend (\ackend/.env\)

| Variable | Required | Description |
|----------|----------|-------------|
| \SPOTIFY_CLIENT_ID\ | Recommended | Spotify Developer App Client ID |
| \SPOTIFY_CLIENT_SECRET\ | Recommended | Spotify Developer App Client Secret |
| \WHISPER_MODEL\ | No | Model size: \	iny\, \ase\ (default), \small\, \medium\ |
| \MUSIXMATCH_API_KEY\ | No | Improves synced lyrics coverage |
| \AUDD_API_TOKEN\ | No | Audio recognition (paid, opt-in only) |
| \YTDLP_TIMEOUT\ | No | yt-dlp subprocess timeout in seconds (default: 5) |
| \CORS_ORIGINS\ | No | Comma-separated allowed origins |

### Frontend (\rontend/.env.local\)

| Variable | Default | Description |
|----------|---------|-------------|
| \NEXT_PUBLIC_API_URL\ | \http://localhost:8000\ | Backend URL |

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| \/health\ | GET | Health check + Whisper model status |
| \/upload\ | POST | Upload audio → transcribe → identify → results |
| \/identify\ | POST | Submit typed lyrics → identification results |
| \/identify/stream\ | POST | SSE streaming with real-time candidate updates |
| \/feedback\ | POST | Record thumbs up/down for result quality |
| \/feedback/stats\ | GET | View aggregate feedback statistics |

### Example Response

\\\json
{
  \"success\": true,
  \"transcript\": \"hello from the other side\",
  \"results\": [
    {
      \"song\": \"Hello\",
      \"artist\": \"Adele\",
      \"confidence\": 91,
      \"timestamp\": 44,
      \"timestamp_display\": \"0:44\",
      \"spotify_url\": \"https://open.spotify.com/track/...?t=44\",
      \"lyrics_context\": \"... I must've called a thousand times\\n>>> Hello from the other side <<<\\nI must've called a thousand times...\",
      \"strategy\": \"youtube\"
    }
  ]
}
\\\

---

## 🧪 Accuracy

Tested across **100 songs** in 7 languages:

| Language | Top-1 Accuracy | Top-3 Accuracy |
|----------|:--------------:|:--------------:|
| English | 90% | 93% |
| Hindi (Romanized) | 93% | 93% |
| Korean (Romanized) | 80% | 100% |
| Portuguese | 80% | 80% |
| Japanese (Romanized) | 80% | 80% |
| French | 70% | 70% |
| Spanish | 67% | 80% |
| **Overall** | **84%** | **86%** |

> Average identification time: **4.8 seconds** per query.

---

## 🏛️ Architecture

- **Parallel Search**: All search strategies execute concurrently (ThreadPoolExecutor)
- **Circuit Breaker**: Automatically skips failing services (e.g., LRCLIB) after consecutive failures
- **Source Agreement**: Candidates found by multiple strategies get a confidence boost
- **Feedback Loop**: User thumbs up/down stored locally and applied as scoring boosts
- **SSE Streaming**: Results stream to the client as each candidate is processed
- **Phonetic Matching**: Handles romanization variants (Hindi: tu/too, mein/main/mai)
- **Penalty System**: Demotes lyric compilations, covers, and non-artist uploads
- **Deduplication**: Intelligent song/artist pair dedup with title normalization

---

## 📁 Project Structure

\\\
├── backend/
│   ├── main.py                    # FastAPI app + endpoints
│   ├── services/
│   │   ├── audio_processor.py     # ffmpeg + librosa pipeline
│   │   ├── transcriber.py         # Whisper singleton
│   │   ├── song_identifier.py     # Multi-strategy search
│   │   ├── lyrics_fetcher.py      # LRCLIB + Genius + Lyrics.ovh
│   │   ├── timestamp_matcher.py   # RapidFuzz alignment
│   │   ├── spotify_linker.py      # Spotify Web API resolution
│   │   └── feedback_store.py      # Thumbs up/down persistence
│   ├── utils/title_cleaner.py     # Title normalization + mojibake fix
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/                       # Next.js app router
│   │   ├── globals.css            # Global styles + animations
│   │   ├── layout.tsx             # Root layout with metadata
│   │   └── page.tsx               # Main page
│   ├── components/                # React components
│   │   ├── Navbar.tsx
│   │   ├── HeroSection.tsx
│   │   ├── MicRecorder.tsx
│   │   ├── TextInput.tsx
│   │   ├── ResultCard.tsx
│   │   ├── LoadingOverlay.tsx
│   │   ├── AnimatedWaveform.tsx
│   │   ├── Confetti.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── Footer.tsx
│   ├── lib/api.ts                 # API client + SSE handler
│   └── package.json
├── docs/screenshots/              # App screenshots
├── start.sh                       # One-command dev launcher
├── docker-compose.yml
├── .github/workflows/ci.yml       # CI configuration
└── README.md
\\\

---

## 🐳 Docker

\\\ash
docker-compose up --build
\\\

The compose file starts both services with health checks. Set \NEXT_PUBLIC_API_URL\ as a build ARG for the frontend image in production.

---

## 🔒 Security & Privacy

- **No data leaves your machine** — Whisper runs locally, no cloud transcription
- **No API keys required** — works with 100% free public APIs out of the box
- **Upload limits** — 5MB max file size, 30s max recording, rate limiting enabled
- **Input sanitization** — All search queries are allowlist-filtered before external calls
- **No user data stored** — Feedback is anonymous and stored locally only

---

## 📋 Limitations

- Spotify web embed cannot start playback at a specific timestamp; the \"Continue from X:XX\" link works in the Spotify desktop/mobile app
- Very short/generic lyrics (< 5 words) may produce ambiguous results
- Non-Latin script songs require romanized input for best results
- LRCLIB coverage varies; plain-lyrics fallback provides estimated timestamps
- getUserMedia (microphone) requires a secure origin (localhost or HTTPS)

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (\git checkout -b feature/amazing-feature\)
3. **Commit** your changes (\git commit -m 'Add amazing feature'\)
4. **Push** to the branch (\git push origin feature/amazing-feature\)
5. **Open** a Pull Request

Please make sure to update tests as appropriate and follow the existing code style.

---

## 📄 License

MIT — See [LICENSE](LICENSE).

---

<p align=\"center\">
  Made with ❤️ and 🎵 by <a href=\"https://github.com/Shashwat1729\">Shashwat Bajpai</a>
</p>

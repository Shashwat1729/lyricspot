# ðŸŽµ LyricSpot

**Sing a lyric. We'll find the song. Keep listening right where you left off.**

<p align="center">
  <img src="docs/screenshots/homepage.png" alt="LyricSpot Home" width="700">
</p>

<p align="center">
  <a href="https://shashwat1729.github.io/lyricspot/" target="_blank">
    <img src="https://img.shields.io/badge/%F0%9F%8C%90%20Live%20Demo-GitHub%20Pages-1DB954?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Pages">
  </a>
  <a href="https://github.com/Shashwat1729/lyricspot" target="_blank">
    <img src="https://img.shields.io/badge/%F0%9F%93%81%20Source%20Code-GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repo">
  </a>
  <a href="https://github.com/Shashwat1729/lyricspot/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License">
  </a>
</p>

---

Ever had a song stuck in your head but only remember one line? You hum it into your phone, but Shazam gives you nothing?

**LyricSpot** is the answer. It listens to you sing (or reads what you type), identifies the song using local AI, finds the exact second your lyric appears, and opens Spotify right at that timestamp. No cloud, no paid APIs, no tracking â€” just pure open-source.

---

## âœ¨ Features

| Feature | Description |
|---------|-------------|
| ðŸŽ¤ **Voice Input** | Record yourself singing â€” 30 second limit, real-time waveform |
| âŒ¨ï¸ **Text Input** | Type whatever lyrics you remember, with example suggestions |
| ðŸ§  **Local AI** | OpenAI Whisper runs entirely on your machine. Nothing leaves your computer. |
| ðŸ” **Multi-Source Search** | Searches YouTube, Genius, iTunes, and Musixmatch in parallel |
| â±ï¸ **Precise Timestamps** | RapidFuzz alignment finds the exact second your lyric appears |
| ðŸŽ§ **Spotify Deep Link** | One click opens Spotify at the right timestamp |
| ðŸ‘ **Feedback Learning** | Thumbs up/down makes future results more accurate |
| ðŸŒ **Multilingual** | Works with English, Hindi, Korean, Spanish, French, Portuguese, Japanese |

---

## ðŸ“¸ Screenshots

| Voice mode | Text mode | Results |
|:---:|:---:|:---:|
| ![Home](docs/screenshots/homepage.png) | ![Lyrics](docs/screenshots/lyrics-input.png) | ![Results](docs/screenshots/results.png) |

> ðŸŽ¯ **Live demo & docs:** [shashwat1729.github.io/lyricspot](https://shashwat1729.github.io/lyricspot/)

---

## ðŸš€ Quick Start

### Prerequisites
- **Node.js** 18+
- **Python** 3.9+
- **ffmpeg** â€” Install with `apt install ffmpeg` (Linux) or `brew install ffmpeg` (macOS)

### One-Command Start (Linux/WSL)
```bash
chmod +x start.sh && ./start.sh
```

### Manual Setup

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

> First startup downloads Whisper (~140MB).

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** and start singing!

### Docker
```bash
docker-compose up --build
```

> ðŸŒ **Want a quick overview?** Check out the [GitHub Pages site](https://shashwat1729.github.io/lyricspot/)

---

## ðŸ§  How It Works

```
You sing / type lyrics
        â”‚
        â–¼
ðŸŽ¤ Audio â†’ ffmpeg â†’ Whisper (local AI) â†’ text transcript
        â”‚
        â–¼
ðŸ” PARALLEL SEARCH (all at once)
    â”œâ”€ YouTube / yt-dlp
    â”œâ”€ Genius scraping
    â”œâ”€ iTunes Search API
    â””â”€ Musixmatch (optional)
        â”‚
        â–¼
ðŸ“œ Lyrics fetched from LRCLIB / Genius / Lyrics.ovh
        â”‚
        â–¼
ðŸŽ¯ RapidFuzz matches your line + finds the timestamp
        â”‚
        â–¼
ðŸŽ§ Spotify opens at exactly that second
```

---

## ðŸ—ï¸ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14, TypeScript, Tailwind CSS, Framer Motion |
| **Backend** | Python 3.9+, FastAPI, Uvicorn |
| **AI** | OpenAI Whisper (local, "base" model) |
| **Search** | yt-dlp, Genius scraper, iTunes Search API |
| **Lyrics** | LRCLIB, Genius, Lyrics.ovh |
| **Matching** | RapidFuzz (partial_ratio + token_set_ratio) |
| **Spotify** | IFrame API + deep links with `?t=seconds` |

---

## ðŸ“ Project Structure

```
â”œâ”€â”€ backend/
â”‚   â”œâ”€â”€ main.py                    # FastAPI app + endpoints
â”‚   â”œâ”€â”€ services/                  # Audio, transcription, search, matching
â”‚   â”‚   â”œâ”€â”€ audio_processor.py
â”‚   â”‚   â”œâ”€â”€ transcriber.py         # Whisper integration
â”‚   â”‚   â”œâ”€â”€ song_identifier.py     # Multi-strategy search
â”‚   â”‚   â”œâ”€â”€ lyrics_fetcher.py
â”‚   â”‚   â”œâ”€â”€ timestamp_matcher.py   # RapidFuzz alignment
â”‚   â”‚   â”œâ”€â”€ spotify_linker.py
â”‚   â”‚   â”œâ”€â”€ confidence_calculator.py
â”‚   â”‚   â””â”€â”€ feedback_store.py
â”‚   â”œâ”€â”€ utils/title_cleaner.py
â”‚   â”œâ”€â”€ requirements.txt
â”‚   â””â”€â”€ .env.example
â”œâ”€â”€ frontend/
â”‚   â”œâ”€â”€ app/                       # Next.js app router
â”‚   â”‚   â”œâ”€â”€ globals.css
â”‚   â”‚   â”œâ”€â”€ layout.tsx
â”‚   â”‚   â””â”€â”€ page.tsx
â”‚   â”œâ”€â”€ components/                # React components
â”‚   â”‚   â”œâ”€â”€ Navbar.tsx
â”‚   â”‚   â”œâ”€â”€ HeroSection.tsx
â”‚   â”‚   â”œâ”€â”€ MicRecorder.tsx
â”‚   â”‚   â”œâ”€â”€ TextInput.tsx
â”‚   â”‚   â”œâ”€â”€ ResultCard.tsx
â”‚   â”‚   â”œâ”€â”€ LoadingOverlay.tsx
â”‚   â”‚   â”œâ”€â”€ AnimatedWaveform.tsx
â”‚   â”‚   â”œâ”€â”€ Confetti.tsx
â”‚   â”‚   â”œâ”€â”€ ErrorBoundary.tsx
â”‚   â”‚   â””â”€â”€ Footer.tsx
â”‚   â”œâ”€â”€ lib/api.ts                 # API client + SSE handler
â”‚   â””â”€â”€ package.json
â”œâ”€â”€ docs/                          # GitHub Pages site (static export)
â”‚   â”œâ”€â”€ index.html                 # The actual app interface
â”‚   â”œâ”€â”€ screenshots/
â”‚   â””â”€â”€ _next/                     # Next.js static build
â”œâ”€â”€ docker-compose.yml
â”œâ”€â”€ start.sh
â””â”€â”€ README.md
```

---

## âš™ï¸ Configuration

### Backend (`backend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `SPOTIFY_CLIENT_ID` | Recommended | Spotify Developer App Client ID |
| `SPOTIFY_CLIENT_SECRET` | Recommended | Spotify Developer App Client Secret |
| `WHISPER_MODEL` | No | `tiny`, `base` (default), `small`, `medium` |
| `MUSIXMATCH_API_KEY` | No | Improves synced lyrics coverage |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |

### Frontend (`frontend/.env.local`)
| Variable | Default |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |

---

## ðŸ“¡ API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + Whisper model status |
| `/upload` | POST | Upload audio â†’ transcribe â†’ identify â†’ results |
| `/identify` | POST | Submit typed lyrics â†’ identification results |
| `/identify/stream` | POST | SSE streaming with real-time candidate updates |
| `/feedback` | POST | Record thumbs up/down for result quality |
| `/feedback/stats` | GET | View aggregate feedback statistics |

---

## ðŸ§ª Accuracy

Tested on **100 songs** across 7 languages:

| Language | Top-1 | Top-3 |
|----------|:-----:|:-----:|
| English | 90% | 93% |
| Hindi (Romanized) | 93% | 93% |
| Korean (Romanized) | 80% | 100% |
| Portuguese | 80% | 80% |
| Japanese (Romanized) | 80% | 80% |
| French | 70% | 70% |
| Spanish | 67% | 80% |
| **Overall** | **84%** | **86%** |

Average identification time: **4.8 seconds** per query.

---


## ðŸŽ¬ Demo

See the app in action with our interactive slideshow:

> **[ðŸ“º Live Demo Slideshow](https://shashwat1729.github.io/lyricspot/demo/)**

Or just visit the [GitHub Pages site](https://shashwat1729.github.io/lyricspot/) and try it yourself â€” no backend required!

---
## ðŸ¤ Contributing

Contributions are welcome! Here's how:

1. ðŸ´ Fork the repository
2. ðŸŒ¿ Create a feature branch (`git checkout -b feature/amazing-feature`)
3. ðŸ’» Make your changes
4. ðŸ“¬ Push and open a Pull Request (`git push origin feature/amazing-feature`)

Please keep tests passing and follow the existing code style.

---

## ðŸ“„ License

MIT â€” See [LICENSE](LICENSE).

---

<p align="center">
  Made with ðŸŽµ by <a href="https://github.com/Shashwat1729">Shashwat Bajpai</a>
  <br>
  <sub><a href="https://github.com/Shashwat1729/lyricspot">ðŸŒŸ Star on GitHub</a></sub>
</p>


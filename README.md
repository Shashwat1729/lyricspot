# 🎵 ContinueMySong AI

**Sing a lyric. We'll find the song. Keep listening right where you left off.**

<p align="center">
  <img src="docs/screenshots/homepage.png" alt="ContinueMySong Home" width="700">
</p>

<p align="center">
  <a href="https://shashwat1729.github.io/continuemysong-ai/" target="_blank">
    <img src="https://img.shields.io/badge/%F0%9F%8C%90%20Live%20Demo-GitHub%20Pages-1DB954?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Pages">
  </a>
  <a href="https://github.com/Shashwat1729/continuemysong-ai" target="_blank">
    <img src="https://img.shields.io/badge/%F0%9F%93%81%20Source%20Code-GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repo">
  </a>
  <a href="https://github.com/Shashwat1729/continuemysong-ai/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License">
  </a>
</p>

---

Ever had a song stuck in your head but only remember one line? You hum it into your phone, but Shazam gives you nothing?

**ContinueMySong** is the answer. It listens to you sing (or reads what you type), identifies the song using local AI, finds the exact second your lyric appears, and opens Spotify right at that timestamp. No cloud, no paid APIs, no tracking — just pure open-source.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎤 **Voice Input** | Record yourself singing — 30 second limit, real-time waveform |
| ⌨️ **Text Input** | Type whatever lyrics you remember, with example suggestions |
| 🧠 **Local AI** | OpenAI Whisper runs entirely on your machine. Nothing leaves your computer. |
| 🔍 **Multi-Source Search** | Searches YouTube, Genius, iTunes, and Musixmatch in parallel |
| ⏱️ **Precise Timestamps** | RapidFuzz alignment finds the exact second your lyric appears |
| 🎧 **Spotify Deep Link** | One click opens Spotify at the right timestamp |
| 👍 **Feedback Learning** | Thumbs up/down makes future results more accurate |
| 🌍 **Multilingual** | Works with English, Hindi, Korean, Spanish, French, Portuguese, Japanese |

---

## 📸 Screenshots

| Voice mode | Text mode | Results |
|:---:|:---:|:---:|
| ![Home](docs/screenshots/homepage.png) | ![Lyrics](docs/screenshots/lyrics-input.png) | ![Results](docs/screenshots/results.png) |

> 🎯 **Live demo & docs:** [shashwat1729.github.io/continuemysong-ai](https://shashwat1729.github.io/continuemysong-ai/)

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **Python** 3.9+
- **ffmpeg** — Install with `apt install ffmpeg` (Linux) or `brew install ffmpeg` (macOS)

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

> 🌐 **Want a quick overview?** Check out the [GitHub Pages site](https://shashwat1729.github.io/continuemysong-ai/)

---

## 🧠 How It Works

```
You sing / type lyrics
        │
        ▼
🎤 Audio → ffmpeg → Whisper (local AI) → text transcript
        │
        ▼
🔍 PARALLEL SEARCH (all at once)
    ├─ YouTube / yt-dlp
    ├─ Genius scraping
    ├─ iTunes Search API
    └─ Musixmatch (optional)
        │
        ▼
📜 Lyrics fetched from LRCLIB / Genius / Lyrics.ovh
        │
        ▼
🎯 RapidFuzz matches your line + finds the timestamp
        │
        ▼
🎧 Spotify opens at exactly that second
```

---

## 🏗️ Tech Stack

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

## 📁 Project Structure

```
├── backend/
│   ├── main.py                    # FastAPI app + endpoints
│   ├── services/                  # Audio, transcription, search, matching
│   │   ├── audio_processor.py
│   │   ├── transcriber.py         # Whisper integration
│   │   ├── song_identifier.py     # Multi-strategy search
│   │   ├── lyrics_fetcher.py
│   │   ├── timestamp_matcher.py   # RapidFuzz alignment
│   │   ├── spotify_linker.py
│   │   ├── confidence_calculator.py
│   │   └── feedback_store.py
│   ├── utils/title_cleaner.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/                       # Next.js app router
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
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
├── docs/                          # GitHub Pages site (static export)
│   ├── index.html                 # The actual app interface
│   ├── screenshots/
│   └── _next/                     # Next.js static build
├── docker-compose.yml
├── start.sh
└── README.md
```

---

## ⚙️ Configuration

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

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + Whisper model status |
| `/upload` | POST | Upload audio → transcribe → identify → results |
| `/identify` | POST | Submit typed lyrics → identification results |
| `/identify/stream` | POST | SSE streaming with real-time candidate updates |
| `/feedback` | POST | Record thumbs up/down for result quality |
| `/feedback/stats` | GET | View aggregate feedback statistics |

---

## 🧪 Accuracy

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

## 🤝 Contributing

Contributions are welcome! Here's how:

1. 🍴 Fork the repository
2. 🌿 Create a feature branch (`git checkout -b feature/amazing-feature`)
3. 💻 Make your changes
4. 📬 Push and open a Pull Request (`git push origin feature/amazing-feature`)

Please keep tests passing and follow the existing code style.

---

## 📄 License

MIT — See [LICENSE](LICENSE).

---

<p align="center">
  Made with 🎵 by <a href="https://github.com/Shashwat1729">Shashwat Bajpai</a>
  <br>
  <sub><a href="https://github.com/Shashwat1729/continuemysong-ai">🌟 Star on GitHub</a></sub>
</p>

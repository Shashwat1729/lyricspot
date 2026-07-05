# 🎵 ContinueMySong AI

**Sing a lyric. We'll find the song. Keep listening right where you left off.**

<p align="center">
  <img src="docs/screenshots/homepage.png" alt="ContinueMySong Home" width="700">
</p>

---

Yo, ever had a song stuck in your head but only remember ONE line? Or you're humming something and Shazam's like "nahhh"? 

**ContinueMySong** is your AI homie that:
1. Listens to you sing (or reads what you type)
2. Figures out what song it is using local AI (Whisper)
3. Finds the EXACT moment that lyric appears
4. Opens Spotify right at that timestamp so you can keep jamming

No cloud nonsense. No paid APIs. Just pure open-source wizardry.

---

## ✨ What It Does

| What | How |
|------|-----|
| 🎤 **Sing into your mic** | Real-time waveform, 30sec max, Whisper transcribes locally |
| ⌨️ **Type lyrics** | Paste "hello from the other side" and we do the rest |
| 🧠 **AI runs on YOUR machine** | Zero data sent anywhere. Whisper stays local. |
| 🔍 **Scours the internet** | YouTube, Genius, iTunes, Musixmatch — all at once |
| ⏱️ **Finds the exact timestamp** | "0:44" — right when you sang that line |
| 🎧 **Opens Spotify at that moment** | Click and continue from where you left off |
| 👍 **Gets smarter** | Thumbs up/down = better results next time |
| 🌍 **Works in 7 languages** | English, Hindi, Korean, Spanish, French, Portuguese, Japanese |

---

## 📸 How It Looks

| Sing into it | Type it out | BOOM results |
|:---:|:---:|:---:|
| ![Home](docs/screenshots/homepage.png) | ![Lyrics](docs/screenshots/lyrics-input.png) | ![Results](docs/screenshots/results.png) |

---

## 🚀 Get Started in 2 Minutes

### What you need
- Node.js 18+
- Python 3.9+
- ffmpeg (`apt install ffmpeg` or `brew install ffmpeg`)

### The easy way
```bash
chmod +x start.sh && ./start.sh
```

### The manual way

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

> First run downloads Whisper (~140MB). Grab a coffee ☕

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** and start singing!

### Docker?
Sure, we got you:
```bash
docker-compose up --build
```

---

## 🧠 How It Works (the nerd stuff)

```
You sing/type
    │
    ▼
🎤 Audio? → ffmpeg → Whisper (local AI) → text
    │
    ▼
🔍 PARALLEL SEARCH — all at once!
    ├─ YouTube
    ├─ Genius  
    ├─ iTunes
    └─ Musixmatch (optional)
    │
    ▼
📜 Grab lyrics from LRCLIB / Genius / Lyrics.ovh
    │
    ▼
🎯 RapidFuzz matches your line + finds timestamp
    │
    ▼
🎧 Spotify opens at EXACTLY that second
```

---

## 🏗️ What's Under the Hood

| Layer | Tech |
|-------|------|
| **Frontend** | Next.js 14, TypeScript, Tailwind CSS, Framer Motion |
| **Backend** | Python 3.9+, FastAPI, Uvicorn |
| **AI** | OpenAI Whisper (local, "base" model) |
| **Search** | yt-dlp, Genius scraper, iTunes API |
| **Lyrics** | LRCLIB, Genius, Lyrics.ovh |
| **Matching** | RapidFuzz (fuzzy string matching) |
| **Spotify** | IFrame API + deep links |

---

## 📁 Project Layout

```
├── backend/          # Python FastAPI + Whisper + search magic
│   ├── main.py       # Where the API lives
│   └── services/     # Audio, transcription, search, matching...
├── frontend/         # Next.js app with all the UI goodness
│   ├── app/          # Pages and layouts
│   ├── components/   # React components (Navbar, Recorder, Cards...)
│   └── lib/          # API client + SSE streaming
├── docs/             # Screenshots + GitHub Pages site
├── docker-compose.yml
└── start.sh          # One-command launcher
```

---

## ⚙️ Config

### Backend (`backend/.env`)
| Variable | What it does |
|----------|-------------|
| `SPOTIFY_CLIENT_ID` | Needed for direct Spotify links |
| `SPOTIFY_CLIENT_SECRET` | Pair with the ID above |
| `WHISPER_MODEL` | `tiny`, `base` (default), `small`, `medium` |
| `MUSIXMATCH_API_KEY` | Optional — better synced lyrics |
| `CORS_ORIGINS` | Allowed domains |

### Frontend (`frontend/.env.local`)
| Variable | Default |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |

---

## 📡 API Endpoints (if you're into that)

| Endpoint | What |
|----------|------|
| `GET /health` | Is it alive? |
| `POST /upload` | Upload audio → find the song |
| `POST /identify` | Send lyrics → get results |
| `POST /identify/stream` | Same but with real-time SSE updates |
| `POST /feedback` | Teach the algorithm |

---

## 🧪 Does It Actually Work?

Tested on **100 songs** in 7 languages:

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

Average time: **4.8 seconds** per query. Not bad, eh?

---

## 🤝 Wanna Contribute?

Heck yeah! Here's how:

1. 🍴 Fork it
2. 🌿 `git checkout -b feature/cool-thing`
3. 💻 Code it up
4. 📬 `git push origin feature/cool-thing`
5. 🔥 Open a PR

Keep tests passing, code clean, and vibes positive.

---

## 📜 License

MIT — do whatever, just be cool about it.

---

<p align="center">
  Made with 🎵, ☕, and questionable life choices by <a href="https://github.com/Shashwat1729">Shashwat Bajpai</a>
  <br>
  <sub>If this helped you, <a href="https://github.com/Shashwat1729/continuemysong-ai">star the repo</a> ⭐</sub>
</p>

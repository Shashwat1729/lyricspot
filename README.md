# [Music] LyricSpot

**Sing a lyric. We'll find the song. Keep listening right where you left off.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-1DB954?logo=github)](https://shashwat1729.github.io/lyricspot/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is this?

Ever had a song stuck in your head but only remember one line? LyricSpot listens to you sing (or reads what you type), identifies the song using local AI, finds the exact second your lyric appears, and opens Spotify right at that timestamp.

**No cloud, no tracking, no paid APIs.** Everything runs on your machine.

## Features

- **Voice Input** - Sing into your mic, 30s limit, real-time waveform
- **Text Input** - Type whatever lyrics you remember
- **Local AI** - OpenAI Whisper runs entirely on your computer
- **Multi-Source Search** - YouTube + Genius + iTunes + Musixmatch in parallel
- **Precise Timestamps** - Finds the exact second your lyric appears
- **Spotify Deep Link** - One click opens Spotify at the right timestamp
- **7 Languages** - English, Hindi, Korean, Spanish, French, Portuguese, Japanese

## Quick Start

### Prerequisites
- Node.js 18+, Python 3.9+, ffmpeg

### One command (Linux/WSL)
`ash
chmod +x start.sh && ./start.sh
`

### Manual

**Backend:**
`ash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
`

**Frontend:**
`ash
cd frontend
npm install && npm run dev
`

Open **http://localhost:3000**

## Environment Variables

Copy ackend/.env.example to ackend/.env:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SPOTIFY_CLIENT_ID | Recommended | - | Spotify API client ID |
| SPOTIFY_CLIENT_SECRET | Recommended | - | Spotify API client secret |
| WHISPER_MODEL | No | base | Model size: tiny, base, small, medium |
| CORS_ORIGINS | No | - | Comma-separated allowed origins |


## Screenshots

| Voice Mode | Lyrics Mode | Results |
|:---:|:---:|:---:|
| ![Voice](docs/screenshots/homepage.png) | ![Lyrics](docs/screenshots/lyrics-input.png) | ![Results](docs/screenshots/results.png) |

## Demo

**Live site:** [shashwat1729.github.io/lyricspot/](https://shashwat1729.github.io/lyricspot/)
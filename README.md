# LumiR

A self-hosted media server for your personal movie and TV library. Browse, stream, and manage your local media collection with a clean interface, TMDB metadata, and built-in online streaming search.

## Features

- **Local library** — Auto-scans your folders, fetches posters, descriptions, ratings, and cast from TMDB
- **HLS streaming** — FFmpeg-powered remux/transcode to HLS, playable on any device
- **Online streaming search** — Searches FrenchStream and FlixHQ when a title isn't in your local library
- **Multi-user** — Accounts with role-based access (admin / user), watch progress tracking
- **Downloads management** — Queue and track downloads
- **AI descriptions** — Optional Groq integration for enriched summaries
- **Lightweight** — ~40 MB RAM at runtime

## Tech stack

| Layer | Technology |
|---|---|
| Full-stack framework | Nuxt 4 + Nitro |
| Frontend | Vue 3, Tailwind CSS, Vidstack |
| API | tRPC |
| Database | SQLite (Drizzle ORM) |
| Media processing | FFmpeg |
| Metadata | TMDB API |

## Getting started

### Prerequisites

- Node.js 22+
- FFmpeg installed on the host
- A [TMDB API key](https://www.themoviedb.org/settings/api)

### Installation

```bash
git clone https://github.com/Athenox14/LumiR.git
cd LumiR
npm install
```

### Configuration

Create a `.env` file at the root:

```env
TMDB_API_KEY=your_tmdb_api_key
NUXT_SESSION_PASSWORD=a_random_32char_secret
```

### Run

```bash
# Development
npm run dev

# Production build
npm run build
node .output/server/index.mjs
```

The app starts on `https://localhost:3000`. On first launch, a setup wizard lets you create the admin account and configure your media folders.

## Project structure

```
app/          # Vue 3 frontend (pages, components, composables)
server/
  api/        # REST endpoints (stream, images, admin)
  trpc/       # tRPC routers
  db/         # Drizzle schema (SQLite)
  providers/  # Streaming providers (FrenchStream, FlixHQ) + pipeline
  utils/      # FFmpeg engine, TMDB client, media scanner
```

## License

MIT

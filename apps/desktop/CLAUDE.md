# CLAUDE.md

Electron + React desktop app for YouTube downloads, transcripts, and study materials (yt-dlp based).

## Commands

```bash
npm run dev              # Development with hot reload
npm run type-check       # TypeScript validation
npm run lint:fix         # ESLint with auto-fix
npm run test             # Jest unit tests
npm run knip             # Find unused code/dependencies
npm run package:auto     # Build production app and open for testing
npm run release:no-draft # Release to GitHub (auto-publish)
npm run db:studio        # Drizzle Studio for database inspection
npm run db:generate      # Generate database migrations
```

## Architecture

**Electron Processes:**
- Main (`src/main.ts`): Window, database, download queue, tRPC handler
- Renderer (`src/App.tsx`): React + TanStack Router
- Preload (`src/preload.ts`): Secure IPC bridge

**IPC:** electron-trpc. Routers in `src/api/routers/`, client in `src/utils/trpc.ts`

**Database:** Drizzle + SQLite (WAL mode). Schema: `src/api/db/schema.ts`

**State:** Jotai (UI) + React Query via tRPC (server) + SQLite (persistent)

**Key Paths:**
- `src/api/` - Main process, tRPC routers, database
- `src/components/` - React components (`ui/` = Shadcn primitives)
- `src/pages/` - Page components
- `src/routes/` - TanStack Router config
- `src/atoms/` - Jotai atoms
- `src/services/` - Business logic (download queue)

## Code Style

- **Max 300 lines** per component file
- **Prefer functions** over classes
- **tRPC hooks** directly in components (no thin wrappers)
- **Path alias:** `@/*` maps to `src/*`

## Media Streaming (macOS)

Renderer uses `local-file://` protocol, not `file://` - main process streams bytes to avoid Chromium demuxer errors.

## Database Migrations

Located in `drizzle/`. Auto-backup before migration (keeps 5). Recovery wipes corrupted DB if retries fail.

## Database Location

Resolved in `src/utils/paths.ts`:

- **Dev** (`npm run dev`): `apps/desktop/local.db`
- **Packaged**: `~/Library/Application Support/LearnifyTube/local.db`
- **Custom**: set in Settings, stored in `<userData>/database-path.json`; overrides both. `LEARNIFYTUBE_FORCE_DEV_DB=true` ignores it.

```bash
sqlite3 local.db "SELECT video_id, title, download_status FROM youtube_videos WHERE download_status = 'failed';"
```

## Mobile Sync Server

`src/main/mobileSyncServer.ts` is the HTTP server the mobile/TV app talks to — a second entry point beside the tRPC routers. Keep its payloads in step with `apps/shared/mobile-sync-contract.ts` and `apps/mobile/services/api.ts`.

Every request must carry the pairing code (`Authorization: Bearer` or a `token` query param for image/video URLs) and no `Origin` header; `src/main/security/sync-auth.ts` decides, `pairing-store.ts` persists the code in `<userData>/mobile-sync-pairing.json`. Files served to the renderer (`local-file://`, `mediaServer`) go through `src/main/security/path-confinement.ts`.

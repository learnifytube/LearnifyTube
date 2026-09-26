# CLAUDE.md

Expo app (phone + Android TV) that syncs downloaded YouTube videos from the LearnifyTube desktop app over local WiFi and plays them offline with transcripts, word lookup, and flashcards.

## Commands

```bash
npm start                   # Expo dev server (phone surface)
npm run start:tv            # Expo dev server forced to TV surface
npm run android             # Run on Android emulator
npm run type-check
npm run lint
npm run check:ui-boundaries # Phone/TV route isolation check
npm test                    # jest-expo
```

Verify with `test`, `type-check`, `lint`, and `check:ui-boundaries`. Tests exercise modules through their public interface with a fake platform built via the module's factory; no module mocking.

## Two Surfaces

`app/index.tsx` redirects to `app/(mobile)` or `app/(tv)` via `getAppSurface()` (`core/hooks/useAppSurface.ts`: `EXPO_PUBLIC_APP_SURFACE`, else `Platform.isTV`).

- `app/(mobile)` — phone: tab navigator, player, sync, share (P2P), saved playlists.
- `app/(tv)` — Android TV: d-pad navigation, player with overlay controls, channel browsing.

The two route groups import and navigate only within themselves; `scripts/check-ui-boundaries.sh` enforces it. Put shared code in `components/`, `core/`, `services/`, `stores/`, or `db/`.

## Architecture

- **Desktop sync** — `services/api.ts` is the REST client for the desktop's mobile sync server; the version handshake lives in `apps/shared/mobile-sync-contract.ts`.
- **Downloads** — queued in `stores/downloads.ts` (AsyncStorage-persisted; in-flight items reset to queued on hydration), driven by `hooks/useDownloadProcessor.ts`, processed by `services/downloadManager.ts` (concurrency, retry backoff, cancellation). `services/downloader.ts` transfers to a temp file, then the manager hands it to the Offline copy module's `adopt`.
- **Persistence** — SQLite via expo-sqlite + Drizzle (`db/schema.ts`, `db/repositories/`); migrations run on app start. Zustand stores in `stores/`; `library.ts` mirrors SQLite, the rest persist to AsyncStorage.
- **P2P sharing** — `services/p2p/`: mDNS discovery (react-native-zeroconf) plus a local server/client. The server serves Offline copies via `offlineCopy.readBytes`; the client downloads to a temp file and the share screen calls `adopt`.
- **File system** — prefer the expo-file-system SDK 54+ `Paths`/`Directory`/`File` API for new code; `downloader.ts`, `storage-location.ts`, `app-update.ts`, and the Offline copy platform still use `expo-file-system/legacy` (picked-folder `content://` URIs).

## Offline copies

`services/offline-copy/` owns a Video's Offline copy in every Storage location (internal, picked folder, USB folder): `offlineCopy.getUri(videoId)`, `offlineCopy.useUri(videoId)`, `offlineCopy.useLookup()` (a `getUri` for screens checking many Videos, re-rendering on any change), `offlineCopy.readBytes(videoId)` for peer-to-peer serving, and `adopt` for finished Downloads and peer-to-peer receives. It is the only writer of the videos table's `localPath` record; the app shell (`hooks/useOfflineCopyScans.ts`) triggers its scans. Choosing a Storage location stays in `services/storage-location.ts`.

TV screens, phone screens and `VideoCard` ask the module: `useUri` / `useLookup` for anything rendered, and `getUri` (or the `useLookup` function, which reads through to it) in handlers and wait loops. Nothing else carries a location: the play queue (`StreamingVideo`), TV history, watch history, the library `Video` and saved-playlist items have none, and players resolve the Offline copy when each Video starts. The Offline copy module is the one way to find a Video's file: don't build video file paths or check for their existence outside `services/offline-copy/`.

## Theme

Styling tokens come from `theme/` (`colors`, `spacing`, `radius`, `fontSize`, `fontWeight`), matching the desktop dark palette; icons come from `theme/icons.ts` (lucide-react-native). Use these tokens in `StyleSheet.create` rather than literal colors or sizes.

# CLAUDE.md

Expo app (phone + Android TV) that pulls Videos from the LearnifyTube desktop app over local WiFi and plays them, including Offline.

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

Phone/TV UI against an isolated desktop: `.cursor/skills/verify/SKILL.md`. AVDs are `LearnifyPhone` and `LearnifyTV` (`npm run emulator:phone` / `emulator:tv`).

## Two Surfaces

`app/index.tsx` redirects to `app/(mobile)` or `app/(tv)` via `getAppSurface()` (`core/hooks/useAppSurface.ts`: `EXPO_PUBLIC_APP_SURFACE`, else `Platform.isTV`).

- `app/(mobile)` — phone: Home catalog, On this phone, player, pairing, share (P2P).
- `app/(tv)` — Android TV: d-pad navigation, player with overlay controls, channel browsing.

On the TV, hardware Back goes through one handler that `app/(tv)/_layout.tsx` mounts (`components/tv/tvBack.ts`): it pops the stack, lands on the TV home when there's nothing to pop, and exits from the home screen. A screen takes Back first with `useTVBackInterceptor` (the home grid, a channel's open playlist). `app/+native-intent.tsx` sends `learnify://` deep links into the TV group on the TV surface. Keep `predictiveBackGestureEnabled` off in `app.json`: with it on, Android 13–15 finish the activity on Back without telling JS.

The two route groups import and navigate only within themselves; `scripts/check-ui-boundaries.sh` enforces it. Put shared code in `components/`, `core/`, `services/`, `stores/`, or `db/`.

## Architecture

- **Desktop sync** — `services/api.ts` is the REST client for the desktop's mobile sync server; the version handshake lives in `apps/shared/mobile-sync-contract.ts`. It attaches the pairing code from `stores/connection.ts` to every request, and to image/video URLs as `?token=`; build desktop URLs with its `get*Url` helpers. A 401 surfaces as `PairingRequiredError`.
- **Desktop connection** — `services/desktop-connection/` owns the TV's connection to the desktop: `desktopConnection.useConnection()` (status `connecting` / `connected` / `offline` / `pairingRequired` / `incompatible`, the desktop's name, discovered desktops), `pair(code, address?)`, `connectManually(address)`, `retryNow()` and `disconnect()`. It tries the saved address, mDNS peers, the emulator host and the legacy port, retries with backoff (3 s up to 60 s) while in the foreground, and health-checks the desktop every 15 s; only that health check decides Offline mode. On the TV it publishes the connected desktop as the connection store's `serverUrl` (the saved address is `savedUrl`); `app/_layout.tsx` starts it on the TV surface only.
- **Downloads** — `services/download-queue/` owns the Download queue: `downloadQueue.request(video)` (does nothing if the Offline copy exists or the Download is on its way; retries a failed one), `cancel`, `waitUntilReady(videoId, signal)` (aborting stops the wait, not the Download), `getDownload`, and the `useDownload` / `useQueue` hooks. Inside, it waits for the desktop to fetch the Video, transfers two at a time with retry backoff, adds the Video to the library and hands the file to the Offline copy module's `adopt`; it runs only while the desktop is connected and the app is in the foreground (`app/_layout.tsx` starts it) and persists to AsyncStorage.
- **Video thumbnails** — `services/video-thumbnails/` stores each held Video's thumbnail as a file on the Device, so it shows in Offline mode: the Download queue stores it when a Download finishes, the Device mirror backfills held Videos missing one, and `stores/library.ts` removes it with the Video. Screens use `videoThumbnails.useLookup()` and fall back to the desktop URL when it returns null.
- **TV catalog** — `components/tv/tvCatalog.ts` `buildTVCatalog` decides the TV home tabs' cards, what each card opens, and the empty-state text. While connected it shows the desktop's catalog; otherwise (Offline mode, including `connecting` on a cold start) only collections, channels and History holding a Video with an Offline copy, and opening one plays only those Videos. My Lists starts with a "Sent to this TV" card for the On-device set, which the Device mirror keeps in `stores/onDeviceSet.ts` for Offline mode; while connected, card badges add how many of a card's Videos are "on this TV" (have an Offline copy). Its sibling `components/tv/tvChannel.ts` does the same for a channel screen: `heldChannelContents` (what the TV holds from the channel) and `buildTVChannelView` (the cards, what each opens or plays, the empty text), with the same rule; the screen only loads, keeps focus and renders.
- **Play queue** — `services/play-queue/` `playQueue.start({ id, title, videos, startIndex })` starts playing a list of Videos and returns the Video to open (null when the list is empty); on the TV it also records the queue in TV history (`stores/tvHistory.ts`). Every screen starts a queue through it; the queue's state lives in `stores/playback.ts`. It holds no desktop address: the TV player takes it from the Desktop connection and the phone player from the connection store's current `serverUrl`, when each Video starts.
- **Desktop fetch** — `services/desktop-fetch/` `desktopFetch.waitUntilFetched(serverUrl, videoId, { signal, onProgress })` asks the desktop to fetch a Video from YouTube and waits until it serves the file (a 200 or 206; a 202 means the desktop lost the file and is fetching it again), rejecting with `DesktopFetchFailedError` or, after 10 minutes, `DesktopStillFetchingError`. The Download queue and the Playback source wait through it; don't poll the desktop's download status anywhere else.
- **TV player** — `services/playback-source/` decides what the TV player plays: `playbackSource.useSource({ videoId, queue, index, getPosition })` returns the source (`preparing` with progress, `offline` with `resumeAt`, `stream`, `failed` with a typed failure and `canRetry`, or `desktopLost` with the next held Video's index or null), `upNext` for the warmed next Video, and `retry`. The desktop's address comes only from the Desktop connection, never the Play queue. When the desktop drops out while the player depends on it, the source becomes the Offline copy at the same position, else `desktopLost`; the screen then plays the next held Video or goes back. The screen words failures with `components/tv/tvMessages.ts` and keeps navigation and the remote overlay; `components/tv/remoteKeys.ts` `decideRemoteKey` decides what each remote key does to the overlay (wake it, seek, hide it, keep it showing), and the screen keeps the auto-hide timer and the focus graph. A short notice that outlives the screen raising it goes through `stores/tvNotice.ts`; `TVNoticeHost` in `app/(tv)/_layout.tsx` shows it for a few seconds without taking focus.
- **Persistence** — SQLite via expo-sqlite + Drizzle (`db/schema.ts`, `db/repositories/`); migrations run on app start. Zustand stores in `stores/`; `library.ts` mirrors SQLite, the rest persist to AsyncStorage.
- **P2P sharing** — `services/p2p/`: mDNS discovery (react-native-zeroconf) plus a local server/client. The server serves Offline copies via `offlineCopy.readBytes`; the client downloads to a temp file and the share screen calls `adopt`.
- **File system** — prefer the expo-file-system SDK 54+ `Paths`/`Directory`/`File` API for new code; `storage-location.ts`, the Download queue platform, `app-update.ts`, and the Offline copy platform still use `expo-file-system/legacy` (picked-folder `content://` URIs).

## Offline copies

`services/offline-copy/` owns a Video's Offline copy in every Storage location (internal, picked folder, USB folder): `offlineCopy.getUri(videoId)`, `offlineCopy.useUri(videoId)`, `offlineCopy.useLookup()` (a `getUri` for screens checking many Videos, re-rendering on any change), `offlineCopy.readBytes(videoId)` for peer-to-peer serving, `adopt` for finished Downloads and peer-to-peer receives, and `remove` for Videos deleted from the library (`stores/library.ts`). It is the only writer of the videos table's `localPath` record; the app shell (`hooks/useOfflineCopyScans.ts`) triggers its scans. Choosing a Storage location stays in `services/storage-location.ts`.

TV screens, phone screens and `VideoGridCard` ask the module: `useUri` / `useLookup` for anything rendered, and `getUri` (or the `useLookup` function, which reads through to it) in handlers and wait loops. Nothing else carries a location: the Play queue (`StreamingVideo`), TV history, watch history and the library `Video` have none, and players resolve the Offline copy when each Video starts. The Offline copy module is the one way to find a Video's file: don't build video file paths or check for their existence outside `services/offline-copy/`.

## Theme

Styling tokens come from `theme/` (`colors`, `spacing`, `radius`, `fontSize`, `fontWeight`), matching the desktop dark palette; icons come from `theme/icons.ts` (lucide-react-native). Use these tokens in `StyleSheet.create` rather than literal colors or sizes. TV screens add `theme/tv.ts`: `tvFontSize` for viewing across a room, and `tvFocus` / `tvRestingBorder`, the one focus treatment (a white ring) every focusable TV element uses.

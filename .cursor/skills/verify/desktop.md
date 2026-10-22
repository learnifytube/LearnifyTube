# Desktop

The isolated desktop is a second Electron process. `LEARNIFYTUBE_USER_DATA_DIR` is applied in `apps/desktop/src/main/userDataOverride.ts` **before** the single-instance lock, so it runs beside the installed app. Its log goes to `<folder>/logs/main.log` (`apps/desktop/src/helpers/logger.ts`); its terminal output to `npm run verify -- logs desktop`.

## Seed

`npm run verify -- up` seeds when the folder has no marker; `up --fresh` reseeds. `apps/desktop/scripts/verify-seed.ts` writes:

- Two channels: Little Science Lab, Calm Bedtime Stories
- Six fetched videos (`vrfyVideo01`–`06`) with H.264 mp4, jpg thumbs, English transcripts
- One unfetched video `vrfyVideo07` ("Not on the desktop yet")
- Playlist "Science for kids", My List "Bedtime" marked on-device
- Movies "The Tiny Test Movie" (40 s, sent to Devices, English Caption) and "Streaming Only" (30 s, not sent); Series "Tiny Tales" with Season 1 (3 Episodes, sent) and Season 2 (1 Episode, not sent). Files under `<folder>/media/`, posters in `movie-posters/`. A paired TV or phone Mirrors the sent ones on its first sync; flip `movies.sent_to_devices` / `seasons.sent_to_devices` in `local.db` with `sqlite3` to watch one arrive or leave within the 2-minute sync.
- `mobile-sync-pairing.json` with `VERFY234`
- Preferences with sync enabled on port `53318`

It refuses to wipe a folder that is missing the `.verify-desktop` marker.

If Vite 504s after a killed start, delete `apps/desktop/.vite/deps_temp_*` and run `up` again.

## Screenshots (CDP)

```bash
npm run verify -- shot desktop                      # current screen
npm run verify -- shot desktop --sidebar Devices
npm run verify -- shot desktop --sidebar "Up next" --click "Why is the sky blue?"
```

The renderer uses **memory history**: `page.goto` will not change screens. `scripts/desktop-shot.mjs` clicks a sidebar `<a>` by its visible title. Useful titles: `Up next`, `Library`, `Lists`, `Channels`, `YouTube playlists`, `Subscriptions`, `Devices`, `Storage`, `Settings`.

Confirm pairing code `VERFY234` and port `53318` on Devices / Settings → Sync when pairing misbehaves.

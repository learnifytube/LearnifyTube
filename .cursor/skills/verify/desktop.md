# Desktop

The verify desktop is a second Electron process. `LEARNIFYTUBE_USER_DATA_DIR` is applied in `apps/desktop/src/main/userDataOverride.ts` **before** the single-instance lock, so it can run beside the installed app.

## Seed

`apps/desktop/scripts/verify-seed.ts` writes:

- Two channels: Little Science Lab, Calm Bedtime Stories
- Six fetched videos (`vrfyVideo01`–`06`) with H.264 mp4, jpg thumbs, English transcripts
- One unfetched video `vrfyVideo07` (“Not on the desktop yet”)
- Playlist “Science for kids”, My List “Bedtime” marked on-device
- `mobile-sync-pairing.json` with `VERFY234`
- Preferences with sync enabled on port `53318`

It refuses to wipe a folder that is missing the `.verify-desktop` marker.

## Launch

From `apps/desktop`:

```bash
tail -f /dev/null | LEARNIFYTUBE_USER_DATA_DIR="${TMPDIR%/}/learnify-verify-desktop" \
  npx electron-forge start -- --remote-debugging-port=9333
```

If Vite 504s after a killed start, delete `apps/desktop/.vite/deps_temp_*` and start again. Do not send Ctrl+C into a Forge that is still optimizing deps unless you will clean those folders.

Health: `curl -sS -H 'Authorization: Bearer VERFY234' http://127.0.0.1:53318/info`

## Screenshots (CDP)

The renderer uses **memory history**. `page.goto` will not change screens. `desktop-shot.mjs` clicks a sidebar `<a>` by its visible title.

Useful titles: `Up next`, `Library`, `Lists`, `Channels`, `YouTube playlists`, `Subscriptions`, `Devices`, `Storage`, `Settings`.

Player: `--click "Why is the sky blue?"` after opening `Up next` or a channel.

```bash
node .cursor/skills/verify/scripts/wait-cdp.mjs
node .cursor/skills/verify/scripts/desktop-shot.mjs --out /tmp/learnify-verify-out/up-next.png
node .cursor/skills/verify/scripts/desktop-shot.mjs --out /tmp/learnify-verify-out/devices.png --sidebar Devices
```

Confirm pairing code `VERFY234` and port `53318` on Devices / Settings → Sync before pairing a device.

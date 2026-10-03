---
name: verify
description: Run LearnifyTube UI verification against an isolated desktop, phone emulator, and Android TV emulator with seeded test data, Playwright CDP screenshots, and Maestro. Use when verifying UI/UX, taking screenshots, pairing phone or TV to desktop, or checking desktop/mobile/TV together without touching the user's installed app.
---

# Verify

Drive the three apps against a **private** desktop so verification never opens the user's library or pairing code.

Keep the user's `LearnifyTube.app` running if they want. The isolated desktop uses a different user-data folder and sync port `53318`.

## When to read the rest

- Desktop only → [desktop.md](desktop.md)
- Phone emulator → [phone.md](phone.md)
- Android TV emulator → [tv.md](tv.md)
- Pairing / sync across apps → [cross-app.md](cross-app.md)

## Constants

| What | Value |
| --- | --- |
| Isolated folder | `$TMPDIR/learnify-verify-desktop` (must contain `.verify-desktop` after seed) |
| Sync port | `53318` |
| Pairing code | `VERFY234` |
| CDP | `http://127.0.0.1:9333` |
| Emulator → host desktop | `http://10.0.2.2:53318` |
| Phone AVD | `LearnifyPhone` |
| TV AVD | `LearnifyTV` |
| Android package | `com.learnifytube.mobile` |
| Deep link | `learnify://connect` |

## One-time tools

- `ffmpeg` on PATH (seed generates mp4/jpg/vtt)
- Playwright in `apps/desktop` (`npx playwright` from that package)
- Android SDK emulator + `adb`; AVDs `LearnifyPhone` and `LearnifyTV`
- Maestro (`maestro --version`) for phone/TV flows

## Always isolate

1. Seed (wipes only a folder it created):

```bash
npm run verify:seed --prefix apps/desktop -- "${TMPDIR%/}/learnify-verify-desktop"
```

2. Start desktop from `apps/desktop` with stdin held open (Forge exits if stdin closes):

```bash
cd apps/desktop
tail -f /dev/null | LEARNIFYTUBE_USER_DATA_DIR="${TMPDIR%/}/learnify-verify-desktop" \
  npx electron-forge start -- --remote-debugging-port=9333
```

Wait until CDP answers:

```bash
node .cursor/skills/verify/scripts/wait-cdp.mjs
```

3. Metro, pinned so the emulator never finds the user's desktop:

```bash
cd apps/mobile
EXPO_PUBLIC_VERIFY_DESKTOP_URL=http://10.0.2.2:53318 \
EXPO_PUBLIC_APP_SURFACE=mobile \
npm start
```

Use `EXPO_PUBLIC_APP_SURFACE=tv` for the TV surface.

Do not kill unrelated `ffmpeg` or the user's Electron app. Stop only the verify desktop (the Forge process whose `LEARNIFYTUBE_USER_DATA_DIR` is the verify folder) and the Metro you started.

## Screenshots

Desktop (optional `--sidebar "Library"`; titles match the desktop sidebar):

```bash
node .cursor/skills/verify/scripts/desktop-shot.mjs \
  --out /tmp/learnify-verify-out/desktop-library.png \
  --sidebar Library
```

Device:

```bash
.cursor/skills/verify/scripts/adb-screencap.sh /tmp/learnify-verify-out/phone.png
```

Maestro flows live in `flows/`. Copy PNGs the user asked to see into the chat; leave raw captures under `/tmp/learnify-verify-out` (not committed).

## After a UI change

Re-run the surface you touched. A phone empty-state change is not done until Maestro or a screencap shows Channels/Library/Settings as a person would. Desktop Playwright e2e under `apps/desktop/src/tests/e2e` launches a **packaged** app with the user's dev db flags — do not use that for this isolated library.

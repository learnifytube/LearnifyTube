---
name: verify
description: Run LearnifyTube UI verification against an isolated desktop, phone emulator, and Android TV emulator with seeded test data, Playwright CDP screenshots, and Maestro. Use when verifying UI/UX, taking screenshots, pairing phone or TV to desktop, or checking desktop/mobile/TV together without touching the user's installed app.
---

# Verify

Drive the three apps against a **private** desktop so verification never opens the user's library or pairing code. The user's `LearnifyTube.app` can keep running.

## Words

- **Verify environment**: the isolated desktop, the verify Metro, and the `LearnifyPhone` / `LearnifyTV` emulators, all started by `npm run verify`.
- **Isolated desktop**: a second Electron process with its own user-data folder, sync port, pairing code and log.
- **Surface**: phone or TV. One Metro serves both; each emulator gets its surface from `Platform.isTV`.
- **Flow**: a Maestro file in `flows/`, named for its surface (`phone-*.yaml`, `tv-*.yaml`).

## Commands

Run from the repo root.

```bash
npm run verify -- up            # desktop + Metro + both emulators, apps launched
npm run verify -- pair          # pair phone and TV (ends on each Home)
npm run verify -- run phone-browse tv-pair   # flows, one folder each
npm run verify -- shot desktop --sidebar Library   # or: shot phone | shot tv
npm run verify -- status
npm run verify -- logs desktop  # or metro | phone | tv
npm run verify -- down          # `down desktop` for Offline; --emulators shuts those too
```

- `up` reuses whatever is healthy and restarts what is not. Run it whenever unsure.
- `up phone` / `up tv` limits it to one surface. `--headless` boots emulators without a window.
- `up --fresh` reseeds the desktop and wipes app data on the emulators (pairing, cache, Offline copies). Pair again afterwards.
- A desktop that answers GET but hangs on POST is issue #29; `up` restarts it and says so. The desktop logs each stuck POST ("Stuck POST body (issue #29)"), and `status` / `up` print how many are in its log. If they report one, add its log entry to #29 before anything else.
- `up` never builds. If the app is missing it prints `npm run verify -- install phone|tv`, which runs `expo run:android` (slow). Only needed after a native change.
- `down` stops only processes carrying the verify environment's markers. It never touches the user's app or port 8384.

## Results

- `run` writes each flow to `/tmp/learnify-verify-out/<YYYYMMDD-HHMMSS>-<flow>/` with `latest` pointing at the newest: Maestro output, `screenshots/*.png` from `takeScreenshot`, and `desktop.log` for that window. It prints the PNG paths; on failure, the failing step and Maestro's failure screenshot.
- `shot` writes to `/tmp/learnify-verify-out/shots/`.
- Copy PNGs the user asked to see into the chat; leave raw captures there (not committed).

## Writing a flow

- Start with `appId: com.learnifytube.mobile`. Name the file `phone-…` or `tv-…` so `run` picks the emulator.
- Pairing is `phone-pair` / `tv-pair`; scenario flows assume a paired device and start with `launchApp`.
- Prefer `testID`s over visible text; titles truncate. Per-surface IDs are in [phone.md](phone.md) and [tv.md](tv.md).
- To open a screen from cold, use `stopApp` then `openLink` (a link sent while the bundle loads is dropped), and wait with `extendedWaitUntil` (first bundle after a restart can take a minute).
- On TV, `hideKeyboard` after `inputText`: while the keyboard is up Maestro sees only its window.

## Constants

| What | Value |
| --- | --- |
| Isolated folder | `$TMPDIR/learnify-verify-desktop` (has `.verify-desktop` after seed; log in `logs/main.log`) |
| Run files (process logs) | `$TMPDIR/learnify-verify-run` |
| Sync port | `53318` |
| Pairing code | `VERFY234` |
| CDP | `http://127.0.0.1:9333` |
| Verify Metro | `8090` (apps reach it at `10.0.2.2:8090`) |
| Emulator → desktop | `http://10.0.2.2:53318` |
| AVDs | `LearnifyPhone`, `LearnifyTV` |
| Android package | `com.learnifytube.mobile` |
| Deep link | `learnify://connect` |

## One-time tools

- `ffmpeg` on PATH (seed generates mp4/jpg/vtt)
- Playwright in `apps/desktop`
- Android SDK emulator + `adb`; AVDs `LearnifyPhone` and `LearnifyTV`
- Maestro (`maestro --version`)

## More

- Desktop seed, screenshots → [desktop.md](desktop.md)
- Phone flows and testIDs → [phone.md](phone.md)
- TV flows and testIDs → [tv.md](tv.md)
- Pairing / sync across apps → [cross-app.md](cross-app.md)

## Under the hood

For when `npm run verify` itself breaks (code: `scripts/verify/`):

- Desktop: `LEARNIFYTUBE_USER_DATA_DIR=<folder> npx electron-forge start -- --remote-debugging-port=9333` from `apps/desktop`. Forge quits when stdin closes, so the tool gives it a fifo it holds open itself. Seed with `npm run verify:seed --prefix apps/desktop -- <folder>` (wipes only a folder with the marker).
- Metro: `npx expo start -c --port 8090` from `apps/mobile` with `EXPO_PUBLIC_VERIFY_DESKTOP_URL=http://10.0.2.2:53318` and no `EXPO_PUBLIC_APP_SURFACE`.
- Debug APKs look for Metro at `10.0.2.2:8081`, which `adb reverse` cannot redirect. The tool writes React Native's `debug_http_host` (`10.0.2.2:8090`) into the app's `shared_prefs/com.learnifytube.mobile_preferences.xml`, then starts `.MainActivity` by name (`monkey` lands on the TV's FallbackHome).
- `pm clear` resets runtime permissions; the tool grants them again so no prompt covers the app.
- The desktop and Metro are found by environment markers (`LEARNIFYTUBE_USER_DATA_DIR=<folder>`, `LEARNIFY_VERIFY_METRO=1`); emulators by asking each one its AVD name (`adb -s <serial> emu avd name`).

## After a UI change

Re-run the surface you touched. A phone empty-state change is not done until a flow or `shot` shows it as a person would. Desktop Playwright e2e under `apps/desktop/src/tests/e2e` launches a **packaged** app with the user's dev db flags — do not use that for this isolated library.

# Phone

AVD: `LearnifyPhone` (Pixel 7, API 34). `npm run verify -- up phone` boots it, points the app at the verify Metro and launches it.

`EXPO_PUBLIC_VERIFY_DESKTOP_URL` (set by the verify Metro) is read in `apps/mobile/services/verify-desktop.ts`. It pins `services/desktop-connection` to the verify desktop, prefills the connect address, and sets the pairing code to `VERFY234` (so a previous session cannot keep a bad code). Verify builds also turn off the LogBox banner (it covered the tab bar and caught taps); warnings still print in `npm run verify -- logs metro`.

## Flows

| Flow | What it does |
| --- | --- |
| `phone-pair` | Cold-launches into `learnify://connect`, connects with the prefilled address and code, ends on Home ("Little Science Lab" visible). |
| `phone-browse` | Needs a paired phone. See all + hardware Back, play, skip next/previous, Back to Home, On this phone. Screenshots `phone-see-all`, `phone-player-start`, `phone-player-next`, `phone-on-this-phone`. |

The pairing UI is `app/(mobile)/connect.tsx` (modal). Settings only discovers an IP; it does **not** collect the pairing code. After connect, Home opens (Continue watching / Sent to this phone / channel and list rows). There is no Download confirm.

## testIDs

`connect-submit`, `row-see-all-<row id>` (e.g. `row-see-all-channel-UCverifyScience01`), `row-grid-back`, `player-back`, `next-video`, `previous-video`, `captions-toggle`. Prefer them over titles: the Magnets title truncates.

## What to look at

Tabs: Home, On this phone, Settings. Player is a full-screen modal. Tap a poster to play; a Download starts in the background.

Offline: `npm run verify -- down desktop` stops only the isolated desktop; `up` brings it back. Home should keep rows that still have Offline copies; streaming a video without an Offline copy should explain itself.

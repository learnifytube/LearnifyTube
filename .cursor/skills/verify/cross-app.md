# Cross-app

Seeded desktop on `53318` + emulator using `10.0.2.2:53318` + pairing `VERFY234`.

## Order

1. Seed and start the verify desktop (CDP 9333). Confirm `/info` with the bearer token.
2. Start the AVD you need (`LearnifyPhone` or `LearnifyTV`), not both unless you set `ANDROID_SERIAL`.
3. Start Metro with `EXPO_PUBLIC_VERIFY_DESKTOP_URL` and the matching `EXPO_PUBLIC_APP_SURFACE`.
4. Pair through `learnify://connect` (phone Settings must not be the only door — that screen has no pairing field).
5. Browse Little Science Lab / Calm Bedtime Stories. Play `vrfyVideo01`. Open `vrfyVideo07` only when you want the “desktop has not fetched this” path.
6. Screenshot desktop Devices while the phone or TV is paired if you need the device list.

## Do not

- Point Metro at `8384` (the user's desktop).
- Wipe a user-data folder that lacks `.verify-desktop`.
- Stop random `ffmpeg` PIDs; seed ffmpeg is short-lived.
- Use `apps/desktop` Playwright e2e specs; they are not this isolated library.

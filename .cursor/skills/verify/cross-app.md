# Cross-app

Seeded desktop on `53318` + emulators reaching it at `10.0.2.2:53318` + pairing `VERFY234`.

## Order

1. `npm run verify -- up` (add `--fresh` to start from an unpaired, freshly seeded state).
2. `npm run verify -- pair`.
3. Browse Little Science Lab / Calm Bedtime Stories. Play `vrfyVideo01`. Open `vrfyVideo07` only when you want the "desktop has not fetched this" path.
4. `npm run verify -- shot desktop --sidebar Devices` while the phone or TV is paired if you need the device list.

## Do not

- Point anything at `8384` (the user's desktop).
- Wipe a user-data folder that lacks `.verify-desktop`.
- Stop random `ffmpeg` PIDs; seed ffmpeg is short-lived.
- Use `apps/desktop` Playwright e2e specs; they are not this isolated library.

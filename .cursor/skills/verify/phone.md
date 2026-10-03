# Phone

AVD: `LearnifyPhone` (Pixel 7, API 34). Start it with `npm run emulator:phone --prefix apps/mobile` and wait for `adb shell getprop sys.boot_completed` → `1`.

## Metro

```bash
cd apps/mobile
EXPO_PUBLIC_VERIFY_DESKTOP_URL=http://10.0.2.2:53318 \
EXPO_PUBLIC_APP_SURFACE=mobile \
npm start
```

`EXPO_PUBLIC_VERIFY_DESKTOP_URL` is read in `apps/mobile/services/verify-desktop.ts`. It pins `services/desktop-connection` to that URL, prefills the phone connect address, and sets the pairing code to `VERFY234` (so a previous session cannot keep a bad code).

Load the app with `npm run android --prefix apps/mobile` if it is not already installed, or open it from the Expo dev client / `adb shell monkey -p com.learnifytube.mobile 1`.

## Pairing

The pairing UI is `app/(mobile)/connect.tsx` (modal). Settings only discovers an IP; it does **not** collect the pairing code. Open connect via Settings → “Pair with desktop”, the Channels empty state, or:

```bash
adb shell am start -a android.intent.action.VIEW -d "learnify://connect" com.learnifytube.mobile
```

Maestro (desktop + Metro already up):

```bash
maestro test .cursor/skills/verify/flows/phone-pair.yaml
```

Code `VERFY234`. Address should already be `http://10.0.2.2:53318`. After connect, Home opens (Continue watching / Sent to this phone / channel and list rows). There is no Download confirm.

## What to look at

Tabs: Home, On this phone, Settings. Player is a full-screen modal. Tap a poster to play; a Download starts in the background.

Offline: stop **only** the verify Forge process (port 53318). Do not kill the user's app on 8384. Home should keep rows that still have Offline copies; streaming a video without an Offline copy should explain itself.

Screencap: `.cursor/skills/verify/scripts/adb-screencap.sh /tmp/learnify-verify-out/phone-channels.png`

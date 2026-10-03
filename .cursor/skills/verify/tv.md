# Android TV

AVD: `LearnifyTV`. Start with `npm run emulator:tv --prefix apps/mobile`.

If both phone and TV emulators are up, pin adb with `ANDROID_SERIAL` (`adb devices -l`).

## Metro

```bash
cd apps/mobile
EXPO_PUBLIC_VERIFY_DESKTOP_URL=http://10.0.2.2:53318 \
EXPO_PUBLIC_APP_SURFACE=tv \
npm start
```

Install/open: `npm run android:tv --prefix apps/mobile`.

## Pairing

TV pairing is `app/(tv)/connect.tsx`. Deep link `learnify://connect` is rewritten into the TV group by `app/+native-intent.tsx`.

```bash
adb shell am start -a android.intent.action.VIEW -d "learnify://connect" com.learnifytube.mobile
```

Enter `VERFY234`. With the URL pinned, **Connect** (no address needed) talks to the verify desktop.

Maestro drives the D-pad:

```bash
maestro test .cursor/skills/verify/flows/tv-pair.yaml
```

Hardware Back is owned by `components/tv/tvBack.ts`. Do not enable `predictiveBackGestureEnabled`.

## What to look at

Home tabs and channel grids (`components/tv/tvCatalog.ts`, `tvChannel.ts`), player overlay (`decideRemoteKey` in `components/tv/remoteKeys.ts`), Offline badges (“on this TV”). Focus is a white ring (`theme/tv.ts`).

Screencap the TV serial the same way as phone, after setting `ANDROID_SERIAL`.

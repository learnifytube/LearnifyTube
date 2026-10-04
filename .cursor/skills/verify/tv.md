# Android TV

AVD: `LearnifyTV`. `npm run verify -- up tv` boots it, points the app at the verify Metro and launches it. The TV surface comes from `Platform.isTV`, so the same Metro serves phone and TV at once.

With the verify desktop URL pinned, the TV connects to it on launch even before `tv-pair`.

## Flows

| Flow | What it does |
| --- | --- |
| `tv-pair` | Cold-launches into `learnify://connect`, types `VERFY234`, hides the keyboard, presses Connect, ends on Home ("Science for kids" visible). |

TV pairing is `app/(tv)/connect.tsx`. Deep link `learnify://connect` is rewritten into the TV group by `app/+native-intent.tsx`. A TV screen opened from a link has no history; Back falls back to Home (`goBackOrTVHome` in `components/tv/tvBack.ts`).

## testIDs

`pairing-code-input`, `tv-connect-submit`.

## What to look at

Home tabs and channel grids (`components/tv/tvCatalog.ts`, `tvChannel.ts`), player overlay (`decideRemoteKey` in `components/tv/remoteKeys.ts`), Offline badges ("on this TV"). Focus is a white ring (`theme/tv.ts`). Hardware Back is owned by `components/tv/tvBack.ts`; do not enable `predictiveBackGestureEnabled`.

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[smoke-tv] type-check"
npm run type-check

echo "[smoke-tv] lint"
npm run lint

echo "[smoke-tv] ui boundaries"
npm run check:ui-boundaries

if [[ "${SMOKE_TV_PLAYER:-}" != "1" ]]; then
  echo "[smoke-tv] Ready to run on device: EXPO_PUBLIC_APP_SURFACE=tv npm start"
  echo "[smoke-tv] With a Video playing in the TV player, SMOKE_TV_PLAYER=1 runs the remote walkthrough."
  exit 0
fi

# Remote walkthrough of the TV player. Start with a Video playing.
# Compare the screenshots and positions against the expectations printed for each step.
shots="${SMOKE_TV_SHOTS:-$(mktemp -d)/smoke-tv-player}"
mkdir -p "$shots"

key() { adb shell input keyevent "$@"; }
shot() { adb exec-out screencap -p >"$shots/$1.png"; }
position() {
  adb shell dumpsys media_session |
    grep -A12 "package=com.learnifytube.mobile" |
    grep -m1 -oE "state=[A-Z]+\([0-9]\), position=[0-9]+" || true
}
step() {
  echo "[smoke-tv] $1"
  echo "           expect: $2"
}

step "Up" "overlay shows; progress row has elapsed and total time; header says Offline or Streaming"
key KEYCODE_DPAD_UP
sleep 1
shot 01-overlay

step "Down, Right x3, Left x1" "progress row focused, playback about 20 s further on"
key KEYCODE_DPAD_DOWN
sleep 1
key KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT KEYCODE_DPAD_LEFT
sleep 1.5
shot 02-seeked

step "play/pause" "PAUSED"
key KEYCODE_MEDIA_PLAY_PAUSE
sleep 1.5
position

step "fast-forward x2, rewind x1" "PAUSED, position 10000 ms further on"
key KEYCODE_MEDIA_FAST_FORWARD KEYCODE_MEDIA_FAST_FORWARD KEYCODE_MEDIA_REWIND
sleep 1.5
position

step "overlay hides, then Right" "overlay shows again, position unchanged"
sleep 7
key KEYCODE_DPAD_RIGHT
sleep 1.5
shot 03-woken
position

step "overlay hides, then Select" "overlay shows again, still PAUSED"
sleep 7
key KEYCODE_DPAD_CENTER
sleep 1.5
shot 04-select-woken
position

step "play/pause" "PLAYING"
key KEYCODE_MEDIA_PLAY_PAUSE
sleep 1.5
position

echo "[smoke-tv] Screenshots in $shots"

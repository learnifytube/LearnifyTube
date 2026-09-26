# Mobile

The phone and Android TV app: pulls Videos from the desktop app over local WiFi and plays them offline.

## Language

### Offline playback

**Offline copy**:
The single playable file of a Video on this device, wherever it is stored. An Offline copy on a removed USB drive still exists but is unreachable until the drive returns.
_Avoid_: local file, local path, downloaded video

**Storage location**:
The place the user chose for new Offline copies: internal app storage, a folder picked through Android's system picker, or a detected USB folder on a TV.
_Avoid_: storage folder, video directory

**Download**:
The act of fetching a Video's Offline copy from the desktop app, including waiting for the desktop to fetch the Video from YouTube first. A Download produces an Offline copy; it is not the copy itself, and it ends when the copy exists. Receiving a Video from a nearby device is not a Download.
_Avoid_: sync (for a single Video)

**On-device set**:
The Videos the desktop wants this device to hold (see the desktop glossary). The device Downloads what is missing and removes Offline copies that left the set. Videos the user pulled on the device itself are not part of it and are left alone.
_Avoid_: synced videos

**Mirror**:
To bring this device in line with the On-device set on connect, on return to the foreground, and every few minutes. The mirror only removes Videos it brought itself, then sends a Device report.
_Avoid_: sync (for this act)

**Download queue**:
The Downloads not yet finished: waiting for the desktop, queued, transferring, or failed. A Video enters the library only when its Download finishes.
_Avoid_: download list, transfers

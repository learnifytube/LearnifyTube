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

**Offline mode**:
The Device cannot reach the desktop, whether it was never paired, the desktop is off, or the connection dropped. The Device shows and plays only its Offline copies and keeps Watch progress for the next Device report. It is a normal way to use the app, not an error.
_Avoid_: disconnected mode, no-server state

**Download queue**:
The Downloads not yet finished: waiting for the desktop, queued, transferring, or failed. A Video enters the library only when its Download finishes.
_Avoid_: download list, transfers

### Connecting to the desktop

**Desktop connection**:
The Device's one link to the desktop app. It is connecting, connected, in Offline mode, waiting for a new Pairing code, or facing a desktop too old or too new to sync with. Only its own health check decides between connected and Offline mode; a slow or failed request for a collection or Video does not.
_Avoid_: server connection, sync status

**Pairing code**:
The code the desktop shows in Settings → Sync, which the Device sends with every request. When the desktop rejects it, the Device must be paired again.
_Avoid_: token, password

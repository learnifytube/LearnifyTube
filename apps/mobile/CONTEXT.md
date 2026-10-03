# Mobile

The phone and Android TV app. The phone is a family catalog of the desktop Library: tap a Video to play it. The TV is the living-room player. Both keep Offline copies so Offline mode is a normal way to watch.

## Language

### Catalog

**Caption**:
Timed lines shown on the picture while a Video plays, for reading along. Off until the viewer turns them on. Not a scrolling study list, not word lookup, not flashcards.
_Avoid_: subtitles, transcript (for this overlay)

### Offline playback

**Offline copy**:
The single playable file of a Video on this device, wherever it is stored. An Offline copy on a removed USB drive still exists but is unreachable until the drive returns. Viewers see a Video with an Offline copy as "on this TV" (or "on this phone"). The phone's **On this phone** screen is exactly those Videos — not the On-device set.
_Avoid_: local file, local path, downloaded video, ready, offline (for the copy; Offline mode is the connection)

**Storage location**:
The place the user chose for new Offline copies: internal app storage, a folder picked through Android's system picker, or a detected USB folder on a TV.
_Avoid_: storage folder, video directory

**Download**:
The act of fetching a Video's Offline copy from the desktop app, starting with a Desktop fetch when the desktop doesn't have the Video yet. On the phone, playing a Video starts a Download with no extra confirmation. A Download produces an Offline copy; it is not the copy itself, and it ends when the copy exists. Receiving a Video from a nearby device is not a Download.
_Avoid_: sync (for a single Video)

**Desktop fetch**:
The desktop getting a Video from YouTube so it can serve it. It is part of a Download and comes before a Stream. It is done only when the desktop serves the file: the desktop's records can call a Video fetched after its file is gone.
_Avoid_: server download

**Stream**:
Playing a Video straight from the desktop when the Device has no Offline copy. A Stream that has started keeps playing from the desktop even if the Offline copy arrives meanwhile; if the desktop drops out, the player carries on from the Offline copy when there is one.
_Avoid_: remote playback, desktop playback

**Play queue**:
The Videos the player moves through after the user presses play on a Home row (Continue watching, Sent to this phone, a Channel, or a List) or on On this phone, with the one playing now. It knows no desktop and no file: each Video's Offline copy or Stream is chosen when that Video starts. On the TV, starting a Play queue also puts it in History.
_Avoid_: playlist (for this), streaming queue

**On-device set**:
The Videos the desktop wants this device to hold (see the desktop glossary). The device Downloads what is missing and removes Offline copies that left the set. Videos the user pulled on the device itself (including by playing them on the phone) are not part of it and are left alone. Viewers see it as "Sent to this phone" or "Sent to this TV", never "On this phone/TV": it can include Videos without an Offline copy yet. The phone still shows the rest of the desktop Library below that shelf.
_Avoid_: synced videos, on this TV, on this phone

**Mirror**:
To bring this device in line with the On-device set on connect, on return to the foreground, and every few minutes. The mirror only removes Videos it brought itself, then sends a Device report.
_Avoid_: sync (for this act)

**Offline mode**:
The Device cannot reach the desktop, whether it was never paired, the desktop is off, or the connection dropped. The Device shows and plays only its Offline copies and keeps Watch progress for the next Device report. It is a normal way to use the app, not an error.
_Avoid_: disconnected mode, no-server state

**Download queue**:
The Downloads not yet finished: waiting for the desktop, queued, transferring, or failed. The phone player does not wait for this queue; a Stream can run while a Download is still going.
_Avoid_: download list, transfers

### Connecting to the desktop

**Desktop connection**:
The Device's one link to the desktop app. It is connecting, connected, in Offline mode, waiting for a new Pairing code, or facing a desktop too old or too new to sync with. Only its own health check decides between connected and Offline mode; a slow or failed request for a collection or Video does not.
_Avoid_: server connection, sync status

**Pairing code**:
The code the desktop shows in Settings → Sync, which the Device sends with every request. When the desktop rejects it, the Device must be paired again.
_Avoid_: token, password

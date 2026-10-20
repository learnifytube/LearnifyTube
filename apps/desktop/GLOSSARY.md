# Desktop

The Electron app where the user finds YouTube Videos, keeps the ones they want in a Library, organises them into Lists, and decides which of them go to their phone and TV.

## Language

### Library

**Video**:
A single YouTube video the app knows about, whether or not it has been kept.
_Avoid_: clip, item

**Library**:
The Videos the user chose to keep: fetched from YouTube, or on their way. A Video seen on a Channel or YouTube playlist is not in the Library until the user keeps it. Removing a Video from the Library deletes its file and takes it out of every List and the On-device set; removing it from one List does not.
_Avoid_: collection, downloads (for the whole set)

**Keep**:
To add a Video to the Library, which fetches it from YouTube onto the desktop. The fetch is done once the desktop has a watchable file of the Video, at whatever resolution YouTube offers up to the Maximum quality. A file the user can watch is never thrown away to look for a sharper one.
_Avoid_: download (that word belongs to the phone fetching from the desktop)

**Maximum quality**:
The highest resolution a Keep fetches, set by the user to keep files small. It is a ceiling, never a requirement: a Video that YouTube only offers below it is still kept.
_Avoid_: download quality, quality target

**List**:
A user-made, ordered group of Videos from the Library. The only thing the user organises with. A Video can be in many Lists.
_Avoid_: my playlist, collection, folder

**Favorites**:
A built-in List the app creates for every user.
_Avoid_: liked videos

**Watch state**:
Whether a Video in the Library is unwatched, in progress, or watched. A Video becomes watched when about 90% of it has been played on any device, or when the user marks it; the user can also mark it back to unwatched.
_Avoid_: seen, read

### Devices

**Device**:
A paired phone or Android TV running the mobile app.
_Avoid_: client, mobile (as a noun)

**On-device set**:
The Videos the desktop wants every Device to hold: the Videos in each List switched on for devices, plus those sent individually as Sent to Devices. Devices mirror it: a Video that leaves the set loses its Offline copy on each Device at the next connection.
_Avoid_: synced videos, phone list

**Sent to Devices**:
The built-in collection of single Videos the user chose to send to their paired Devices without switching on a whole List. Always part of the On-device set.
_Avoid_: phone list, device queue

**Device report**:
What a Device tells the desktop each time it mirrors: which Videos it holds and how far each was watched. Watch progress from a Device only counts when it is newer than the desktop's last change to that Video, so marking a Video on the desktop wins.

### Finding Videos

**Source**:
A place on YouTube the user finds new Videos from: a Channel, a YouTube playlist, or a pasted URL. A Source is for finding Videos, not for organising them.
_Avoid_: library section

**Channel**:
A YouTube channel, used as a Source.

**YouTube playlist**:
A playlist published on YouTube, used as a Source. Not a List.
_Avoid_: playlist (unqualified)

**Subscription**:
A Channel the user chose to subscribe to, so its new Videos show up for them to consider keeping. A Channel the user has only visited is not a Subscription.
_Avoid_: followed channel

### Audiobooks

**Audiobook**:
One book the user imported from audio files on their computer, defined once at Import and handled as a whole from then on. It is the unit the user sends to Devices: sending an Audiobook sends all of it, never a chosen part. It is not a Video and has nothing to do with YouTube: it is never in the Library, a List, or the On-device set of Videos.
_Avoid_: imported video, local video, album

**Import**:
To turn a folder on the computer into one or more Audiobooks. The user picks a folder and then says, before anything is saved, whether the folder is one Audiobook or each of its subfolders is one. Import is to Audiobooks what Keep is to Videos.
_Avoid_: add files, upload, keep (for Audiobooks)

**Track**:
One audio file in an Audiobook. An Audiobook plays its Tracks in its Track order from the first to the last. A Track is not necessarily a chapter: it may be a disc track, or the whole book in one file.
_Avoid_: chapter, part, episode

**Track order**:
The order an Audiobook plays its Tracks in. Import sets it by subfolder and then by file name, reading numbers as numbers (Track 2 before Track 10); the user can rearrange it at Import or any time later.
_Avoid_: playlist order

**Rescan**:
Looking at an Audiobook's folder again after Import. New files join at the end of the Track order and files that are gone show as missing; nothing already there is reordered. The user's files are only ever read: forgetting an Audiobook never deletes them.
_Avoid_: re-import, refresh

**Listening position**:
Where the user is in an Audiobook: one Track and a time inside it, the same wherever it is played, on the desktop or any Device. Playing an Audiobook always resumes from it and carries on to the end, skipping missing Tracks. The newest position wins, even when the book plays in two places at once: nothing hands playback from one to the other. An Audiobook is finished when its last Track ends.
_Avoid_: watch state, progress (for Audiobooks)

**Book player**:
What plays an Audiobook, on the desktop or a phone, with the same rules on both: it resumes from the Listening position, crosses Tracks on its own, pauses and resumes, skips ±30s, and lets the user pick any Track. Previous restarts the Track unless it has only just begun. On the desktop it keeps playing while the user browses or the window is hidden, and pauses when a Video starts.
_Avoid_: audio player, video player (for Audiobooks)

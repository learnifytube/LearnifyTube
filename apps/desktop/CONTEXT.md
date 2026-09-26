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
To add a Video to the Library, which fetches it from YouTube onto the desktop.
_Avoid_: download (that word belongs to the phone fetching from the desktop)

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
The Videos the desktop wants every Device to hold: the Videos in each List switched on for devices, plus those in the built-in Phone List. Devices mirror it: a Video that leaves the set loses its Offline copy on each Device at the next connection.
_Avoid_: synced videos, phone list

**Phone List**:
A built-in List for single Videos the user wants On device without switching on a whole List. Always part of the On-device set.

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
A Channel the user follows so its new Videos show up for them to consider keeping.

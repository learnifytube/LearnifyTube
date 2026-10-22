# Movies and Series are their own concept, imported like Audiobooks

The user wants to import films and TV shows from their computer and watch them on the desktop, phone and Android TV. As with ADR-0004, we chose new concepts over widening **Video**: a **Movie** is one file, and a **Series** has **Seasons** of **Episodes**. They never enter the Library or Lists, because a Video means "from YouTube" across Keep, Source and Library. Unlike Audiobooks, though, each Movie and Episode keeps its own Watch state with the Video rules (about 90% means watched, a mark on the desktop wins). A film is watched, not resumed as one long whole, so they also join the phone's Continue watching.

They come in through the same **Import** as Audiobooks, with the kind chosen from the files and confirmed in the preview. Files are referenced in place and picked up again with Rescan. Files play as they are, without transcoding; Import warns about codecs that Android is likely to refuse.

A Movie is sent to Devices whole; a Series is sent one **Season** at a time, and Episodes that Rescan finds later join a sent Season. Devices Mirror what was sent. **This narrows ADR-0002 for Movies and Episodes**: playing one on the phone or TV only Streams. A Download happens only when the desktop sent it or the user asks for one on the device, because a single file can run to many gigabytes and tap-to-cache would fill a phone. Each Movie and Series is **Shown on Devices** by default and can be left out of the Devices' catalog, because the phone is a family catalog.

## Considered Options

- **Widen Video to local files**: rejected for the same language reasons as ADR-0004, even though Watch state carries over unchanged.
- **One umbrella concept for Audiobooks and Movies**: rejected; books and films differ in progress (one Listening position against Watch state per file) and in what gets sent.
- **Send a whole Series**: rejected; a Series can run to hundreds of gigabytes.
- **Transcode on the desktop**: deferred until real files show it is needed; the optimization queue can do it later.
- **Online metadata (TMDB)**: deferred; posters come from the folder, embedded art, or a frame grab.

## Consequences

- The sync contract in `apps/shared` gains Movies, Series, Seasons and Episodes, their files (byte-range Streams), sidecar Captions, Watch progress in the Device report, and a send per Season; it gets a new protocol version, and Devices hide these on older desktops.
- The TV gets local content for the first time: Home rows for Movies and Series, Mirroring of what was sent, and playing one puts it in the TV's History like a Video's Play queue (the TV still has no Continue watching).
- A Movie whose file is gone shows as missing and keeps its Watch state, like a missing Track.
- Sidecar `.srt`/`.vtt` files show as Captions. Embedded subtitle and audio-track choice wait until the player can expose them.

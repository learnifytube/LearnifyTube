# Every file resumes on its own, and collections remember where they were

The user wants pause and resume to work the same everywhere: every Video, Movie, Episode and Track resumes from where it stopped, and every List, YouTube playlist, Series and Audiobook resumes the file it was last playing. Videos, Movies and Episodes already kept their own position. Two things did not fit.

**This reverses part of ADR-0004.** An Audiobook kept one Listening position and its Tracks kept none, so jumping to another Track and back lost the place. Each Track now keeps its own **Track position** (a time and whether it was played to its end), and the Listening position becomes "the Track last played", whose time is that Track's own. "Play book" still starts from the Listening position and still carries on through the Track order.

Lists and YouTube playlists remembered a slot number on the desktop only, which pointed at the wrong Video after a reorder or removal and never reached a Device. They now remember a **Current Video**. A Series likewise remembers the Episode last played instead of working out "the one in progress", which could not choose between two half-watched Episodes. All of these, and every Track position, are shared between the desktop and Devices with the newest change winning, the same rule as Watch progress and the Listening position.

## Considered Options

- **Keep one position per Audiobook** (ADR-0004 as written): rejected; the user jumps between Tracks and expects each to keep its place.
- **A slot number for the current item**: rejected; it breaks on reorder and removal.
- **Current item kept per Device**: rejected; it would make the phone, TV and desktop disagree about where a List is, unlike every other position the user sees.
- **Work out a Series' Episode each time**: rejected; it is ambiguous once two Episodes are in progress.

## Consequences

- The sync contract in `apps/shared` carries Track positions, Current Videos and each Series' last Episode, both ways, in a new protocol version; desktop and mobile change together.
- Desktop storage gains a Track position per Track, a Current Video per List and YouTube playlist, and a last Episode per Series; the slot number is converted once to the Video in that slot. Each Audiobook's Listening position seeds its Track's Track position, and the Tracks before it count as played to their end.
- Devices keep these changes in Offline mode and send them with the next Device report.
- Anything finished (a watched Video, Movie or Episode, or a Track played to its end) starts again from the beginning when played.

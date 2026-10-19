# Audiobooks are their own concept, not imported Videos

The user wants to import audio from their computer, starting with an audiobook folder, and play it on the phone from start to end. The cheapest path was to widen **Video** to "anything playable, from YouTube or a file", which would have reused Lists, the On-device set, Download and the Play queue unchanged. We chose a separate **Audiobook** concept instead (made of **Tracks**, with one **Listening position**), because a book behaves differently from a Video: its order comes from the files, it is sent and held as a whole, and "where am I" belongs to the book rather than to each file. Mixing the two would have bent Library, List and Watch state language around a case they don't fit.

Audiobooks are **referenced in place**: Import reads the user's folder and never copies or deletes it. **Rescan** picks up new files (at the end of the Track order) and marks missing ones.

## Considered Options

- **Widen Video**: rejected for the language and behaviour mismatch above, even though it reused the most code.
- **An imported folder becomes a List**: rejected; a List is user-made and holds Videos.
- **Copy files into app storage**: rejected; audiobooks are large and the user's music folder is already their home. The cost is that moving the folder shows Tracks as missing.

## Consequences

- The desktop gets its own Audiobook storage and an Audiobooks section separate from the Library.
- The sync contract in `apps/shared` gains Audiobooks, their Tracks, a whole-book send, and Listening position reporting; desktop and mobile change together.
- The phone needs a real background audio player (screen off, lock-screen controls, speed, ±30s skip); the existing `expo-video` player does not provide this.
- Sent Audiobooks are Mirrored like the On-device set, and books the phone pulled by playing are left alone, following ADR-0001 and ADR-0002.

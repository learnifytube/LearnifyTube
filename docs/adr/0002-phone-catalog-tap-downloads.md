# The phone browses the Library; tap starts a Stream and a Download

ADR-0001 still holds: the desktop owns the On-device set, and Mirror must not delete Videos the user pulled on the Device. The phone is no longer only a player of that set. It is a family catalog (YouTube Kids-like), not a kid-profile product and not a Download console.

Home rows, top to bottom: Continue watching, Sent to this phone, then a row per Channel, then a row per List. Opening a row is a poster grid; one tap plays that row as the Play queue. Playing Streams when connected and starts a Download with no confirm (including when the desktop still has to fetch the file — wait in the player). Every played Video is cached; no quota in this pass. Offline mode shows only rows that still have Offline copies.

Three tabs: Home, On this phone (Offline copies — tap to play, long-press to remove; Mirror may restore Sent-to-this-phone items), Settings (pairing, storage, Caption language). Pairing is not a cold-start gate once anything is on the phone or cached; an empty phone with no desktop gets one Pair with desktop path.

Flashcards, word study, scrolling transcript, multi-select Download, and Save Playlist are out. Captions are on the picture, off until toggled. Share is not in the tabs. TV layout is a later pass.

## Amendment (2026-10-06): Offline mode keeps the Catalog snapshot; Continue watching spans devices

In Offline mode the phone now shows every Home row from its Catalog snapshot instead of hiding rows without Offline copies. Videos without an Offline copy are dimmed with "Needs the desktop" and do nothing but explain when tapped. The Play queue skips them, so playing a row never stops on one. Hiding them made the phone look emptied out whenever the desktop was off. Tapping does not queue a Download for later, so a child tapping around offline cannot fill the Download queue.

Continue watching is now the Videos in progress on any device, merged from the desktop's Watch state and the phone's own unreported progress. Resume uses the most recent position, and a mark made on the desktop wins. This applies to the phone only; the TV keeps its History.

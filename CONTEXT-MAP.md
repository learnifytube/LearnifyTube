# Context Map

## Contexts

- [Mobile](./apps/mobile/CONTEXT.md) — phone and Android TV app that plays Videos offline

## Relationships

- **Desktop → Mobile**: Desktop serves Videos, Playlists and transcripts over the sync contract in `apps/shared`; Mobile Downloads them into Offline copies

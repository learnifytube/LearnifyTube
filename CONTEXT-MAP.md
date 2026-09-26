# Context Map

## Contexts

- [Desktop](./apps/desktop/CONTEXT.md) — Electron app where the user keeps a Library of Videos, organises it into Lists, and decides what goes to their phone and TV
- [Mobile](./apps/mobile/CONTEXT.md) — phone and Android TV app that plays Videos offline

## Relationships

- **Desktop → Mobile**: Desktop serves Videos, Playlists and transcripts over the sync contract in `apps/shared`; Mobile Downloads them into Offline copies

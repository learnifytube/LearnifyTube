# Context Map

## Contexts

- [Desktop](./apps/desktop/CONTEXT.md) — Electron app where the user keeps a Library of Videos, organises it into Lists, and decides what goes to their phone and TV
- [Mobile](./apps/mobile/CONTEXT.md) — phone and Android TV app that browses the desktop Library and plays Videos, including Offline

## Relationships

- **Desktop → Mobile**: Desktop serves Videos, Lists, Channels and Captions over the sync contract in `apps/shared`. The phone browses that catalog; a Device Downloads an Offline copy when the user plays a Video, and also Mirrors the On-device set.

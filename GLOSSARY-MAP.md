# Glossary Map

## Contexts

- [Desktop](./apps/desktop/GLOSSARY.md) — Electron app where the user keeps a Library of Videos, organises it into Lists, and decides what goes to their phone and TV
- [Mobile](./apps/mobile/GLOSSARY.md) — phone and Android TV app that browses the desktop Library and plays Videos, including Offline

## Relationships

- **Desktop → Mobile**: Desktop serves Videos, Lists, Channels and Captions over the sync contract in `apps/shared`. The phone browses that catalog; a Device Downloads an Offline copy when the user plays a Video, and also Mirrors the On-device set. Desktop also serves the Audiobooks the user Imported; they travel as whole books and are never Videos. Imported Movies and Series are not Videos either: a Movie travels whole, a Series one Season at a time, and each Movie and Episode reports Watch progress back.

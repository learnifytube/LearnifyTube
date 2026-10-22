# Coding standards

Judgement calls a reviewer applies to a diff. Lint, type-check, `check:ui-boundaries` and the 300-line `max-lines` rule already enforce the mechanical rules; this file holds what they can't check.

## Both apps

- **Domain words**: names in code and UI copy use the glossary terms (`apps/desktop/GLOSSARY.md`, `apps/mobile/GLOSSARY.md`). For films and TV: Movie, Series, Season, Episode; "show", "local video" and "imported video" are the wrong words.
- **One type per concept**: reuse the exported type for a domain concept (`MovieKind` from `apps/shared/mobile-sync-contract.ts`, not a fresh `"movie" | "episode"`). When the same few fields travel together across files, give them one type.
- **Shared logic lives once**: logic two screens or two apps both need goes in a shared module (`apps/shared/`, mobile `hooks/` / `services/` / `components/`), not copied between the phone and TV route groups or between desktop and mobile.
- **Functions over classes.**
- **Tests** drive a module through its public interface with a fake platform from the module's factory; no module mocking.
- **Hooks**: derive state rather than syncing it with `useEffect`; an effect is for a subscription or an external system. `useMemo` / `useCallback` need a stated reason (an API that requires a stable identity, or a measured cost).

## Desktop

- **tRPC hooks are called directly in components**; a wrapper hook earns its place only by adding behaviour (a transform, a combination of queries).
- **Multi-row writes are atomic**: an operation that writes several rows applies them in one `db.batch([...])` (libsql's `db.transaction` opens a new connection; see `apps/desktop/src/api/movies/batch-writes.ts`).

## Sync contract

- A change to `apps/shared/mobile-sync-contract.ts` comes with the matching change on both sides (`apps/desktop/src/main/mobileSyncServer.ts` and its route files, `apps/mobile/services/api.ts`). New fields stay optional for older peers, or the protocol version goes up.

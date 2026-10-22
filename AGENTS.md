# AGENTS.md

Two apps, one sync protocol:

- `apps/desktop` — Electron app; guidance in `apps/desktop/CLAUDE.md`.
- `apps/mobile` — Expo app for phone and Android TV; guidance in `apps/mobile/CLAUDE.md`.
- `apps/shared/mobile-sync-contract.ts` — the desktop↔mobile sync contract. Desktop serves it from `apps/desktop/src/main/mobileSyncServer.ts`; mobile consumes it in `apps/mobile/services/api.ts`. A change on one side needs the matching change on the other.

In a git worktree, run `scripts/worktree-deps.sh` first: it links the main checkout's `node_modules` (gitignored) so tests, lint and the pre-commit hook run.

## Agent skills

- **Issues** — GitHub Issues on `learnifytube/LearnifyTube` via `gh`. Commands: `docs/agents/issue-tracker.md`.
- **Triage labels** — role-to-label mapping: `docs/agents/triage-labels.md`.
- **Domain docs** — glossary (`GLOSSARY.md`) and ADR layout: `docs/agents/domain.md`.
- **Verify** — isolated desktop + phone + TV screenshots and pairing: `.cursor/skills/verify/SKILL.md`.

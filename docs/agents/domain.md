# Domain Docs

How the engineering skills consume this repo's domain documentation.

This is a **multi-context** repo: `apps/desktop` (Electron) and `apps/mobile` (Expo, phone + TV) are separate contexts. `apps/shared` holds the cross-app sync contract; decisions about it are system-wide.

## Layout

Read the files relevant to your topic before exploring:

```
/
├── GLOSSARY-MAP.md            ← points at each context's GLOSSARY.md
├── docs/adr/                  ← system-wide decisions (incl. apps/shared contract)
└── apps/
    ├── desktop/
    │   ├── GLOSSARY.md        ← desktop glossary
    │   └── docs/adr/          ← desktop decisions
    └── mobile/
        ├── GLOSSARY.md        ← mobile/TV glossary
        └── docs/adr/          ← mobile/TV decisions
```

The per-app `docs/adr/` folders are created lazily by `/domain-modeling` the first time a decision scoped to one app gets recorded. Until one exists, check the root `docs/adr/` for decisions that touch that app.

## Use the glossary's vocabulary

Name domain concepts (in issue titles, refactor proposals, hypotheses, test names) with the term `GLOSSARY.md` defines. A concept missing from the glossary is a signal: either you're inventing language the project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

When your output contradicts an ADR, say so explicitly:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

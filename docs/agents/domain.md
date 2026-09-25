# Domain Docs

How the engineering skills consume this repo's domain documentation.

This is a **multi-context** repo: `apps/desktop` (Electron) and `apps/mobile` (Expo, phone + TV) are separate contexts. `apps/shared` holds the cross-app sync contract; decisions about it are system-wide.

## Layout

Read the files relevant to your topic before exploring:

```
/
├── CONTEXT-MAP.md             ← points at each context's CONTEXT.md
├── docs/adr/                  ← system-wide decisions (incl. apps/shared contract)
└── apps/
    ├── desktop/
    │   ├── CONTEXT.md         ← desktop glossary
    │   └── docs/adr/          ← desktop decisions
    └── mobile/
        ├── CONTEXT.md         ← mobile/TV glossary
        └── docs/adr/          ← mobile/TV decisions
```

These files are created lazily by `/domain-modeling` as terms and decisions get resolved. Where one is missing, carry on with the code as the source of truth.

## Use the glossary's vocabulary

Name domain concepts (in issue titles, refactor proposals, hypotheses, test names) with the term `CONTEXT.md` defines. A concept missing from the glossary is a signal: either you're inventing language the project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

When your output contradicts an ADR, say so explicitly:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

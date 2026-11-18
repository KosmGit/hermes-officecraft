# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the direction.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Setup

```bash
npm ci --prefix dev
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

Node 20 or later, Python 3.12. To try your build in Hermes:

```bash
hermes plugins install file://$PWD --force --enable   # installs your last commit
hermes gateway restart                                # the agent half only reloads on restart
```

## Rules of the code

- **Never edit `desktop/plugin.js` by hand.** Change `src/`, run `npm --prefix dev run build` and commit both.
- The bundle imports only `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`. From the SDK, import by name only
  what every Desktop version exports (`SDK_BASELINE` in `dev/check.mjs`); reach newer exports through
  `import * as sdk` with a local fallback.
- No literal colour outside `src/scene/` (the pixel art keeps its own palette; everything else uses theme variables).
- Pure logic lives in `src/core/` and `src/scene/` (no DOM, no SDK) so it runs under `node --test`.
- Every visible string goes through `useT()` and exists in `src/i18n/en.js`, `fr.js` and `es.js`.
- The agent half serves whitelisted fields only. Never a card body, a comment, a path, a key or a `SOUL.md`.
- Nothing shown in the office is invented: a new element needs a real fact from Hermes behind it.

## Before you open a pull request

```bash
npm --prefix dev run verify
.venv/bin/pytest -q tests/python
```

Both must pass, and a change of behaviour comes with a test. Keep pull requests focused: one subject each.

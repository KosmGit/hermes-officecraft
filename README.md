<div align="center">

# Officecraft

**The pixel-art office & kanban control room for [Hermes Agent](https://github.com/NousResearch/hermes-agent)**

See what your agents and kanban chains are doing — and act on them.

[![CI](https://github.com/KosmGit/hermes-officecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/KosmGit/hermes-officecraft/actions/workflows/ci.yml)
[![Version 0.2.0](https://img.shields.io/badge/version-0.2.0-f59e0b)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Hermes Agent ≥ 0.23](https://img.shields.io/badge/Hermes%20Agent-%E2%89%A5%200.23-7c3aed)
![Languages: EN · FR · ES](https://img.shields.io/badge/languages-EN%20%C2%B7%20FR%20%C2%B7%20ES-0ea5e9)

[Features](#features) · [Install](#install) · [How it works](#how-it-works) · [Privacy and safety](#privacy-and-safety) · [Development](#development)

<img src="docs/images/scene-day.webp" alt="The Officecraft page: an isometric pixel-art office with twelve agents at their desks, three projects in the bar below, and a side panel listing the cards that wait for a decision with the reason each bot gave." width="900">

</div>

Officecraft draws your Hermes profiles as people in an isometric office, one island per kanban board. At a glance you see who is working, who went silent, who is queued behind a colleague, which cards are blocked and waiting for you, and whether the gateway, messaging and scheduled jobs are healthy.

**Nothing is simulated.** Every desk, state and counter is read from your Hermes backend. An empty office is preferred to a fake one.

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Decide from the office</h3>
      Blocked cards and approval requests land in one inbox, grouped by project, each with the reason its bot gave. A card that holds other bots back says how many. Unblock, comment or answer without leaving the page.
    </td>
    <td width="50%" valign="top">
      <h3>See who waits for whom</h3>
      A bot whose card waits for a colleague's work is <em>queued</em>, not idle. Select it: the office follows the chain up to the card at its head, and tells you when that card is the one waiting for you.
    </td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/decisions.webp" alt="The Decisions tab: cards grouped by project, each with the reason it is blocked, how many bots it holds back, and its Unblock and Comment buttons." width="352"></td>
    <td><img src="docs/images/scene-queue.webp" alt="A queued agent selected: its sheet says which colleague it waits for and who is at the head of the queue, and the scene outlines the agents upstream."></td>
  </tr>
  <tr>
    <td valign="top">
      <h3>Plan a campaign</h3>
      Compose a graph of cards from a template or by hand, preview it, create it in one write. A guard card holds everything until you press <em>Launch</em>.
    </td>
    <td valign="top">
      <h3>Recruit a bot</h3>
      Name it, say what it takes and what it delivers, pick a starting point and a model. The character is drawn as you type.
    </td>
  </tr>
  <tr>
    <td><img src="docs/images/campaign.webp" alt="The Campaign editor: an objective, cards with a bot each, and the previewed graph under its guard."></td>
    <td><img src="docs/images/recruit.webp" alt="The Recruit window: identity with a live character preview and the bot types, then the model and provider list."></td>
  </tr>
  <tr>
    <td valign="top">
      <h3>Night shift, live</h3>
      The office follows the clock and your theme. Agents type, think and raise a sign when a card of theirs needs you.
    </td>
    <td valign="top">
      <h3>A game on real facts</h3>
      35 trophies, an office level and agent grades, all recomputed from your history. One switch turns it off.
    </td>
  </tr>
  <tr>
    <td><img src="docs/images/scene-night.webp" alt="The office at night with an agent selected: the Team tab lists the card that waits for you, its running cards, model and skills."></td>
    <td><img src="docs/images/trophies.webp" alt="The trophy showcase: office level, trophies closest to unlocking, and shelves of pixel-art medals."></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/scene-live.gif" alt="A short loop of the office: agents type at their desks while exclamation marks flag the cards that wait for a decision."></td>
    <td align="center"><img src="docs/images/mobile.webp" alt="The page in a narrow pane: the office as a list, and the Decisions view with its bottom bar." width="420"></td>
  </tr>
</table>

<sub>Screenshots use a made-up team and made-up projects. The screens themselves are the real ones.</sub>

**Also in the box**

| | |
|---|---|
| **Replay & Resources** | Put the office back as it was last night; read the estimated cost, tokens, calls and quota as Hermes recorded them. |
| **Notifications** | Decisions, silent agents, the Hermes gateway, scheduled jobs and more (eight types), on the messaging apps Hermes already serves. Off by default. |
| **LLM functions** | Ten optional helpers (draft a recruitment, propose a campaign graph, decorate the office…). All off by default, capped per month, and a model never creates anything without your click. |
| **Narrow panes and touch** | Below the size where the room stays readable the office becomes a list, and controls grow on a touch screen. |
| **Three languages** | English, French and Spanish, with plurals, numbers and times written the way each language does. |

### The states you will see

States are read, never declared. The strongest one wins:

| State | What it means |
|---|---|
| **Working** | A worker of the agent gave a sign of life in the last 2 minutes. A sign is added when another of its cards waits for you. |
| **Waiting for you** | One of the agent's cards is blocked: the decision is yours. |
| **Silent** | A card is running but has given no sign of life for more than 5 minutes. |
| **Queued** | A card of the agent waits for an unfinished card it depends on, and none of its own is running or blocked. |
| **Recent session** | No card, but a chat session touched in the last 10 minutes. |
| **Idle** | Nothing in progress. |

## Install

Requires Hermes Agent **0.23.0 or later**.

```bash
hermes plugins install https://github.com/KosmGit/hermes-officecraft --enable
hermes gateway restart
```

Then switch on the desktop half in **Capabilities → Plugins** (desktop plugins ship off by default) and open **Officecraft** in the sidebar.

- **From the app**: *Capabilities → Plugins → Install from Git*, paste the repository URL, then restart the gateway.
- **In a browser**: set `webapp.enabled: true` in your Hermes `config.yaml`, restart the gateway and run `hermes webapp`.
- **Update**: `hermes plugins update hermes-officecraft`, then restart the gateway.

Without the agent half (remote backend where it is not installed, older Hermes) the office still shows every agent with its state, read-only, and says what is missing.

## How it works

Officecraft has two halves, installed together:

| Half | What it does |
|---|---|
| **Desktop** (`desktop/plugin.js`) | The page, in Hermes Desktop and the Hermes Webapp. Built from `src/` with esbuild; imports only the Hermes plugin SDK and React. |
| **Agent** (`hermes_officecraft/`) | Routes under `/api/plugins/hermes-officecraft/`: read-only views of the kanban, profiles and usage, the actions you send, notifications and the optional LLM functions. |

Every action that writes follows the same rules: a risk class shown in words (*No risk*, *Reversible*, *Final*), a confirmation that names the target, **6 seconds to cancel**, one action at a time, and the real state read back before anything is reported as done.

## Privacy and safety

- **Reads by default, writes only what you ask for.** Nothing runs in the background except the notifications and LLM functions you switched on.
- **Whitelisted fields only.** Shown: profile names, states, counters, timestamps, card and session titles, and the reason a bot gave when it blocked a card (cleaned, at most 280 characters). Never read or shown: card bodies, comments, message contents, file paths, keys, the `SOUL.md` of an existing bot.
- **A blocking reason stays on the page.** A bot wrote it, so it is drawn as plain text and never put in a notification, the audit log or a prompt.
- **You see what you approve.** Before you allow an approval request from the office, the confirmation shows the command exactly as Hermes provides it (already redacted). A command too long to be shown whole can only be refused; a tall one must be scrolled to its end before you can confirm. It is shown, never stored.
- **Every action is logged** in an `audit.jsonl` readable by you only, in the data folder Hermes gives the plugin. It holds names and codes: never a comment's text, a title or a command.
- **LLM functions are opt-in**, each with its own switch. The settings list exactly which fields each one sends to the model. A monthly cap ($1 and 300 calls by default) is checked before every call, and a call that fails on a priced model still counts at its worst cost. What a model receives is marked as untrusted data, and a link in its answer is refused.
- **No telemetry, no network call of its own.** The plugin talks to your Hermes backend and to nothing else.

### What the plugin touches

| | |
|---|---|
| **Reads, outside its own folder** | The kanban boards (cards, links, runs, events), the list of profiles and the headers of their skills, session metadata and token usage in each profile's `state.db`, the gateway status and the scheduled jobs. All read-only. |
| **Writes, only on your action** | Kanban cards through Hermes (unblock, comment, create the cards of a campaign, launch or cancel it), a new profile when you recruit a bot, your answer to an approval request. |
| **Writes, in its own data folder** | `audit.jsonl`, the notifier's state, the LLM spending counter. Page settings stay in the browser's local storage. |
| **Sends** | Notifications through Hermes' own messaging, to the recipients you picked. Off until you choose one. |
| **Calls a model** | Only for the LLM functions you switched on, through Hermes' plugin LLM API, with the model set in Hermes (or the one you pick, if you grant the plugin that permission). |
| **Hooks** | `on_kanban_dispatch_tick` (notifications without the page open), `pre_approval_request`, `post_approval_response`. |
| **Never** | Shell commands, credentials or `.env` files, third-party services, self-update. |

Hermes has no public API yet for some of these reads (kanban history, sessions, usage), so the agent half imports a few internal Hermes modules. `hermes plugins validate` reports them as a warning; a Hermes release can break them, and the plugin then says which data is missing rather than inventing it.

Found a vulnerability? See [SECURITY.md](.github/SECURITY.md).

## Development

```bash
npm ci --prefix dev --ignore-scripts   # esbuild, the only dev dependency
npm --prefix dev run build             # src/ -> desktop/plugin.js (committed)
npm --prefix dev run verify            # bundle up to date, allowed imports, node tests

python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q tests/python
```

| Path | Role |
|---|---|
| `src/` | Desktop sources. `src/core/` and `src/scene/` are pure logic, tested under `node --test`. |
| `desktop/plugin.js` | Generated bundle loaded by Hermes. Never edit by hand. |
| `hermes_officecraft/` | Agent half (FastAPI routes, kanban reads, actions, notifier, LLM functions). |
| `dashboard/` | How Hermes mounts the agent half's routes. |
| `plugin.yaml`, `__init__.py` | Plugin manifest and entry point. |
| `dev/`, `tests/` | Build tooling and test suites. |

What changed in each version: [CHANGELOG.md](CHANGELOG.md). Contributions are welcome: see [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## License

[MIT](LICENSE)

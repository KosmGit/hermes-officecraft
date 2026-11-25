# Changelog

All notable changes to Officecraft are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-25

### Added

- **Queued**, a new state: a bot whose card waits for an unfinished card it depends on is no longer shown as idle. Its
  sheet names the colleague it waits for and the head of the queue; selecting it outlines the agents upstream.
- The reason a bot gave when it blocked a card, on the decision card (cleaned, at most 280 characters, never sent
  anywhere else). A decision that holds other bots back says how many.
- A sign on a working agent that also has a card waiting for you, in the scene and in the Team list.
- Card titles instead of technical identifiers in the agent sheet and the Log.

### Changed

- Header: Replay, Resources, Recruit and Campaign carry their label on a wide window; the game badge is quieter and
  the decisions counter stands out when there is something to decide.
- The bar under the office stays on one row: selecting an agent no longer moves the scene.
- Recruit: the title comes before the identifier, and the bot type folds into one line.
- Settings: three tabs instead of five (Game and Replay join General). Stored settings are unchanged.
- Resources opens on the estimated cost.
- Larger controls on touch screens; plurals, numbers and times follow each language.
- The game is recomputed only when what it reads changes, and the scene redraws only when what it draws changes.

### Fixed

- Notifications were no longer sent on recent Hermes versions (the sending module had moved).
- The header no longer overflows, at any width or in any language.
- Keyboard and screen readers: focus returns to a visible control, the More menu is a real menu, one live region.
- A past day in Resources is kept only once it can no longer change.

### Security

- Approvals: a command that Hermes cut, or that is missing, can only be refused; a command taller than its frame must
  be scrolled to its end before it can be confirmed.
- LLM cap: a call that fails on a priced model is counted at its worst cost, so failures cannot walk past the cap.
- Every LLM call tells the model that the data it receives is untrusted; an address without a scheme (an IP, a
  `host:port`, `//host`) in an answer is refused like any other link.
- Audit log: a value that is not shaped like a name or a code is dropped, and the same line sent twice at once is
  written once.
- Nothing is notified while the notifier's state cannot be written.
- Assignee and pinned model of a card are cleaned and bounded like its title.
- CI checks that the lockfile resolves from the npm registry only; Python dev dependencies are pinned exactly.

## [0.1.0] - 2026-11-18

First public release.

### Added

- The isometric pixel-art office: one desk per Hermes profile, one island per kanban board, states read from Hermes
  (working, recent session, waiting for you, silent, idle), day and night, light and dark themes.
- A side panel with four tabs: Decisions, Team, Projects, Log.
- Actions from the office: unblock and comment a card, answer approval requests, recruit a bot. Each with a risk
  class, a confirmation, six seconds to cancel and a line in the audit log.
- Campaign editor: a graph of cards created in one write, four chain templates, guards, Launch and Cancel.
- Replay of a past moment and Resources (tokens, calls, costs and quota as Hermes recorded them).
- Notifications on the messaging apps Hermes serves (eight types, quiet hours, off by default).
- Game layer: 35 trophies, office level, agent grades, with a sober mode.
- Ten optional LLM functions, off by default, with a monthly cap and a strong and a light model.
- English, French and Spanish.

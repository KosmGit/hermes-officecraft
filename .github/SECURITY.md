# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on this repository
([direct link](https://github.com/KosmGit/hermes-officecraft/security/advisories/new)).

Include what you can of: the affected version or commit, how to reproduce it, and the impact you expect.
You should get a first answer within a week. Once a fix is released, the advisory is published and you are
credited unless you prefer otherwise.

## Supported versions

Only the latest release (the `main` branch) receives security fixes.

## Scope

Officecraft runs inside Hermes Agent: its routes are mounted and authenticated by the Hermes gateway, and its
page runs in Hermes Desktop or the Hermes Webapp. In scope, for example:

- a route of the agent half that serves a field outside its whitelist (card bodies, comments, paths, keys…);
- text written by a bot (a card title, a profile name, a model's answer) that becomes markup, a link, an action
  or a file attachment;
- a way past the confirmation of an action, the monthly LLM cap or the limits of the notifier.

A problem in the authentication or transport of Hermes itself belongs to
[Hermes Agent](https://github.com/NousResearch/hermes-agent).

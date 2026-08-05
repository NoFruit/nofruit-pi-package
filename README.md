# nofruit-pi-package

Personal pi environment sync repository. Mirrors my pi setup across machines.
Not published (`private: true`) — for personal use only.

## Contents

- `extensions/` — incubating pi extensions
  - `extensions/searxng-server/` — SearXNG mirror tooling (tool: `searxng_run_node`)
- `packages.md` — external pi packages to install alongside this one
- `tsconfig.json` — local LSP-only config wiring module resolution to the global pi install (paths inside the file; stale paths do not affect pi)
- `AGENTS.md` — local working conventions (not committed)

## Restore on a new machine

1. Install pi: `npm install -g @earendil-works/pi-coding-agent`
2. Install this package: `pi install git:git@github.com:NoFruit/nofruit-pi-package`
3. Install the standard external packages from [`packages.md`](./packages.md)
4. Run `pi`

# Changelog

English · [中文](CHANGELOG.zh-CN.md)

All notable changes are recorded here. This project follows [Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-10-29

### Fixed

**The panel no longer gets slower the longer it runs, and no longer stalls the client.**

The cause was neither git nor repository size. Every git call went through the host's `ctx.subprocess.spawn`, which starts an Electron runner process and attaches a Windows Job object for each child. Measured on Windows 11, that costs a **fixed ~1.3 s per call**, while a bare `git status` takes 25–130 ms. A single `view` needs 5 of those calls and a merge needs about 14, and the panel polls every 10 s — so one refresh took 6.7 s and concurrent requests queued behind each other, which is what made the whole client freeze.

- `lib/git.js` — `gitRunner` now starts `git` directly through `node:child_process.spawn`: fixed argv array, no shell, `cwd` still the already-validated workspace root. It keeps the 1 MiB output cap, the 60 s timeout kill and `AbortSignal` support, and sets `GIT_TERMINAL_PROMPT=0` / `GIT_PAGER=cat` so a credential or pager prompt can never block a request.
- `index.js` — `inject` no longer requests `subprocess`; only `webServer` and `workspaceRegistry` remain.
- `view()` — 12 spawns reduced to 5: one `rev-parse` supplies the root and every operation marker at once, branch/head/upstream/ahead/behind all come from a single `status --porcelain=v2 --branch`, and one `for-each-ref` covers local and remote branches.
- Untracked files are read with `--untracked-files=normal` instead of `all`. A directory full of build artifacts or `__pycache__` collapses to one line, so the payload stays around 1 KB instead of growing to 3 MB after a few thousand files.
- `client.js` — polling has an in-flight guard, so a slow request is no longer stacked by the next tick. Results are compared by signature, so an unchanged view skips `setView` entirely and the branch rows are not re-rendered. The merge-target dropdown is capped at 40 entries, with the current / target / stage branch pinned first, instead of rendering every branch in the repository.

### Measured

| Case | Before | After |
| --- | --- | --- |
| Large repo (9 local / 423 remote branches) | 6726 ms | 372–395 ms |
| Medium repo (18 local / 9 remote branches) | 9323 ms | 259–260 ms |
| 8 concurrent `view` calls | 4.85 s each | 0.91–0.97 s each |
| Host subprocess runner processes | one per call | 0 |

The security boundary is unchanged and was re-verified: workspace gate (`workspace-unknown` for unregistered paths), loopback fence, `415` for non-JSON bodies, and `invalid-ref-name` for arguments such as `-D` or `--upload-pack`.

### Added

- `scripts/verify-status-parser.mjs` — 26 assertions over real `git status --porcelain=v2` output: clean, modified, staged rename, collapsed and expanded untracked, ahead/behind, divergence and conflict rows.
- Measurement scripts: `measure-view.mjs`, `soak-view.mjs`, `simulate-poll.mjs`, `measure-branch-cost.mjs`, `measure-untracked-cost.mjs`, `watch-handles.mjs`.

### Documentation

- Split into `README.md` (English, default) and `README.zh-CN.md`, added interface screenshots, a market catalog entry and a 180×180 icon.

## 0.1.0 — 2026-10-22

First tagged release.

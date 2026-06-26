# Global CI/CD — one canonical pipeline for every project

There is **one** CI/CD pipeline: [`.github/workflows/reusable-ci-cd.yml`](../.github/workflows/reusable-ci-cd.yml)
(a GitHub **reusable workflow**, `on: workflow_call`). Every project gets a **thin
caller** that only declares its options. **Never** inline pipeline steps into a
project, and **never** invent a different CI/CD approach — extend the reusable
workflow instead, so all projects move together and never drift.

Pipeline: `checkout → setup(node/python) → install → lint → custom-check → test →
build → deploy(firebase | github-pages | netlify | vps-ssh | none) → smoke`.
Every stage is opt-in (runs only when its input is set). Hardening is built in:
least-privilege `permissions`, `concurrency` (no overlapping/partial deploys),
per-job `timeout-minutes`, secret-presence gates, retry + idempotent release
handling, optional dependency cache, post-deploy smoke verification, and a job
summary. Only official `actions/*` + CLIs are used (no unpinned third-party
actions).

## Adopt it in a project

Add `.github/workflows/deploy.yml` (a thin caller). Same-repo callers reference
the file by path; other repos reference it by full slug `@main`:

```yaml
name: CI/CD
on:
  push: { branches: [main] }
  workflow_dispatch: {}
jobs:
  ci-cd:
    # same repo as the reusable workflow:
    uses: ./.github/workflows/reusable-ci-cd.yml
    # any OTHER repo (this repo is public):
    # uses: Victordtesla24/prompt-reconstruction-engine/.github/workflows/reusable-ci-cd.yml@main
    permissions: { contents: read }   # add `pages: write` + `id-token: write` for github-pages
    secrets: inherit
    with:
      # …project options (see presets)…
```

## Per-project-type presets (copy the `with:` block)

**Static site → Firebase Hosting** (e.g. prompt-reconstruction-engine, forgotten-mistory)
```yaml
with:
  node_version: "20"
  test_cmd: npm test
  build_cmd: ""               # set if the site needs a build
  deploy_target: firebase
  firebase_project: <project-id>
  smoke_url: https://<host>/
secrets: inherit               # needs FIREBASE_SERVICE_ACCOUNT
```

**Pure static HTML → GitHub Pages** (e.g. vik-legal-defence)
```yaml
permissions: { contents: read, pages: write, id-token: write }
with:
  deploy_target: github-pages
  pages_dir: "."             # or dist/out
  smoke_url: https://<user>.github.io/<repo>/
secrets: inherit              # none required
```

**Tailwind/SPA → Netlify** (e.g. legal-strategy-dashboard)
```yaml
with:
  node_version: "20"
  build_cmd: npm run build:css
  test_cmd: node --test
  deploy_target: netlify
  netlify_site_id: <site-id>
  netlify_dir: "."
  smoke_url: https://<site>.netlify.app/
secrets: inherit              # needs NETLIFY_AUTH_TOKEN
```

**Node backend → VPS (ssh + systemd)** (e.g. recon-backend)
```yaml
with:
  deploy_target: vps-ssh
  vps_host: 187.77.12.13
  vps_user: root
  vps_src: "server/"
  vps_dest: /opt/recon-backend/server/
  vps_post_cmd: systemctl restart recon-backend
  smoke_url: https://recon.srv1356245.hstgr.cloud/health
secrets: inherit              # needs VPS_SSH_KEY (and ideally VPS_KNOWN_HOSTS)
```

**Python (uv) package** (e.g. scripts/mcp-doctor, maclean)
```yaml
with:
  python_version: "3.12"
  use_uv: true
  lint_cmd: "uvx ruff check . && uvx mypy ."
  test_cmd: uv run pytest
  deploy_target: none
```

**Library / no deploy** (e.g. ralph-loop-infinite)
```yaml
with:
  lint_cmd: "shellcheck $(git ls-files '*.sh')"   # or omit
  deploy: false
  deploy_target: none
```

## Required secrets by target

| Target | Secrets |
|---|---|
| firebase | `FIREBASE_SERVICE_ACCOUNT` |
| github-pages | none (uses `GITHUB_TOKEN` via `id-token`/`pages` perms) |
| netlify | `NETLIFY_AUTH_TOKEN` (+ `netlify_site_id` input) |
| vps-ssh | `VPS_SSH_KEY` (+ optional `VPS_KNOWN_HOSTS`) |

Every deploy step **gates on its secret** (`if missing → ::error:: and fail`), so
a caller is safe to add before the secret exists (the run fails loudly, never
silently deploys wrong).

## Pre-flight checklist (before adding/migrating CI on ANY project)

1. You are inside the **subproject repo** (workspace root is not a repo) and on a
   **non-default branch** (the git-guard blocks committing on `main`).
2. Read the subproject's `CLAUDE.md`/`AGENTS.md` for exact **build/test/lint** commands.
3. Confirm a **GitHub remote exists** (`git remote -v`) — no remote ⇒ no Actions; create one first.
4. Identify the **deploy target** and confirm the required **secrets** exist (`gh secret list`).
5. **Do not regress** an existing richer pipeline: fold extra gates (lighthouse, axe,
   typecheck, Playwright) into `lint_cmd`/`test_cmd`/`custom_check_cmd`; if a deploy
   mode is missing (Firebase Functions, PR-preview channels, Docker), **extend the
   reusable workflow** — never drop the feature.
6. `brew install actionlint` and lint locally (`actionlint .github/workflows/*.yml`);
   optional `brew install act` for `act -n` dry-runs.
7. Open a **PR** (don't push CI straight to `main` on a live repo); confirm green +
   smoke before merge.

## Workspace rollout status

| Repo | Remote | Target | Status |
|---|---|---|---|
| prompt-reconstruction-engine | public | firebase (+ vps backend, manual) | **migrated to reusable + tested** |
| vik-legal-defence | public | github-pages | caller ready (preset above) |
| ralph-loop-infinite | public | none (bash lib) | caller ready (lint/none) |
| forgotten-mistory | public | firebase hosting **+ functions + lighthouse/axe + PR previews** | migrate carefully — extend reusable for functions/previews before replacing; do not regress |
| abentertainment | public | **dual: Docker-VPS + Hostinger static** | migrate carefully — express both via vps-ssh/post-cmd; do not regress |
| General-Work | private | none (docs; macOS jarvis) | optional lint-only; app build needs macOS runner (out of ubuntu scope) |
| legal-strategy-dashboard | **none** | netlify | blocked — create GitHub remote first |
| jarvis-holographic | **none** | none chosen | blocked — create remote + pick target |
| scripts/mcp-doctor | **none** | (PyPI?) | blocked — create remote first |

## Linting & local testing

```bash
actionlint .github/workflows/*.yml      # static lint (installed: 1.7.12)
act -n                                  # optional dry-run (needs Docker + `brew install act`)
gh workflow run "Deploy to Firebase Hosting"   # trigger the dispatch run
gh run watch                            # watch it
```

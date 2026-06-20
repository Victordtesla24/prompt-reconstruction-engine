# Prompt Reconstruction Engine

Turns a raw, unstructured prompt into a **precision-engineered system prompt** that
maximises execution accuracy when run by an autonomous coding agent (Claude Opus
4.8, DeepSeek V4 Pro, and the OpenRouter open-source frontier).

Live: <https://prompt-reconstruction-engine.web.app>

## What it produces

A 5-layer system prompt — **Foundation → Requirements & Constraints → Execution
Control (SDLC FSM) → Quality & Verification → Deliverables** — with a
non-skippable lifecycle loop (Plan → Build → Test → Debug → Code-review → Re-test
→ Regression-test → Commit → Deploy → Verify → loop) and a `###STOP###` completion
protocol, adapted per target model.

## Context attachments (R1–R8)

Attach external context alongside the raw prompt and the engine folds it into the
reconstructed prompt as **DATA** (never instructions): a target **deliverable**, a
debugging / defect-resolution **reference**, or a **to-do** source — plus an
auto-derived TO-DO list. Supported: local **files / photos / media**, **GitHub
repositories** (enriched with real public metadata + README, key-free), **website
links**, and **terminal command outputs**. Each attachment is role-typed, and only
`to-do` items may carry actionable instructions (authority-by-role anti-injection).

## Architecture

- **`public/engine.core.js`** — pure, dependency-free reconstruction core
  (UMD: `window.PRE` + Node `module.exports`). Deterministic (no `Date.now`/
  `Math.random`). The single source of truth, shared verbatim by the frontend and
  the backend. Key API: `reconstruct`, `parseRawPrompt`, `buildSystemPrompt`,
  `scoreReconstruction`, `validateReconstruction`, `buildMetaInstruction`,
  `buildResearchInstruction`, `normalizeAttachments`.
- **`public/index.html`** — static frontend. Runs the deterministic engine
  client-side by default; an optional **Live AI** toggle calls the backend when
  `recon-api-base` is configured.
- **`server/reconstruct-server.cjs`** — VPS OpenRouter backend. Holds
  `OPENROUTER_API_KEY`, runs a ranked reconstructor chain (`z-ai/glm-5.2` →
  `deepseek/deepseek-v4-pro` → …), validates every output and falls back to the
  deterministic engine so the mandated loop is never lost. Also hosts the
  token-gated `POST /research` deep-research dispatch (see below).

Empty `recon-api-base` ⇒ the site runs **deterministic-only** — fully functional,
no backend required.

## Deep research (R9–R15)

`POST /research` dispatches a structured brief to `perplexity/sonar-deep-research`
(OpenRouter) to study the deployed engine across execution-accuracy metrics,
model feasibility, structure, independent review, tooling, and improvements. It is
**disabled unless `RESEARCH_TOKEN` is set**. See [`docs/DEEP-RESEARCH.md`](docs/DEEP-RESEARCH.md)
for the latest findings and the prioritized improvement roadmap.

## Develop

```bash
npm test          # node --test tests/engine.test.cjs (zero deps)
npm run syntax    # node --check on inline script + core + server
npm run server    # OPENROUTER_API_KEY=… node server/reconstruct-server.cjs
```

CI (`.github/workflows/deploy.yml`) runs the JS syntax check and auto-deploys to
Firebase Hosting on push to `main`.

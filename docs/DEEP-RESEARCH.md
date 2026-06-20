# Deep Research — Prompt Reconstruction Engine (R9–R15)

Independent deep-research study of the **deployed** engine
(<https://prompt-reconstruction-engine.web.app>) focused on the reconstructed
prompt's and the executing agent's: execution-accuracy metrics, feasibility on
the latest coding agents, structure, independent review/verification, optimal
tool/MCP usage, and other critical accuracy-maximising changes.

## Method & honesty note

Run as a multi-agent fan-out: two **grounding** agents (OpenRouter/Perplexity
facts; 2026 context-injection best practices) + one assessment agent per
dimension, each reading the actual source (`engine.core.js`,
`reconstruct-server.cjs`, `index.html`, `tests/engine.test.cjs`) and cross-checking
against external 2026 sources.

**Coverage cap (no silent truncation):** the run hit a monthly API spend limit
partway through. **Completed:** the two grounding agents and dimensions
**R10, R11, R12, R15**. **Cut short by the cap:** the dedicated **R13**
(independent reviewer) and **R14** (tooling/MCP) assessment agents, plus the
machine synthesis/verify pass. Those two dimensions below are synthesized from
the source + the grounding findings + first-principles, and are explicitly marked
as *not independently deep-researched* — treat their confidence accordingly.

## Confirmed facts

- **Perplexity deep-research slug: `perplexity/sonar-deep-research`** — verified
  current on OpenRouter. OpenAI-compatible chat model; returns **citations**
  natively as message annotations (`url_citation`: title, url, date). Paid/metered
  (~$2/1M in, $8/1M out, $3/1M reasoning, $5/1k searches; 128K context). Paid
  route ⇒ no OpenRouter RPM cap, but multi-minute latency — prefer **async
  submit-and-poll** for production.
- **All engine model slugs are live and correct** — `z-ai/glm-5.2`,
  `z-ai/glm-4.7`, `deepseek/deepseek-v4-pro`, `qwen/qwen3-coder-next`,
  `moonshotai/kimi-k2.7-code`, `mistralai/codestral-2508`,
  `meta-llama/llama-4-maverick`, `anthropic/claude-opus-4.8`, `openrouter/auto`.
  **No slug changes required.**

## Findings by dimension

### R10 · Execution-accuracy metrics
The headline "% Execution Accuracy" is largely **self-referential**:
`scoreReconstruction` scores the reconstructed prompt against markers the
deterministic builder is guaranteed to emit, so on the deterministic path every
dimension pins near 100. `constraintGuard` is a raw count, not a quality measure.
Nothing executes the reconstructed prompt against a real agent and measures the
*agent's* accuracy. The genuinely well-built part is `validateReconstruction` —
but it is a binary **gate**, not a metric, and (before this change set) checked
only `\bR1\b` for requirement coverage.

### R11 · Feasibility / suitability on the latest coding agents
The 5-layer + SDLC spine executes well on all targets, but the **per-model
adapters are mostly cosmetic**: only the Claude XML branch and one preamble
sentence differ; reasoning-effort/thinking-mode written as prose are inert
(they are request-side parameters). The rich per-family `model.note`s never reach
the deterministic prompt. GLM-5.2/4.7 is the strongest non-Claude fit as written;
Qwen/Llama/Codestral lack their real tool-call formats; Codestral (a FIM
autocomplete model) is wrongly handed the agentic spec.

### R12 · Structure
The 5-layer spine (Foundation → Requirements → SDLC-FSM → Quality → Deliverables)
is **well-conceived and correctly ordered** for 2026 coding-agent execution. The
single biggest structural gap identified was **"no dedicated CONTEXT/attachments
layer"** — every pasted reference was being mis-classified as a requirement or
constraint. *(This change set closes exactly that gap: a `§1.1 CONTEXT` layer that
holds attachments verbatim as DATA — see below.)* Remaining: `qualityBlock` over-
fuses three concerns; no few-shot/example slot; the SDLC FSM is not task-tiered.

### R13 · Independent reviewer & verification *(not independently deep-researched — cap)*
The SDLC mandates **self**-review (P5 Code-review) and re-test/regression, but no
**independent** verifier of the deliverables/agent outputs *post*-execution.
Recommended: the reconstructed prompt should mandate an independent-verifier pass —
evidence-before-claims, adversarial "try to refute each claim", and a separate
reviewer identity that re-checks every requirement→test mapping against actual
run output rather than the agent's self-report.

### R14 · Effective & optimum tooling / skills / plugins / MCP *(not independently deep-researched — cap)*
§1 mentions "Tools available" only generically. Recommended: a `§ TOOLING` block
(or Foundation addendum) that directs the agent to **discover and use** the right
skills/plugins/MCP servers and public OSS libs/repos for the task, prefer existing
capability over reinvention, and record which tools were used. The grounding
research adds a security caveat: treat MCP tool descriptions and config files
(CLAUDE.md/AGENTS.md) as **untrusted context** under least-privilege.

### R15 · Other critical accuracy-maximising changes
Highest-leverage finding: the live-AI gate's requirement-coverage check was only
`R1`-deep, so an AI reconstruction that silently dropped R2..Rn still passed.
Other prioritized items: server should **score every gate-passing candidate** and
pick the best (best-of-N) instead of first-pass; send a fixed **seed** +
structured outputs; validate **constraint** (C1..Cn) coverage; recover
near-complete **truncated** outputs via one continuation.

## Prioritized roadmap

| # | Change | Impact | Effort | Status |
|---|--------|--------|--------|--------|
| 1 | Harden `validateReconstruction` to enforce full R1..Rn coverage (live-AI gate) | High | Low | **SHIPPED** (this change set) |
| 2 | Dedicated CONTEXT/attachments layer (DATA, role-typed, TO-DO derivation) | High | Med | **SHIPPED** (R1–R8) |
| 3 | Authorization-by-role anti-injection in the CONTEXT layer (CVE-2025-53773 class) | High | Low | **SHIPPED** |
| 4 | Server scores every gate-passing AI candidate, selects best (best-of-N) | High | Med | Roadmap |
| 5 | Fixed seed + structured outputs (`response_format`) on the OpenRouter call | Med | Low | Roadmap |
| 6 | Validate constraint coverage (C1..Cn) in the gate | Med | Low | Roadmap |
| 7 | Real per-family tool-call scaffolding (Qwen/Llama/DeepSeek) in `buildSystemPrompt` | High | Med | Roadmap |
| 8 | Copyable per-family API-parameter snippets (vs inert prose) | High | Low | Roadmap |
| 9 | Independent-verifier role + evidence-before-claims mandate (R13) | High | Med | Roadmap |
| 10 | `§ TOOLING` discovery/usage block (R14) | Med | Low | Roadmap |
| 11 | Semantic requirement-coverage metric; rename "Execution Accuracy" → "Spec Conformance" | High | Med | Roadmap |
| 12 | Task-tiered SDLC (compressed loop for one-line fixes) + optional few-shot slot | Med | Med | Roadmap |
| 13 | Recover near-complete truncated outputs via one continuation turn | Med | Med | Roadmap |

Items 1–3 shipped here (test-covered, low-risk, backward-compatible). Items 4–13
are deferred to keep this change set minimal and non-regressing (constraint C1);
they are concrete and ready to pick up.

## Perplexity deep-research dispatch (R9)

Built into the engine, token-gated so a paid call can never be triggered by an
anonymous visitor:

- `PRE.buildResearchInstruction({ siteUrl?, repoUrl?, models? })` → `{ system, user }`
  — the R10–R15 research brief (deterministic, unit-tested).
- Backend `POST /research` (in `server/reconstruct-server.cjs`) dispatches it to
  `perplexity/sonar-deep-research`. Disabled unless `RESEARCH_TOKEN` is set; the
  caller must supply that token.

```bash
# On the VPS (with OPENROUTER_API_KEY + RESEARCH_TOKEN set):
curl -X POST https://<host>.<tailnet>.ts.net/research \
  -H "Authorization: Bearer $RESEARCH_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

This report itself was produced via the free multi-agent research path (Claude
subscription), not the paid Perplexity route, which remains a one-command opt-in
to respect the cost gate.

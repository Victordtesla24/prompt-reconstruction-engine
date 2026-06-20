/* Tests for the Prompt Reconstruction Engine core (spec v2).
 * Run: node --test   (Node 18+, no dependencies) */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const PRE = require('../public/engine.core.js');

const RAW_LIST = `1. Build a rate limiter for the payments API.
2. Add structured logging with request IDs.
- The service must not log secrets.
- Always use TypeScript on Node 20.
Use the \`payments-worker\` agent. \`ralphy\` runs in another terminal — don't collide.`;

const RAW_PROSE = 'make a dashboard that loads fast and shows live orders. it must never expose customer emails.';

test('parseRawPrompt extracts numbered requirements', () => {
  const p = PRE.parseRawPrompt(RAW_LIST);
  assert.ok(p.requirements.length >= 2, 'expected >=2 requirements');
  assert.ok(p.requirements.some(r => /rate limiter/i.test(r)));
});

test('parseRawPrompt separates must/never lines into constraints', () => {
  const p = PRE.parseRawPrompt(RAW_LIST);
  assert.ok(p.constraints.some(c => /must not log secrets/i.test(c)));
  assert.ok(p.constraints.some(c => /typescript/i.test(c)));
});

test('parseRawPrompt detects named agents and ignores shell reserved words', () => {
  const p = PRE.parseRawPrompt(RAW_LIST + '\nrun `npm` and `git`');
  assert.ok(p.agents.includes('payments-worker'));
  assert.ok(p.agents.includes('ralphy'));
  assert.ok(!p.agents.includes('npm'));
  assert.ok(!p.agents.includes('git'));
});

test('parseRawPrompt flags collision and infers backend domain', () => {
  const p = PRE.parseRawPrompt(RAW_LIST);
  assert.equal(p.collision, true);
  assert.equal(p.domain, 'backend');
});

test('prose input still yields requirements + constraints (fallback)', () => {
  const p = PRE.parseRawPrompt(RAW_PROSE);
  assert.ok(p.requirements.length >= 1);
  assert.ok(p.constraints.some(c => /never expose customer emails/i.test(c)));
});

test('reconstructed prompt contains ALL mandated SDLC phases, in order', () => {
  const full = PRE.reconstruct(RAW_LIST, { model: 'claude-opus-4-8' }).variants[0].prompt;
  // Scope to the SDLC section so requirement/preamble text that happens to
  // contain a phase word (e.g. "Build a rate limiter") can't confuse ordering.
  const prompt = full.slice(full.indexOf('EXECUTION CONTROL'));
  let last = -1;
  for (const ph of PRE.SDLC_PHASES) {
    const idx = prompt.indexOf(ph.name);
    assert.ok(idx !== -1, `phase missing: ${ph.name}`);
    assert.ok(idx > last, `phase out of order: ${ph.name}`);
    last = idx;
  }
});

test('mandated loop keywords are all present', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt.toLowerCase();
  for (const kw of ['plan', 'build', 'test', 'debug', 'code-review', 're-test', 'regression', 'commit', 'deploy', 'verify']) {
    assert.ok(prompt.includes(kw), `missing loop keyword: ${kw}`);
  }
});

test('output includes 5 layers, coverage table and ###STOP### token', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt;
  assert.ok(/§1 · FOUNDATION/.test(prompt));
  assert.ok(/§2 · REQUIREMENTS/.test(prompt));
  assert.ok(/§3 · EXECUTION CONTROL/.test(prompt));
  assert.ok(/§4 · QUALITY/.test(prompt));
  assert.ok(/§5 · DELIVERABLES/.test(prompt));
  assert.ok(/PASS\/FAIL/.test(prompt));
  assert.ok(/###STOP###/.test(prompt));
});

test('lossless: every parsed requirement is indexed in the output', () => {
  const r = PRE.reconstruct(RAW_LIST, { model: 'deepseek-v4-pro' });
  const n = r.parsed.requirements.length;
  for (let i = 1; i <= n; i++) assert.ok(r.variants[0].prompt.includes('R' + i + ':'), 'missing R' + i);
});

test('per-model: Claude target uses XML tags', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'claude-opus-4-8' }).variants[0].prompt;
  assert.ok(/<foundation>/.test(prompt) && /<sdlc>/.test(prompt));
  assert.ok(/high|max.*effort|effort/i.test(prompt));
});

test('per-model: DeepSeek target invokes <think> + reasoning_effort=xhigh', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'deepseek-v4-pro' }).variants[0].prompt;
  assert.ok(/<think>/.test(prompt));
  assert.ok(/reasoning_effort="xhigh"/.test(prompt));
  assert.ok(!/<foundation>/.test(prompt), 'DeepSeek variant must not use Claude XML wrappers');
});

test('per-model: Opus 4.8 target runs xHigh + Ultracode multi-agent orchestration', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'claude-opus-4-8' }).variants[0].prompt;
  assert.ok(/<foundation>/.test(prompt), 'Opus (claude family) uses XML wrappers');
  assert.ok(/xhigh/i.test(prompt), 'Opus runs at xHigh reasoning effort');
  assert.ok(/ultracode/i.test(prompt), 'Opus uses Ultracode multi-agent orchestration');
});

test('per-model: Claude Sonnet 4.7 target uses XML + scalable thinking budget (all levels)', () => {
  const r = PRE.reconstruct(RAW_LIST, { model: 'claude-sonnet-4-7' });
  const prompt = r.variants[0].prompt;
  assert.ok(/<foundation>/.test(prompt) && /<sdlc>/.test(prompt), 'Sonnet (claude family) uses XML wrappers');
  assert.ok(/thinking budget/i.test(prompt), 'must instruct a thinking budget scaled across all levels');
  assert.equal(PRE.MODELS['claude-sonnet-4-7'].executor, 'anthropic/claude-sonnet-4.7');
  assert.equal(PRE.MODELS['claude-sonnet-4-7'].family, 'claude');
});

test('per-model: Qwen target forbids hidden CoT (visible output)', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'qwen3-coder-next' }).variants[0].prompt;
  assert.ok(/no hidden chain-of-thought|visible/i.test(prompt));
});

test('per-model: GLM target keeps strict-constraint + ###STOP###', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'glm-4-7' }).variants[0].prompt;
  assert.ok(/never assume, extend, or generalise|strictly/i.test(prompt));
  assert.ok(/###STOP###/.test(prompt));
});

test('worker vs concurrent: the "other terminal" agent is not the primary role', () => {
  const p = PRE.parseRawPrompt('Use the `payments-worker` agent. `ralphy` runs in another terminal — don\'t collide.');
  assert.equal(p.worker, 'payments-worker');
  assert.ok(p.concurrent.includes('ralphy'));
  const prompt = PRE.buildSystemPrompt(p, { model: 'generic' });
  assert.ok(/You are `payments-worker`/.test(prompt), 'worker must be the primary role');
  assert.ok(/`ralphy` \(concurrent/.test(prompt), 'concurrent agent must be flagged');
});

test('honest scoring: dims present and overall within 0..100', () => {
  const r = PRE.reconstruct(RAW_LIST, { model: 'claude-opus-4-8' });
  const sc = r.variants[0].score;
  assert.equal(sc.dims.length, 5);
  assert.ok(sc.overall >= 0 && sc.overall <= 100);
  assert.equal(sc.dims[0].pct, 100, 'all requirements should be mapped → 100% coverage');
});

test('determinism: identical input ⇒ identical output', () => {
  const a = PRE.reconstruct(RAW_LIST, { model: 'glm-4-7' }).variants[0].prompt;
  const b = PRE.reconstruct(RAW_LIST, { model: 'glm-4-7' }).variants[0].prompt;
  assert.equal(a, b);
});

test('no DOM dependency: core runs in pure Node', () => {
  assert.equal(typeof document, 'undefined');
  assert.doesNotThrow(() => PRE.reconstruct('do a thing', {}));
});

test('buildMetaInstruction encodes lossless + full loop + ###STOP###', () => {
  const mi = PRE.buildMetaInstruction('deepseek-v4-pro');
  assert.ok(/LOSSLESS/.test(mi));
  assert.ok(/Plan → Build → Test → Debug → Code-review → Re-test → Regression-test → Commit → Deploy/.test(mi));
  assert.ok(/###STOP###/.test(mi));
});

test('model registry uses live-verified OpenRouter slugs', () => {
  assert.equal(PRE.MODELS['deepseek-v4-pro'].executor, 'deepseek/deepseek-v4-pro');
  assert.equal(PRE.MODELS['glm-4-7'].executor, 'z-ai/glm-4.7');
  assert.equal(PRE.MODELS['qwen3-coder-next'].executor, 'qwen/qwen3-coder-next');
  assert.ok(PRE.RECONSTRUCTOR_CHAIN.includes('deepseek/deepseek-v4-pro'));
});

test('empty / whitespace input does not throw', () => {
  assert.doesNotThrow(() => PRE.reconstruct('', {}));
  assert.doesNotThrow(() => PRE.reconstruct('   \n  ', {}));
});

// ── v2.1: validation gate, latest models, hardened meta + reconstructed prompt ──

test('validateReconstruction PASSES the deterministic engine output (guaranteed fallback)', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'glm-5-2' }).variants[0].prompt;
  const v = PRE.validateReconstruction(prompt);
  assert.deepEqual(v.missing, [], 'deterministic output must be the guaranteed-compliant fallback');
  assert.equal(v.ok, true);
});

test('validateReconstruction FAILS a truncated reconstruction (missing ###STOP###)', () => {
  const full = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt;
  const truncated = full.slice(0, Math.floor(full.length * 0.5)); // cut before §5/###STOP###
  const v = PRE.validateReconstruction(truncated);
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes('stop-token'), 'must detect the missing completion token');
});

test('validateReconstruction FAILS when SDLC phases are dropped', () => {
  const v = PRE.validateReconstruction(
    'R1: do it. ###STOP### foundation requirements execution quality deliverables ' + 'x'.repeat(500));
  assert.equal(v.ok, false);
  assert.ok(v.missing.some(m => m.indexOf('phase:') === 0), 'must flag the dropped phases');
});

test('validateReconstruction tolerates case/punctuation reformatting of phase names', () => {
  let p = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt;
  p = p.replace(/Code-review/g, 'code review').replace(/Re-test/g, 'RETEST');
  const v = PRE.validateReconstruction(p);
  assert.ok(!v.missing.some(m => m === 'phase:Code-review' || m === 'phase:Re-test'),
    'punctuation/case differences must not be treated as dropped phases');
});

test('validateReconstruction rejects a dropped standalone Test phase (no false-accept via Re-test/Regression-test)', () => {
  // A model that emits Re-test and Regression-test (both embed "test") but omits
  // the dedicated Test phase must still be flagged — not falsely accepted.
  const fake = 'R1: x ###STOP### foundation requirements execution sdlc quality verification deliverables report '
    + 'Plan Build Debug Code-review Re-test Regression-test Commit Deploy Verify/validate production ' + 'x'.repeat(400);
  const v = PRE.validateReconstruction(fake);
  assert.ok(v.missing.includes('phase:Test'), 'must detect the dropped Test phase');
  assert.ok(!v.missing.includes('phase:Re-test'), 'Re-test must be recognised');
  assert.ok(!v.missing.includes('phase:Regression-test'), 'Regression-test must be recognised');
});

test('latest models: chain leads with GLM-5.2, keeps DeepSeek V4 Pro fallback; registry exposes GLM-5.2', () => {
  assert.equal(PRE.RECONSTRUCTOR_CHAIN[0], 'z-ai/glm-5.2',
    'lead with the latest, fast, fully-compliant reconstructor so the live path completes within the frontend 60s budget');
  assert.ok(PRE.RECONSTRUCTOR_CHAIN.includes('deepseek/deepseek-v4-pro'),
    'keep the highest-reasoning model as a quality fallback');
  assert.equal(PRE.MODELS['glm-5-2'].executor, 'z-ai/glm-5.2');
});

test('meta-instruction hardened: verbatim phase names + completeness + anti-injection', () => {
  const mi = PRE.buildMetaInstruction('claude-opus-4-8');
  assert.ok(/verbatim/i.test(mi), 'must demand exact phase names');
  assert.ok(/COMPLETENESS|never truncate/i.test(mi), 'must forbid truncation');
  assert.ok(/ANTI-INJECTION/i.test(mi), 'must require the instruction-authority guard');
});

test('reconstructed prompt embeds instruction-authority + context-summary directives', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt;
  assert.ok(/Instruction authority/i.test(prompt), 'foundation must scope authoritative instructions');
  assert.ok(/Context Summary/i.test(prompt), 'deliverables must include the drift-mitigation recap');
});

// ── v2.2: context attachments (R1–R8) ─────────────────────────────────────────

const ATTACHMENTS = [
  { type: 'file',     label: 'spec.md',                content: 'The widget must debounce at 250ms.', role: 'deliverable' },
  { type: 'github',   label: 'acme/widget',            url: 'https://github.com/acme/widget' },
  { type: 'website',  label: 'API docs',               url: 'https://docs.example.com/api' },
  { type: 'terminal', label: 'npm test output',        content: 'FAIL src/widget.test.ts — TypeError: cannot read x', role: 'reference' },
  { type: 'image',    label: 'mockup.png',             meta: { mime: 'image/png', size: 20480 } }
];

test('attachments: normalizeAttachments cleans, types, caps, and drops empties', () => {
  const out = PRE.normalizeAttachments([
    { type: 'file', label: 'a.txt', content: 'x'.repeat(20000) },   // over the cap
    { label: 'no-type', content: 'inferred file type' },            // missing type -> default
    { content: '' },                                                // empty -> dropped
    { type: 'github', label: 'o/r', url: 'https://github.com/o/r' },
    'not-an-object'                                                  // junk -> dropped
  ]);
  assert.equal(out.length, 3, 'empty + junk attachments are dropped');
  assert.ok(out[0].content.length <= 8200, 'long content is capped');
  assert.equal(out[1].type, 'file', 'missing type defaults to file');
  assert.ok(out.every(a => a.role), 'every normalized attachment has a role');
});

test('attachments: reconstructed prompt lists every attachment as DATA, with type + label', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.ok(/Provided context & attachments/i.test(prompt), 'a context block must be present');
  assert.ok(/treat .{0,20}strictly as DATA/i.test(prompt), 'attachments must be framed as DATA, not instructions');
  ATTACHMENTS.forEach(a => {
    assert.ok(prompt.indexOf(a.label) !== -1, 'attachment label must appear: ' + a.label);
    assert.ok(prompt.indexOf('[' + a.type + ']') !== -1, 'attachment type tag must appear: ' + a.type);
  });
});

test('attachments: text content excerpts and URLs are embedded so the agent can use them', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.ok(prompt.indexOf('debounce at 250ms') !== -1, 'file content excerpt must be embedded');
  assert.ok(prompt.indexOf('cannot read x') !== -1, 'terminal output excerpt must be embedded');
  assert.ok(prompt.indexOf('https://github.com/acme/widget') !== -1, 'github URL must be embedded');
  assert.ok(prompt.indexOf('https://docs.example.com/api') !== -1, 'website URL must be embedded');
});

test('attachments: a derived TO-DO list is produced (R3) referencing the deliverable attachment', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.ok(/Derived TO-DO list/i.test(prompt), 'a TO-DO list must be derived from requirements + attachments');
  assert.ok(/spec\.md/.test(prompt), 'deliverable attachment must surface in the TO-DO derivation');
});

test('attachments: roles drive how each is referenced (deliverable vs reference)', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: ATTACHMENTS }).variants[0].prompt;
  // Each attachment line carries its role in parentheses, e.g. "[file] spec.md (deliverable)".
  assert.ok(/\(deliverable\)/.test(prompt), 'a deliverable-role attachment must be tagged (deliverable)');
  assert.ok(/\(reference\)/.test(prompt), 'a reference-role attachment must be tagged (reference)');
});

test('attachments: deliverables layer mandates verifying each attachment was incorporated', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.ok(/each attached (?:context|reference|item).{0,80}incorporat/i.test(prompt) ||
           /incorporat.{0,80}attach/i.test(prompt),
    'deliverables/verification must require every attachment to be addressed');
});

test('attachments: NO attachments leaves the reconstructed output unchanged (non-regression, C1)', () => {
  const withNone = PRE.reconstruct(RAW_PROSE, { model: 'generic' }).variants[0].prompt;
  const withEmpty = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: [] }).variants[0].prompt;
  assert.equal(withNone, withEmpty, 'empty attachments must not alter output');
  assert.ok(!/Provided context & attachments/i.test(withNone), 'no context block when there are no attachments');
});

test('attachments: determinism holds with attachments (identical input ⇒ identical output)', () => {
  const a = PRE.reconstruct(RAW_PROSE, { model: 'claude-opus-4-8', attachments: ATTACHMENTS }).variants[0].prompt;
  const b = PRE.reconstruct(RAW_PROSE, { model: 'claude-opus-4-8', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.equal(a, b);
});

test('attachments: Claude target wraps the context block in its XML section too', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'claude-opus-4-8', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.ok(/<context>/.test(prompt) && /<\/context>/.test(prompt), 'Claude variant must tag the context section');
});

test('attachments: meta-instruction tells the live model to incorporate provided context; backward compatible without', () => {
  const withAtt = PRE.buildMetaInstruction('claude-opus-4-8', { attachments: ATTACHMENTS });
  assert.ok(/context|attach/i.test(withAtt), 'meta-instruction must direct the model to use provided context');
  assert.ok(/DATA/i.test(withAtt), 'meta-instruction must keep the DATA-not-instructions guard for attachments');
  const plain = PRE.buildMetaInstruction('claude-opus-4-8');
  assert.ok(/LOSSLESS/.test(plain) && /###STOP###/.test(plain), 'no-opts meta-instruction stays fully intact (backward compatible)');
});

// ── v2.2: Perplexity deep-research dispatch (R9–R15) ──────────────────────────

test('research: buildResearchInstruction returns a {system,user} brief covering R10–R15', () => {
  const r = PRE.buildResearchInstruction();
  assert.ok(r && typeof r.system === 'string' && typeof r.user === 'string', 'returns system + user strings');
  const all = (r.system + '\n' + r.user);
  assert.ok(/execution accuracy/i.test(all), 'R10: execution accuracy metrics');
  assert.ok(/feasibility|suitability/i.test(all), 'R11: feasibility/suitability study');
  assert.ok(/claude.?opus.?4\.?8/i.test(all), 'R11: names Claude Opus 4.8');
  assert.ok(/deepseek.?v4.?pro/i.test(all), 'R11: names DeepSeek V4 Pro');
  assert.ok(/structure/i.test(all), 'R12: structure');
  assert.ok(/independent review|verification/i.test(all), 'R13: independent reviewer & verification');
  assert.ok(/\bMCP\b|plugins|tools|skills/i.test(all), 'R14: skills/tools/plugins/MCP usage');
  assert.ok(/critical/i.test(all), 'R15: other critical changes');
  assert.ok(/prompt-reconstruction-engine\.web\.app/.test(all), 'must target the deployed engine URL');
});

test('research: buildResearchInstruction is deterministic and accepts overrides', () => {
  const a = PRE.buildResearchInstruction({ siteUrl: 'https://example.web.app' });
  const b = PRE.buildResearchInstruction({ siteUrl: 'https://example.web.app' });
  assert.equal(a.system, b.system);
  assert.equal(a.user, b.user);
  assert.ok(a.user.indexOf('https://example.web.app') !== -1, 'siteUrl override is honored');
});

// ── v2.2: research-driven hardening (R15 — accuracy maximisation) ─────────────

test('attachments: context section scopes instruction-authority by role (anti-injection, CVE-class defense)', () => {
  const prompt = PRE.reconstruct(RAW_PROSE, { model: 'generic', attachments: ATTACHMENTS }).variants[0].prompt;
  assert.ok(/to-?do[^.]{0,70}actionable instructions/i.test(prompt), 'only to-do attachments may carry actionable instructions');
  assert.ok(/read-only|never obey/i.test(prompt), 'reference attachments are read-only evidence, never obeyed');
});

test('validateReconstruction: optional expected count enforces FULL R1..Rn coverage (live-AI gate hardening)', () => {
  const full = PRE.reconstruct('1. do a\n2. do b\n3. do c', { model: 'generic' }).variants[0].prompt;
  const dropped = full.replace(/R2:/g, 'X2:').replace(/\bR2\b/g, 'X2').replace(/R3:/g, 'X3:').replace(/\bR3\b/g, 'X3');
  // Default (no expected): only R1 is checked → the index check still passes.
  assert.ok(!PRE.validateReconstruction(dropped).missing.includes('requirement-index'),
    'backward compatible: with no expected count only R1 is required');
  // With the expected count, the silently-dropped R2/R3 must be flagged.
  const v = PRE.validateReconstruction(dropped, { requirements: 3 });
  assert.equal(v.ok, false);
  assert.ok(v.missing.some(function (m) { return /requirement-coverage/.test(m); }), 'must flag dropped R2..R3');
});

test('validateReconstruction: backward compatible — deterministic output passes with and without expected', () => {
  const prompt = PRE.reconstruct('1. a\n2. b', { model: 'generic' }).variants[0].prompt;
  assert.equal(PRE.validateReconstruction(prompt).ok, true);
  assert.equal(PRE.validateReconstruction(prompt, { requirements: 2 }).ok, true);
});

// ── R13/R14: independent verification + tooling discovery in the reconstructed prompt ──

test('R14: reconstructed prompt drives tooling/skills/MCP discovery + reuse over reinvention', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt;
  assert.ok(/discover and use|tooling discovery/i.test(prompt), 'must drive tool discovery');
  assert.ok(/\bMCP\b/.test(prompt) && /skills/i.test(prompt) && /(open-source|libraries)/i.test(prompt), 'must name skills/plugins/MCP/OSS libraries');
  assert.ok(/reinvent|extending proven|existing/i.test(prompt), 'must prefer reuse over reinvention');
});

test('R13: reconstructed prompt mandates an INDEPENDENT verification pass (evidence-before-claims)', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'generic' }).variants[0].prompt;
  assert.ok(/independent verification|independent-reviewer/i.test(prompt), 'must mandate independent verification');
  assert.ok(/evidence|execution|test output|logs|live check/i.test(prompt), 'must require evidence, not self-report');
});

test('meta-instruction also mandates independent verification + tooling discovery (live-AI path)', () => {
  const mi = PRE.buildMetaInstruction('claude-opus-4-8');
  assert.ok(/independent/i.test(mi) && /verif/i.test(mi), 'meta must require independent verification');
  assert.ok(/\bMCP\b|tooling|skills/i.test(mi), 'meta must require tooling discovery');
});

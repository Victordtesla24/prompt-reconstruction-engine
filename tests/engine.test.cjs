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
  const r = PRE.reconstruct(RAW_LIST, { model: 'claude-opus-4-8' });
  const prompt = r.variants[0].prompt;
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

test('per-model: DeepSeek target invokes <think> + reasoning_effort=max', () => {
  const prompt = PRE.reconstruct(RAW_LIST, { model: 'deepseek-v4-pro' }).variants[0].prompt;
  assert.ok(/<think>/.test(prompt));
  assert.ok(/reasoning_effort="max"/.test(prompt));
  assert.ok(!/<foundation>/.test(prompt), 'DeepSeek variant must not use Claude XML wrappers');
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

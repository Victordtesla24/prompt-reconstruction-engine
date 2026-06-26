#!/usr/bin/env node
'use strict';
/** R1: Cross-model execution evals via OpenRouter — real API, fail loudly if key missing. */
const fs = require('fs');
const path = require('path');
const PRE = require('../public/engine.core.js');
const corpus = require('./eval-corpus.cjs');
const { writeJson, timestamp } = require('./lib/report-io.cjs');

function loadApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(__dirname, '../server/.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const TARGETS = [
  {
    id: 'claude-low',
    model: 'anthropic/claude-haiku-4.5',
    tier: 'claude-low',
    taskKind: 'coding',
    promptHint: 'Use a minimal thinking budget and produce only the essential implementation plan.'
  },
  {
    id: 'claude-mid',
    model: 'anthropic/claude-sonnet-4.6',
    tier: 'claude-mid',
    taskKind: 'coding',
    promptHint: 'Use a normal thinking budget and produce a practical implementation plan.'
  },
  {
    id: 'claude-high',
    model: 'anthropic/claude-opus-4.8',
    tier: 'claude-high',
    taskKind: 'coding',
    promptHint: 'Use high reasoning effort and produce a rigorous implementation plan.'
  },
  {
    id: 'gemini-noncoding',
    model: 'google/gemini-3.1-pro-preview',
    tier: 'non-claude',
    taskKind: 'nonCoding',
    promptHint: 'Execute the non-coding specification and return the requested structured content.'
  },
  {
    id: 'glm-noncoding',
    model: 'z-ai/glm-5.2',
    tier: 'non-claude',
    taskKind: 'nonCoding',
    promptHint: 'Execute the non-coding specification and return the requested structured content.'
  }
];

const USER_TASK = {
  coding: 'Execute the specification above. Reply with a concise implementation plan (file paths + key code snippets). Do not ask clarifying questions.',
  nonCoding: 'Execute the specification above. Return the requested structured content. Do not add facts not present in the prompt.'
};

const TASK_CHECKS = {
  'code-simple-edit': [
    { id: 'mentions-retry-or-backoff', re: /retry|backoff/i },
    { id: 'mentions-fetch-or-client', re: /fetch|api\/client/i },
    { id: 'mentions-request-id', re: /request.?id/i },
    { id: 'respects-4xx-constraint', re: /4xx|400|401|403|404/i }
  ],
  'code-multi-file': [
    { id: 'mentions-health-endpoint', re: /health/i },
    { id: 'mentions-router', re: /router|route/i },
    { id: 'mentions-test', re: /test/i },
    { id: 'mentions-readme', re: /readme|documentation/i },
    { id: 'respects-stack-trace-constraint', re: /stack trace|internal|C1/i }
  ],
  'code-debug': [
    { id: 'mentions-flaky-or-race', re: /flaky|race|timing|CI/i },
    { id: 'mentions-regression-test', re: /regression/i },
    { id: 'does-not-disable-test', reject: /\b(disable|disabling|skip|skipping|comment out|remove)\b[^.\n]{0,25}\btest\b|\.skip\s*\(|\bxit\s*\(|\bit\.only\b|describe\.skip/i, allow: /\b(?:never|do not|don'?t|not|without|avoid(?:ing)?|rather than|instead of)\s+(?:just |simply |ever |the |a |any |to )?(?:disabl|skip)|\bno test\b[^.\n]{0,15}\bdisabl/i }
  ],
  'code-ui': [
    { id: 'mentions-responsive-panel', re: /responsive|settings panel/i },
    { id: 'mentions-dark-mode', re: /dark mode|theme/i },
    { id: 'mentions-wcag', re: /WCAG|contrast|accessibility|ARIA|focus/i },
    { id: 'mentions-keyboard', re: /keyboard|focus|ARIA|aria-|tab/i }
  ],
  'code-deploy': [
    { id: 'mentions-github-actions', re: /GitHub Actions|workflow/i },
    { id: 'mentions-firebase', re: /Firebase/i },
    { id: 'mentions-test-gate', re: /npm test|tests fail|test/i },
    { id: 'mentions-secret-safety', re: /secret/i }
  ],
  'write-summary': [
    { id: 'mentions-root-cause', re: /root cause/i },
    { id: 'mentions-impact', re: /impact/i },
    { id: 'mentions-remediation', re: /remediation|remedy|next step/i },
    { id: 'avoids-speculation-language', reject: /\bprobably|maybe|might be|I assume\b/i }
  ],
  'analysis-compare': [
    { id: 'mentions-cost', re: /cost/i },
    { id: 'mentions-risk', re: /risk/i },
    { id: 'mentions-time-to-value', re: /time.?to.?value|time to value/i },
    { id: 'mentions-tradeoffs', re: /trade-?off/i },
    { id: 'avoids-probably', reject: /\bprobably\b/i, allow: /["“']\s*probabl|\b(?:exclud\w*|avoid\w*|not use|do not use|did not use|no|without)\s+(?:the\s+)?(?:vague|speculat\w*|hedg\w*|word|term|phrase|language)\b/i }
  ],
  'transform-data': [
    { id: 'mentions-json-schema', re: /JSON|schema/i },
    { id: 'mentions-validation', re: /validat/i },
    { id: 'mentions-invalid-records', re: /invalid/i },
    { id: 'respects-no-drop-rows', re: /drop rows|dropped rows|silently|invalid records|partition/i }
  ]
};

async function callModel(apiKey, model, systemPrompt, userPrompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://prompt-reconstruction-engine.web.app',
        'X-Title': 'PRE model-eval'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 4000
      }),
      signal: ctrl.signal
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (data.error && data.error.message) || ('HTTP ' + r.status) };
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content || !content.trim()) return { ok: false, error: 'empty completion' };
    return { ok: true, content: content.trim(), usage: data.usage || null, model: data.model || model };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// A reject check fails ONLY when a single sentence/clause actually commits the
// violation — it matches `reject` AND lacks exonerating `allow` evidence IN THAT
// SAME unit. Per-unit scoping (vs. scanning the whole document) stops one
// boilerplate compliance phrase elsewhere from whitewashing a concrete bad
// action, and stops a quoted/negated mention of the forbidden term from counting
// as a violation.
function rejectViolation(output, c) {
  const units = String(output).split(/(?<=[.!?;:\n])\s+/);
  for (const u of units) {
    if (c.reject.test(u) && !(c.allow && c.allow.test(u))) return true;
  }
  return false;
}

function runExecutableChecks(output, item) {
  const checks = [];
  for (const c of TASK_CHECKS[item.id]) {
    if (c.reject) checks.push({ id: c.id, pass: !rejectViolation(output, c) });
    else checks.push({ id: c.id, pass: c.re.test(output) });
  }
  checks.push({ id: 'structured-response', pass: output.trim().length >= 120 });
  // Refusal-only = STARTS with a refusal AND offers no substantive deliverable
  // (short). A caveated-but-delivered answer ("I cannot fully X without repo
  // access, so here is the plan…") is long and must NOT be flagged as a refusal.
  const t = output.trim();
  checks.push({ id: 'no-refusal-only', pass: !(/^(I cannot|I can't|I am unable|I'?m unable|As an AI|Sorry,? I)/i.test(t) && t.length < 400) });
  return checks;
}

async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('FATAL: OPENROUTER_API_KEY not set (env or server/.env)');
    process.exit(1);
  }

  const ts = timestamp();
  const runs = [];
  for (const target of TARGETS) {
    const items = target.taskKind === 'coding' ? corpus.coding : corpus.nonCoding;
    for (const item of items) {
      const reconstructed = PRE.reconstruct(item.raw, { model: target.taskKind === 'coding' ? 'claude-opus-4-8' : 'generic' }).variants[0].prompt;
      const out = await callModel(apiKey, target.model, reconstructed, target.promptHint + '\n\n' + USER_TASK[target.taskKind]);
      const entry = {
        target: target.id,
        model: target.model,
        tier: target.tier,
        taskKind: target.taskKind,
        corpusTask: item.id,
        reconstructedLength: reconstructed.length,
        ok: out.ok,
        error: out.error || null,
        usage: out.usage || null,
        outputPreview: out.content ? out.content.slice(0, 500) : null,
        output: out.content || null,
        checks: out.ok ? runExecutableChecks(out.content, item) : []
      };
      if (out.ok) {
        entry.executablePass = entry.checks.every((c) => c.pass);
        entry.outputLength = out.content.length;
      }
      runs.push(entry);
      console.log(target.id + ' / ' + item.id + ': ' + (entry.ok ? (entry.executablePass ? 'PASS' : 'CHECK_FAIL') : 'API_FAIL'));
    }
  }

  const executableRuns = runs.filter((r) => r.ok);
  const executablePass = executableRuns.filter((r) => r.executablePass).length;
  const passRate = runs.length ? (executablePass / runs.length) * 100 : 0;

  const report = {
    capturedAt: ts,
    requirement: 'R1: >=95% executable-check success',
    coverage: {
      claudeCodingTiers: TARGETS.filter((t) => t.taskKind === 'coding').map((t) => t.id),
      codingCorpus: corpus.coding.map((i) => i.id),
      nonClaudeNonCodingTargets: TARGETS.filter((t) => t.taskKind === 'nonCoding').map((t) => t.id),
      nonCodingCorpus: corpus.nonCoding.map((i) => i.id)
    },
    totalTargets: runs.length,
    apiSuccess: executableRuns.length,
    executablePass,
    passRatePct: Math.round(passRate * 100) / 100,
    ok: passRate >= 95,
    runs
  };

  writeJson('model-eval.json', report);
  console.log('Model eval: ' + executablePass + '/' + executableRuns.length + ' executable (' + report.passRatePct + '%)');
  if (!report.ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

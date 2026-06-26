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
    id: 'deepseek-noncoding',
    model: 'deepseek/deepseek-v4-pro',
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

const TASKS = {
  coding: {
    item: corpus.coding[0],
    userTask: 'Execute the specification above. Reply with a concise implementation plan (file paths + key code snippets). Do not ask clarifying questions.',
    checks: [
      { id: 'mentions-retry-or-backoff', re: /retry|backoff/i },
      { id: 'mentions-fetch-or-client', re: /fetch|api\/client/i },
      { id: 'mentions-request-id', re: /request.?id/i },
      { id: 'respects-4xx-constraint', re: /4xx|400|401|403|404/i }
    ]
  },
  nonCoding: {
    item: corpus.nonCoding[0],
    userTask: 'Execute the specification above. Return executive bullets with root cause, impact, and remediation. Do not add facts not present in the prompt.',
    checks: [
      { id: 'mentions-root-cause', re: /root cause/i },
      { id: 'mentions-impact', re: /impact/i },
      { id: 'mentions-remediation', re: /remediation|remedy|next step/i },
      { id: 'avoids-speculation-language', reject: /\bprobably|maybe|might be|I assume\b/i }
    ]
  }
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
        max_tokens: 2000
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

function runExecutableChecks(output, taskKind) {
  const checks = [];
  for (const c of TASKS[taskKind].checks) {
    if (c.reject) checks.push({ id: c.id, pass: !c.reject.test(output) });
    else checks.push({ id: c.id, pass: c.re.test(output) });
  }
  checks.push({ id: 'structured-response', pass: output.trim().length >= 120 });
  checks.push({ id: 'no-refusal-only', pass: !/^(I cannot|I can't|As an AI)/i.test(output.trim()) });
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
    const task = TASKS[target.taskKind];
    const reconstructed = PRE.reconstruct(task.item.raw, { model: target.taskKind === 'coding' ? 'claude-opus-4-8' : 'generic' }).variants[0].prompt;
    const out = await callModel(apiKey, target.model, reconstructed, target.promptHint + '\n\n' + task.userTask);
    const entry = {
      target: target.id,
      model: target.model,
      tier: target.tier,
      taskKind: target.taskKind,
      corpusTask: task.item.id,
      reconstructedLength: reconstructed.length,
      ok: out.ok,
      error: out.error || null,
      usage: out.usage || null,
      outputPreview: out.content ? out.content.slice(0, 500) : null,
      output: out.content || null,
      checks: out.ok ? runExecutableChecks(out.content, target.taskKind) : []
    };
    if (out.ok) {
      entry.executablePass = entry.checks.every((c) => c.pass);
      entry.outputLength = out.content.length;
    }
    runs.push(entry);
    console.log(target.id + ': ' + (entry.ok ? (entry.executablePass ? 'PASS' : 'CHECK_FAIL') : 'API_FAIL'));
  }

  const executableRuns = runs.filter((r) => r.ok);
  const executablePass = executableRuns.filter((r) => r.executablePass).length;
  const passRate = runs.length ? (executablePass / runs.length) * 100 : 0;

  const report = {
    capturedAt: ts,
    requirement: 'R1: >=95% executable-check success',
    coverage: {
      claudeCodingTiers: TARGETS.filter((t) => t.taskKind === 'coding').map((t) => t.id),
      nonClaudeNonCodingTargets: TARGETS.filter((t) => t.taskKind === 'nonCoding').map((t) => t.id)
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

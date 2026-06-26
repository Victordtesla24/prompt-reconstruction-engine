#!/usr/bin/env node
'use strict';
/** R2: Prompt precision audit — ambiguity, indexing, phase exactness, validateReconstruction. */
const PRE = require('../public/engine.core.js');
const corpus = require('./eval-corpus.cjs');
const { writeJson, timestamp } = require('./lib/report-io.cjs');

const AMBIGUOUS_PATTERNS = [
  /\b(if possible|when feasible|try to|consider|maybe|perhaps|ideally|where appropriate|as needed|if applicable)\b/i,
  /\b(should|could|might|may want to)\b/i
];

const EXECUTION_SECTION_RE = /§3 · EXECUTION|EXECUTION CONTROL|§4 · QUALITY|QUALITY & VERIFICATION/i;

function auditOne(raw, model) {
  const r = PRE.reconstruct(raw, { model: model || 'generic' });
  const prompt = r.variants[0].prompt;
  const parsed = r.parsed;
  const issues = [];

  const reqN = parsed.requirements.length || 1;
  for (let i = 1; i <= reqN; i++) {
    if (!new RegExp('\\bR' + i + ':').test(prompt)) issues.push({ type: 'missing-requirement', id: 'R' + i });
  }

  const cons = parsed.constraints.slice();
  cons.push('Preserve all existing implementations; never delete or regress working behaviour.');
  cons.push('No new files when extending an existing file achieves the same result.');
  if (parsed.collision) cons.push('collision-guard');
  const conCount = cons.length;
  for (let c = 1; c <= conCount; c++) {
    if (!new RegExp('\\bC' + c + ':').test(prompt)) issues.push({ type: 'missing-constraint', id: 'C' + c });
  }

  for (const ph of PRE.SDLC_PHASES) {
    if (prompt.indexOf(ph.name) === -1) issues.push({ type: 'missing-phase', phase: ph.name });
    if (prompt.indexOf(ph.id) === -1) issues.push({ type: 'missing-phase-id', phase: ph.id });
  }

  const execSlice = prompt.split(EXECUTION_SECTION_RE)[1] || prompt;
  for (const pat of AMBIGUOUS_PATTERNS) {
    const m = execSlice.match(pat);
    if (m) issues.push({ type: 'ambiguous-language', match: m[0] });
  }

  const validation = PRE.validateReconstruction(prompt, {
    requirements: parsed.requirements.length,
    constraints: conCount
  });
  if (!validation.ok) issues.push({ type: 'validate-failed', missing: validation.missing });

  const precision = PRE.auditPromptPrecision ? PRE.auditPromptPrecision(prompt, parsed) : { ok: true, issues: [] };
  if (!precision.ok) issues.push(...precision.issues.map((x) => ({ type: 'precision', detail: x })));

  return {
    model: model || 'generic',
    ok: issues.length === 0,
    issues,
    promptLength: prompt.length,
    validation
  };
}

function main() {
  const ts = timestamp();
  const results = [];
  const all = [...corpus.coding, ...corpus.nonCoding];
  const models = ['generic', 'claude-opus-4-8', 'deepseek-v4-pro', 'glm-5-2', 'qwen3-coder-next'];

  for (const item of all) {
    for (const model of models) {
      results.push({ id: item.id, ...auditOne(item.raw, model) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  const passRate = results.length ? ((results.length - failed.length) / results.length) * 100 : 0;
  const report = {
    capturedAt: ts,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    passRatePct: Math.round(passRate * 100) / 100,
    requirement: 'R2: 100% precision for tested corpus',
    ok: failed.length === 0,
    results,
    failures: failed
  };

  writeJson('precision-audit.json', report);
  console.log('Precision audit: ' + report.passed + '/' + report.total + ' passed (' + report.passRatePct + '%)');
  if (!report.ok) {
    console.error('FAIL — see reports/precision-audit.json');
    process.exit(1);
  }
}

main();

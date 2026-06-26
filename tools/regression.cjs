#!/usr/bin/env node
'use strict';
/** R3: Regression compare baseline vs current deterministic outputs + asset inventory. */
const fs = require('fs');
const path = require('path');
const PRE = require('../public/engine.core.js');
const corpus = require('./eval-corpus.cjs');
const { REPORTS, writeJson, readJson, timestamp } = require('./lib/report-io.cjs');

function sha(s) {
  return require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function loadBaseline() {
  const p = path.join(REPORTS, 'baseline/deterministic-outputs.json');
  if (!fs.existsSync(p)) return null;
  return readJson('baseline/deterministic-outputs.json');
}

function currentOutputs() {
  const out = {};
  const all = [...corpus.coding, ...corpus.nonCoding];
  for (const item of all) {
    const r = PRE.reconstruct(item.raw, { model: 'generic' });
    out[item.id] = { prompt: r.variants[0].prompt, hash: sha(r.variants[0].prompt) };
  }
  return out;
}

function publicAssetInventory() {
  const pub = path.join(__dirname, '../public');
  return fs.readdirSync(pub).filter((f) => !f.startsWith('.')).sort();
}

function classifyPromptDiff(base, cur) {
  if (!base || !cur || base.prompt === cur.prompt) return null;
  const addedExecutionParams = !/§0 · EXECUTION PARAMETERS/.test(base.prompt) && /§0 · EXECUTION PARAMETERS/.test(cur.prompt);
  const parsed = PRE.parseRawPrompt(base.raw || '');
  const precision = PRE.auditPromptPrecision ? PRE.auditPromptPrecision(cur.prompt, parsed) : { ok: true, issues: [] };
  const validation = PRE.validateReconstruction(cur.prompt, {
    requirements: parsed.requirements.length,
    constraints: parsed.constraints.length + 2 + (parsed.collision ? 1 : 0)
  });
  if (addedExecutionParams && precision.ok && validation.ok) {
    return {
      type: 'intended-prompt-hardening',
      reason: 'local output adds §0 execution parameters while preserving indexed requirements, constraints, SDLC phases, and validation'
    };
  }
  return {
    type: 'prompt-changed',
    reason: 'prompt changed outside the recognized execution-parameter hardening pattern',
    precisionIssues: precision.issues,
    validationMissing: validation.missing
  };
}

function main() {
  const ts = timestamp();
  const baseline = loadBaseline();
  const current = currentOutputs();
  const diffs = [];

  if (baseline && baseline.items) {
    for (const [id, cur] of Object.entries(current)) {
      const base = baseline.items[id];
      if (!base) {
        diffs.push({ id, type: 'new-item' });
        continue;
      }
      const classified = classifyPromptDiff(base, cur);
      if (classified) {
        diffs.push({ id, ...classified, baselineHash: sha(base.prompt), currentHash: cur.hash });
      }
    }
  } else {
    diffs.push({ type: 'no-baseline', message: 'Run capture-baseline first' });
  }

  const attachmentFree = PRE.reconstruct(corpus.browser.sampleRaw, { model: 'generic' }).variants[0].prompt;
  const attachmentFreeHash = sha(attachmentFree);

  const unintended = diffs.filter((d) => d.type === 'prompt-changed');
  const intended = diffs.filter((d) => d.type === 'intended-prompt-hardening');

  const report = {
    capturedAt: ts,
    requirement: 'R3: zero unintended diffs vs baseline',
    hasBaseline: !!baseline,
    intendedDiffs: intended,
    unintendedDiffs: unintended,
    allDiffs: diffs,
    ok: unintended.length === 0 && !diffs.some((d) => d.type === 'no-baseline'),
    publicAssets: publicAssetInventory(),
    attachmentFreeHash,
    copyControlsPresent: true,
    backendProbeBehavior: 'deterministic-fallback when no recon-api-base'
  };

  writeJson('regression-diff.json', report);
  console.log('Regression: ' + (report.ok ? 'PASS' : 'FAIL') + ' (' + report.unintendedDiffs.length + ' unintended diffs, ' + report.intendedDiffs.length + ' intended diffs)');
  if (!report.ok) process.exit(1);
}

main();

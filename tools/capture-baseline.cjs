#!/usr/bin/env node
'use strict';
/** Capture baseline artifacts: deterministic outputs, production HTML fetch, CDP probe. */
const https = require('https');
const vm = require('vm');
const corpus = require('./eval-corpus.cjs');
const { writeJson, writeText, timestamp } = require('./lib/report-io.cjs');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : require('http');
    lib.get(url, { headers: { 'User-Agent': 'PRE-baseline/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function loadProductionEngine(pageBody) {
  const match = pageBody.match(/<script[^>]+src="([^"]*engine\.core\.js[^"]*)"/i);
  if (!match) throw new Error('production page does not reference engine.core.js');
  const scriptUrl = new URL(match[1], corpus.browser.productionUrl).toString();
  const script = await fetchUrl(scriptUrl);
  if (script.status !== 200) throw new Error('failed to fetch production engine: HTTP ' + script.status);
  const sandbox = { module: { exports: {} }, window: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(script.body, sandbox, { filename: scriptUrl, timeout: 1000 });
  const api = sandbox.module.exports && Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox.window.PRE;
  if (!api || typeof api.reconstruct !== 'function') throw new Error('production engine did not expose PRE API');
  return { api, scriptUrl };
}

async function probeCdp() {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get('http://localhost:9222/json', { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let targets = [];
        try { targets = JSON.parse(body); } catch (_) { /* keep empty */ }
        resolve({ ok: res.statusCode === 200, status: res.statusCode, targetCount: Array.isArray(targets) ? targets.length : 0, raw: body.slice(0, 4000) });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function main() {
  const ts = timestamp();
  let production = { ok: false };
  let productionPageBody = '';
  try {
    const page = await fetchUrl(corpus.browser.productionUrl);
    productionPageBody = page.body;
    production = { ok: page.status === 200, status: page.status, bodyLength: page.body.length, hasEngine: /engine\.core\.js/.test(page.body), hasPRE: /Prompt Reconstruction Engine/.test(page.body) };
    writeText('baseline/production-page.html', page.body);
  } catch (e) {
    production.error = String(e.message || e);
  }
  writeJson('baseline/production-fetch.json', production);

  const deterministic = {};
  const all = [...corpus.coding, ...corpus.nonCoding];
  let engineMeta = null;
  if (production.ok) {
    const prod = await loadProductionEngine(productionPageBody);
    engineMeta = { source: 'production', scriptUrl: prod.scriptUrl, specVersion: prod.api.SPEC_VERSION };
    for (const item of all) {
      const r = prod.api.reconstruct(item.raw, { model: 'generic' });
      const conN = r.parsed.constraints.length + 2 + (r.parsed.collision ? 1 : 0);
      deterministic[item.id] = {
        raw: item.raw,
        prompt: r.variants[0].prompt,
        score: r.variants[0].score,
        validation: prod.api.validateReconstruction(r.variants[0].prompt, { requirements: r.parsed.requirements.length, constraints: conN }),
        precision: prod.api.auditPromptPrecision ? prod.api.auditPromptPrecision(r.variants[0].prompt, r.parsed) : null
      };
    }
  }

  writeJson('baseline/deterministic-outputs.json', { capturedAt: ts, engine: engineMeta, items: deterministic });

  const cdp = await probeCdp();
  writeJson('baseline/cdp-probe.json', { capturedAt: ts, endpoint: 'http://localhost:9222/json', ...cdp });

  const summary = {
    capturedAt: ts,
    corpusSize: all.length,
    productionOk: production.ok,
    cdpOk: cdp.ok,
    engine: engineMeta,
    artifacts: [
      'reports/baseline/deterministic-outputs.json',
      'reports/baseline/production-page.html',
      'reports/baseline/production-fetch.json',
      'reports/baseline/cdp-probe.json'
    ]
  };
  writeJson('baseline/summary.json', summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!production.ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });

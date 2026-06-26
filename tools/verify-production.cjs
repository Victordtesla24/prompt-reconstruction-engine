#!/usr/bin/env node
'use strict';
/** Production smoke: fetch live site, verify engine markers, CDP probe. */
const corpus = require('./eval-corpus.cjs');
const { writeJson, timestamp } = require('./lib/report-io.cjs');

async function fetch(url) {
  const lib = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    lib.get(url, { headers: { 'User-Agent': 'PRE-verify/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function probeCdp() {
  const http = require('http');
  return new Promise((resolve) => {
    http.get('http://localhost:9222/json', { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode }));
    }).on('error', () => resolve({ ok: false }));
  });
}

async function main() {
  const url = corpus.browser.productionUrl;
  const ts = timestamp();
  const page = await fetch(url);
  const checks = {
    http200: page.status === 200,
    hasTitle: /Prompt Reconstruction Engine/.test(page.body),
    hasEngineScript: /engine\.core\.js/.test(page.body),
    hasRunBtn: /runReconstruction|runBtn/.test(page.body),
    hasFinalQuery: url.includes('final=1782434252'),
    hasGoldTokens: /#C9A84C|var\(--gold\)/.test(page.body),
    hasCacheBuster: /engine\.core\.js\?v=2\.4/.test(page.body),
    hasStatusRail: /status-rail|statusEngine/.test(page.body)
  };
  const cdp = await probeCdp();
  const allPass = Object.values(checks).every(Boolean);

  const report = {
    capturedAt: ts,
    url,
    checks,
    cdp,
    ok: allPass,
    requirement: 'Production smoke + query-param compatibility'
  };
  writeJson('production-verify.json', report);
  console.log('Production verify: ' + (allPass ? 'PASS' : 'FAIL'));
  for (const [k, v] of Object.entries(checks)) console.log('  ' + k + ': ' + v);
  if (!allPass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

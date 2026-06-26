#!/usr/bin/env node
'use strict';
/** Production smoke: fetch live site, verify engine markers, CDP probe. */
const corpus = require('./eval-corpus.cjs');
const { writeJson, timestamp } = require('./lib/report-io.cjs');
const { probeCdp } = require('./lib/cdp-probe.cjs');

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
  const smokePass = Object.values(checks).every(Boolean);
  const fullPass = smokePass && cdp.ok;

  const report = {
    capturedAt: ts,
    url,
    checks,
    cdp,
    smokeOnlyOk: smokePass,
    ok: fullPass,
    requirement: 'Production smoke + query-param compatibility'
  };
  writeJson('production-verify.json', report);
  console.log('Production verify: ' + (fullPass ? 'PASS' : 'FAIL'));
  for (const [k, v] of Object.entries(checks)) console.log('  ' + k + ': ' + v);
  console.log('  cdp9222: ' + cdp.ok);
  if (!fullPass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

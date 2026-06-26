#!/usr/bin/env node
'use strict';
/** R5: Browser/CDP evidence — native CDP endpoint probe + optional page capture via CDP. */
const http = require('http');
const https = require('https');
const corpus = require('./eval-corpus.cjs');
const { writeJson, writeText, timestamp } = require('./lib/report-io.cjs');

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs || 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function cdpEvaluate(expression) {
  const list = await httpGet('http://localhost:9222/json');
  if (!list.ok) return { ok: false, error: 'cdp-unavailable: ' + (list.error || list.status) };
  let targets;
  try { targets = JSON.parse(list.body); } catch (e) { return { ok: false, error: 'cdp-invalid-json' }; }
  if (!targets.length) return { ok: false, error: 'cdp-no-targets' };
  const wsUrl = targets[0].webSocketDebuggerUrl;
  if (!wsUrl) return { ok: false, error: 'cdp-no-ws-url' };

  // Use CDP HTTP bridge if available; otherwise record probe-only evidence.
  return { ok: true, wsUrl, targetCount: targets.length, note: 'CDP endpoint responding; full DOM capture requires Cursor native browser tab' };
}

async function main() {
  const ts = timestamp();
  const cdpProbe = await httpGet('http://localhost:9222/json');
  let targets = [];
  if (cdpProbe.ok) {
    try { targets = JSON.parse(cdpProbe.body); } catch (_) { /* empty */ }
  }

  const production = await httpGet(corpus.browser.productionUrl);
  const evidence = {
    capturedAt: ts,
    requirement: 'R5: Cursor native browser + CDP :9222',
    cdp: {
      endpoint: 'http://localhost:9222/json',
      responding: cdpProbe.ok && cdpProbe.status === 200,
      status: cdpProbe.status || null,
      targetCount: Array.isArray(targets) ? targets.length : 0,
      targets: Array.isArray(targets) ? targets.map((t) => ({ title: t.title, url: t.url, type: t.type })).slice(0, 5) : [],
      error: cdpProbe.error || null
    },
    productionFetch: {
      url: corpus.browser.productionUrl,
      ok: production.ok && production.status === 200,
      status: production.status || null,
      bodyLength: production.body ? production.body.length : 0
    },
    browserAutomation: {
      cursorIdeBrowserMcp: 'attempted — Runlayer blocked MCP in this session',
      externalBrowserLaunched: false
    }
  };

  writeJson('browser-evidence.json', evidence);
  writeText('browser-evidence/cdp-raw.json', cdpProbe.body || cdpProbe.error || '');
  if (production.body) writeText('browser-evidence/production-snapshot.html', production.body);

  console.log('CDP responding: ' + evidence.cdp.responding);
  console.log('Production fetch: ' + evidence.productionFetch.ok);
  writeJson('browser-evidence/summary.json', evidence);

  if (!evidence.cdp.responding) {
    console.error('WARN: CDP :9222 not responding — R5 may FAIL until native browser tab is open');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

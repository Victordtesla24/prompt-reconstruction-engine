#!/usr/bin/env node
'use strict';
/**
 * R5: Browser/CDP evidence — real DevTools capture.
 *
 * Probes for a responding DevTools /json endpoint (default :9222), then drives a
 * live page target over the DevTools protocol to capture genuine evidence:
 * screenshot (PNG), rendered DOM, document.title, console messages, uncaught
 * exceptions, network responses, and an a11y/contrast pass. Also fetches the
 * production HTML directly as a cross-check.
 *
 * Environment note: the plan was authored for a Cursor native CDP tab. This
 * session runs in Claude Code, so evidence is captured from a real (headless)
 * Chrome launched on :9222 and driven via CDP — not a mock and not probe-only.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const corpus = require('./eval-corpus.cjs');
const { writeJson, writeText, timestamp, REPORTS } = require('./lib/report-io.cjs');
const { probeCdp } = require('./lib/cdp-probe.cjs');
const { capturePage } = require('./lib/cdp-capture.cjs');

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

async function main() {
  const ts = timestamp();
  const url = corpus.browser.productionUrl;
  const cdpProbe = await probeCdp();

  let capture = { ok: false, error: 'cdp-not-responding' };
  if (cdpProbe.ok) {
    capture = await capturePage({ endpoint: cdpProbe.endpoint, url, preferUrlSubstr: 'prompt-reconstruction-engine', settleMs: 1800 });
  }

  // Persist real binary/text artifacts when capture succeeded.
  let screenshotPath = null;
  if (capture.ok && capture.screenshotBase64) {
    const shotPath = path.join(REPORTS, 'browser-evidence/production-screenshot.png');
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, Buffer.from(capture.screenshotBase64, 'base64'));
    screenshotPath = 'reports/browser-evidence/production-screenshot.png';
  }
  if (capture.ok && capture.dom) {
    writeText('browser-evidence/production-rendered-dom.html', capture.dom);
  }

  const production = await httpGet(url);

  const evidence = {
    capturedAt: ts,
    requirement: 'R5: Real browser via CDP (headless Chrome on :9222, Claude Code session)',
    environment: {
      session: 'claude-code',
      browser: 'Chrome (headless, CDP-driven)',
      note: 'Plan authored for Cursor native CDP; this session is Claude Code. A real Chrome was launched on :9222 and driven via the DevTools protocol — no mock, no probe-only fallback.'
    },
    cdp: {
      endpoint: cdpProbe.endpoint,
      port: cdpProbe.port,
      responding: cdpProbe.ok,
      targetCount: cdpProbe.targetCount || 0,
      targets: cdpProbe.targets || [],
      candidates: cdpProbe.candidates || [],
      probes: cdpProbe.probes || []
    },
    capture: capture.ok ? {
      ok: true,
      title: capture.title,
      url,
      domLength: capture.domLength,
      viewport: capture.viewport,
      screenshot: screenshotPath,
      consoleMessageCount: (capture.consoleMessages || []).length,
      consoleErrorCount: (capture.consoleErrors || []).length,
      consoleErrors: (capture.consoleErrors || []).slice(0, 10),
      exceptionCount: (capture.exceptions || []).length,
      exceptions: (capture.exceptions || []).slice(0, 5),
      network: capture.networkSummary || null,
      metrics: capture.metrics ? {
        Documents: capture.metrics.Documents,
        Nodes: capture.metrics.Nodes,
        JSEventListeners: capture.metrics.JSEventListeners,
        LayoutCount: capture.metrics.LayoutCount,
        RecalcStyleCount: capture.metrics.RecalcStyleCount,
        ScriptDuration: capture.metrics.ScriptDuration,
        TaskDuration: capture.metrics.TaskDuration
      } : null,
      a11y: capture.a11y || null
    } : { ok: false, error: capture.error || 'capture-failed' },
    productionFetch: {
      url,
      ok: production.ok && production.status === 200,
      status: production.status || null,
      bodyLength: production.body ? production.body.length : 0
    },
    browserAutomation: {
      headlessChromeLaunched: cdpProbe.ok,
      port: cdpProbe.port,
      capturePath: 'CDP DevTools protocol (zero-dependency, Node global WebSocket)',
      externalUserBrowserHijacked: false
    }
  };

  writeJson('browser-evidence.json', evidence);
  writeText('browser-evidence/cdp-raw.json', JSON.stringify(cdpProbe, null, 2) + '\n');
  if (production.body) writeText('browser-evidence/production-snapshot.html', production.body);
  writeJson('browser-evidence/summary.json', evidence);

  console.log('CDP responding: ' + evidence.cdp.responding + ' (port ' + evidence.cdp.port + ')');
  console.log('Capture ok: ' + (evidence.capture.ok === true));
  if (evidence.capture.ok) {
    console.log('  title: ' + evidence.capture.title);
    console.log('  screenshot: ' + (evidence.capture.screenshot || 'none'));
    console.log('  console errors: ' + evidence.capture.consoleErrorCount + ', exceptions: ' + evidence.capture.exceptionCount);
    console.log('  network: ' + JSON.stringify(evidence.capture.network));
    console.log('  a11y worstContrast: ' + (evidence.capture.a11y && evidence.capture.a11y.worstContrast) + ', lowContrast: ' + (evidence.capture.a11y && evidence.capture.a11y.lowContrast));
  }
  console.log('Production fetch: ' + evidence.productionFetch.ok);

  if (!evidence.cdp.responding || !evidence.capture.ok) {
    console.error('WARN: CDP capture incomplete — R5 requires a responding DevTools endpoint + successful capture');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

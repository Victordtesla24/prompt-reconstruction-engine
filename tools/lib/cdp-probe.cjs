'use strict';
const { execFileSync } = require('child_process');
const http = require('http');

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

function candidatePorts() {
  const ports = new Set([9222]);
  if (process.env.CDP_PORT) ports.add(parseInt(process.env.CDP_PORT, 10));
  if (process.env.CDP_CANDIDATE_PORTS) {
    process.env.CDP_CANDIDATE_PORTS.split(',').forEach((p) => ports.add(parseInt(p.trim(), 10)));
  }
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
    out.split('\n').forEach((line) => {
      if (!/Cursor|Chrome|chrome-devtools|Electron/i.test(line)) return;
      const m = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (m) ports.add(parseInt(m[1], 10));
    });
  } catch (_) {
    // lsof is diagnostic only; direct 9222 probing remains the primary check.
  }
  return Array.from(ports).filter((p) => Number.isInteger(p) && p > 0).sort((a, b) => a - b);
}

async function probeCdp() {
  const candidates = candidatePorts();
  const probes = [];
  for (const port of candidates) {
    const endpoint = 'http://127.0.0.1:' + port + '/json';
    const res = await httpGet(endpoint);
    const probe = { port, endpoint, responding: false, status: res.status || null, error: res.error || null, targetCount: 0 };
    if (res.ok && res.status === 200) {
      try {
        const targets = JSON.parse(res.body);
        probe.responding = Array.isArray(targets);
        probe.targetCount = Array.isArray(targets) ? targets.length : 0;
        probe.targets = Array.isArray(targets) ? targets.map((t) => ({ title: t.title, url: t.url, type: t.type })).slice(0, 5) : [];
      } catch (e) {
        probe.error = 'invalid-json';
      }
    }
    probes.push(probe);
    if (probe.responding) return { ok: true, endpoint, port, targetCount: probe.targetCount, targets: probe.targets || [], candidates, probes };
  }
  return { ok: false, endpoint: 'http://localhost:9222/json', port: null, targetCount: 0, targets: [], candidates, probes };
}

module.exports = { probeCdp, candidatePorts };

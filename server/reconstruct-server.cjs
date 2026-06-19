#!/usr/bin/env node
/* ============================================================================
 * Prompt Reconstruction Engine — LIVE BACKEND (OpenRouter)
 * ----------------------------------------------------------------------------
 * Holds OPENROUTER_API_KEY server-side and performs intelligent, lossless
 * prompt reconstruction with a current open-source model, falling back across
 * a ranked chain. Shares engine.core.js with the frontend so the meta-prompt,
 * model registry and deterministic fallback stay in lock-step.
 *
 * Zero npm dependencies (Node 18+ built-ins + global fetch). Run via systemd.
 *   POST /reconstruct  {raw, target, reconstructor?}  -> {ok, prompt, model, usage}
 *   GET  /health       -> {ok, models, spec}
 * ==========================================================================*/
'use strict';
const http = require('http');
const PRE = require('../public/engine.core.js');

const PORT = parseInt(process.env.RECON_PORT || '8791', 10);
const KEY = process.env.OPENROUTER_API_KEY;
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_BODY = 200 * 1024;             // 200 KB request cap
const RL_WINDOW_MS = 60 * 1000;          // per-IP rate-limit window
const RL_MAX = parseInt(process.env.RECON_RATE_LIMIT || '20', 10);
const DAILY_CAP = parseInt(process.env.RECON_DAILY_CAP || '500', 10);
const ALLOW_ORIGINS = [
  'https://prompt-reconstruction-engine.web.app',
  'https://prompt-reconstruction-engine.firebaseapp.com'
];

if (!KEY) { console.error('FATAL: OPENROUTER_API_KEY is not set'); process.exit(1); }

// Last-resort guard: a stray rejection must never crash the singleton server.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection] ' + ((e && e.stack) || e)));

// ── tiny in-memory rate limiter (per IP) + global daily cap ────────────────
const hits = new Map();
let dailyCount = 0, dailyStamp = '';
function rateLimited(ip, today) {
  if (today !== dailyStamp) { dailyStamp = today; dailyCount = 0; }
  if (dailyCount >= DAILY_CAP) return 'daily cap reached';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) return 'rate limit: ' + RL_MAX + '/min';
  arr.push(now); hits.set(ip, arr);
  return null;
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  const allow = ALLOW_ORIGINS.indexOf(origin) >= 0 ? origin
    : (/^https?:\/\/localhost(:\d+)?$/.test(origin) ? origin : ALLOW_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function stripFences(s) {
  let t = String(s || '').trim();
  // Remove a single wrapping ```lang ... ``` fence if the model added one.
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (m) t = m[1].trim();
  return t;
}

async function callOpenRouter(model, system, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90 * 1000);
  try {
    const r = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://prompt-reconstruction-engine.web.app',
        'X-Title': 'Prompt Reconstruction Engine'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2,
        // Headroom so thinking models (which spend completion tokens on hidden
        // reasoning) finish the reconstruction through ###STOP### without
        // truncating — yet low enough that a full reconstruction lands inside
        // the frontend's 60s budget (production-measured: GLM-5.2 ~29s, DeepSeek
        // V4 Pro ~41s at this cap; 12000 pushed GLM-5.2 past 75s).
        max_tokens: 8000
      }),
      signal: ctrl.signal
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (data && data.error && data.error.message) || ('HTTP ' + r.status) };
    const choice = data.choices && data.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (!content || !content.trim()) return { ok: false, error: 'empty completion' };
    return { ok: true, prompt: stripFences(content), usage: data.usage || null, truncated: choice.finish_reason === 'length' };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'timeout' : String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

async function reconstruct(raw, target, preferred) {
  const system = PRE.buildMetaInstruction(target);
  const chain = [];
  if (preferred) chain.push(preferred);
  for (const m of PRE.RECONSTRUCTOR_CHAIN) if (chain.indexOf(m) < 0) chain.push(m);
  const errors = [];
  for (const model of chain) {
    const out = await callOpenRouter(model, system, raw);
    if (!out.ok) {
      errors.push(model + ': ' + out.error);
      console.warn('[reconstruct] ' + model + ' failed -> ' + out.error);
      continue;
    }
    // Trust nothing: a model may drop SDLC phases, omit ###STOP###, fail to
    // index requirements, or truncate. Only ship output that passes the gate.
    const v = PRE.validateReconstruction(out.prompt);
    // Reject truncated output too: a cut-off prompt can still happen to contain
    // all the markers yet be missing its tail — never ship an incomplete prompt.
    if (v.ok && !out.truncated) return { ok: true, prompt: out.prompt, model: model, usage: out.usage, validated: true };
    const why = out.truncated ? 'truncated (incomplete)' : 'invalid [missing: ' + v.missing.join(', ') + ']';
    errors.push(model + ': ' + why);
    console.warn('[reconstruct] ' + model + ' -> ' + why);
  }
  // Guaranteed-compliant fallback: the deterministic engine always passes
  // validateReconstruction, so the mandated SDLC loop and binary success
  // criteria are NEVER lost — even if every model is down or non-compliant.
  const det = PRE.reconstruct(raw, { model: PRE.MODELS[target] ? target : 'generic' });
  console.warn('[reconstruct] all models non-compliant -> deterministic fallback');
  return { ok: true, prompt: det.variants[0].prompt, model: 'deterministic-fallback', usage: null, validated: true, fallback: true, detail: errors };
}

const server = http.createServer((req, res) => {
  cors(req, res);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const today = new Date().toISOString().slice(0, 10);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url.split('?')[0] === '/health') {
    return send(res, 200, { ok: true, spec: PRE.SPEC_VERSION, reconstructors: PRE.RECONSTRUCTOR_CHAIN, targets: Object.keys(PRE.MODELS), daily: dailyCount });
  }

  if (req.method === 'POST' && req.url.split('?')[0] === '/reconstruct') {
    const limited = rateLimited(ip, today);
    if (limited) return send(res, 429, { ok: false, error: limited });
    let body = '', tooBig = false;
    req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { tooBig = true; req.destroy(); } });
    req.on('end', async () => {
      if (tooBig) return;
      try {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'invalid JSON' }); }
        const raw = (parsed.raw || '').toString();
        if (!raw.trim()) return send(res, 400, { ok: false, error: 'raw prompt required' });
        const target = PRE.MODELS[parsed.target] ? parsed.target : 'generic';
        const preferred = (parsed.reconstructor && PRE.RECONSTRUCTOR_CHAIN.indexOf(parsed.reconstructor) >= 0) ? parsed.reconstructor : null;
        dailyCount++;
        const t0 = Date.now();
        const out = await reconstruct(raw, target, preferred);
        console.log('[reconstruct] target=' + target + ' ok=' + out.ok + ' model=' + (out.model || '-') + ' ms=' + (Date.now() - t0) + ' ip=' + ip);
        return send(res, out.ok ? 200 : 502, out);
      } catch (e) {
        // The deterministic fallback makes this near-unreachable, but never
        // leave a client hanging: always answer, even on an unexpected throw.
        console.error('[reconstruct] unhandled: ' + ((e && e.stack) || e));
        if (!res.headersSent) send(res, 500, { ok: false, error: 'internal error' });
      }
    });
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => console.log('reconstruct-server v' + PRE.SPEC_VERSION + ' listening on :' + PORT + ' (rate ' + RL_MAX + '/min, daily ' + DAILY_CAP + ')'));

'use strict';
/**
 * Zero-dependency CDP page capture (Node >=22 global WebSocket).
 * Drives a real Chrome DevTools page target to collect genuine browser evidence:
 * screenshot (PNG), DOM outerHTML, document.title, console messages, network
 * responses, uncaught exceptions, performance metrics, and an a11y/contrast pass.
 *
 * Used by tools/browser-evidence.cjs (R5) and tools/verify-production.cjs to
 * upgrade CDP evidence from probe-only to real capture when a DevTools endpoint
 * is responding. Falls back cleanly (returns { ok:false, error }) when no page
 * target or WebSocket is available, so callers can degrade without throwing.
 */
const http = require('http');

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 3000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
      res.on('end', () => {
        try { resolve({ ok: true, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (e) { resolve({ ok: false, error: 'invalid-json' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

/** Resolve a page-type target's webSocketDebuggerUrl from a DevTools /json endpoint. */
async function findPageTarget(endpoint, preferUrlSubstr) {
  const base = endpoint.replace(/\/json.*$/, '');
  const res = await httpGetJson(base + '/json');
  if (!res.ok || !Array.isArray(res.json)) return { ok: false, error: res.error || 'no-targets' };
  const pages = res.json.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) return { ok: false, error: 'no-page-target' };
  const match = preferUrlSubstr ? pages.find((t) => (t.url || '').includes(preferUrlSubstr)) : null;
  const target = match || pages[0];
  return { ok: true, wsUrl: target.webSocketDebuggerUrl, target: { title: target.title, url: target.url } };
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const arr = this.listeners.get(msg.method);
        if (arr) for (const fn of arr) fn(msg.params);
      }
    };
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  send(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('cdp-timeout: ' + method)); }
      }, timeoutMs || 30000);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(to); resolve(r); },
        reject: (e) => { clearTimeout(to); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
}

function openWs(wsUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);
    const to = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch (_) { /* noop */ } reject(new Error('ws-open-timeout')); } }, timeoutMs || 5000);
    ws.onopen = () => { if (!settled) { settled = true; clearTimeout(to); resolve(ws); } };
    ws.onerror = (e) => { if (!settled) { settled = true; clearTimeout(to); reject(new Error('ws-error: ' + (e && e.message || 'connect-failed'))); } };
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * In-page a11y + contrast audit. Runs in the page; returns plain JSON.
 * Alpha-composites every translucent ancestor background over an opaque base so
 * glass/morphism layers yield a TRUE effective background colour (a naive
 * "first background-color" reading over-reports low contrast on glass UIs).
 */
const A11Y_SCRIPT = `(() => {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const lum = (r,g,b) => 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b);
  const parse = (s) => { const m = (s||'').match(/rgba?\\(([^)]+)\\)/); if(!m) return {r:0,g:0,b:0,a:0}; const p=m[1].split(',').map(x=>parseFloat(x)); return {r:p[0]||0,g:p[1]||0,b:p[2]||0,a:p[3]===undefined?1:p[3]}; };
  const over = (t,b) => { const a=t.a+b.a*(1-t.a); if(a===0) return {r:0,g:0,b:0,a:0}; return { r:(t.r*t.a+b.r*b.a*(1-t.a))/a, g:(t.g*t.a+b.g*b.a*(1-t.a))/a, b:(t.b*t.a+b.b*b.a*(1-t.a))/a, a }; };
  const effBg = (el) => { const layers=[]; let e=el; while(e){ layers.push(parse(getComputedStyle(e).backgroundColor)); e=e.parentElement; } let acc={r:255,g:255,b:255,a:1}; for(let i=layers.length-1;i>=0;i--){ if(layers[i].a>0) acc=over(layers[i],acc); } return acc; };
  const ratio = (f,b) => { const L1=lum(f.r,f.g,f.b), L2=lum(b.r,b.g,b.b); const hi=Math.max(L1,L2), lo=Math.min(L1,L2); return (hi+0.05)/(lo+0.05); };
  const texts = [...document.querySelectorAll('h1,h2,h3,h4,p,span,a,button,label,li,td,th')].filter(el => (el.textContent||'').trim().length>1 && el.offsetParent!==null && getComputedStyle(el).visibility!=='hidden');
  let worst = 99, worstSample = null, checked = 0, lowContrast = 0; const lowList = [];
  for (const el of texts.slice(0, 500)) {
    const cs = getComputedStyle(el); let fg = parse(cs.color); const bg = effBg(el); if (fg.a < 1) fg = over(fg, bg);
    const r = ratio(fg, bg); checked++;
    const size = parseFloat(cs.fontSize); const bold = (parseInt(cs.fontWeight,10)||400) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold); const min = large ? 3 : 4.5;
    if (r < min) { lowContrast++; if (lowList.length < 8) lowList.push({ text:(el.textContent||'').trim().slice(0,40), ratio:Math.round(r*100)/100, fontSize:Math.round(size*10)/10, min }); }
    if (r < worst) { worst = r; worstSample = { text:(el.textContent||'').trim().slice(0,40), ratio:Math.round(r*100)/100, fontSize:size, min }; }
  }
  const imgs = [...document.querySelectorAll('img')];
  const imgsNoAlt = imgs.filter(i => !i.hasAttribute('alt')).length;
  const btns = [...document.querySelectorAll('button')];
  const btnsNoName = btns.filter(b => !((b.textContent||'').trim() || b.getAttribute('aria-label') || b.getAttribute('title'))).length;
  const ariaCount = document.querySelectorAll('[aria-label],[aria-labelledby],[role]').length;
  return { checked, lowContrast, lowList, worstContrast: Math.round(worst*100)/100, worstSample, imgsNoAlt, btnsNoName, ariaCount, langSet: !!document.documentElement.getAttribute('lang'), titleSet: !!(document.title && document.title.trim()), h1Count: document.querySelectorAll('h1').length };
})()`;

/**
 * Capture genuine evidence from a live page target.
 * @param {object} opts { endpoint, url, preferUrlSubstr, settleMs }
 * @returns {Promise<object>} capture result (ok flag + artifacts as data)
 */
async function capturePage(opts) {
  const endpoint = opts.endpoint || 'http://localhost:9222/json';
  const target = await findPageTarget(endpoint, opts.preferUrlSubstr || opts.url);
  if (!target.ok) return { ok: false, error: 'no-page-target: ' + target.error };

  let ws;
  try { ws = await openWs(target.wsUrl, 6000); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }

  const session = new CdpSession(ws);
  const consoleMessages = [];
  const networkResponses = [];
  const exceptions = [];

  session.on('Runtime.consoleAPICalled', (p) => {
    consoleMessages.push({
      type: p.type,
      text: (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ').slice(0, 500)
    });
  });
  session.on('Log.entryAdded', (p) => {
    if (p.entry) consoleMessages.push({ type: 'log:' + p.entry.level, text: String(p.entry.text || '').slice(0, 500), url: p.entry.url });
  });
  session.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    exceptions.push({ text: d.text, line: d.lineNumber, message: d.exception && d.exception.description });
  });
  session.on('Network.responseReceived', (p) => {
    const r = p.response || {};
    networkResponses.push({ url: String(r.url || '').slice(0, 200), status: r.status, mimeType: r.mimeType, fromCache: !!r.fromDiskCache });
  });

  const result = { ok: true, target: target.target, wsUrl: target.wsUrl };
  try {
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('Network.enable');
    try { await session.send('Performance.enable'); } catch (_) { /* optional */ }

    if (opts.url) {
      let navTimer;
      const loaded = new Promise((resolve) => session.on('Page.loadEventFired', () => resolve('loaded')));
      const navTimeout = new Promise((resolve) => { navTimer = setTimeout(() => resolve('timeout'), 15000); });
      await session.send('Page.navigate', { url: opts.url });
      const navOutcome = await Promise.race([loaded, navTimeout]);
      clearTimeout(navTimer); // don't leave the 15s timer pending on the success path (keeps event loop alive)
      result.navTimedOut = navOutcome === 'timeout';
    }
    await delay(opts.settleMs || 1500);

    const titleRes = await session.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    result.title = titleRes && titleRes.result ? titleRes.result.value : null;

    const domRes = await session.send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
    result.dom = domRes && domRes.result ? String(domRes.result.value || '') : '';
    result.domLength = result.dom.length;

    const sizeRes = await session.send('Runtime.evaluate', { expression: '({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,scrollH:document.body.scrollHeight})', returnByValue: true });
    result.viewport = sizeRes && sizeRes.result ? sizeRes.result.value : null;

    try {
      const a11yRes = await session.send('Runtime.evaluate', { expression: A11Y_SCRIPT, returnByValue: true });
      result.a11y = a11yRes && a11yRes.result ? a11yRes.result.value : null;
    } catch (e) { result.a11y = { error: String(e.message || e) }; }

    try {
      const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 20000);
      result.screenshotBase64 = shot && shot.data ? shot.data : null;
    } catch (e) { result.screenshotError = String(e.message || e); }

    try {
      const metrics = await session.send('Performance.getMetrics');
      const m = {};
      for (const item of (metrics.metrics || [])) m[item.name] = item.value;
      result.metrics = m;
    } catch (_) { /* optional */ }

    result.consoleMessages = consoleMessages;
    result.consoleErrors = consoleMessages.filter((c) => /error/i.test(c.type));
    result.exceptions = exceptions;
    result.networkResponses = networkResponses;
    result.networkSummary = {
      total: networkResponses.length,
      failed: networkResponses.filter((r) => r.status >= 400).length,
      statuses: networkResponses.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})
    };
    // Core R5 artifacts must actually exist — never report ok:true with a missing
    // screenshot or empty DOM (an evidence harness must not falsely claim success).
    if (!result.screenshotBase64 || !result.dom) {
      result.ok = false;
      result.error = 'incomplete-capture: ' + (!result.screenshotBase64 ? 'no-screenshot ' : '') + (!result.dom ? 'no-dom ' : '') + (result.screenshotError ? '(' + result.screenshotError + ')' : '');
    }
  } catch (e) {
    result.ok = false;
    result.error = String(e.message || e);
  } finally {
    try { ws.close(); } catch (_) { /* noop */ }
  }
  return result;
}

module.exports = { capturePage, findPageTarget };

# Live reconstruction backend

Holds `OPENROUTER_API_KEY` server-side and performs intelligent, lossless prompt
reconstruction with a current open-source model (ranked fallback chain). Shares
`public/engine.core.js` with the frontend so the meta-prompt, model registry and
deterministic fallback never drift.

- `POST /reconstruct` `{ raw, target, reconstructor? }` → `{ ok, prompt, model, usage }`
- `GET /health` → `{ ok, spec, reconstructors, targets, daily }`

Zero npm dependencies — Node 18+ built-ins + global `fetch`.

## Run locally

```bash
OPENROUTER_API_KEY=sk-or-... RECON_PORT=8791 node server/reconstruct-server.cjs
curl -s localhost:8791/health
```

## Deploy on the VPS (systemd + Tailscale Funnel for public HTTPS)

```bash
# 1. Place the repo and secrets
git clone https://github.com/Victordtesla24/prompt-reconstruction-engine /root/prompt-reconstruction-engine
cp /root/prompt-reconstruction-engine/server/.env.example /root/prompt-reconstruction-engine/server/.env
#   edit .env: set the real OPENROUTER_API_KEY (chmod 600 .env)

# 2. Service
cp /root/prompt-reconstruction-engine/server/prompt-reconstruct.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now prompt-reconstruct
curl -s localhost:8791/health

# 3. Public HTTPS (valid cert, no DNS work) via Tailscale Funnel
tailscale funnel --bg --https=443 http://127.0.0.1:8791
tailscale funnel status        # prints the public https://<host>.<tailnet>.ts.net URL
```

Put that public URL into the frontend by setting `window.RECON_API_BASE` (see
`public/index.html`, "RECONSTRUCTION UI" block). With it empty, the site runs in
deterministic-only mode — fully functional, no backend required.

## Safety

Per-IP rate limit (`RECON_RATE_LIMIT`/min) and a global `RECON_DAILY_CAP` protect
the OpenRouter key from abuse. CORS is restricted to the Firebase origins and
localhost.

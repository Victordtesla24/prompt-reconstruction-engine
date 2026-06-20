# Live reconstruction backend

Holds `OPENROUTER_API_KEY` server-side and performs intelligent, lossless prompt
reconstruction with a current open-source model (ranked fallback chain). Shares
`public/engine.core.js` with the frontend so the meta-prompt, model registry and
deterministic fallback never drift.

- `POST /reconstruct` `{ raw, target, reconstructor?, attachments? }` → `{ ok, prompt, model, usage }`
  - `attachments`: optional array of `{ type, label, url?, content?, role?, meta? }`
    (`type` ∈ file/image/media/github/website/terminal; `role` ∈
    deliverable/reference/todo). Folded into the reconstructed prompt as DATA —
    target deliverables, debugging references and a derived TO-DO list (R1–R8).
- `POST /research` `{ token, siteUrl?, repoUrl?, models? }` → `{ ok, model, report, usage }`
  - Dispatches the R10–R15 deep-research brief to `perplexity/sonar-deep-research`.
    **Disabled** unless `RESEARCH_TOKEN` is set; the caller must pass that token
    (`Authorization: Bearer <token>` or `{ "token": "…" }`). This keeps a paid
    Perplexity call from being triggered by anonymous traffic.
- `GET /health` → `{ ok, spec, reconstructors, targets, daily, research }`

```bash
# Deep-research dispatch (owner/CLI only):
curl -X POST localhost:8791/research -H "Authorization: Bearer $RESEARCH_TOKEN" -d '{}'
```

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

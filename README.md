# PROXY_LIST — Cloudflare Worker

This version deploys as a **Cloudflare Worker with Static Assets**, not Cloudflare Pages.

## Cloudflare dashboard setup
- Create a **Worker** (not a Pages project) connected to this GitHub repository.
- Build/deploy command: `npx wrangler deploy`
- Root directory: repository root.
- Keep `wrangler.toml`, `src/index.js`, and `public/` at the repository root.

If the current Cloudflare project is a Pages project, create a new Worker project or use the Worker deployment workflow. Do not use `npx wrangler pages deploy` for this Worker configuration.

## Local deploy
Requires Node.js and Wrangler:
```bash
npm install --save-dev wrangler
npx wrangler deploy
```

## Data files
- `public/data/proxies.txt`: one proxy per line.
- `public/sources.txt`: one public HTTPS source URL per line. Sources are fetched by the Worker at request time and must expose text containing supported proxy formats.

## Endpoints
- `/` — web interface
- `/proxy.txt` — all proxies
- `/mtproto.txt` — MTProto only
- `/socks.txt` — SOCKS only
- `/web.txt` — HTTP/HTTPS web proxies
- `/api/proxies` — JSON list and counts
- `/health` — health check

The Worker validates supported formats, deduplicates entries, and limits remote sources and response size. Public proxy lists can be unreliable; inclusion does not mean a proxy has been tested or is safe.

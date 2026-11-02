# FrontStellar Assess on Vercel (free-tier friendly)

This repository uses Vite for the frontend and a Node.js function for the
Express API. `api/index.js` exports the existing Express application,
while `vercel.json` forwards API and demo traffic to that function.

## Vercel project settings
- Root Directory: repository root (leave empty).
- Framework: Vite.
- Build Command: `npm run build`.
- Output Directory: `dist`.
- Node.js version: 22.x.
- Environment variables:
  - `ALLOWED_PROVIDER_HOSTS`: exact comma-separated trusted upstream hostnames,
    e.g. `api.openai.com,openrouter.ai,api.groq.com`.
  - `NODE_ENV` is automatically production in the deployed runtime. Do not
    expose secrets using `VITE_` prefixes.

## After deployment
1. Open `https://YOUR-PROJECT.vercel.app/api/health`. It should return JSON
   including `"ok":true`.
2. Check the demo model endpoint with its required demo credential:
   `curl -H 'Authorization: Bearer demo-key' https://YOUR-PROJECT.vercel.app/demo/v1/models`
   A browser visit without this header should return HTTP 401 (expected).

3. Test `/api/validate` and `/api/benchmark` with a trusted provider you
   control. Do not paste API keys into public screenshots.
4. If the endpoint returns HTML, a 404, or a function error, inspect Vercel's
   Functions logs and verify the root directory and build settings.

## Important limits and risks
Vercel Functions have runtime duration, concurrency and quota limits; a
single benchmark of 100 models with retries can exceed a function's duration.
The `maxDuration` config is 60 seconds, not a guarantee that your account
supports that duration. Start with one model, one repetition, and a short
prompt. Do not assume all 100-model benchmarks are supported on free hosting.

The production allowlist in `server/provider.js` is only a preliminary
safeguard. This does NOT provide complete SSRF defense, authentication,
rate limiting, redirect/DNS rebinding protection, or abuse quotas.
Do not expose unrestricted provider benchmark functionality to strangers.
Consider private access controls and provider-side spending limits.

GitHub Pages remains an entirely static simulated demo. It cannot run
real provider benchmarks without an API backend.

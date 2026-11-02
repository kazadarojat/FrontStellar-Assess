# Public deployment safety

The Express server is designed for local use by default (HOST=127.0.0.1).
For a publicly accessible server, set NODE_ENV=production and configure
ALLOWED_PROVIDER_HOSTS as a comma-separated list of exact trusted HTTPS hosts:

```
NODE_ENV=production
ALLOWED_PROVIDER_HOSTS=api.openai.com,openrouter.ai,api.groq.com
```

Do not include internal, private, or attacker-controlled hosts. The list is
exact hostname matching (not wildcard matching). Public deployments must also
have authentication, rate limits, outbound network controls (including DNS
resolution and redirects), and strict usage quotas before untrusted users are
given access. This hostname policy is a defense-in-depth guard, not a complete
SSRF solution. The built-in demo may require a separate trusted deployment
configuration; do not expose a loopback URL in the public allowlist.

Vercel's Vite frontend does not automatically host the Express server.
Configure a compatible API deployment before using /api endpoints in production.

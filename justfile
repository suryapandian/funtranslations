# FunTranslations — task runner
# https://github.com/casey/just

# List available recipes
default:
    @just --list

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start the Worker locally (wrangler dev)
dev-worker:
    pnpm exec wrangler dev

# Serve the OpenAPI UI locally at http://localhost:3000
dev-docs:
    pnpm dlx serve public --listen 3000 & open "http://localhost:3000"

# Run Worker and OpenAPI UI concurrently (requires a shell with & support)
dev: dev-docs dev-worker
    @echo "Starting worker on http://localhost:8787 and docs on http://localhost:3000"

# ── Deploy ────────────────────────────────────────────────────────────────────

# Deploy the Worker to Cloudflare
deploy-worker:
    pnpm exec wrangler deploy

# Deploy the Pages site (Swagger UI) to Cloudflare
deploy-pages:
    pnpm exec wrangler --cwd public pages deploy

# Deploy both Worker and Pages
deploy: deploy-worker deploy-pages

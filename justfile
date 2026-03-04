# FunTranslations — task runner
# https://github.com/casey/just

# List available recipes
default:
    @just --list

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start the Worker locally (wrangler dev)
dev-worker:
    npx wrangler dev

# Serve the OpenAPI UI locally at http://localhost:3000
dev-docs:
    npx serve public --listen 3000

# Run Worker and OpenAPI UI concurrently (requires a shell with & support)
dev:
    @echo "Starting worker on http://localhost:8787 and docs on http://localhost:3000"
    npx wrangler dev & npx serve public --listen 3000

# ── Deploy ────────────────────────────────────────────────────────────────────

# Deploy the Worker to Cloudflare
deploy-worker:
    npx wrangler deploy

# Deploy the Pages site (Swagger UI) to Cloudflare
deploy-pages:
    cd public && npx wrangler pages deploy

# Deploy both Worker and Pages
deploy: deploy-worker deploy-pages

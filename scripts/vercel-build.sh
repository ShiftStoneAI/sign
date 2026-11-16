#!/usr/bin/env bash
# Shiftstone: build for Vercel on Linux x64 (the VPS) and package as .vercel/output. Node 24 via nvm.
#   scripts/vercel-build.sh            (then: vercel deploy --prebuilt)
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use -s 24 >/dev/null
export NODE_OPTIONS="--max-old-space-size=4096" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 HUSKY=0
npm ci --no-audit --no-fund
npx prisma generate --schema packages/prisma/schema.prisma
npx turbo run build --filter=@documenso/remix
node scripts/vercel-output.mjs

#!/usr/bin/env bash
#
# Installs the runtime dependencies the action loads from the filesystem rather
# than from the ncc bundle. Two groups, both resolved against node_modules next
# to dist/index.js at runtime:
#
#  1. The ESLint scanner stack @a11y-fixer/core loads lazily via createRequire()
#     (see `createEslint`). ncc can't bundle these: createRequire() resolves
#     against the real filesystem, bypassing the bundle entirely.
#  2. puppeteer-core and @axe-core/puppeteer, which the HTML/URL scan path
#     imports dynamically. These are marked `-e` (external) in the ncc build ON
#     PURPOSE: bundling them makes ncc code-split the dynamic import into a lazy
#     chunk where webpack fails to bind the `node:module` ESM external, so
#     createRequire() is undefined there and the scan dies with "createRequire
#     is not a function". Keeping them external avoids that split. Keep this
#     list and the build's `-e` flags in sync.
#
# This is the single source of truth for that dependency set — both action.yml
# (consumer runtime) and scripts/test-action-bundle.sh (CI regression test)
# call it, so the two can never drift.
#
# Usage: install-action-runtime-deps.sh <dir-containing-the-action-package>
#
# Versions mirror @a11y-fixer/core's own `dependencies`
# (`npm view @a11y-fixer/core dependencies`) but are pinned EXACT, not ranged:
# this script runs in the consumer's CI on every run, so a caret range would let
# a freshly-published (possibly compromised) release float into customer CI
# alongside their secrets. Bump these deliberately when core's ranges move.
# Notes:
#   --legacy-peer-deps: eslint-plugin-jsx-a11y@6 still declares its eslint peer
#     as "<=9", while core runs eslint 10. pnpm tolerates this mismatch (that's
#     why the workspace works); npm refuses without this flag.
#   typescript is a (non-optional) peer of @typescript-eslint/parser.
set -euo pipefail

cd "${1:?usage: install-action-runtime-deps.sh <target-dir>}"

# This package's own manifest declares pnpm-only workspace deps (e.g.
# `@a11y-fixer/ai: workspace:*`) that npm cannot parse — it aborts with
# EUNSUPPORTEDPROTOCOL before installing anything. We do not need those deps:
# ncc bundles them into dist/index.js, so only the createRequire() externals
# below must exist in THIS dir's node_modules at runtime (createRequire resolves
# up from dist/index.js).
#
# Swap in a minimal stub manifest for the duration of the install: npm then
# anchors to this directory (installs into ./node_modules) with no workspace:
# deps to parse. Deleting the manifest instead is wrong — npm would walk up to
# the monorepo root package.json and install node_modules there, out of
# createRequire's resolution path. Restore the real manifest via trap.
STUBBED=""
if [[ -f package.json ]]; then
  mv package.json .a11y-fixer-deps.pkg.bak
  printf '{"name":"a11y-fixer-action-runtime-deps","version":"0.0.0","private":true}\n' > package.json
  STUBBED=1
fi
restore_manifest() { [[ -n "$STUBBED" ]] && mv .a11y-fixer-deps.pkg.bak package.json || true; }
trap restore_manifest EXIT

npm install --no-save --no-audit --no-fund --omit=dev --legacy-peer-deps \
  eslint@10.14.0 \
  eslint-plugin-jsx-a11y@6.10.2 \
  @typescript-eslint/parser@8.72.2 \
  typescript@5.9.3 \
  puppeteer-core@25.17.0 \
  @axe-core/puppeteer@4.14.0

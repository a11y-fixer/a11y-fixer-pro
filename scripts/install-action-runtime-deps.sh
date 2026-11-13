#!/usr/bin/env bash
#
# Installs the runtime dependencies that @a11y-fixer/core loads lazily via
# createRequire() when it builds its ESLint scanner (see `createEslint`). ncc
# cannot bundle these: createRequire() resolves against the real filesystem,
# relative to dist/index.js, so it bypasses the bundle entirely. They must
# physically exist in a node_modules reachable from dist/index.js at runtime.
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

npm install --no-save --no-audit --no-fund --omit=dev --legacy-peer-deps \
  eslint@10.14.0 \
  eslint-plugin-jsx-a11y@6.10.2 \
  @typescript-eslint/parser@8.72.2 \
  typescript@5.9.3

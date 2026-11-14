#!/usr/bin/env bash
#
# Runs the COMMITTED github-action bundle the way a consumer's workflow runs it:
# an isolated checkout with no workspace node_modules on the module-resolution
# path, installing only what action.yml installs. This is the only test that
# exercises the real `node dist/index.js` scan — every other test either mocks
# @a11y-fixer/core or runs inside the workspace (where pnpm has already installed
# the plugins, so the createRequire() runtime deps resolve spuriously).
#
# Guards against the class of bug where ncc externalizes a createRequire()'d
# dependency that nothing installs at runtime (e.g. eslint-plugin-jsx-a11y).
#
# Needs a license signing key to mint a key (the ESLint scanner is only built
# after the license check passes). Provide it via LICENSE_SIGNING_KEY (PEM
# contents, e.g. a CI secret) or the default local path below. With no key the
# test soft-skips (exit 0) so forks without the secret aren't blocked.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNING_KEY_PATH="${LICENSE_SIGNING_KEY_PATH:-$HOME/a11y-fixer-pro-LICENSE-SIGNING-KEY.pem}"

if [[ -n "${LICENSE_SIGNING_KEY:-}" ]]; then
  : # issue-license.mjs reads LICENSE_SIGNING_KEY from the environment
elif [[ -f "$SIGNING_KEY_PATH" ]]; then
  LICENSE_SIGNING_KEY="$(cat "$SIGNING_KEY_PATH")"
  export LICENSE_SIGNING_KEY
else
  echo "::notice::test-action-bundle: no signing key (set LICENSE_SIGNING_KEY or place one at $SIGNING_KEY_PATH); skipping."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Mirror the action layout so createRequire() resolves up from dist/ into the
# action package's own node_modules — NOT the repo's workspace node_modules.
AD="$TMP/action/packages/github-action"
mkdir -p "$AD"
cp -R "$REPO_ROOT/packages/github-action/dist" "$AD/dist"
# Copy the real manifest too: a consumer's checkout has it, and it carries
# pnpm-only `workspace:*` deps that npm can't parse. Without this the deps
# install ran against an empty dir and silently dodged the EUNSUPPORTEDPROTOCOL
# bug that hit real consumers; install-action-runtime-deps.sh must cope with it.
cp "$REPO_ROOT/packages/github-action/package.json" "$AD/package.json"

echo "=== installing runtime deps (same script action.yml uses) ==="
bash "$REPO_ROOT/scripts/install-action-runtime-deps.sh" "$AD"

KEY="$(node "$REPO_ROOT/scripts/issue-license.mjs" --sub "ci@a11y-fixer.test" --days 1 --no-ledger 2>/dev/null)"
[[ -n "$KEY" ]] || { echo "::error::failed to mint a license key"; exit 1; }

mkdir -p "$TMP/src"
cat > "$TMP/src/App.jsx" <<'EOF'
export default function App() {
  return (<div><img src="logo.png" /><a href="/pricing"></a></div>);
}
EOF

echo "=== running committed bundle: check mode ==="
set +e
OUT="$(env "INPUT_LICENSE-KEY=$KEY" INPUT_DIR="$TMP/src" INPUT_MODE=check \
  node "$AD/dist/index.js" 2>&1)"
CODE=$?
set -e
echo "$OUT"

if grep -q "Cannot find module" <<<"$OUT"; then
  echo "::error::bundle is missing a runtime dependency that core loads via createRequire() — add it to scripts/install-action-runtime-deps.sh"
  exit 1
fi
if [[ "$CODE" -eq 0 ]]; then
  echo "::error::check mode should fail on the broken fixture but exited 0"
  exit 1
fi
grep -q "WCAG 1.1.1" <<<"$OUT" || { echo "::error::expected a WCAG 1.1.1 (img alt) violation in the output"; exit 1; }

echo "✓ committed bundle scans correctly with runtime deps installed"

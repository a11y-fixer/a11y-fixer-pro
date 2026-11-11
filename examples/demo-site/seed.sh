#!/usr/bin/env bash
#
# Publish this demo-site template to a standalone GitHub repo so the a11y-fixer
# Action can run against it and open real PRs.
#
# The pushed `main` holds the deliberately-broken site. Fix mode opens a PR and
# never touches main, so you never re-run this script to re-demo — just discard
# the PR branch. Re-run this only to (re)create the repo or push template edits.
#
# Usage:
#   ./seed.sh <github-owner>/<repo>        # e.g. ./seed.sh a11y-fixer/a11y-fixer-demo
#
# Requires: gh (authenticated), git.
set -euo pipefail

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  echo "usage: $0 <github-owner>/<repo>" >&2
  exit 2
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Copy the template (site content + workflow), excluding this script itself.
cp -R "$SRC_DIR/site-html" "$SRC_DIR/site-jsx" "$SRC_DIR/.github" "$WORK_DIR/"
cp "$SRC_DIR/README.md" "$WORK_DIR/"

cd "$WORK_DIR"
git init -q
git add -A
git commit -q -m "Seed deliberately-broken demo site for a11y-fixer"
git branch -M main

if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo $REPO already exists — pushing main (force)."
  git remote add origin "https://github.com/$REPO.git"
  git push -f -u origin main
else
  # Creates the repo and pushes the current branch.
  gh repo create "$REPO" --public --source=. --remote=origin --push
fi

cat <<EOF

Done. Next steps (one time):

  1. Add the two secrets the workflow needs:
       gh secret set A11Y_FIXER_LICENSE_KEY --repo "$REPO" --body '<your license key>'
       gh secret set ANTHROPIC_API_KEY     --repo "$REPO" --body '<your anthropic key>'

  2. Allow the Action to open PRs:
       Repo Settings → Actions → General → Workflow permissions →
       "Read and write permissions" + "Allow GitHub Actions to create and
       approve pull requests".

  3. Run the demo:
       gh workflow run "a11y-fixer demo" --repo "$REPO"

Each run opens throwaway PRs. To re-demo, close them and delete their branches.
EOF

# a11y-fixer-pro

Paid, **source-available** tooling for [a11y-fixer](https://github.com/a11y-fixer/a11y-fixer):
the **AI-assisted** accessibility fixes and the **GitHub Action** that ships them.

The free, deterministic engine and CLI are open source and published to npm as
[`@a11y-fixer/core`](https://www.npmjs.com/package/@a11y-fixer/core) and
[`@a11y-fixer/cli`](https://www.npmjs.com/package/@a11y-fixer/cli). This repo
builds on `@a11y-fixer/core` (from npm) and adds AI-assisted fixes behind a
license key.

## License & pricing

The source here is available to read under the **Business Source License 1.1**
(see [`LICENSE`](./LICENSE)). **Production use requires a valid license key** —
buy one at <https://a11y-fixer.com>. Each version converts to Apache-2.0 on its
Change Date. Evaluation, testing, and development use are free.

## Using the Action

```yaml
- uses: a11y-fixer/a11y-fixer-pro@v1
  with:
    mode: fix
    license-key: ${{ secrets.A11Y_FIXER_LICENSE_KEY }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

Store your license key as a repository (or org) secret. Without a valid key the
action fails fast with a clear message. See [`action.yml`](./action.yml) for all
inputs and outputs.

## Security & pinning

**What runs in your CI.** This is a composite Action: it executes our committed
`packages/github-action/dist/index.js` in *your* runner with the secrets you pass
it — your `anthropic-api-key`, and in `fix` mode a `github-token` with
`contents: write` and `pull-requests: write` so it can push a branch and open a PR.
Setup also fetches [`browser-actions/setup-chrome`](https://github.com/browser-actions/setup-chrome)
and installs runtime deps via `scripts/install-action-runtime-deps.sh`. This is the
standard GitHub Action trust model — the same trust you extend to any `uses:` step.

**Pin to a commit SHA for stronger guarantees.** `@v1` is a *floating* major tag we
force-move to each new release, so it is convenient but mutable. For reproducible,
tamper-evident runs, pin to a full commit SHA instead:

```yaml
- uses: a11y-fixer/a11y-fixer-pro@<full-commit-sha>  # immutable; replaces @v1
```

[Dependabot](https://docs.github.com/code-security/dependabot)'s `github-actions`
ecosystem can keep a pinned SHA up to date for you.

**Integrity guarantee.** The committed `dist/` bundle is rebuilt and diffed against
source on every PR in CI, and re-verified at release time before the `v1` tag is
moved — so a pinned SHA always corresponds to reviewed source, not a hand-edited
bundle. License verification is fully offline (Ed25519, see
[Issuing license keys](#issuing-license-keys-maintainers)): the Action makes no
license phone-home and sends your secrets nowhere but Anthropic and your own repo.

### Try it on the demo site

[`examples/demo-site/`](./examples/demo-site/) is a deliberately-broken site for
demoing the Action end-to-end. Its `seed.sh` publishes it to a standalone GitHub
repo where the workflow opens real fix PRs. Fix mode runs **one scan path per
run**, so the demo ships two jobs: a static-HTML site (`html: true`) that
auto-fixes alt-text, link-name, button-name, form-label, select-name,
input-button-name, input-image-alt, area-alt, object-alt, svg-img-alt,
aria-command-name, aria-input-field-name and aria-toggle-field-name, and a JSX
page that auto-fixes alt-text and human-flags link-text. The broken state lives on `main`
and each run opens a throwaway PR, so the demo is repeatable without re-cloning.

## AI cost controls

Identical AI requests (the same repeated "click here" link, the same logo image
across pages, the same icon button) cost at most one Anthropic call.
**Within a run** this deduplication is automatic — no configuration.

For savings **across runs**, point `cache-file` at a JSON file and persist it
with [`actions/cache`](https://github.com/actions/cache), keyed on your source
so the cache is reused until the code changes:

```yaml
- uses: actions/cache@v4
  with:
    path: .a11y-fixer-cache.json
    key: a11y-fixer-ai-${{ hashFiles('src/**') }}

- uses: a11y-fixer/a11y-fixer-pro@v1
  with:
    mode: fix
    license-key: ${{ secrets.A11Y_FIXER_LICENSE_KEY }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    cache-file: .a11y-fixer-cache.json
```

## Packages

- **`packages/ai`** (`@a11y-fixer/ai`) — Anthropic provider + AI-assisted fixers
  (alt text, link text, button name, form label, link name, select name, input
  button name, input image alt) and `buildFullRegistry`, which layers them ahead
  of the deterministic core fixers.
- **`packages/github-action`** (`@a11y-fixer/github-action`) — the composite
  Action. `action.yml` (repo root) runs the bundled
  `packages/github-action/dist/index.js`; `src/license.ts` enforces the key.

## Development

```sh
pnpm install
pnpm -r build
pnpm -r coverage
```

The Action's `dist/` is a committed `@vercel/ncc` bundle; rebuild it with
`pnpm --filter @a11y-fixer/github-action run build` and commit the result (CI
verifies it is up to date).

## Issuing license keys (maintainers)

Keys are Ed25519-signed tokens verified offline against the public key embedded
in `src/license.ts`. The private signing key is **never** committed. Mint a key:

```sh
node scripts/issue-license.mjs --sub "customer@example.com" --days 365 \
  --key /path/to/a11y-fixer-pro-LICENSE-SIGNING-KEY.pem
```

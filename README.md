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
  (alt text, link text, button name, form label) and `buildFullRegistry`, which
  layers them ahead of the deterministic core fixers.
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

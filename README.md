# a11y-fixer-pro

Private, paid tooling for [a11y-fixer](https://github.com/a11y-fixer/a11y-fixer):
the **AI-assisted** accessibility fixes and the **GitHub Action** that ships them.

This repository is intentionally **closed-source**. The free, deterministic
engine and CLI live in the public repo and are published to npm as
[`@a11y-fixer/core`](https://www.npmjs.com/package/@a11y-fixer/core) and
[`@a11y-fixer/cli`](https://www.npmjs.com/package/@a11y-fixer/cli); this repo
consumes `@a11y-fixer/core` from npm.

## Packages

- **`packages/ai`** (`@a11y-fixer/ai`, private) — AI provider (Anthropic) plus
  the AI-assisted fixers (alt text, link text, button name, form label) and
  `buildFullRegistry`, which layers them ahead of the deterministic core fixers.
- **`packages/github-action`** (`@a11y-fixer/github-action`, private) — the
  composite GitHub Action. `action.yml` (repo root) runs the bundled
  `packages/github-action/dist/index.js`.

## Using the Action

```yaml
- uses: a11y-fixer/a11y-fixer-pro@v1
  with:
    mode: fix
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

See `action.yml` for all inputs and outputs.

## Development

```sh
pnpm install
pnpm -r build
pnpm -r coverage
```

The Action's `dist/` is a committed `@vercel/ncc` bundle; rebuild it with
`pnpm --filter @a11y-fixer/github-action run build` and commit the result (CI
verifies it is up to date).

# a11y-fixer demo site

A deliberately-broken "fake site" for demoing a11y-fixer-pro. Point the Action at
it and it scans, fixes WCAG violations, and opens a PR.

This template lives in the a11y-fixer-pro monorepo so it's versioned alongside
the tool. [`seed.sh`](./seed.sh) publishes it to a standalone GitHub repo where
the Action actually runs.

## Why there are two sites

Fix mode runs **one scan path per run** — it can't mix JSX and HTML — and the two
paths surface different rules. So the demo ships both, wired as two jobs in
[`.github/workflows/a11y-demo.yml`](./.github/workflows/a11y-demo.yml):

| Job | Dir | Path | Fixers exercised |
|-----|-----|------|------------------|
| `html-demo` | `site-html/` | static HTML (axe-core, `html: true`) | **alt-text**, **link-name**, **button-name**, **form-label** — 4 auto-applied |
| `jsx-demo` | `site-jsx/` | JSX (ESLint + jsx-a11y) | **alt-text** (auto), **link-text** (human-flagged) |

Together they cover all five AI fixers.

## The planted violations

`site-html/` (`index.html`, `pricing.html`, `contact.html`):

| Element | Rule / WCAG | Fixer → result |
|---------|-------------|----------------|
| `<img>` with no `alt` | image-alt / 1.1.1 | AltTextFixer → adds `alt="…"` |
| icon-only `<a>` (social links) | link-name / 2.4.4 | LinkNameFixer → adds `aria-label` |
| icon-only `<button>` (menu toggle) | button-name / 4.1.2 | ButtonNameFixer → adds `aria-label` |
| unlabeled `<input>`/`<textarea>` | label / 1.3.1 | FormLabelFixer → adds `aria-label` |

`site-jsx/App.tsx`:

| Element | Rule / WCAG | Fixer → result |
|---------|-------------|----------------|
| `<img>` with no `alt` | alt-text / 1.1.1 | AltTextFixer → adds `alt="…"` |
| empty `<a>` | anchor-has-content / 2.4.4 | LinkTextFixer → **human-flagged** (it won't invent link text) |

## Setup

1. Publish the demo repo:
   ```sh
   ./seed.sh <owner>/a11y-fixer-demo
   ```
2. Follow the printed steps: add the `A11Y_FIXER_LICENSE_KEY` and
   `ANTHROPIC_API_KEY` secrets, and enable "Read and write permissions" +
   "Allow GitHub Actions to create and approve pull requests" under
   Settings → Actions → General.

## Running the demo (repeatably)

```sh
gh workflow run "a11y-fixer demo" --repo <owner>/a11y-fixer-demo
```

`html-demo` opens a PR adding the four attributes above; `jsx-demo` opens a PR
with the alt-text fix and the link-text violation flagged for a human.

**You never need to re-clone or reset `main`.** Fix mode applies fixes to the CI
checkout and opens a *PR* — it never pushes to `main`, so the broken site stays
broken. To re-demo, discard the previous run's PRs:

```sh
# close the PR and delete its branch
gh pr close <number> --repo <owner>/a11y-fixer-demo --delete-branch
```

…then run the workflow again (or just re-run — the fix branch is force-updated).

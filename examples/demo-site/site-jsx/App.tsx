// Minimal React page scanned via the default JSX path (ESLint + jsx-a11y).
//
// This path exists to show LinkTextFixer (WCAG 2.4.4), which the static-HTML
// run can't surface: it *rewrites* generic-but-present link text and otherwise
// human-flags, rather than inventing text for an empty link. The empty anchor
// below is reported as anchor-has-content (2.4.4) and LinkTextFixer flags it for
// a human — the deliberate "we flag, we don't hallucinate" story. The bad <img>
// is auto-fixed by AltTextFixer (1.1.1).
export default function App() {
  return (
    <main>
      {/* VIOLATION (jsx-a11y/alt-text / WCAG 1.1.1): AltTextFixer adds an alt. */}
      <img className="avatar" src="/avatar.png" width="64" height="64" />

      <h1>Your account</h1>

      {/* VIOLATION (jsx-a11y/anchor-has-content / WCAG 2.4.4): empty anchor.
          LinkTextFixer human-flags it (nothing to rewrite). */}
      <a href="/settings"></a>
    </main>
  );
}

# Stage 9 — Chromium browser tests and security checks

The browser check loads the compiled Manifest V3 extension from dist/ in a disposable Chromium profile. Every chatgpt.com request is answered by a local HTML/JSON fixture; unexpected HTTP(S) requests are blocked. No user accounts or live conversations are involved.

## Automated CI commands

1. npm ci
2. npm run typecheck && npm test && npm run build
3. npm run test:security — privilege policy tests, manifest review and license inventory in artifacts/security/extension-audit.json
4. npm audit --audit-level=high — live npm advisory scan of both production and development dependencies; network errors are not a pass
5. npm run test:browser:setup — temporarily installs pinned Playwright and its Chromium binary without changing package.json or package-lock.json
6. npm run test:browser — exercises the built extension against local fixtures; failed browser screenshots are saved under artifacts/browser/

The browser test covers real MV3 MAIN/ISOLATED scripts, TOC rendering/search, reveal and keyboard controls, options synchronization, side-by-side and narrow-screen fallback, SPA navigation, failed API response and reload. Stage 10 checks both a fully mounted 500-message synthetic DOM and a bounded-window virtual-scroll fixture (24 mounted prompt pairs), recording TOC-build and far-jump timings. It also checks a UI-driven JSON backup export/merge-restore round trip through the shared background queue. These are fixtures, not a live-host performance benchmark.

Limitations: fixtures are not the live ChatGPT DOM, authenticated history/edited branches, real network conditions or real device acceptance. Permission/host checks are scoped to the extension manifest and built assets. The lockfile license inventory is an automated triage aid, not legal clearance. npm audit covers known registry advisories, not undisclosed or code-level vulnerabilities. Both reports still require review before merge.

The workflow uses read-only repository permissions and never publishes or removes releases, tags or user data. Chromium timings are observations only and must not be presented as live ChatGPT performance numbers.

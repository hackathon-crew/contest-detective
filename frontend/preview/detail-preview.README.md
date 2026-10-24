# Contest detail preview

This isolated preview renders the production `ContestDetail`, `LibraryRows`, `FollowButton` and shared design styles. Follow state is in memory only, with no account or persistence requests. It is not imported by `main.tsx` and does not enter the default Vite production build. The existing agent recommendation preview is unchanged.

## Open the preview

From `frontend`, run `npm ci` and `npm run dev -- --host 127.0.0.1 --port 5186 --strictPort`, then open:

- `http://127.0.0.1:5186/detail-preview.html?scenario=full`: the public Huairou event snapshot with populated Chinese content.
- `http://127.0.0.1:5186/detail-preview.html?scenario=conflict`: the public Cal Hacks snapshot with actual conflicting participation requirements.
- `http://127.0.0.1:5186/detail-preview.html?scenario=sparse`: an explicitly named synthetic boundary sample.
- `http://127.0.0.1:5186/detail-preview.html?scenario=long-reward`: the public McDonald's event snapshot with a long reward description.

Add `&variant=default` to inspect the other real detail entry. Close a detail and use the real list to reopen it. Public snapshots are labeled `界面预览 · 公开快照`; the sparse fixture is labeled `边界测试样本`, and its title includes `预览样本` so this remains visible in the fullscreen mobile dialog.

## Data boundaries

The three `detail-*-public-snapshot.json` files retain complete public API responses fetched after 2026-10-24 21:35:51 UTC. Each file preserves the API URL, capture boundary, server date and original response SHA-256. These are fixed historical snapshots, not live queries or a promise that the current data is unchanged.

`detail-preview-provenance.json` records source snapshot identities and public cover URLs, media types and SHA-256 hashes. Cover bytes are stored locally solely to make browser captures independent of external image services. Fixture rendering changes only the cover transport. No source-backed field, verification level, claim, excerpt or document is invented or replaced. The sparse fixture is synthetic and contains no invented verified information.

Known contest queries resolve in memory even after staleness; unknown `/api/` paths fail closed. The preview does not contact a backend or model. Browser tests additionally reject any external or API request. No login, personal profile, account data or secrets are needed.

## Real Chromium screenshots

On a supported runner:

1. `npm ci`
2. `npx playwright install --with-deps chromium`
3. Install the official distribution's `fonts-noto-cjk` package when Chinese fonts are not available.
4. `npm run test:detail-preview`

The pinned Playwright package downloads its matching official Chromium. The PR-only `Contest Detail Preview` workflow uses `contents: read`, no secrets, no deployment and no write permissions. Existing format, lint, typecheck, unit-test, build and generated-API checks remain in the ordinary frontend workflow.

Captures use desktop 1440×1100 and mobile 390×844 viewports at scale 1, a light color scheme, reduced motion, Chinese locale and Asia/Shanghai timezone. Browser time is fixed at the snapshot capture boundary. Readiness is based on the accessible dialog, rendered content, image decoding and `document.fonts.ready`, never timed sleeps.

The dialog body scrolls independently. Tests therefore capture both the initial reading view and the expanded bottom source section at the real viewport size rather than treating `fullPage` as a way to reveal hidden modal content. They also check horizontal overflow, fixed actions, missing optional sections, evidence navigation and return, close/reopen, stale-query isolation and the default detail variant.

Images and per-image metadata are in `artifacts/detail-preview/`:

- `desktop-full.png`, `desktop-full-sources.png`
- `desktop-conflict.png`, `desktop-conflict-sources.png`
- `desktop-sparse.png`, `desktop-long-reward.png`
- The same six names prefixed with `mobile-` instead of `desktop-`.

CI uploads screenshots first as `contest-detail-screenshots-<run_id>` and reports/failure traces separately as `contest-detail-playwright-report-<run_id>`, retained for seven days. Test assertions do not replace human review of the actual PNG pixels.

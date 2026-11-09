# Inkpaw for Anna

An Anna-native **candidate build** for finding contest opportunities. Describe interests, review an editable profile, confirm it, then explicitly start a source-backed search. This build has not yet completed real Anna installation or billing/storage validation and is not published.

## What works in the candidate

- Anna `#` entry requests prefill or stage a query. Opening/reopening never starts a model or search call.
- Draft a profile with the user's Anna model, or fill it manually. Any edits require confirmation again.
- Explicit search: at most two basic searches, eight fetched pages and one extraction-model call. No automatic paid retries. Stopping blocks later steps; already-sent requests may finish and consume quota.
- Each displayed fact retains source URL, retrieval time and exact excerpt. Missing facts remain unknown. Conflicts, closed registration, expired cutoffs and unverified hard constraints do not become recommendations. Fewer than three results is normal when evidence is insufficient.
- Independently checked organizer sources currently cover the CRASH event site, the EIS Next Horizon page and the Mobile World Capital More than a Hack page. The registry stores source identity only, never contest dates or eligibility. It never adds default fetches: only current search hits use the page budget. Other live search discoveries are separate **unverified leads**, not official recommendations. This is not yet a universal organizer-verification service.
- Free-form availability and custom hard constraints are not automatically proven in this version. They may exclude all verified matches; the app does not silently discard them.
- Personal Anna app-scope storage keeps only confirmed profiles and explicitly saved title/link snapshots. No shared database, raw search pages or unconfirmed drafts are stored. Existing-row updates use ETags. First save rechecks storage, but simultaneous first saves can race; use one window for initial setup. Failed loads do not overwrite saved data.
- Host light/dark theme and English/Chinese interface (some operational/source warnings are currently English), responsive desktop windows, manual bookmark removal and data clearing. Mobile platform support is not declared.
- A button sends a small transient source summary to the current Anna conversation. This is not durable chat history or automatic model context.

## Costs and privacy

Anna model/search/fetch calls consume the installing user's CU. Basic search documentation gives examples of roughly 0.5–13.8 CU per call; fetch starts at 1 CU per URL and can use a more expensive fallback. Models cost extra. These are examples, not a fixed upper price. The app displays reported actual CU; missing reporting is never shown as zero. Model drafting and search have separate opt-in controls.

No API keys, third-party accounts, local Agent, local-device permissions, resumes, private repository profiling or old Inkpaw server are required. Search queries use confirmed topics/skills/modes/location, not the original free-text paragraph. Do not put sensitive details in the form. Clearing data uses Anna soft deletion, not guaranteed erasure from platform backups.

## Build and test offline

Node 24 or newer is required.

```sh
npm ci --ignore-scripts
npm run check
node node_modules/playwright-core/cli.js install --with-deps chromium
npm run test:browser
npm run pack:offline
```

`check` runs type checks, offline behavior and official-host contract probes, builds `dist/`, and uses Anna CLI 0.1.64/schema 0.33.0 strict validation. Browser tests run inside Anna’s documented modal-free iframe sandbox, mock all Anna APIs, label screenshots as **OFFLINE SIMULATION**, and use synthetic facts. They do not prove live Anna compatibility, real search quality, CU usage or production APS persistence.

`dist/bundle/` is the deployable static-file candidate, `dist/manifest.json` and `dist/app.json` are its metadata, and `dist/file-map.json` records SHA-256/size/content-type. Build clears its own output first. Test fixtures, screenshots, dependencies and development files are excluded. No build or test command logs in, uploads, submits review, releases an Anna version, or touches the old production server.

For a purely local mock preview after build:

```sh
node tests/preview.mjs
```

Open `http://127.0.0.1:4327/preview`. This test server binds loopback only, uses synthetic responses and is not a public demo.

## Before calling it ready to publish

Still required on an authorized Anna account:

1. Confirm developer access and distribution rights, including the developer terms. Creating a CLI PAT is a separate persistent-access decision.
2. Install the candidate and test the actual SDK iframe handshake, `#` entry/re-entry, theme/locale changes and window close/reopen.
3. With an explicitly approved CU budget, run the real profile and search flow. Inspect actual provider failures, fetched-page shapes, source precision and the usage ledger. A local mock pass is not a live smoke pass.
4. Verify APS persistence across windows/devices, account isolation, ETag conflicts and clear semantics. Legacy local storage is not proof of production APS.
5. Validate listing/screenshots, finalize the actual bundle, submit the specific candidate for review, and release only after platform approval. CLI `apps push`, `cut`, `submit-review` and `release` are distinct actions; creating a version does not mean it is live.

When upload is separately authorized, point the CLI to the generated project root (`dist/`) or explicitly set `--bundle-dir dist/bundle`. Do not upload the authored `bundle/` without its generated `lib/` modules.

The repository's [PolyForm Noncommercial license](../../LICENSE) applies and is copied into the bundle. Commercial or revenue-share distribution rights must be verified before publication. Source code and third-party organizer facts are separate rights questions.

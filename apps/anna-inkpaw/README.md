# Inkpaw for Anna

This version is an **architecture skeleton**, not a working opportunity finder. It does not connect to Anna, invoke models, search websites, or save personal data. The window states this clearly.

## Check the skeleton

Node 22 or newer is required.

```sh
npm ci --ignore-scripts
npm run check
npm run pack:offline
```

The package uses the official Anna CLI 0.1.64 and schema 0.33.0. `pack:offline` creates a local `dist/` directory with bundle assets, metadata and a SHA-256 file map. It does not log in or upload anything. The bundle is not a publish-ready product.

The manifest supports desktop only and requests no Executas, third-party accounts, device tools, cross-app data, or browser permissions. Tests marked TODO describe unimplemented behavior and are not counted as successful product tests.

The repository's [PolyForm Noncommercial license](../../LICENSE) applies. Distribution and commercial/revenue-share rights must be verified before publication.

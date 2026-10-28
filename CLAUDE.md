# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Repository instructions

- Read `AGENTS.md` before making changes. It defines the repository's required `Proposal → Issue → branch → PR → Merge` workflow, issue/PR linking, commit format, API-key handling, and product invariants.
- This repository is Inkpaw, a contest discovery and verification product. Contest fields must remain traceable to clickable source URLs; do not invent missing values or hide conflicting source evidence.
- Keep search providers replaceable: provider changes belong behind the search interfaces and must not leak into extraction or verification logic.
- Keep credentials in local environment files. Update `.env.example` when adding configuration, but never commit real values, personal paths, notes, or session content.

## Commands

Run backend commands from the repository root with `--directory backend`, or `cd backend` first.

### Backend setup and development

```bash
uv sync --locked --directory backend
uv run --directory backend alembic upgrade head
uv run --directory backend contest-detective       # FastAPI development server on port 8000
uv run --directory backend contest-detective-sync  # run one source synchronization
uv run --directory backend contest-detective-mcp   # local read-only stdio MCP; needs an existing SQLite or PostgreSQL database
```

The default local database is `backend/contest_detective.db` when `DETECTIVE_DB_URL` is not overridden. Copy `.env.example` to a local environment file and configure provider/model settings only when a feature needs them. The MCP stdio process opens the configured database in read-only mode and does not create a database or run migrations.

### Backend verification

```bash
uv run --directory backend pytest
uv run --directory backend pytest tests/test_mcp.py
uv run --directory backend pytest tests/test_mcp.py -k search
uv run --directory backend lint-imports
```

The import-linter contracts are part of the architecture and must pass. The backend CI runs migrations, all pytest tests, and `lint-imports`.

### Frontend setup, development, and checks

Run frontend commands from `frontend`:

```bash
npm ci
npm run dev
npm run format:check
npm run lint
npm run typecheck
npm test
npm test -- src/features/detective/conversation.test.tsx
npm run build
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000` and removes the `/api` prefix. Set `VITE_API_PROXY_TARGET` when the backend runs elsewhere. `npm test` runs Vitest; tests needing a DOM opt into jsdom at the top of the test file. Frontend CI runs formatting, linting, type checking, tests, build, and generated API comparison in that order.

### API type generation

When backend routes or response models change, regenerate both tracked outputs:

```bash
npm run generate:api --prefix frontend
```

This exports `backend/openapi.json` and rewrites `frontend/src/shared/api/generated`. Do not hand-edit generated files. The frontend request boundary is `frontend/src/shared/api`; use its `apiClient`, which unwraps the common `code/message/data` response and raises `ApiError` on failures.

### Deployment checks

```bash
python3 -m unittest discover -s deploy/tests -v
```

Production deployment is release-based: `npm ci --prefix frontend && npm run build --prefix frontend` builds the frontend, and the GitHub Actions workflow deploys only a published `vX.Y.Z` release that is reachable from `main`. Read `deploy/README.md` before changing systemd, nginx, release, or production configuration.

## Architecture

### Backend layers

The Python package is `backend/src/contest_detective` and is split into six top-level packages:

- `framework/` owns settings, SQLAlchemy engines/session helpers, response envelopes and business errors (`result/`, `exceptions/`, `enums/`), model discovery, and Alembic migrations. Domain `models.py` modules register tables; `init_db()` walks the package tree, loads them, and applies migrations.
- `contest/` owns contest identity, claims, source evidence, verification, and queries.
- `research/` owns source adapters, provider-independent search, page retrieval/extraction, structured-source enrichment/deduplication/normalization, the staged sync pipeline, and the daily scheduler.
- `agent/` owns the investigator loop, LLM extraction/normalization, tool calls, budgets, and streamed events.
- `system/` owns accounts, authentication, resumes, profiles, matching, notifications, and document Q&A: `system/user/`, `system/auth/`, `system/account/`, `system/notifications/`, `system/documents/`.
- `bootstrap/` is the transport and composition layer. `bootstrap/api/` validates HTTP inputs and maps domain results to the common response format; `bootstrap/app.py`, `bootstrap/mcp*.py`, `bootstrap/source_sync.py`, and `bootstrap/offline_refresh.py` assemble the FastAPI app, scheduler, sync CLI, and MCP processes. Keep domain behavior out of route handlers.

The import-linter rules in `backend/pyproject.toml` are architectural constraints: domain code must not depend on HTTP; contest code must not depend on research, agent, auth, or user domains; research must be independent of accounts and investigation; and investigation must not authenticate. Preserve these boundaries when adding imports.

### Contest synchronization and evidence flow

`SequentialContestSync` executes configured stages in order. Structured collection can be followed by enrichment, deduplication, and optional LLM normalization; unstructured collection retrieves search/listing pages and extracts drafts; verification combines this run with existing claims and resolves field values with evidence levels. The pipeline returns records, but persistence is performed by the surrounding pipeline orchestration rather than by verification stages.

A contest is backed by claims tied to source pages. `contest/service.py` refreshes derived details, status, dates, and next deadlines from those claims. Date comparison, deduplication, sorting, and status calculation must remain deterministic; models may interpret or extract text but must not replace these rules.

### HTTP, MCP, and persistence

The FastAPI app is created in `bootstrap/app.py`, mounts the routers from `bootstrap/api`, initializes/upgrades the configured database during lifespan, and starts the optional synchronization scheduler. `/agent/ask` is an SSE endpoint: the investigator emits typed events and the route serializes them as event names plus JSON payloads. Contest/profile/auth routes use the common response envelope.

The local and remote MCP entry points expose read-only contest search, contest detail, and profile matching. MCP calls reuse contest/user services, do not search the web or call a model, and must not persist the supplied profile. The stdio entry point uses a read-only SQLite or PostgreSQL engine; the HTTP entry point is a separate bootstrap path.

### Frontend layers and state

The React app is assembled in `frontend/src/app`, with routes under `pages`, user-facing capabilities under `features`, domain models/API under `entities`, and reusable infrastructure under `shared`. The enforced dependency direction is `app → pages → features → entities → shared`; `pages`, `features`, and `entities` are sliced, so slices at the same layer must not import each other. `frontend/src/architecture.test.ts` is the executable rule—run it through `npm test` when changing module placement or imports.

`shared/api` owns the HTTP and SSE clients and the generated OpenAPI types. Contest entities provide contest queries, date/status formatting, calendar data, and evidence-oriented UI primitives. The detective feature consumes the real `/api/agent/ask` SSE stream and stores conversations in the current browser, scoped by login identity; it is not server-side shared conversation state. App routing preserves background locations so contest details can open as overlays without losing page filters or scroll state.

## Change-sensitive conventions

- Changes to backend routes or Pydantic response schemas require `npm run generate:api --prefix frontend`, followed by checking that both `backend/openapi.json` and the generated frontend directory are included in the change.
- Changes to evidence fields, date precision, contest matching, source adapters, pipeline stages, or normalization should be covered by the corresponding backend tests and must preserve source URLs and verification levels.
- Changes to frontend imports must satisfy the layer/slice test; shared code cannot import an upper layer, and a slice cannot reach across to another slice at the same layer.
- Do not start a second production worker: scheduled synchronization and the web process assume a single worker against the configured database.

<p align="center">
  <a href="https://inkpaw.windup.xin">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/inkpaw-logo-dark.png">
      <img src="docs/assets/readme/inkpaw-logo-light.png" width="300" alt="Inkpaw">
    </picture>
  </a>
</p>

<h3 align="center">Find competitions with sources you can check.</h3>

<p align="center">
  <a href="https://github.com/hackathon-crew/contest-detective/releases/latest"><img src="https://img.shields.io/github/v/release/hackathon-crew/contest-detective?style=flat-square&amp;color=3f5fd6" alt="Latest release"></a>
  <a href="https://github.com/hackathon-crew/contest-detective/actions/workflows/backend.yml"><img src="https://img.shields.io/github/actions/workflow/status/hackathon-crew/contest-detective/backend.yml?branch=main&amp;style=flat-square&amp;label=backend&amp;color=3f5fd6" alt="Backend checks"></a>
  <a href="https://github.com/hackathon-crew/contest-detective/actions/workflows/frontend.yml"><img src="https://img.shields.io/github/actions/workflow/status/hackathon-crew/contest-detective/frontend.yml?branch=main&amp;style=flat-square&amp;label=frontend&amp;color=3f5fd6" alt="Frontend checks"></a>
</p>

<p align="center">
  <strong><a href="https://inkpaw.windup.xin">Try Inkpaw ↗</a></strong>
  &nbsp; · &nbsp; <a href="https://inkpaw.windup.xin/contests">Browse competitions</a>
  &nbsp; · &nbsp; <a href="#connect-via-mcp">MCP setup</a>
  &nbsp; · &nbsp; <a href="README.md">简体中文</a>
  &nbsp; · &nbsp; <a href="https://github.com/hackathon-crew/contest-detective/issues/new/choose">Feedback</a>
</p>

**Inkpaw**, also known as 比赛侦探 (Contest Detective), helps students and independent developers discover competitions scattered across event platforms, organizers' websites, and public WeChat posts. Browse the catalog yourself, or tell the detective your skills, availability, and preferences so it can search, read source pages, and return recommendations with evidence.

Competition cards record **registration and submission deadlines separately**, alongside their sources, date precision, and verification status. When a repost is outdated, dates disagree, or a rule is missing, you can inspect the evidence before deciding to enter.

<p align="center"><a href="https://inkpaw.windup.xin"><img src="docs/assets/readme/home.png" width="100%" alt="Live Inkpaw homepage with natural-language search, the blue octopus mascot, and competition posters"></a></p>

<p align="center"><sub>Screenshots show the live v0.1.27 site on October 25, 2026. Competition counts, dates, and page content change over time.</sub></p>

## Get started

1. **Explore the catalog.** Open [competitions](https://inkpaw.windup.xin/contests), combine format, city, deadline, and status filters, and switch between list and calendar views.
2. **Describe what fits.** Ask the [detective](https://inkpaw.windup.xin/detective), for example: “I know Python. Find online AI hackathons with deadlines next month.” Inspect its tool steps, competition cards, and source links, then ask follow-up questions.
3. **Keep track.** Sign in to your [account](https://inkpaw.windup.xin/account) to maintain a profile, sync followed competitions, control individual reminders, or generate a personal calendar subscription.

The public catalog and anonymous MCP queries are available directly. Accounts store personal profiles, follows, tracking conditions, and settings. The web interface is currently primarily Chinese.

## From discovery to follow-up

| Capability | What you can do |
| :--- | :--- |
| **Competition catalog** | Combine keyword, format, city, status, and deadline filters. Browse posters, organizers, summaries, prizes, and event dates. |
| **Detective conversations** | Search in natural language, refine your criteria, and ask follow-ups. The conversation shows actual catalog queries, web searches, page reads, and other tool steps. |
| **Evidence per field** | Inspect recorded sources, excerpts, and verification levels. Registration, submission, start, and end dates remain distinct. |
| **Profile matching** | Build a profile from public GitHub information, a PDF / DOCX / TXT résumé, or manual input. Edit and confirm it, then match by skills, identity, location, and availability with reasons. |
| **Follows and calendars** | Sync follows across devices after sign-in, control reminders per competition, export a calendar, or subscribe to a personal `.ics` feed. |
| **Private updates** | Enable watching per followed competition and inspect personal updates with before-and-after values, sources, timestamps, and actual check status. |
| **Account controls** | Manage profiles, competition email preferences, tracking conditions, search and model keys, email, passwords, data export, and account deletion. |
| **MCP access** | Query the same catalog from a Streamable HTTP client. A personal token also grants read access to your own profile, follows, and tracking conditions. |

### Investigation modes

- **Standard recommendations:** use the catalog and compatible available search providers. This does not mean Yuanbao performed live verification in the current run.
- **Catalog only:** use existing competition and profile tools, without registering page-reading, search, or write-back tools.
- **Live verification:** requires configured Yuanbao search and actual execution, with no fallback to another provider. The model plans steps and connects each claim to original pages read in the current run, clickable sources, and actual search traces. Unexecuted steps, failures, and insufficient evidence remain explicitly incomplete.
- **Deep investigation:** builds on live verification with distinct queries across rounds, coverage of the investigation plan, and claim-by-claim comparisons of original sources. Mirrors and reposts with unknown provenance do not count as independent corroboration. A search-count threshold alone does not establish completion.

Reports distinguish supported, contradicted, conflicting, and unverified claims from source grades such as official or reposted, and export the same content as Markdown or JSON. Search snippets and historical catalog cards are leads rather than original evidence from the current run. Page reads retain public-address, DNS, and redirect safety checks. Reports exclude account keys, user profiles, and sensitive links.

Investigation covers public competition information, excluding political or current-affairs claims and messages about individuals. Text recognized from screenshots must be confirmed by the user before submission as claims to investigate; recognition is not factual evidence. An event allowing individual participation is an ordinary eligibility rule and does not fall under personal messages.

### Compare the competitions that fit

The catalog offers list and calendar views, plus filters for published prizes, deadlines checked against original sources, and your followed competitions. Events with unknown deadlines remain available so you can inspect their sources yourself.

<p align="center"><img src="docs/assets/readme/contests.png" width="100%" alt="Live catalog with a calendar, filters, competition list, deadline labels, and source links"></p>

### Understand where a date came from

An aggregator may list registration dates while an organizer lists submission dates and later posts an extension on WeChat. Inkpaw stores evidence per field so these milestones are not collapsed into one ambiguous deadline.

| Label or state | Meaning |
| :--- | :--- |
| **Official source — 官方原文** | The field is traced to an organizer's website, official event page, or official WeChat post. |
| **Repost — 转载** | Evidence currently comes from a repost or aggregator and has not been traced to an official original. |
| **Conflicting sources — 说法不一** | Sources disagree; expand the evidence to compare their values. |
| **Time unverified — 时刻未核实** | Only the day is verified. Hours and minutes are not invented. |
| **Missing information** | Not yet fetched, fetch failed, extraction failed, checked but not found, and explicitly unpublished are distinct states. |

Verification belongs to an individual field. Stored evidence has its own collection time; opening a detail view does not automatically fetch the organizer's website again. Follow the source links to check subsequent announcements.

<p align="center"><img src="docs/assets/readme/evidence.png" width="100%" alt="Live McDonald's developer competition detail with its summary, date precision, repost status, and original field evidence"></p>

### Maintain your participation preferences

The [account area](https://inkpaw.windup.xin/account) has five pages: profile, competition email, follows, search and keys, and account settings. Skills retain their GitHub, résumé, or manual provenance and can be corrected before saving. Follows sync with your account, and the personal calendar feed updates as your follows change.

Email preferences include frequency, Beijing time, natural-language tracking conditions, a preview of the next email, and delivery records. **Sending requires the operator to configure and enable Resend. The v0.1.27 production release keeps email sending disabled**, so saving preferences alone does not activate delivery.

### Watch followed competitions

After signing in, enable watching for individual followed competitions under Account → Follows. Private updates preserve the before-and-after field values, sources, and timestamps as they were when the change occurred. Historical records without a saved snapshot do not produce invented changes. Updates are visible only to their account owner; read status is independent of email processing. Pausing stops new updates, resuming starts from the current version, and unfollowing removes the watch subscription.

The page distinguishes a paused subscription, globally paused automatic checks, actual last-check results, and an estimated next check. `DETECTIVE_WATCH_ENABLED` defaults to `false`: it does not start website checks or re-enable source synchronization or email. When an administrator explicitly enables it, checks rotate through never-checked and least-recently-checked items, with a default interval of 1,440 minutes per item and at most 30 items per batch. The estimate is the earliest eligible check time, not a promise that every followed competition is checked daily. Failed fetches preserve the last successful time; competitions sharing an official page fetch it only once per batch. Page access and model calls retain the existing budget and source-safety constraints.

## Connect via MCP

Endpoint: **`https://inkpaw.windup.xin/mcp`**. Transport: **Streamable HTTP**. The website and MCP read the same catalog, including source links, verification levels, and date precision.

<p align="center"><img src="docs/assets/readme/mcp.png" width="100%" alt="Live MCP setup dialog with client configuration, public tools, and personal-token instructions"></p>

### Query public competitions

For Claude Code:

```bash
claude mcp add --transport http inkpaw https://inkpaw.windup.xin/mcp
```

For Cursor, add this to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "inkpaw": {
      "url": "https://inkpaw.windup.xin/mcp"
    }
  }
}
```

Then ask your client: “Use Inkpaw to find online competitions with upcoming deadlines. Include registration links and the sources behind each date.”

### Read your profile and follows

Generate a personal token under [Search and keys](https://inkpaw.windup.xin/account/keys), then add an `Authorization` header:

```bash
claude mcp add --transport http inkpaw https://inkpaw.windup.xin/mcp \
  --header "Authorization: Bearer YOUR_PERSONAL_TOKEN"
```

For Cursor, use this personal configuration:

```json
{
  "mcpServers": {
    "inkpaw": {
      "url": "https://inkpaw.windup.xin/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_TOKEN"
      }
    }
  }
}
```

The two Claude Code commands are alternative anonymous and personal configurations; choose one. A complete token is shown only when generated, and rotating it immediately invalidates the previous token. Keep it in your local client configuration.

| Tool | Access | Input and output |
| :--- | :--- | :--- |
| `search_contests` | Anonymous / personal | Optional `keyword`, `status`, `mode`, `date_from`, `date_to`, `ids`, `sort`, `page`, `page_size`; returns paginated results. |
| `get_contest` | Anonymous / personal | Required `id`; returns complete competition details and sources. |
| `match_contests` | Anonymous / personal | Required `profile`; returns competitions, match reasons, and ranking scores. |
| `get_my_profile` | Personal token | No arguments; returns the token owner's saved profile. |
| `get_my_follows` | Personal token | No arguments; returns the owner's followed competitions and reminder settings. |
| `get_my_tracking` | Personal token | No arguments; returns the owner's tracking conditions. |

Example public query: `{"keyword":"Python","mode":"online","page_size":5}`. Example explicit profile match: `{"profile":{"skills":["Python"],"preferred_modes":["online"]}}`.

MCP tools read existing business data. They do not search the web, call a model, or save the supplied matching profile. Personal-token authentication updates the token's last-used time. The public endpoint allows 60 requests per minute per IP, a burst of 20, and up to 4 concurrent connections, with a 64 KiB request limit. Rate-limit violations return HTTP 429.

<details>
<summary>Local stdio MCP: read your own SQLite database</summary>

Install dependencies and run migrations using the local setup below, then start:

```bash
uv run --directory backend contest-detective-mcp
```

By default it reads `contest_detective.db` in the backend working directory. Set `DETECTIVE_DB_URL` to select another existing database. The SQLite connection uses file read-only mode; startup does not create a database or run migrations. Logs go to standard error, leaving standard input and output for MCP. Local stdio exposes the three public tools and does not read account data.

```json
{
  "mcpServers": {
    "inkpaw-local": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/contest-detective/backend", "contest-detective-mcp"],
      "env": {
        "DETECTIVE_DB_URL": "sqlite:////absolute/path/to/contest_detective.db"
      }
    }
  }
}
```

Replace the example paths with absolute paths to your checkout and database.

</details>

## Run locally

Requires **Python 3.12+, uv, Node.js 24, and npm**. The backend uses FastAPI, SQLAlchemy, Alembic, and SQLite; the frontend uses React, TypeScript, and Vite.

```bash
git clone https://github.com/hackathon-crew/contest-detective.git
cd contest-detective
cp .env.example .env
uv sync --locked --directory backend
uv run --directory backend alembic upgrade head
uv run --directory backend contest-detective
```

In another terminal:

```bash
cd contest-detective/frontend
npm ci
npm run dev
```

Open the address printed by Vite, normally `http://localhost:5173`. The development proxy forwards `/api` to `http://127.0.0.1:8000`. Backend health is at `http://127.0.0.1:8000/health`; interactive API documentation is at `http://127.0.0.1:8000/docs`.

**A fresh installation has an empty database.** Model calls, scheduled collection, and email are disabled by default. Starting the application does not import the production catalog. Once source settings are ready, explicitly run `uv run --directory backend contest-detective-sync`, or import reviewed public evidence with the offline tool below.

| Capability | Configuration |
| :--- | :--- |
| Detective and résumé understanding | Set `DETECTIVE_LLM_ENABLED=true`, `DETECTIVE_LLM_API_KEY`, `DETECTIVE_LLM_BASE_URL`, and `DETECTIVE_LLM_MODEL`. Adjust `DETECTIVE_LLM_DEEPSEEK_OPTIONS` when changing providers. |
| Web search | Configure Yuanbao's `DETECTIVE_YUANBAO_SECRET_ID` / `DETECTIVE_YUANBAO_SECRET_KEY`, or `DETECTIVE_TAVILY_API_KEY`. |
| Scheduled collection | Set `DETECTIVE_SYNC_DAILY_AT` or `DETECTIVE_SYNC_INTERVAL_MINUTES`. Source extraction also depends on model configuration. |
| Automatic watching | `DETECTIVE_WATCH_ENABLED` defaults to off. When enabled, `DETECTIVE_WATCH_INTERVAL_MINUTES` and `DETECTIVE_WATCH_BATCH_SIZE` control the interval and batch size. |
| Personal provider keys | Generate and retain a separate `DETECTIVE_ACCOUNT_ENCRYPTION_KEY` to encrypt account-owned model and search keys. |
| Email and subscription URLs | Set `DETECTIVE_PUBLIC_BASE_URL`. Sending also needs Resend credentials, a sender address, and `DETECTIVE_MAIL_ENABLED=true`. |

See [`.env.example`](.env.example) for all settings. Model and search calls use the configured providers' allowances. Local budget modes and production setup are covered in the [deployment guide](deploy/README.md); frontend proxies and generated API types are covered in the [frontend guide](frontend/README.md).

<details>
<summary>Offline refresh: import reviewed public evidence</summary>

`contest-detective-refresh` imports reviewed `contest-refresh-v1` manifests. It does not access the network, read `.env`, start schedulers, call a model, or fetch and interpret pages. Each entry contains competition identity, the SHA-256 of the saved text, its representation and completeness, excerpts, and sources. Cited summaries are optional. Search snippets and partial excerpts must be marked `partial`; they cannot establish that a rule is absent from the full page.

Migrate an explicitly selected local SQLite database, then run the default read-only dry run:

```bash
uv run --directory backend contest-detective-refresh \
  --database /absolute/path/to/contest.db \
  --manifest /absolute/path/to/reviewed-public-evidence.json \
  --output-directory /absolute/path/to/refresh-reports
```

Review the report before adding `--apply`. Failures are isolated per competition. Omitted historical fields and text remain intact, and applying an identical manifest again does not duplicate writes. `created` and `updated` count distinct competitions; `applied_entries` counts manifest entries. Source-discovery counts and pagination stop reasons are reported separately. Failed entries remain in the report and can be retried after review with a new manifest version. Changed content requires a new `manifest_id`; different editions or incompatible dates are rejected for automatic merging.

Before writing, the tool creates a SQLite backup and a rollback record containing only changes to public competition tables. The backup can contain other database records and belongs in protected local storage. Rollback reverses this run's competition changes without overwriting subsequent account data. It refuses when affected records have since changed or private records reference a newly created competition:

```bash
uv run --directory backend contest-detective-refresh \
  --database /absolute/path/to/contest.db \
  --rollback /absolute/path/to/refresh-reports/refresh-run/changes.json \
  --output-directory /absolute/path/to/refresh-reports --apply
```

Correcting an old mapping requires its old source, value, excerpt, reason, replacement evidence, and an expected public-data fingerprint. Partial fetches cannot overwrite history, and imports cannot silently change a historical source's official status. The command does not deploy or connect to production; production imports use a separately reviewed operational channel. Ordinary page GETs and deployment migrations do not import manifests.

</details>

## Data and behavior

- **Public sources.** Collection and search cover Devpost, HackerTrip, WaytoAGI, ETHGlobal, Huodongxing, and organizers' public websites and WeChat posts. Coverage varies by source; ask the detective when the catalog does not contain what you need.
- **Source text.** New source documents expose necessary excerpts and links by default; historical full text is retained, and details load on demand. Competition posters and third-party brands in screenshots belong to their respective owners.
- **Personal information.** Confirmed profiles and preferences are saved after sign-in. Résumé import uses the configured model service, so provide the information needed for competition matching. GitHub profiles use public information.
- **Conversations.** History stays in the current browser and is isolated by signed-in identity. You can refresh and continue; history currently does not sync across devices.
- **Credentials.** Personal model and search keys are stored encrypted and returned masked. Personal MCP tokens are stored as hashes. Account settings support data export and confirmed account deletion.

## macOS companion

The repository also includes a native [Inkpaw Companion](plugins/inkpaw-macos/README.md): a desktop octopus, milestone countdowns, submission checklists, questions over local rule documents, read-only Git activity, and system reminders.

It is a separate **macOS 15+ development build**, requiring a Swift 6 toolchain, and is not signed, notarized, or formally released. See the [companion guide](plugins/inkpaw-macos/README.md) for build instructions and boundaries, and the [macOS workflow](https://github.com/hackathon-crew/contest-detective/actions/workflows/inkpaw-macos.yml) for native verification results.

## Contribute

Found a wrong date, missing source, or product issue? [Open an issue](https://github.com/hackathon-crew/contest-detective/issues/new/choose) with the competition link and original evidence. Contributions follow **Issue → branch → PR**; see [CONTRIBUTING.md](CONTRIBUTING.md).

[Releases](https://github.com/hackathon-crew/contest-detective/releases) · [Milestones](https://github.com/hackathon-crew/contest-detective/milestones) · [Deployment](deploy/README.md) · [Frontend development](frontend/README.md) · [hackathon-crew](https://github.com/hackathon-crew)

The repository does not currently declare an open-source license.

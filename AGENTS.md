# Instructions for AI Agents

## Project Overview

**Stackable Cockpit** is a SvelteKit application that serves as the web UI of the Stackable Data Platform. It is built as a set of modules behind a shared OIDC login:

- **Trino** — SQL editor (Monaco + ANTLR grammar) with catalogue browser and query lifecycle management
- **Storage** — S3 file browser with preview, upload/download, archives, search and transfers (HDFS is a stub)
- **Settings** — user-managed storage connections, stored in PostgreSQL
- **Dashboard** and **bookmarks** (browser `localStorage`) across modules

The Trino connection is either fixed via `STACKABLE_COCKPIT_TRINO_URL` or entered per user on `/trino` and held in server memory.

Further modules are added the same way: a route under `src/routes/(app)/<module>/`, server code under `src/lib/server/<module>/`, components under `src/lib/components/<module>/`.

## Tech Stack

- **SvelteKit** with **Svelte 5** — always use runes (`$props`, `$state`, `$derived`, ...), adapter-node
- **Tailwind CSS v4** — CSS-based configuration in `src/app.css`, no `tailwind.config.js`
- **DaisyUI v5** — use its components/classes where possible. Many v4 classes no longer exist; check <https://daisyui.com/docs/upgrade/> if needed
- **Icons** — `unplugin-icons` with the `material-symbols` set: `import IconMenu from 'virtual:icons/material-symbols/menu'`
- **Monaco Editor** + **ANTLR** (`antlr-ng` generator, `antlr4ng` runtime, `antlr4-c3` completion) for Trino SQL
- **zod + sveltekit-superforms** — all forms
- **better-auth** with the `genericOAuth` plugin — authentication via any OIDC provider
- **PostgreSQL + Drizzle ORM** — users/sessions, storage connections, recent searches, download manifests. See `docs/DATABASE.md`
- **AWS SDK v3** — S3 storage access
- **Paraglide-JS v2** — i18n
- **pino** — logging; **prom-client** — Prometheus metrics at `/metrics`

## Project Structure

Single SvelteKit application (not a monorepo).

```text
├── src/
│   ├── lib/
│   │   ├── server/         # Server-only code: auth, db, logging, metrics, feature flags, trino/, storage/
│   │   ├── components/     # Svelte components (shared ones at top level, per-module subfolders)
│   │   ├── client/         # Client-only utilities
│   │   ├── stores/         # Svelte stores (*.svelte.ts)
│   │   ├── storage/        # Client-side storage module logic
│   │   ├── editor/         # Monaco/ANTLR Trino SQL support (grammar/, generated/, completion/)
│   │   ├── dashboard/      # Dashboard and bookmarks
│   │   ├── types/          # Shared types
│   │   ├── test-utils/     # Unit test helpers (e.g. mock-logger.ts)
│   │   └── paraglide/      # Generated i18n code (do not edit)
│   ├── routes/
│   │   ├── (app)/          # Authenticated routes: trino, storage, settings, api
│   │   ├── auth/           # Login/logout
│   │   ├── healthz/        # Health check (public)
│   │   └── metrics/        # Prometheus endpoint (public)
│   ├── architecture-tests/ # Architecture fitness functions
│   ├── test/               # Unit test setup and stubs
│   └── hooks.server.ts     # Auth middleware, request logging, metrics
├── messages/               # i18n message files (en.json, de.json)
├── e2e/                    # Playwright E2E tests
├── dev/                    # Local dev environment (kind cluster setup)
├── deploy/helm/            # Helm chart
├── docker/Dockerfile       # Production container image
└── docs/                   # Further documentation
```

## Tech Debt

When introducing shortcuts, known issues, or deferred security work, file an issue with the `tech-debt` label. Keep it concise: what the issue is, why it is acceptable now, and what the correct long-term fix is.

## Development Guidelines

### Browser Compatibility

The application must work in **Firefox** and **Chromium-based browsers**. Do not use browser-specific features or CSS without verifying cross-browser support. E2E tests run on both.

### CSS & Styling

- **Light and dark mode must work automatically.** Never use hard-coded colours (`text-gray-700`, `bg-white`, ...). Use DaisyUI semantic classes (`text-base-content`, `bg-base-200`, `border-base-300`, `text-primary`, `bg-error`, ...) with opacity modifiers (`text-base-content/80`) where needed.
- **Secondary text uses `text-muted`** (defined in `src/app.css`), never `text-base-content` at 60 % opacity or less, and never `text-muted` with an opacity: both fail 4.5:1 contrast in the light theme. `aria-hidden` is no exemption. Lower opacities are only allowed on `aria-hidden` icon components that duplicate adjacent text; state icons (e.g. an expand chevron) need 3:1 and use `text-muted` too.
- **Mobile-friendly**: use responsive breakpoints (`sm:`, `md:`, `lg:`) and check layouts at mobile widths. Navigation must work on small screens.

### Accessibility (WCAG 2.2 AA)

The application must comply with **WCAG 2.2 AA**, which covers **BITV 2.0** (based on WCAG 2.1 AA). The axe tests in `e2e/accessibility.spec.ts` check the WCAG 2.0, 2.1 and 2.2 A/AA rules.

- **Semantic HTML**: correct elements (`<nav>`, `<main>`, `<button>`, `<a>`, headings in order). Never use `<div>`/`<span>` for interactive elements.
- **Keyboard navigation**: everything reachable and operable via keyboard, with visible focus indicators.
- **ARIA** only where semantic HTML is insufficient (`aria-label`, `aria-current`, `aria-expanded`, ...).
- **Colour contrast**: 4.5:1 for normal text, 3:1 for large text. Never convey information through colour alone.
- **Target size**: interactive targets at least 24×24 CSS px, or enough spacing to undersized neighbours (WCAG 2.5.8).
- **Form labels**: every control has a visible label, associated via `for`/`id` (see below).
- **Alt text** on every `<img>` (`alt=""` for decorative images); hide decorative elements with `aria-hidden="true"`.
- **Language**: `lang` on `<html>` and on content in other languages.

### Logging

Server-side logging uses **pino** (structured JSON). Include logging at `debug` and `info` level as appropriate in server code.

- **Request-scoped** (`+page.server.ts`, `+server.ts`, hooks): `const log = event.locals.logger;`
- **Module-level** (singletons, services): `const log = logger.child({ module: 'trino-client' });` with `import { logger } from '$lib/server/logging';`

Levels: `trace` for request lifecycle noise, `debug` for operational detail, `info` for significant business events (login, query executed), `warn` for recoverable problems, `error` for failures needing investigation.

Conventions:

- Context object first, message second: `log.info({ user_id }, 'User logged in')`
- snake_case field names (`request_id`, `user_id`, `duration_ms`, `status_code`, ...)
- Never log tokens, credentials or full request/session objects — add redaction paths to `src/lib/server/logging/redaction.ts`

### Metrics

`/metrics` is served by `src/routes/metrics/+server.ts`; HTTP request duration is tracked for all routes in `hooks.server.ts`. Define further metrics in `src/lib/server/metrics.ts` (server-only) for new API endpoints, background operations and external service calls.

### Monaco Editor

- Monaco (and modules that import it, such as `trinosql.ts`) must be **dynamically imported** and loaded client-side only (SSR safety).
- Use the custom `trinosql` language registration.

### Updating the Trino SQL Grammar

The grammar lives at `src/lib/editor/grammar/SqlBase.g4`. Its source is `core/trino-grammar/src/main/antlr4/io/trino/grammar/sql/SqlBase.g4` in the Trino repository:

```bash
gh api "repos/trinodb/trino/contents/core/trino-grammar/src/main/antlr4/io/trino/grammar/sql/SqlBase.g4" \
  --jq '.download_url' | xargs curl -s -o src/lib/editor/grammar/SqlBase.g4
npm run generate:antlr
```

Afterwards compare the token list in the generated `SqlBaseLexer.ts` against `src/lib/editor/tokenMap.ts`. Missing tokens fall back to the `'identifier'` scope (no colour); add them with an appropriate scope.

### Database

PostgreSQL via Drizzle ORM; schema in `src/lib/server/schema.ts` (better-auth tables in `auth-schema.ts`), migrations in `src/lib/server/migrations/`. Generate migrations with `npm run db:generate` and commit the SQL together with `meta/`. Migrations run automatically at startup, so never edit one that has already been released. See `docs/DATABASE.md`.

For **new features**, do not add data migrations or legacy-data compatibility paths unless persisted data or an external consumer already exists and requires it. Ask if unclear.

### Feature Flags

Feature flags and limits are environment variables parsed in `src/lib/server/feature-flags.ts`; client-visible `PUBLIC_*` flags live in `src/lib/client/feature-flags.ts` and are re-exported by the server where it enforces them. Document new flags in `README.md` and `.env.example`; don't read `env` ad hoc.

### Code Style & Best Practices

- Run `npm run format`.
- British English.
- Use `resolve()` from `$app/paths` for internal links and `goto` (`svelte/no-navigation-without-resolve`).
- **Redirects**: never wrap `throw redirect()` in try-catch; put it after the try-catch.

  ```typescript
  try {
    await operation();
  } catch (err) {
    return fail(500, { error: 'Failed' });
  }
  throw redirect(303, '/path');
  ```

- **Public routes**: add unauthenticated paths to `PUBLIC_PATHS` in `hooks.server.ts`. `/metrics` and `/healthz` are permanently public — never put auth in front of them.
- **Label-element association**: always use `for`/`id`, with IDs from `$props.id()`. Never wrap the input in the label.

  ```svelte
  <script>
    const uid = $props.id();
  </script>

  <label for="{uid}-name" class="label">Name</label>
  <input id="{uid}-name" class="input" />
  ```

- **Modals**: use the shared `Modal` component with a boolean `$state` and `bind:open`. Never use `<dialog>` directly.
- **Date/time pickers**: use the shared `DateTimePicker` component. Never use native date inputs.

### Internationalisation (i18n)

English is the default/fallback locale; German is also supported.

- All user-visible strings go into `messages/en.json` **and** `messages/de.json` (same keys in both). This includes `aria-label`, `title`, `placeholder` and `alt`.
- Use them via `import * as m from '$lib/paraglide/messages.js'` and `m.key_name()`.
- Flat keys with a feature prefix: `dashboard_welcome`, `nav_dashboard`, `header_user_menu`.
- Data structures containing translated strings must be `$derived` so they follow locale changes.
- The Vite plugin compiles messages during `dev`/`build`. For `npm run check`/`lint` outside Vite, compile manually: `npx @inlang/paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`.

## Commands

### Node.js Version

The Node.js version is pinned in `.node-version` (CI) and `.nvmrc` (nvm); keep both in sync. Activate it with `nvm install && nvm use` before running `npm` — `.npmrc` sets `engine-strict=true`.

`.npmrc` also sets `min-release-age=7`: package versions published less than seven days ago don't resolve (supply-chain cooldown). Use `min-release-age-exclude` only for urgent fixes.

### Local Setup

Either copy `.env.example` to `.env` and point it at your own OIDC provider, PostgreSQL and Trino, or use the pre-configured kind environment:

```bash
./dev/setup.sh           # Requires a running kind cluster and stackablectl. Deploys Keycloak, Trino,
                         # Garage (S3) and PostgreSQL, runs migrations and writes .env.development
npm run dev              # Start dev server
npm run build            # Build for production (npm run preview to serve it)
```

### Quality Checks (run after major changes)

```bash
npm run format               # Format code
npm run lint                 # prettier, eslint, svelte-check, knip, architecture tests
pre-commit run --all-files   # All of the above plus markdownlint, yamllint, shellcheck,
                             # actionlint, hadolint, typos, helm lint
```

### Enforced Rules

Most conventions in this file are checked automatically; fix violations instead of disabling rules.

- **ESLint** (`eslint.config.js`): no server imports from client code (`src/lib/client`, `stores`, `storage`, `editor`, `types`) and vice versa, file naming (PascalCase components, stores as `*.svelte.ts`), file size limits (`max-lines`), no `<dialog>` outside `Modal.svelte`, a subset of hard-coded colour classes (`bg-white`, `text-gray-*`, ...), no `console` in server code.
- **Architecture tests** (`npm run test:arch`, `src/architecture-tests/`): no circular dependencies in `src/lib` and `src/routes`, i18n key parity and no unused message keys, no static English `aria-label`, no native date inputs, `<img>` with `alt`, no clickable `<div>`/`<span>`, no low-opacity `text-base-content` for text (use `text-muted`). `npm run test:arch:report` additionally writes dependency/metrics reports to `reports/`.

When you add a new architectural rule, prefer an ESLint rule; otherwise add a `.spec.ts` in `src/architecture-tests/` following the existing patterns.

### Dead Code (knip)

```bash
npm run knip                 # Report unused files, exports, types and dependencies
npm run knip:fix             # Remove unused exports and dependencies; review the diff and run npm install afterwards
```

Delete dead code rather than silencing knip. For genuine false positives, configure `knip.json`: add files nothing imports statically (CLI scripts, config files) to `entry`, and packages loaded at runtime by name (e.g. `pino-pretty`) or used only outside the source tree to `ignoreDependencies`, each with a comment explaining why.

## Testing

### Unit Tests

```bash
npm run test:unit            # Vitest
npm run test:unit:coverage   # With coverage (run in CI)
```

Vitest has two projects (`vite.config.ts`):

- `client` — `*.svelte.test.ts` / `*.svelte.spec.ts`, run in headless Chromium (component and rune tests)
- `server` — all other `*.test.ts` / `*.spec.ts`, run in Node

Place unit tests next to the code they test. Add them for new server logic, stores and non-trivial components. Every test must assert (`requireAssertions`); use `src/lib/test-utils/mock-logger.ts` when testing server code that logs. The client project needs the Playwright Chromium browser.

### E2E Tests

```bash
npm run test:e2e             # Builds with .env.test, then runs Playwright
```

Plain `playwright test` serves a stale build. The E2E setup starts PostgreSQL and Garage via testcontainers (requires Docker) plus mock OIDC and mock Trino servers (`e2e/support/`).

- **Mandatory**: every new page, UI feature or API endpoint needs E2E tests before the work is complete — user flows (navigation, forms, filters) and API endpoints (status codes, response structure).
- Run the E2E tests after UI, route, layout or form changes, and before committing UI changes.
- Import `test` and `expect` from `e2e/support/fixtures.ts`, not `@playwright/test`. Its worker-scoped fixture logs each worker in via the mock OIDC server as its own user, so parallel workers never share server-side state. Opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.

```typescript
import { test, expect } from './support/fixtures.js';

test('example test', async ({ page }) => {
  await page.goto('/some-page');
  await expect(page.locator('h1')).toContainText('Expected Title');
});
```

## Documentation

When changing behaviour that is documented, update the related docs too: `README.md` (configuration, feature flags), `docs/`, `.env.example` and the Helm chart values.

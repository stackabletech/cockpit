# Instructions for Claude

## Project Overview

This is the **Stackable Unified Data Platform UI** - a SvelteKit application that serves as the first module of a unified platform UI for Stackable's data infrastructure. The initial module is a **Trino SQL query editor** with SSO, authorisation, and catalogue browsing.

The application is designed with a **plugin/module architecture** so future Stackable services (trino-lb queue management, etc.) can be integrated as additional modules.

## Tech Stack

- **SvelteKit** with **Svelte 5** - Always use Svelte 5 syntax with runes (`$props`, `$state`, `$derived`, etc.)
- **Tailwind CSS v4** - No tailwind.config.js file (uses CSS-based configuration)
- **DaisyUI** - Use DaisyUI components/classes where possible for consistent UI - This is DaisyUI v5! A lot of classes you know about DON'T EXIST anymore. Check <https://daisyui.com/docs/upgrade/?lang=enj> if needed
- **Monaco Editor** - SQL editor component (dynamic import, SSR-safe)
- **ANTLR4** (antlr4ng) - Trino SQL parsing for syntax highlighting and code completion
- **zod & superforms** - All forms are to use zod & superforms
- **Generic OIDC** (openid-client) - Authentication via any OIDC provider
- **OPA** - Authorisation / feature visibility
- **prom-client** - Prometheus metrics, exposed at `/metrics`

## Project Structure

This is a **single SvelteKit application** (not a monorepo).

```text
├── src/
│   ├── lib/              # Shared utilities, components, stores
│   ├── routes/           # SvelteKit routes
│   │   └── (app)/        # Authenticated app routes
│   ├── app.css           # Global styles (Tailwind + DaisyUI)
│   ├── app.d.ts          # Type declarations
│   ├── app.html          # HTML template
│   └── hooks.server.ts   # Server hooks (auth middleware)
├── e2e/                  # Playwright E2E tests
├── static/               # Static assets
├── docker/Dockerfile     # Production container image
├── CLAUDE.md             # AI assistant instructions
└── TECH_DEBT.md          # Known tech debt and deferred security concerns
```

## Tech Debt

When introducing shortcuts, known issues, or deferred security work, add an entry to `TECH_DEBT.md`. Keep entries concise: what the issue is, why it is acceptable now, and what the correct long-term fix is.

## Development Guidelines

### Browser Compatibility

- The application must work in both **Firefox** and **Chromium-based browsers** (Chrome, Edge).
- Do not use browser-specific features or CSS without verifying cross-browser support.
- E2E tests run on both Firefox and Chromium (desktop) plus a mobile Chromium viewport.

### CSS & Styling

- **All UI must work in both light and dark mode automatically.** Never use hard-coded colours (e.g., `text-gray-700`, `bg-white`, `border-slate-200`). Always use DaisyUI semantic colour classes (`text-base-content`, `bg-base-100`, `bg-base-200`, `border-base-300`, `text-primary`, `bg-error`, etc.) and Tailwind opacity modifiers on those classes (`text-base-content/60`, `bg-primary/10`) so that colours adapt to the active theme.
- **All pages and components must be mobile-friendly.** Use responsive Tailwind breakpoints (`sm:`, `md:`, `lg:`) and test layouts at mobile viewport widths. Navigation must be accessible on small screens.
- Use Tailwind v4 `@source` directive for component CSS scanning

### Accessibility (BITV 2.0)

The application must comply with **BITV 2.0** (German accessibility regulation, based on WCAG 2.1 AA). Key requirements:

- **Semantic HTML**: Use correct elements (`<nav>`, `<main>`, `<header>`, `<button>`, `<a>`, headings in order). Never use `<div>` or `<span>` for interactive elements.
- **Keyboard navigation**: All interactive elements must be reachable and operable via keyboard. Visible focus indicators are required.
- **ARIA attributes**: Use `aria-label`, `aria-current`, `aria-disabled`, `aria-expanded`, `role` where semantic HTML is insufficient. Do not use ARIA to fix what semantic HTML can handle.
- **Colour contrast**: Text must meet WCAG AA contrast ratios (4.5:1 normal text, 3:1 large text). Never convey information through colour alone.
- **Form labels**: Every form control must have a visible, associated `<label>` (see label-element association rule below).
- **Alt text**: Every `<img>` must have a meaningful `alt` attribute (or `alt=""` for decorative images).
- **Language**: The `<html>` element must have a `lang` attribute. Use `lang` attributes on content in other languages.
- **Screen reader support**: Ensure content is announced correctly. Hide decorative elements with `aria-hidden="true"`.

### Logging

The project uses **pino** for structured JSON logging (server-side only).

**Two usage patterns:**

1. **Request-scoped** (in `+page.server.ts`, `+server.ts`, hooks) — use the logger from `event.locals`:

   ```typescript
   const log = event.locals.logger;
   log.info({ catalog_name: name }, 'Loading catalogue');
   ```

2. **Module-level** (singletons, services) — create a child logger:

   ```typescript
   import { logger } from '$lib/server/logging';
   const log = logger.child({ module: 'trino-client' });
   log.info({ trino_url: url }, 'Connecting to Trino');
   ```

**Log level guidance:**

- `trace` — request lifecycle noise and highly detailed diagnostics (for example request start/completion for successful requests)
- `debug` — verbose operational detail (cache hits, query plans, non-request-flow diagnostics)
- `info` — significant business events (user login, query executed, service discovered)
- `warn` — recoverable problems needing attention (deprecated config, retry succeeded)
- `error` — failures requiring investigation (unhandled exceptions, external service down)

**Conventions:**

- Context object first, message string second: `log.info({ user_id }, 'User logged in')`
- Use snake_case field names for queryability: `request_id`, `user_id`, `module`, `duration_ms`, `status_code`, `path`, `method`
- Never log tokens, credentials, or full request/session objects directly — add redaction paths to `src/lib/server/logging/redaction.ts`

### Monaco Editor

- Always use **dynamic imports** to avoid SSR issues (`import('monaco-editor')`)
- The editor must be loaded client-side only
- Use the custom `trinosql` language registration for Trino SQL support

### Updating the Trino SQL Grammar (ANTLR)

The grammar lives at `src/lib/editor/grammar/SqlBase.g4`. The authoritative source is the main Trino repository:

```text
core/trino-grammar/src/main/antlr4/io/trino/grammar/sql/SqlBase.g4
```

Fetch the latest version with:

```bash
gh api "repos/trinodb/trino/contents/core/trino-grammar/src/main/antlr4/io/trino/grammar/sql/SqlBase.g4" \
  --jq '.download_url' | xargs curl -s -o src/lib/editor/grammar/SqlBase.g4
```

Then regenerate the TypeScript lexer/parser:

```bash
npm run generate:antlr
```

After regeneration, compare the new token list against `src/lib/editor/tokenMap.ts`. Any token present in `SqlBaseLexer.ts` but missing from `tokenMap.ts` will fall back to `'identifier'` scope (no colour). Add missing tokens with an appropriate scope (`'keyword'`, `'delimiter'`, `'string'`, etc.).

### Metrics

The app exposes a Prometheus scrape endpoint at `/metrics` via `src/routes/metrics/+server.ts`. HTTP request duration is tracked automatically for all routes in `hooks.server.ts`.

- **Adding custom metrics**: Define new counters, histograms, or gauges in `src/lib/server/metrics.ts` and import them in the relevant server-side code (e.g. track query execution counts, Trino errors, cache hits)
- **Server-only**: Never import from `src/lib/server/metrics.ts` in client-side code or `.svelte` files
- **When to add metrics**: New API endpoints, background operations, external service calls, and any operation where latency or error rates are operationally significant

### Code Style & Best Practices

- Use spaces not tabs
- Run npm run format
- Use British English
- For the server side only: Always include logging at debug and info levels as appropriate
- **Redirects**: Never wrap `throw redirect()` in try-catch. Put redirect AFTER try-catch to avoid it being caught.

  ```typescript
  try {
    await operation();
  } catch (err) {
    return fail(500, { error: 'Failed' });
  }
  throw redirect(303, '/path'); // Outside try-catch
  ```

- **Public Routes**: Update `hooks.server.ts` when adding unauthenticated pages. The `/metrics` endpoint is permanently public (Prometheus scraping) — never add auth in front of it.
- **Label-Element Association**: Always explicitly associate `<label>` elements with their form controls using `for` and `id` attributes. Generate unique IDs with `$props.id()` (see <https://svelte.dev/docs/svelte/$props#$props.id()>). Never rely on implicit association (wrapping the input inside the label).

  ```svelte
  <script>
    const uid = $props.id();
  </script>

  <label for="{uid}-name" class="label">Name</label>
  <input id="{uid}-name" class="input" />
  ```

- **Modals**: Always use a shared `Modal` component. Never use raw `<dialog>` elements directly. Control modals with a boolean `$state` and `bind:open`.
- **Date/Time Pickers**: Always use a shared `DateTimePicker` component. Never use native `<input type="date">` or `<input type="datetime-local">` elements.

### Internationalisation (i18n)

The application uses **Paraglide-JS v2** for type-safe, compiler-based internationalisation. English is the default/fallback locale; German is also supported.

- **Message files**: All user-visible strings go in `messages/en.json` and `messages/de.json`. Both files must always have the same keys.
- **Import pattern**: `import * as m from '$lib/paraglide/messages.js'` — then use `m.key_name()` in templates and script blocks.
- **Key naming**: Use flat keys with a feature prefix and underscores, e.g. `dashboard_welcome`, `nav_dashboard`, `header_user_menu`.
- **Reactivity**: Data structures containing translated strings (e.g. nav sections, page title maps) must use `$derived` so they update when the locale changes.
- **No hardcoded strings**: Never hardcode user-visible strings in `.svelte` files. This includes text content, `aria-label`, `title`, `placeholder`, and `alt` attributes.
- **Adding new strings**: Add the key to both `messages/en.json` and `messages/de.json`, then run `npx @inlang/paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` to regenerate typed message functions.

## Commands

### Node.js Version

The required Node.js version is pinned in `.node-version`. Use `nvm` to install and activate it before running any `npm` commands — `npm` will hard-fail with engine errors otherwise (`.npmrc` sets `engine-strict=true`).

```bash
nvm install   # installs the version from .node-version
nvm use       # activates it in the current shell
```

### Local Setup

For a pre-configured local dev environment using OIDC, deploy & configure Keycloak and Trino on a kind cluster:

```bash
./dev/setup.sh           # Creates and configures Keycloak. Deploys Trino with OIDC authentication. Writes to .env.development which is used by dev server.
```

### Development

```bash
npm run dev              # Start dev server
```

### Building

```bash
npm run build            # Build for production
npm run preview          # Preview production build
```

### Quality Checks (run after major changes)

```bash
npm run format               # Format code
pre-commit run --all-files   # Run all checks: lint (prettier + eslint), type checking,
                             # markdownlint, yamllint, shellcheck, actionlint, hadolint, helm lint
```

### E2E Testing

```bash
npm run test:e2e         # Run all E2E tests
```

## E2E Testing Guidelines

E2E tests use **Playwright** and are located in `e2e/`.

### When to Add Tests

- **MANDATORY**: Always add E2E tests when creating new pages, UI features, or API endpoints. This is not optional - every frontend-visible feature must have corresponding E2E tests before the work is considered complete.
- **Always** add tests for user flows (navigation, form submissions, filters)
- **Always** add tests for API endpoints (status codes, response structure)
- **Always** run `npm run test:e2e` after making UI changes to ensure nothing broke

### When to Run Tests

- Before committing UI changes
- After modifying routes, layouts, or navigation
- After changing form behaviour or validation
- As part of quality checks before pushing

### Writing Tests

```typescript
import { test, expect } from '@playwright/test';

test('example test', async ({ page }) => {
  await page.goto('/some-page');
  await expect(page.locator('h1')).toContainText('Expected Title');
});
```

### Authentication

Tests use a saved session from `e2e/.auth/user.json`. If tests fail with auth errors, run the auth setup to re-authenticate via OIDC.

## Important Notes

- **Environment**: The app needs a `.env` file for proper env var access
- **SSR Safety**: Monaco Editor and ANTLR must be dynamically imported to avoid SSR issues
- **Service Discovery**: The app can auto-discover Trino instances via K8s API or use static configuration

For documentation tasks, always update both the primary document AND any related README files that reference it.

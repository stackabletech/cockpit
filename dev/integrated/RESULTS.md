# Trino iframe spike — results log

Living record for the measurement spike defined in `iframe-spike.md` §5.1, adapted to Trino.
Approach and plan: `~/.claude/plans/read-iframe-spike-md-come-up-witty-horizon.md`.

## Environment

- kind cluster from `dev/integrated/kind-config.yaml` (apiserver pinned `6443`, `80/443` mapped).
- Baseline via `dev/setup.sh --skip-garage`: Stackable operators (commons, listener, secret,
  trino), Keycloak (realm `stackable`, users alice/bob), Trino `477-stackable0.0.0-dev`.
- Trino NodePort endpoint during Phase 0: `https://172.19.0.2:32625` (self-signed).

## Phase 0 — framing go/no-go (2026-08-10)

Probed the Trino coordinator Web UI **unauthenticated** over the NodePort:

| Endpoint | Result |
|---|---|
| `/v1/info` | `477-stackable0.0.0-dev`, reachable |
| `/ui/` | `HTTP 303` → IdP authorize endpoint; **no `X-Frame-Options`, no CSP** |
| `/ui/login.html` | `HTTP 303` → IdP authorize; no framing headers |
| `/` | `HTTP 303` → `/ui/` |

**Findings**

1. **Framing is NOT header-blocked.** Trino 477's Web UI emits neither `X-Frame-Options` nor
   `Content-Security-Policy: frame-ancestors` on the probed surfaces. → No Trino-side header
   patch is needed merely to embed it. (Confirm the *authenticated* HTML app once we have a Dex
   session — same Airlift server, expected to be header-free too.)
2. **Escape-hatch case is real and observed.** Unauthenticated `/ui/` `303`-redirects to the
   OIDC authorize endpoint. Per `iframe-spike.md` §4.3 the redirect itself is XFO-safe; the
   in-frame failure only occurs when the IdP has no same-site session and must *render* a login
   document. Today (direct Keycloak, cross-site) that would break in-frame → validates the need
   for the Dex broker (Layer 1). On session expiry with the frame open, expect: silent if the
   Dex session is live; otherwise a rendered IdP page that XFO-blocks → needs the §4.7
   interstitial (documented, not built in this PoC).
3. **OAuth2 callback path = `/oauth2/callback`** (client_id `trino`, scope `openid profile
   email`). This is the exact redirect URI to register for the `trino` client in Dex.
4. Trino issues `__Secure-` cookies → HTTPS end-to-end required (satisfied by a re-encrypting
   ingress).

**Verdict: GO** for the framing build. Remaining framing risk is router/history/deep-link
behaviour of the authenticated React UI (measured in Phase 3) and the escape hatch (documented).

## ⚠ Load-bearing finding: Dex has no auth session (revises §4.3/§4.5)

`iframe-spike.md` §4.3/§4.5 assume Dex holds a same-site browser session (`dex_session`) so a
product's in-frame re-auth is satisfied by Dex (first-party cookie in the frame) and never touches
the cross-site IdP. **This is not true for the shipped Dex (v2.45.1).** dexidp/dex issue #4560
("Implement Auth Sessions") is still *open*; Dex has no SSO session/cookie and re-delegates to the
connector (Keycloak) on every authorize. Confirmed empirically: expiring only Keycloak's session
bricked the in-frame re-auth (§4.7 test), i.e. the silent path depended on Keycloak's cross-site
`SameSite=None` cookies, not on Dex.

Consequence: the same-site-session benefit §4.3 rests on is **not delivered by Dex today**. Silent
in-frame re-auth currently depends on the upstream IdP's session + `SameSite=None` cookies — the
cross-site dependency §4.3 wanted to avoid, and one a real corporate IdP (Entra, step-up/MFA) may
not honour in a frame. Options: (a) the §4.6 lifetime invariant + a Cockpit top-level heartbeat so
expiry surfaces full-page before the frame bricks (product-agnostic, implementable now); (b) an edge
same-site session layer (oauth2-proxy — but that's model B, §4.4); (c) wait for Dex #4560. This
should be fed back into §4.3/§4.5.

## Layer 1 — brokered foundation (2026-08-10)

Standing up the same-site + real-TLS foundation in `dev/integrated/` (reproducible via `up.sh`).

**Working and verified server-side (no browser needed):**

- ingress-nginx v1.15.1 (kind provider) terminating TLS on `:443` for all hosts.
- TLS: openssl fallback CA + wildcard cert for `*.sdp.test` / `*.corp.test` (`tls.sh`; mkcert
  path for browser trust is the host step below). CA also imported as SecretClass `sdp-oidc-ca`.
- CoreDNS rewrites so pods resolve the public hostnames to the ingress (`coredns-rewrite.sh`).
- Keycloak = customer IdP at `https://idp.corp.test`, stable issuer via `KC_HOSTNAME`
  (`keycloak-patch.yaml`); realm `stackable` + `dex` client + users alice/bob
  (`keycloak-config.sh`). NB: dev Keycloak uses an in-memory DB — re-run the config after any
  restart.
- Dex v2.45.1 broker at `https://dex.sdp.test`, federating to Keycloak. `/auth/keycloak`
  302s to `idp.corp.test` → CoreDNS + CA trust path proven.
- Trino repointed off Keycloak-direct onto Dex (`trino-oidc-dex.yaml`). `/ui/` via the ingress
  303s to `https://dex.sdp.test/auth?...redirect_uri=https://trino.sdp.test/oauth2/callback&client_id=trino`.

**Gotchas hit (recorded so they aren't re-hit):**

1. Operator **rejects `tls.verification.none`** for OIDC ("trino does not support unverified TLS
   connections to OIDC"). Fix: verify against a SecretClass whose CA signed the ingress cert
   (imported our CA into `sdp-oidc-ca-keypair` as `0.ca.crt`/`0.ca.key`).
2. **Issuer must match exactly.** Operator normalises `rootPath` and always renders
   `https://dex.sdp.test/` (trailing slash) — can't strip it Trino-side; fixed by setting Dex's
   `issuer` to the trailing-slash form (Dex still builds clean single-slash endpoints).
3. `rollout restart` does **not** re-render operator config; a TrinoCluster spec change (or
   AuthenticationClass change) is needed to trigger reconcile.
4. `http-server.process-forwarded=true` makes Trino build the external `trino.sdp.test`
   redirect_uri behind the re-encrypting ingress.

**Still requires the host (browser verification):**

- `/etc/hosts`: `127.0.0.1 cockpit.sdp.test dex.sdp.test trino.sdp.test idp.corp.test`
- Browser-trusted TLS: install `mkcert` (+`libnss3-tools`), re-run `tls.sh`.
- Then `npm run dev` and log in at `https://cockpit.sdp.test`.

## Layer 2 — the iframe spike (2026-08-10)

Single, revertable diff on top of Layer 1 (the diff size *is* the measurement):

- `src/routes/(app)/trino-console/+page.svelte` — full-height `<iframe>` of
  `PUBLIC_STACKABLE_COCKPIT_TRINO_UI_URL` (= `https://trino.sdp.test/ui/`).
- Nav item (gated on the URL being set) in `nav-items.ts`; page title in `(app)/+layout.svelte`;
  i18n keys in `messages/en|de.json`; e2e spec `e2e/trino/trino-console.spec.ts`.
- `vite.config.ts`: integrated-mode HTTPS + host binding + HMR (see below).

`npm run check`: 0 errors. **No Trino source patch and no ingress header override were needed**
for the browser to frame Trino — it emits no `X-Frame-Options`/CSP (Phase 0). So the Trino-side
framing cost is **0 LOC**; the entire Layer 2 diff is Cockpit code we own. (Optional hardening:
a `frame-ancestors https://cockpit.sdp.test` CSP via an ingress snippet — requires enabling
`allow-snippet-annotations` on ingress-nginx v1.15; not required for the PoC.)

### Cockpit-behind-ingress gotcha (cost us the most time)

better-auth's `isAuthPath` compares the request **origin** (scheme+host) to its `baseURL`
(`https://cockpit.sdp.test`). SvelteKit's dev server ignores `X-Forwarded-Proto`, so with the
ingress terminating TLS and forwarding HTTP, SvelteKit saw `http://cockpit.sdp.test` → every
`/api/auth/*` route 404'd. Fix (no auth-logic patch): make Vite serve **HTTPS end-to-end**
(`server.https` from the wildcard cert, gated on `STACKABLE_COCKPIT_INTEGRATED_HOST`, read via
`loadEnv` since Vite doesn't put `.env` into `process.env` at config time) and re-encrypt at the
cockpit ingress. Verified: `POST /api/auth/sign-in/oauth2` → 200 with a Dex authorize URL.

Second gotcha: the OIDC **callback** 502'd — `upstream sent too big header` — because better-auth's
callback response carries several large `Set-Cookie` headers (session + OAuth state/PKCE) that
overflow nginx's default proxy header buffer. Fix: `proxy-buffer-size: 32k` (+`proxy-buffers-number`)
on the cockpit ingress. Callback then returns 302 instead of 502.

## Phase 3 — measurements

### Headline result (2026-08-10, Firefox)

**Trino frames cleanly.** After logging into Cockpit (Dex session established), opening the
**Trino Console** page renders the Trino Web UI **inside the iframe** — the in-frame OIDC redirect
chain (Trino → Dex → Keycloak) completed **silently** (no login prompt rendered in the frame, no
`X-Frame-Options` block). Confirms the §4.5 silent-SSO payoff *and* that same-site subdomains make
in-frame re-auth work for the happy path.

**Cost measured:** Trino-side change = **0 LOC** (no source patch, no ingress header override —
Trino emits no XFO/CSP). Entire spike diff is Cockpit code we own + `dev/integrated/` infra.

### Still to measure (browser interaction)

- deep-link to a query detail, then **refresh** inside the frame; **back** button after ≥3 levels;
  **copy the frame URL into a new tab**.
- **Session expiry with the frame open** — the §4.7 escape hatch. Test rig: `short-sessions.sh`
  shortens the Keycloak SSO session (idle 60s). Then delete Trino's `__Secure-Trino-*` cookie and
  reload the frame to force an in-frame re-auth after the upstream has lapsed.
  - _Config lesson:_ `web-ui.session-timeout` (the obvious "make Trino re-auth" knob) is
    **form-auth only**; Trino hard-fails startup on it under oauth2 (`Configuration property
    'web-ui.session-timeout' was not used`). Under oauth2 the UI session is token-bounded.
  - _Confirmed live (Firefox, 2026-08-10):_ with the upstream session expired, forcing an in-frame
    re-auth makes Trino 302 to Dex→Keycloak inside the frame, and **Firefox refuses to render
    `idp.corp.test`** (Keycloak's `X-Frame-Options: SAMEORIGIN`) → the frame breaks. So the §4.7
    top-level escape hatch is **required** and is a genuine gap for Trino: it 302s to the IdP
    in-frame rather than signalling the parent to re-auth at top level. Mitigations, in order:
    (a) keep the Dex session alive so re-auth stays same-site/silent (the §4.6 lifetime invariant +
    a Cockpit heartbeat); (b) a generic interstitial/`postMessage` escape hatch — not per-product,
    but Trino needs *something* (today it has nothing). The happy path (Dex session valid) re-auths
    silently in-frame, as seen when the Trino Console first rendered.
- CSV/result **download**; Trino UI **open-in-new-tab** actions; **dropdowns/modals** near the frame edge.
  - _Observed:_ both the **worker** link *and* clicking a **query** on the overview open a **new
    tab** onto the raw `trino.sdp.test` UI (escape-hatch leak, §5 point 2). These are the Trino Web
    UI's *primary* drill-downs — so framing gives you the overview/query-list, but every meaningful
    navigation pops out of the frame, unbranded. This is the decisive integration limit for Trino:
    the app *frames* for free (0 patches to render), but *feels* integrated only at the surface.
  - **Resolved:** they are plain **`<a target="_blank">` anchors**, confirmed in the Trino 477
    source (`webapp/src/components/QueryList.jsx:185` `query.html`, and `stage.html`/`plan.html`/
    `references.html`; `WorkerList.jsx:97` `worker.html`) — **not** `window.open`. So the leaks are
    fixable by a **proxy-injected script** (§4.9 level 3: strip `target`/`<base target="_self">` or
    intercept clicks) — no Trino source patch, and stable because it keys on a generic DOM pattern,
    not Trino's URL grammar.

### Spike conclusion for Trino

The two concerns §5 defers full-app framing over, evaluated against Trino 477:

1. **Router/history sync (§5.1)** — *does not apply.* Trino's Web UI is not a history-routed SPA;
   each view is a separate page (`query.html?<id>`, `stage.html`, `worker.html`). Nothing to sync
   to the parent; deep-links are just normal URLs. (This is Trino-specific — Superset/NiFi differ.)
2. **Escape-hatch leaks (§5.2)** — real (query/worker drill-downs are `target="_blank"`), but
   class-3 fixable via one injected script, not a class-2 frontend patch.

**Measured cost to frame Trino:** render = **0 patches**; make it *feel* integrated (keep
drill-downs in-frame) = **1 proxy-injected script we own**, URL-structure-independent → near-zero
rebase churn. This is well inside any reasonable §5.1 acceptance threshold. For Trino specifically,
the §3 minimal-patch objection to framing is **not** load-bearing — reconsider the §5 deferral for
this product. (Still verify the escape-hatch/session-expiry case and the Superset/NiFi multiplier
before generalising.)

**In-frame `target="_blank"` fix demonstrated (item 1):** `dev/integrated/trino-chrome-proxy.yaml`
— a stock-nginx proxy in front of the coordinator injects a `<script>` via `sub_filter` that
strips `target="_blank"` (MutationObserver + click-capture, for the React-rendered DOM). Drill-downs
now navigate in-frame. Auth path intact (`/ui/` still 303s to Dex, redirect_uri preserved).

_UX note (observed → fixed):_ in-frame navigation showed a brief **white flash** on each drill-down.
Cause: Trino's Web UI is multi-page (each view a full document load) *and* hardcoded-dark, so on
every navigation the browser paints a default **white** document for an instant before Trino's dark
CSS applies (a FOUC). Only noticeable in Cockpit **dark** mode (white against dark chrome; against
light chrome it blends). Fix, made **theme-conditional**: Cockpit publishes its current theme to the
Trino subdomain via a cookie on the shared parent domain (`cockpit_theme` on `sdp.test`, readable
cross-subdomain because same-site) plus a `postMessage` for live toggles; the injected script reads
it and sets `html{background:#1b1b1b}` **only when Cockpit is dark** (light mode untouched). NB:
injecting `color-scheme: dark` was wrong — it shifts UA-rendered controls and made Trino look off;
use a plain background. The full reload itself is inherent (not an SPA) and not removed. Neat detail:
this reuses the same-site property the whole design rests on (§4.1/§4.3) to pass the theme across
origins.

### Theme sync (Cockpit ⇄ Trino) — feasibility

Trino's Web UI (477) is **Bootstrap 3.4.1 + a hardcoded-dark `assets/trino.css`** — no `data-bs-theme`,
no `prefers-color-scheme`, no light/dark toggle. So it **cannot cheaply follow Cockpit's light/dark
toggle**: it's statically dark, which already matches Cockpit dark; matching Cockpit *light* would
require injecting a full light restyle that overrides `trino.css` (many rules, re-done per release) —
a §4.9 re-theme, not a one-liner. Conclusion: leave Trino dark; a proper SDP theme (dark, on-brand)
injected via the chrome proxy is the real §4.9 branding task, but a *light* variant is out of scope.
- Browser matrix: Firefox ✓, Chromium _todo_ (Safari not testable on this Linux host).
- **Churn:** swap the `TrinoCluster` image to 476 and a newer 47x; re-check framing + the ingress
  config. Expected near-zero since the Trino-side cost is already 0.

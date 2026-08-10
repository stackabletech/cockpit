# Cockpit: integrated SDP product UIs — design context

**Status:** design notes, pre-implementation
**Revision:** 2, 2026-08-10
**Repo:** `stackabletech/stackable-cockpit`

## How to use this document

Context, not a specification. It records decisions, the reasoning behind them, and —
importantly — options considered and rejected, so they don't get re-proposed. Sections
marked **VERIFY** contain claims about third-party software that were not confirmed
against the versions we ship; check them before relying on them.

---

## 1. Goal

Present the Stackable Data Platform (SDP) as a single integrated platform rather than a
collection of separately deployed tools. One URL, one login, consistent chrome across
product UIs (Apache Trino, Apache Superset, Apache Airflow, Apache NiFi, and others).
This is a UX goal and a product/branding goal; the branding half is a first-class
requirement.

## 2. Deployment context

- Cockpit runs in the same Kubernetes cluster as the SDP products.
- Customers deploy on AWS, Azure, and a substantial amount on-prem.
- We know little about how customers expose services (domains, ingress, TLS).
- We know little about customers' OIDC providers: Keycloak, Entra, or homegrown.
- We build product images from source and can patch at OCI build time.
- We have full control of Cockpit and Dex configuration, and large influence over
  product configuration via the operators.

## 3. Governing constraint — minimal patches

**Keep source patches to product images as close to zero as possible.** This constraint
outranks architectural elegance and decides several open questions below. Where two
designs are otherwise comparable, prefer the one that moves complexity into our own
operators (Rust, our repos, our release cadence, no rebase risk) rather than into
product forks.

Patch classes, worst to least bad:

1. **Auth logic** — fails silently, can ship an auth bypass, re-validated every bump.
   Avoid entirely.
2. **Routing / history / base path** — patches the area upstream refactors most often;
   conflicts on most releases.
3. **Cosmetic** — rebases cleanly, fails visibly and harmlessly.

Prefer, in order: product configuration → upstream extension points (supported APIs,
e.g. Superset's `superset_config.py` and custom security manager, Airflow's plugin
interface) → proxy-injected chrome → source patch → upstream contribution to remove the
need for the patch.

---

## 4. Decisions

### 4.1 Hostname layout — DECIDED

One hostname pattern for the platform, e.g. `*.sdp.<customer-domain>`, with per-product
subdomains (`trino-prod.sdp.example`, `superset.sdp.example`), Cockpit and Dex at fixed
names under the same parent.

Subdomains over path-based routing (`cockpit.example/p/trino/...`) because:

- Path mounting requires every product to tolerate a base path — URL-rewriting patches
  across ~10 products and every release. See the Apache Knox precedent in section 9.
- Cookie collisions: multiple Jetty-based products set `JSESSIONID` at path `/` on one
  origin and clobber each other.
- No origin isolation — XSS in any product reaches the Cockpit session and all others.

Subdomains share a registrable domain, so they are **same-site**. This matters for more
than cookies-in-frames; see 4.3.

### 4.2 Ingress — DECIDED

Routing, TLS, and header hygiene only. No auth logic at this layer.

Prefer operator-generated `Ingress` resources against the cluster's existing ingress
controller. Do **not** ship a dedicated nginx unless a concrete requirement appears that
the ingress controller cannot meet.

### 4.3 Identity: Dex as broker — DECIDED, behind a feature flag

Dex (Apache-2.0) runs in-cluster between the products and the customer's IdP. Products
are OIDC clients of Dex; Dex federates to whatever the customer runs.

**Flag semantics — platform-level, not per-product:**

- **Flag on:** Dex is deployed. Products point at Dex. Integrated experience.
- **Flag off:** Dex is not deployed. Products are configured against the customer's
  OIDC provider directly — current SDP behaviour, already supported, unchanged.

Dex is a **hard dependency of the feature**, not an optional component of it. Earlier
drafts said Dex should be optional; that was wrong and is superseded. Do not reintroduce
a "reduced" mode that keeps the integrated experience without Dex.

Do **not** make the flag per-product. Mixing brokered and direct products gives users
two session domains and two login prompts, and a shared top bar linking to products that
prompt again — worse than either mode. Products not yet integrated simply sit outside
the integrated set; that is a roadmap fact, not a customer-facing switch.

**Why the broker is structurally necessary — do not re-litigate:**

1. **Same-site session.** `dex.sdp.example` is same-site with the product subdomains, so
   `dex_session` is a first-party cookie in those contexts. A corporate IdP on its own
   domain is cross-site: its session cookie is blocked by default in Safari and Firefox,
   so the IdP cannot see the session, falls back to rendering a login page, and that
   page is then blocked by `X-Frame-Options`. Note the mechanism precisely — a 302
   renders nothing and is never blocked by XFO; it is the *cookie* block that forces the
   IdP to render a document in the first place. Nothing hosted on the customer's IdP
   domain can have the same-site property. This applies to silent re-auth generally, not
   only to iframes.
2. **Client provisioning.** Every stacklet is a new OIDC client with a new redirect URI.
   Direct-to-IdP means the customer's IAM team registers a client per stacklet — a
   ticket queue in most enterprises, which kills self-service deployment. Wildcard
   redirect URIs are refused by most IdPs and are a real security hole; a single fixed
   callback dispatching per product is a broker, i.e. Dex rebuilt badly. **This reason
   holds even if we never embed anything.**

**Answer to the predictable security-review objection:** Dex holds no user store and
performs no primary authentication. It delegates to the customer's IdP and translates
the response. It runs inside their cluster; no user data or audit trail leaves their
network. It is a broker, not a second identity provider. The substantive part of the
concern is the revocation window (see 4.6), answered with a short absolute lifetime.

**Caveats:**

- Per-stacklet Dex client provisioning must be templated by the operators, with a Dex
  config reload. **VERIFY** current Dex support for dynamic/managed client registration.
- Dex is authentication only. Group and role claim mapping from the upstream connector
  must be plumbed through to products and OPA rules; behaviour varies by connector type.

### 4.4 Identity model: per-product OIDC (model A) — DECIDED

Two coherent models were compared:

| | **A — per-product OIDC** (chosen) | **B — edge proxy + asserted JWT** |
|---|---|---|
| Shape | Each product is its own OIDC client of Dex | Single oauth2-proxy authenticates once, injects a Dex-signed JWT; products verify it |
| Sessions | Cockpit + Dex + N product sessions | Cockpit + oauth2-proxy + Dex |
| Dex clients | One per stacklet | One total |
| Patches | None — products already do OIDC; only the issuer and secret change | Per product: accept externally asserted identity. Trino native; Superset needs a custom security manager; some need auth patches |
| Complexity lives in | Our operators | Product forks |

**A is chosen because of section 3.** B is genuinely more elegant — it collapses the
session-lifetime problem, removes per-stacklet client provisioning, and reduces the
escape hatch to one piece of proxy config. It is also what Kubeflow does (section 9).
But it pays in the worst patch class, and under a minimal-patch constraint that decides
it. Reconsider only if the constraint changes.

**Do not build a hybrid.** Mixing A and B gives both sets of problems and a support
matrix nobody can reason about.

**oauth2-proxy still has a role in model A:** as an outer gate in front of products with
no usable OIDC support (several Hadoop-family UIs), guaranteeing no unauthenticated
request reaches a pod. Contained exception, not the general pattern.

### 4.5 Session reuse across products — DECIDED

Dex holds a browser session. Cockpit's top-level login establishes it. Every subsequent
product login is a silent redirect round trip (product → Dex → product) with no user
interaction. Ordinary SSO; no custom code.

**VERIFY:** Dex session management is opt-in via `SessionConfig` — cookie name (default
`dex_session`), absolute lifetime, idle timeout, optional AES-GCM cookie encryption.
Related features (`prompt=none`, `prompt=login`, `id_token_hint`) have been landing
incrementally; see `dexidp/dex` issue #4560. Confirm what exists in the version we ship.

**Do not** implement token relay — Cockpit acquiring a token and passing it to products.
It needs token exchange or audience juggling, puts Cockpit in the token-brokering
business, and defeats audience validation.

### 4.6 Session lifetime invariant — DECIDED

```
cockpit_session  <  dex_idle_timeout
cockpit_session  <=  product_session  <  dex_absolute_lifetime
```

Consequences:

- Cockpit's session is the shortest clock, so expiry always surfaces at the top level,
  where a redirect to the corporate IdP can actually render.
- Cockpit renewing its own session is an authorization request to Dex, which resets
  Dex's idle timer. Cockpit is therefore the keepalive preventing the Dex session going
  idle while the user is active elsewhere. Without this, a user can work for hours
  without anything redirecting to Dex, and the Dex session lapses while the user is
  demonstrably active.
- Dex outliving the products means a lapsed product session renews silently.
- Dex's absolute lifetime bounds the revocation window (access removed upstream, but Dex
  keeps issuing until its clock runs out). Keep it short enough to defend in review.

**Implementation requirements:**

1. **Generate, don't document.** Expose one platform-level session lifetime; operators
   derive Dex config and each product's session setting from it. Clamp or reject
   customer overrides that would invert the ordering. This invariant is invisible when
   violated — nothing fails at deploy time; you get an intermittent failure at one
   customer months later.
2. **Cockpit needs a session heartbeat.** Cockpit's web UI is a SolidJS SPA; session
   expiry appears as a 401 on an API call, not as a navigation. Poll and redirect at top
   level on failure. The "Cockpit fails first" guarantee is theoretical without this.
3. **Audit what a session means per product.** Products validating a token per request
   inherit Dex's clock automatically. Products minting their own server-side session
   cookie after the OIDC handshake (Flask-based ones especially) run an independent clock
   that outlives the token unless explicitly capped. Do this inventory before tuning
   numbers — it determines which products are actually in scope.

### 4.7 Top-level escape hatch — DECIDED

Lifetime alignment cannot cover: revocation upstream, Conditional Access step-up (e.g.
Entra demanding MFA mid-session), browser restore (cookie persistence differs per app),
and transient failures during silent re-auth.

Required behaviour: **never 302 to the IdP inside a frame.** Products return 401 for
XHR, or a small interstitial for navigations, which `postMessage`s the parent. Cockpit
re-authenticates at top level.

One generic mechanism covers all cases. It must exist and fail gracefully; it does not
need to be per-product.

### 4.8 Identity continuity when the flag flips — OPEN RISK

**Flipping the flag is a migration, not a config toggle.**

Dex constructs its own `sub`, encoding the connector and upstream subject rather than
passing the upstream `sub` through. A product keying users on `sub` will see every
existing user as brand new the moment it switches from direct OIDC to Dex. Everything
owned per user breaks: Superset dashboards and saved queries, Airflow ownership, Trino
query history, OPA policies written against the old identifier. Nothing errors — users
log in to an empty account.

Mitigations in order of preference:

1. Configure products to key on a stable claim (`email`, `preferred_username`) rather
   than `sub`.
2. Make Dex's claim mapping produce exactly what the direct-IdP configuration produced.
3. Verify per product what it actually keys on — this varies and defaults are
   inconsistent.

Deliverables: a documented migration procedure, and a pre-flight check comparing the
identifiers the two configurations would produce.

**VERIFY** Dex's current `sub` construction against the version we ship — it is
long-standing behaviour but it is the load-bearing assumption here.

### 4.9 Branding — DECIDED, mechanism open

Target: SDP theming (fonts, colours, logo) plus a shared top bar — product switcher,
cluster context, user menu — served as a CSS+JS bundle from Cockpit.

Independent of the embedding decision: a themed product looks the same framed or
full-page, so this is worth doing regardless.

Follow the precedence ladder in section 3. Levels 1–3 may be sufficient on their own;
establish that before assuming patches are needed.

Note on level 3 (proxy-injected chrome): a single substitution inserting a `<script>`
before `</head>`, plus a CSP adjustment. This is **not** the Knox tarpit — Knox's
rewriting had to understand each product's URL grammar and broke when upstream moved
paths. A single tag injection does not depend on URL structure and is stable in a way
Knox's rules never were.

---

## 5. Deferred: full-app iframe embedding

**Not part of the current build.** The auth objections are resolved (4.5–4.7). What
remains is patch cost, which section 3 decides against for now:

1. **Router and history sync** — deep links, refresh, and the back button only work if
   each product's router reports route changes to the parent and accepts them back.
   Patch class 2, in the area upstream refactors most.
2. **Escape hatches leak** — new tabs, downloads, exports, popups exit the frame and
   land unbranded. Each fix is another patch.

Multiplied across ~10 products and every SDP release, with no other project to amortise
against (section 9).

**Exception, not deferred:** Superset's embedded SDK for dashboards uses guest tokens
behind a feature flag — upstream-supported, no patches, no session-in-frame problem.
General rule: embed widget-shaped things upstream supports embedding; navigate full-page
to app-shaped things. **VERIFY** against the version we ship.

### 5.1 Measurement spike

A time-boxed spike will measure the real cost so the deferral is revisited on data
rather than argument. Structure it so it can be discarded cleanly:

**Layer 1 — keep regardless.** Dex with sessions, subdomain and wildcard TLS layout,
Superset on OIDC against Dex, shared chrome bundle. This is the feature, not the spike.

**Layer 2 — the spike.** Cockpit page with the iframe, plus whatever Superset patches
framing requires. Must be a small diff on top of layer 1, so discarding costs a
`git revert` and the diff size *is* the measurement. If the layers entangle, the result
is unusable and the spike becomes load-bearing by accident.

**Commit acceptance criteria before writing code** — thresholds chosen without sunk
cost. Suggested form: reject if more than *N* lines touch routing, history, or auth;
reject if the patch conflicts on rebase across two releases; reject if deep links do not
survive refresh.

**Measure churn, not initial effort.** Apply the patch to the shipped Superset version,
then rebase onto an older and a newer release and count conflicts. That is the recurring
cost — once per product per release, forever. A two-day patch that rebases cleanly is
fine; a two-hour patch that conflicts every release is not.

**Behaviours to check:** deep link then refresh; back button after several levels; copy
URL into a new tab; Dex session expiry with the frame open (set short lifetimes to make
this testable in minutes); CSV export and downloads; Superset's open-in-new-tab actions;
modals and dropdowns near the frame edge.

**Test in Safari and Firefox as well as Chromium, over real TLS with real hostnames.**
Same-site subdomains should behave everywhere, but that assumption is what the spike
exists to verify, and localhost over plain HTTP hides all of it.

**Two corrections for bias:**

- Superset is the friendly case; treat the result as a floor. Before extrapolating,
  read NiFi's frontend — routing model, whether there is a hookable router, absolute
  redirects, `window.top` checks — for a rough multiplier.
- Include the no-patch comparison: measure what fraction of what users want from
  Superset in Cockpit is dashboards. If it is most of it, the answer for this product
  may be "use the embedded SDK, don't frame the app."

---

## 6. Rejected options — do not re-propose

| Option | Why rejected |
|---|---|
| Path-based routing under one origin | Base-path patches across all products; cookie collisions; no origin isolation. See 4.1 and the Knox precedent in 9. |
| **Plain trusted headers** (`X-Remote-User` from a proxy) | Trusted-network assumption; full auth bypass if a product is reachable directly; makes NetworkPolicy load-bearing for correctness. **Note:** this does *not* apply to a signed JWT verified against Dex's JWKS — forging that needs Dex's key, not network position. That is model B in 4.4, rejected on patch cost, not security. An earlier revision conflated the two. |
| Disabling product auth entirely behind a proxy | Collapses all users to one identity; breaks OPA authorization and audit. |
| Cockpit relaying its own token to products | Token exchange or audience juggling; makes Cockpit a token broker. See 4.5. |
| Writing our own OIDC/session proxy in Cockpit | Ships a bespoke security-critical component with the CVE response obligation that implies. Use Dex plus existing proxies. |
| Auth-logic patches in product images | Worst patch class. Push upstream instead. |
| Pre-authenticating all products at top level before rendering any frame | N sequential redirect round trips per login; breaks when one product's session expires out of sync. Superseded by 4.5. |
| Making Dex optional while keeping the integrated experience | Structurally impossible — see 4.3. Superseded by the feature flag. |
| Per-product feature flag | Two session domains, two login prompts, top bar linking to products that prompt again. See 4.3. |

---

## 7. Customer prerequisites

State these up front in the docs — all three are IAM or infrastructure asks with lead
times, and a customer who cannot meet them should learn it from the prerequisites, not
from a security review three weeks into a deployment.

1. One wildcard DNS record and TLS certificate under a platform domain (internal CA is
   fine).
2. One OIDC client registered in their IdP, for Dex.
3. Acceptance of an in-cluster identity broker — no user store, no primary
   authentication, no data leaving their network.

---

## 8. Beyond embedding — Cockpit-native surfaces

Embedding alone does not deliver the integrated-platform claim, and several SDP
components have no UI at all (Apache Kafka, Apache ZooKeeper, the Apache Hive
metastore). The minimal-patch constraint makes this half relatively *more* valuable: it
is pure Cockpit code with no product coupling and no rebase risk.

- Platform inventory, health, versions.
- Cross-product access and audit overview.
- Contextual deep links — from a Cockpit page about a specific Trino cluster into that
  cluster's context in the Trino UI, not the product's home page. Contextual entry reads
  as integration; a grid of tiles reads as a bookmark folder.

Selectively, native UI for the two or three highest-value cross-product flows. Be
disciplined: this is a different treadmill (API drift) and can become a worse version of
the product it replaces.

---

## 9. Prior art

**Apache Knox** — the direct ancestor: one entry point, pluggable auth, proxied Hadoop
UIs. KnoxSSO issues a normalized SSO token from LDAP/AD, Kerberos, SAML or OAuth
upstreams — the broker pattern, built years ago. Independent convergence is a good sign
for 4.3.

The cautionary half is URL rewriting for path-mounted UIs. Knox's own KIP-9 describes
upstream UIs as a moving target that is hard to track and to stay backward-compatible
with, and notes operators isolating each UI in its own topology to avoid relative-URL
collisions, which breaks the namespacing model topologies existed to provide. The
changelog shows the recurring cost: individual fixes for HDFS UI font and CSS map
rewrite rules, Livy redirect handling, Spark History Server links into the YARN UI.
Strong independent validation of 4.1.

Knox's service definitions are also a free inventory of where each Hadoop-family UI
generates absolute URLs — worth skimming for the products we care about.

**Kubeflow** — closest architectural analogue: multi-component OSS platform, Kubernetes
-native, central dashboard iframing component UIs, highly variable customer IdPs. Stack
is Dex plus oauth2-proxy; oidc-authservice was replaced by oauth2-proxy in 1.9, and they
document pointing oauth2-proxy directly at an enterprise IdP and skipping Dex — our
feature flag, already shipping elsewhere.

Kubeflow is model B: identity asserted at the edge, JWT verified per request at the mesh
via Istio `RequestAuthentication`. Not naive header injection.

**Key disanalogy:** Kubeflow's components are first-party. When the dashboard needs an
iframe to sync its URL to the parent, they change the component; we would patch
Superset. Their iframe experience is also the most criticised part of Kubeflow — with
cooperating components.

**Backstage, OpenShift console, Ambari Views** — all chose not to frame. Backstage
plugins are React components calling product APIs; OpenShift console loads federated
React modules from operators at runtime; Ambari Views were purpose-built views hosted by
Ambari, not proxied product UIs.

**Grafana, Superset embedded SDK** — the pattern that does work: products providing
explicit, supported embedding surfaces. Embed what upstream wants embedded.

**Synthesis.** Nobody has made framing third-party, upstream-owned UIs feel integrated.
Everyone who achieved the integrated feel either owned the component frontends or wrote
their own views. Knox, facing our exact inputs, declined to try and paid in rewrite
rules instead.

Our position sits between Knox and Kubeflow: Knox's inputs (third-party UIs, no control
over upstream roadmaps) with a lever Knox lacked (we build from source and can patch).
The question that lever poses is whether we are willing to be a soft fork of ten
frontends' routing layers indefinitely. Section 3 currently answers no; section 5.1
measures what that answer costs.

Note on being alone: the Hadoop-distribution category consolidated, so few vendors ship
this exact shape on-prem. The pattern is alive in managed multi-tool data platforms
(Aiven, Instaclustr, EMR Studio, Dataproc component gateway), which as far as we know
link out rather than frame — **VERIFY** if it matters. The relevant consequence is that
Knox's rewrite rules were painful but community-maintained; an SDP-only soft fork has no
co-payer.

---

## 10. Verification checklist

Confirm against the versions we actually ship; several have changed across releases:

- [ ] Dex session management: config surface, defaults, and which of `prompt=none` /
      `prompt=login` / `id_token_hint` are implemented.
- [ ] Dex `sub` construction and claim mapping per connector type, especially LDAP
      groups (see 4.8 — this one is load-bearing).
- [ ] Dex client provisioning: what is supported beyond static config, and what a config
      reload costs operationally.
- [ ] Per product: is the session token-derived or an independent server-side cookie,
      and what caps its lifetime.
- [ ] Per product: OIDC support maturity, and which stable claim it keys users on.
- [ ] Per product: `frame-ancestors` / `X-Frame-Options` behaviour and how to configure
      it.
- [ ] Per product: theming knobs and supported extension points, before considering
      patches.
- [ ] Per product: back-channel logout support. Login dedup is easy, logout propagation
      is not — do not ship a sign-out button in the shared top bar that silently fails.
- [ ] Superset embedded SDK: current status, auth model, feature flag.
- [ ] Licence check on any new dependency (Apache-2.0-compatible only).

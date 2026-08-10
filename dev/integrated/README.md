# Integrated Cockpit PoC (iframe-spike Layer 1 + 2)

Stands up the brokered, same-site, real-TLS environment the measurement spike needs and embeds the
Apache Trino Web UI inside Cockpit:

```
Browser ──TLS(mkcert)──► kind ingress-nginx :443
  cockpit.sdp.test → Cockpit (Vite dev server on the host, via a host-Endpoints Service)
  dex.sdp.test     → Dex broker            (OIDC clients: cockpit, trino)
  trino.sdp.test   → trino-chrome (injects in-frame script) → Trino coordinator
  idp.corp.test    → Keycloak = stand-in customer IdP (separate registrable domain = cross-site)
```

Design context: `../../iframe-spike.md`. Findings/measurements: `RESULTS.md`.

## Prerequisites (host tools)

`kind`, `kubectl`, `helm`, `stackablectl`, `docker`, Node (`.node-version`) + `npm`, and for
browser-trusted TLS `mkcert` + `libnss3-tools`. If running under the nono sandbox, the session
needs cluster/network access — see the `nono-cockpit-cluster-access` note (network unblocked,
`~/.kube` + docker socket granted, apiserver on an allow-listed port).

## From scratch

Steps marked **[HOST]** touch host DNS/trust or docker and must be run by you (not sandbox-able);
the rest are plain cluster operations.

```bash
# 1. [HOST] create the cluster (pinned apiserver :6443 + 80/443 mappings for the ingress)
kind create cluster --config dev/integrated/kind-config.yaml

# 2. [HOST] install mkcert (for browser-trusted TLS) + add the hostnames
sudo apt-get install -y mkcert libnss3-tools      # or equivalent
sudo sh -c 'echo "127.0.0.1 cockpit.sdp.test dex.sdp.test trino.sdp.test idp.corp.test" >> /etc/hosts'

# 3. baseline + integrated bring-up in ONE command
#    (operators + Keycloak + Trino, then ingress-nginx + TLS + Dex + CoreDNS + repoint Trino/Cockpit)
./dev/setup.sh --integrated --skip-garage

# 4. run Cockpit (binds 0.0.0.0 + HTTPS so the ingress can reach it; see vite.config.ts)
npm run dev
```

`setup.sh --integrated` runs the baseline and then `dev/integrated/up.sh`. To re-apply just the
integrated layer after editing a manifest, run `./dev/integrated/up.sh` directly (idempotent).

Then open <https://cockpit.sdp.test> and log in as `alice` / `alicealice`. The **Trino Console**
nav item embeds the Trino Web UI. Full-page Trino: <https://trino.sdp.test/ui/>.

`up.sh` is idempotent — re-run it after changing any manifest. `tls.sh` falls back to an openssl
self-signed CA if `mkcert` is absent (functional for server-side flows, but the browser will warn;
run it with `mkcert` installed for the real browser test, then restart `npm run dev`).

## Test toggles

- **Session expiry / escape hatch (§4.7):** `dev/integrated/short-sessions.sh` (revert with
  `--restore`). See the script header for the procedure.
- **Cockpit session heartbeat (§4.6):** `STACKABLE_COCKPIT_SESSION_MAX_AGE_SECONDS` in
  `.env.development` (short = the heartbeat re-auths at top level quickly). Default 7d.

## Teardown

```bash
kind delete cluster
sudo sed -i '/sdp.test\|idp.corp.test/d' /etc/hosts   # [HOST] remove the hostnames
```

The Layer 2 iframe is a small, revertable diff (the spike's measurement): revert the
`trino-console` route, the `nav-items.ts` entry, and `trino-chrome-proxy.yaml` to remove it.

## File map

| File | Purpose |
|---|---|
| `kind-config.yaml` | kind cluster: pinned apiserver `6443`, `80/443` host mappings, ingress-ready |
| `up.sh` | one-shot idempotent orchestrator (ingress-nginx → TLS → Dex → wiring) |
| `tls.sh` | wildcard cert for `*.sdp.test`/`*.corp.test` (mkcert or openssl), loads k8s secret + CA |
| `coredns-rewrite.sh` | in-cluster DNS: `*.sdp.test`/`*.corp.test` → ingress (so pods reach the public issuers) |
| `keycloak-patch.yaml` | stable Keycloak issuer at `idp.corp.test` (`KC_HOSTNAME`, forwarded headers) |
| `keycloak-config.sh` | (re)creates realm `stackable` + `dex` client + users (dev Keycloak is in-memory) |
| `dex.yaml` | Dex broker: issuer, Keycloak connector, `cockpit`+`trino` static clients |
| `ingress.yaml` | Ingress routes + TLS for dex / trino / keycloak / cockpit |
| `trino-oidc-dex.yaml` | repoints Trino's OIDC AuthenticationClass at Dex + CA SecretClass |
| `trino-chrome-proxy.yaml` | nginx in front of Trino: injects the in-frame `target`-strip + theme script |
| `cockpit-devserver.yaml` | Service+Endpoints exposing the host Vite dev server behind the ingress |
| `short-sessions.sh` | test toggle for the §4.7 session-expiry case |

## Assumptions worth checking on a new host

- `cockpit-devserver.yaml` Endpoints IP is the kind docker gateway (`172.19.0.1`). Verify with
  `docker network inspect kind -f '{{(index .IPAM.Config 0).Gateway}}'` and update if different.
- `up.sh` pins ingress-nginx `controller-v1.15.1` and Dex `v2.45.1` (`dex.yaml`); bump as needed.

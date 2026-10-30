# Lapwing Lab: refuse requests from other sites — design and plan

The server listens on `127.0.0.1` only, but it never looks at the `Host` or `Origin` headers. A web page the owner happens to visit could therefore reach it through the owner's own browser: by DNS rebinding (the page's own hostname is made to resolve to 127.0.0.1, so same-origin rules no longer protect the API) or by a cross-site write (a `text/plain` POST/PUT that needs no preflight). It could read or change the journal, notes, settings, texts and routines. The repository is about to become public. Fix: check both headers on every request.

## Behaviour

- **Host check (every request, API and static):** the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (also `[::1]:<port>`), where `<port>` is the port the request actually arrived on (`req.socket.localPort`; tests listen on ephemeral ports, so never hard-code 5757). A missing, malformed or different Host → `403` with a short plain-text body (`Forbidden host`), nothing else is run. Compare case-insensitively on the hostname.
- **Origin check:** if an `Origin` header is present it must be `http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>` (same port as above); anything else (including `null`) → `403` (`Forbidden origin`). A request with no `Origin` (curl, the browser's own same-origin GET navigation, the tests' `fetch`) passes the Origin check. Applies to every method.
- **Dev mode:** `npm run dev` runs Vite (port 5173 by default) proxying `/api`, `/content`, `/media` to `127.0.0.1:5757`. After the change it must still work: configure the proxy in `vite.config.ts` so the forwarded request carries `Host: 127.0.0.1:5757` (`changeOrigin: true`) and an `Origin` of `http://127.0.0.1:5757` (e.g. the proxy's `headers`/`configure` hook). The server itself must NOT allow the Vite dev origin.
- **Where:** one small function in `server/` (e.g. `server/guard.ts`: `checkRequest(req): { ok: true } | { ok: false; reason: 'host' | 'origin' }`), called first thing in `handle()` in `server/server.ts`, before path decoding and before API routing. No new dependency.
- Copy of the 403 bodies is plain and neutral. No change to any response for a normal same-origin use.

## Tests (tests/server/guard.test.ts for the function; extend tests/server/server.test.ts with real requests)

- Allowed: Host `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`, upper-case `LOCALHOST:<port>`; Origin absent, or matching the same host+port.
- Refused (403): Host `evil.example:<port>`, `evil.example`, `127.0.0.1:1` (wrong port), `127.0.0.1.evil.example:<port>`, missing Host, empty Host; Origin `https://evil.example`, `http://evil.example`, `null`, `http://127.0.0.1:1`, `http://localhost.evil.example:<port>`, the Vite origin `http://localhost:5173`.
- Over real HTTP (node `http.request` so Host/Origin can be set exactly): a PUT to `/api/settings` (or another existing write route) with a foreign Origin returns 403 and writes nothing (temp data dir); a GET of `/` and of an `/api` read with a bad Host returns 403; the same requests with good headers still work. All existing tests stay green.
- `vite.config.ts` has the proxy options (a small test or a documented manual check is fine; report which).

## Files

Create `server/guard.ts`, `tests/server/guard.test.ts`. Modify `server/server.ts`, `vite.config.ts`, `README.md` (one short paragraph under the server/Quick start section: it only answers requests addressed to `127.0.0.1`/`localhost` on its own port and refuses other Host/Origin headers, so a web page cannot reach it through your browser; `HOST`-style remote access is not supported). `docs/superpowers/m0-m1-followups.md`: nothing.

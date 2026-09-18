# Admin-authenticatie hardening — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De admin-API beveiligen met een gehashte token, HttpOnly-sessie-cookies en HTTPS, zodat de token nergens meer in plaintext staat en de admin-API zonder token niet op het netwerk bereikbaar is.

**Architecture:** Alle auth-logica komt in een nieuwe module `lib/admin-auth.js` (hash/verify, sessies, rate-limit, Express-middleware); certificaatbeheer in `lib/admin-tls.js`. `index.js` vervangt het bestaande bearer-blok door drie endpoints (`/admin/login`, `/admin/logout`, `/admin/auth-status`) plus de middleware, en start de admin-server via `https.createServer`. De UI stapt over van `localStorage`-bearer naar cookie-sessies.

**Tech Stack:** Node.js 24 (ESM), Express 4, `node:crypto` (scrypt, timingSafeEqual), `node:test`, npm-package `selfsigned` 5.x (async `generate()`).

Spec: `docs/superpowers/specs/2026-09-18-admin-auth-hardening-design.md`

## Global Constraints

- `admin-auth.json` in de app-root: `{ algorithm: "scrypt", salt: <32 bytes hex>, hash: <64 bytes hex>, createdAt }`; scrypt `N=16384, r=8, p=1, keylen=64`.
- Cookie: `rs_session=<id>; HttpOnly; Secure; SameSite=Strict; Path=/`; id = 32 random bytes base64url.
- Sessie: idle 12 uur, absoluut 7 dagen; config `service.admin.session.idleHours` / `maxDays`.
- Login rate-limit: 5 mislukte pogingen per IP per 15 minuten → 429 met `Retry-After`; 15 minuten blokkade; succes reset.
- `Authorization: Bearer` en `?token=` worden nergens meer geaccepteerd.
- Zonder `admin-auth.json`: geen auth, admin-server geforceerd op `127.0.0.1`.
- `process.env.ADMIN_TOKEN` wordt genegeerd; waarschuwing bij start als gezet.
- HTTPS altijd; cert uit `service.admin.tls.certFile/keyFile`, anders `certs/admin-cert.pem` + `certs/admin-key.pem`, anders genereren (RSA 2048, 10 jaar, CN = hostname, SAN = hostname + `localhost` + `127.0.0.1`).
- Bind-adres `service.admin.host` (default `0.0.0.0`), poort `ADMIN_PORT` (default 8080).
- Code, comments en logregels in het Nederlands, in de stijl van de bestaande code (emoji-prefix in console.log).
- Commits eindigen met `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Bestandsoverzicht

| Bestand | Verantwoordelijkheid |
|---|---|
| `lib/admin-auth.js` (nieuw) | Token-hash laden/verifiëren, sessies, login-rate-limit, Express-middleware |
| `lib/admin-tls.js` (nieuw) | TLS-opties voor de admin-server bepalen: geconfigureerd cert, bestaand bestand, of self-signed genereren |
| `scripts/set-admin-token.js` (nieuw) | CLI om token te genereren en `admin-auth.json` te schrijven |
| `test/admin-auth.test.js`, `test/admin-tls.test.js` (nieuw) | Unit-tests (`node:test`) |
| `index.js` | Auth-blok vervangen; login/logout/auth-status; HTTPS-server; bind-host; startup-waarschuwingen |
| `admin-ui/app.js`, `admin-ui/index.html` | Cookie-sessies, login/logout, geen `localStorage`-token |
| `package.json`, `.gitignore`, `README.md`, `install-service-nssm.bat`, `service-installer.cjs` | Scripts, dependency, documentatie |

---

### Task 1: Token-hash en verificatie in `lib/admin-auth.js`

**Files:**
- Create: `lib/admin-auth.js`
- Create: `test/admin-auth.test.js`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces:
  - `hashToken(token: string): { algorithm: "scrypt", salt: string, hash: string, createdAt: string }`
  - `verifyToken(token: string, record?: object): boolean` — `record` default = geladen `admin-auth.json`
  - `loadAdminAuth(filePath?: string): object | null` — leest en cachet; `null` als afwezig/ongeldig
  - `isAuthRequired(): boolean`
  - `ADMIN_AUTH_FILE: string` — absoluut pad naar `<root>/admin-auth.json`

- [ ] **Step 1: Voeg `npm test` toe aan `package.json`**

In `"scripts"`, na `"start:help"`:

```json
    "test": "node --test test/",
```

- [ ] **Step 2: Schrijf de failing test**

`test/admin-auth.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { hashToken, verifyToken, loadAdminAuth, isAuthRequired } from "../lib/admin-auth.js";

test("hashToken levert scrypt-record met salt en hash", () => {
  const rec = hashToken("mijn-geheime-token-1234");
  assert.equal(rec.algorithm, "scrypt");
  assert.match(rec.salt, /^[0-9a-f]{64}$/);
  assert.match(rec.hash, /^[0-9a-f]{128}$/);
  assert.ok(!Number.isNaN(Date.parse(rec.createdAt)));
});

test("verifyToken accepteert de juiste token en weigert andere", () => {
  const rec = hashToken("mijn-geheime-token-1234");
  assert.equal(verifyToken("mijn-geheime-token-1234", rec), true);
  assert.equal(verifyToken("mijn-geheime-token-1235", rec), false);
  assert.equal(verifyToken("", rec), false);
  assert.equal(verifyToken(undefined, rec), false);
});

test("verifyToken weigert alles als er geen record is", () => {
  assert.equal(verifyToken("wat-dan-ook", null), false);
});

test("loadAdminAuth leest bestand en isAuthRequired volgt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-auth-"));
  const file = path.join(dir, "admin-auth.json");
  assert.equal(loadAdminAuth(file), null);
  assert.equal(isAuthRequired(), false);
  fs.writeFileSync(file, JSON.stringify(hashToken("abc-def-ghi-jkl-1234")));
  const rec = loadAdminAuth(file);
  assert.equal(rec.algorithm, "scrypt");
  assert.equal(isAuthRequired(), true);
  assert.equal(verifyToken("abc-def-ghi-jkl-1234"), true);
  fs.writeFileSync(file, "{ dit is geen json");
  assert.equal(loadAdminAuth(file), null);
  assert.equal(isAuthRequired(), false);
});
```

- [ ] **Step 3: Draai de test, verwacht falen**

Run: `npm test`
Expected: FAIL met `Cannot find module '.../lib/admin-auth.js'`

- [ ] **Step 4: Implementeer `lib/admin-auth.js` (deel 1)**

```js
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Bepaal applicatie root op basis van waar dit script zich bevindt
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
export const ADMIN_AUTH_FILE = path.join(ROOT, "admin-auth.json");

// scrypt-parameters (vast; staan niet in het bestand zodat ze niet verzwakt kunnen worden)
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

let loadedRecord = null;

/**
 * Maak een admin-auth record voor een token. De token zelf wordt nergens opgeslagen.
 */
export function hashToken(token) {
  const salt = crypto.randomBytes(32);
  const hash = crypto.scryptSync(String(token), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return {
    algorithm: "scrypt",
    salt: salt.toString("hex"),
    hash: hash.toString("hex"),
    createdAt: new Date().toISOString()
  };
}

/**
 * Verifieer een token tegen een record (standaard: het geladen admin-auth.json).
 * Vergelijking is timing-safe.
 */
export function verifyToken(token, record = loadedRecord) {
  if (!record || record.algorithm !== "scrypt" || typeof token !== "string" || token.length === 0) return false;
  try {
    const expected = Buffer.from(record.hash, "hex");
    const actual = crypto.scryptSync(token, Buffer.from(record.salt, "hex"), expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Laad admin-auth.json. Retourneert het record, of null als het bestand ontbreekt of ongeldig is.
 * Het resultaat wordt gecachet voor verifyToken()/isAuthRequired().
 */
export function loadAdminAuth(filePath = ADMIN_AUTH_FILE) {
  loadedRecord = null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const rec = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (rec?.algorithm !== "scrypt" || !/^[0-9a-f]{64}$/.test(rec.salt || "") || !/^[0-9a-f]{128}$/.test(rec.hash || "")) {
      console.error(`❌ ${filePath} is ongeldig (verwacht scrypt record met salt/hash); authenticatie uitgeschakeld`);
      return null;
    }
    loadedRecord = rec;
    return rec;
  } catch (error) {
    console.error(`❌ Kon ${filePath} niet lezen: ${error.message}; authenticatie uitgeschakeld`);
    return null;
  }
}

export function isAuthRequired() {
  return loadedRecord !== null;
}
```

- [ ] **Step 5: Draai de tests, verwacht slagen**

Run: `npm test`
Expected: `# pass 4`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add lib/admin-auth.js test/admin-auth.test.js package.json
git commit -m "Admin-auth: scrypt token-hash en verificatie

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Sessies, rate-limit en middleware in `lib/admin-auth.js`

**Files:**
- Modify: `lib/admin-auth.js` (toevoegen onderaan)
- Modify: `test/admin-auth.test.js` (toevoegen)

**Interfaces:**
- Consumes: `verifyToken`, `isAuthRequired` uit Task 1.
- Produces:
  - `configureSessions({ idleHours?, maxDays?, now? })` — `now` is een injecteerbare klok (`() => number`) voor tests
  - `createSession(): string`
  - `getSession(id: string): { createdAt, lastSeen } | null` — verlengt `lastSeen`
  - `destroySession(id: string): void`
  - `checkLoginRateLimit(ip: string): { allowed: boolean, retryAfterSeconds: number }`
  - `recordFailedLogin(ip: string): void`, `resetLoginRateLimit(ip: string): void`
  - `SESSION_COOKIE = "rs_session"`
  - `parseSessionCookie(req): string | null`
  - `hasValidSession(req): boolean` — geldige sessie-cookie aanwezig (zet `req.adminSessionId`)
  - `adminAuthMiddleware(req, res, next)` — laat door als `!isAuthRequired()` of geldige cookie; anders 401 `{ error: "Unauthorized" }`

- [ ] **Step 1: Schrijf de failing tests**

Toevoegen aan `test/admin-auth.test.js`:

```js
import {
  configureSessions, createSession, getSession, destroySession,
  checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit,
  adminAuthMiddleware, hasValidSession, parseSessionCookie, SESSION_COOKIE
} from "../lib/admin-auth.js";

function fakeClock(startMs) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("sessie: aanmaken, ophalen, verlengen, vernietigen", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ idleHours: 12, maxDays: 7, now: clock.now });
  const id = createSession();
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(getSession(id));
  assert.equal(getSession("bestaat-niet"), null);
  destroySession(id);
  assert.equal(getSession(id), null);
});

test("sessie verloopt na idle-timeout, maar niet zolang hij gebruikt wordt", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ idleHours: 1, maxDays: 7, now: clock.now });
  const id = createSession();
  clock.advance(50 * 60 * 1000);
  assert.ok(getSession(id), "na 50 min nog geldig");
  clock.advance(50 * 60 * 1000);
  assert.ok(getSession(id), "verlengd door vorig gebruik");
  clock.advance(61 * 60 * 1000);
  assert.equal(getSession(id), null, "61 min ongebruikt → verlopen");
});

test("sessie verloopt absoluut na maxDays ondanks gebruik", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ idleHours: 24, maxDays: 1, now: clock.now });
  const id = createSession();
  for (let i = 0; i < 23; i++) { clock.advance(60 * 60 * 1000); assert.ok(getSession(id)); }
  clock.advance(2 * 60 * 60 * 1000);
  assert.equal(getSession(id), null);
});

test("rate-limit: 5 fouten blokkeren, blokkade verloopt, succes reset", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ now: clock.now });
  const ip = "10.0.0.5";
  resetLoginRateLimit(ip);
  for (let i = 0; i < 5; i++) {
    assert.equal(checkLoginRateLimit(ip).allowed, true);
    recordFailedLogin(ip);
  }
  const blocked = checkLoginRateLimit(ip);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 15 * 60);
  clock.advance(15 * 60 * 1000 + 1000);
  assert.equal(checkLoginRateLimit(ip).allowed, true);
  recordFailedLogin(ip);
  resetLoginRateLimit(ip);
  assert.equal(checkLoginRateLimit(ip).allowed, true);
  assert.equal(checkLoginRateLimit("10.0.0.6").allowed, true, "ander IP niet geraakt");
});

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}

test("middleware: zonder auth-bestand alles doorlaten", () => {
  loadAdminAuth(path.join(os.tmpdir(), "rs-auth-niet-bestaand.json"));
  const res = fakeRes(); let called = false;
  adminAuthMiddleware({ headers: {}, method: "GET", path: "/tenants" }, res, () => { called = true; });
  assert.equal(called, true);
});

test("middleware: met auth-bestand alleen geldige cookie doorlaten, bearer genegeerd", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-auth-"));
  const file = path.join(dir, "admin-auth.json");
  fs.writeFileSync(file, JSON.stringify(hashToken("abc-def-ghi-jkl-1234")));
  loadAdminAuth(file);
  configureSessions({ now: () => Date.now() });

  let called = false; let res = fakeRes();
  adminAuthMiddleware({ headers: {}, method: "GET", path: "/tenants" }, res, () => { called = true; });
  assert.equal(called, false); assert.equal(res.statusCode, 401);

  called = false; res = fakeRes();
  adminAuthMiddleware({ headers: { authorization: "Bearer abc-def-ghi-jkl-1234" }, query: { token: "abc-def-ghi-jkl-1234" }, method: "GET", path: "/tenants" }, res, () => { called = true; });
  assert.equal(called, false, "bearer/query token mag niet meer werken");

  const id = createSession();
  called = false; res = fakeRes();
  const req = { headers: { cookie: `foo=bar; ${SESSION_COOKIE}=${id}` }, method: "GET", path: "/tenants" };
  assert.equal(parseSessionCookie(req), id);
  adminAuthMiddleware(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.adminSessionId, id);
});
```

- [ ] **Step 2: Draai de tests, verwacht falen**

Run: `npm test`
Expected: FAIL met `does not provide an export named 'configureSessions'`

- [ ] **Step 3: Implementeer sessies, rate-limit en middleware**

Toevoegen onderaan `lib/admin-auth.js`:

```js
// ---------------------------------------------------------------------------
// Sessies (in-memory) en login rate-limiting
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "rs_session";

const sessions = new Map();      // sessionId -> { createdAt, lastSeen }
const loginFailures = new Map(); // ip -> { count, firstAt, blockedUntil }

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

let sessionConfig = { idleMs: 12 * 60 * 60 * 1000, maxMs: 7 * 24 * 60 * 60 * 1000, now: () => Date.now() };

/**
 * Stel sessie-levensduur in (uit config.json service.admin.session) en optioneel een klok voor tests.
 */
export function configureSessions({ idleHours, maxDays, now } = {}) {
  if (Number.isFinite(idleHours) && idleHours > 0) sessionConfig.idleMs = idleHours * 60 * 60 * 1000;
  if (Number.isFinite(maxDays) && maxDays > 0) sessionConfig.maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (typeof now === "function") sessionConfig.now = now;
}

export function createSession() {
  const id = crypto.randomBytes(32).toString("base64url");
  const t = sessionConfig.now();
  sessions.set(id, { createdAt: t, lastSeen: t });
  return id;
}

/**
 * Haal een sessie op en verleng de idle-timer. Verlopen sessies worden opgeruimd.
 */
export function getSession(id) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  const t = sessionConfig.now();
  if (t - s.lastSeen > sessionConfig.idleMs || t - s.createdAt > sessionConfig.maxMs) {
    sessions.delete(id);
    return null;
  }
  s.lastSeen = t;
  return s;
}

export function destroySession(id) {
  if (id) sessions.delete(id);
}

export function checkLoginRateLimit(ip) {
  const entry = loginFailures.get(ip);
  if (!entry) return { allowed: true, retryAfterSeconds: 0 };
  const t = sessionConfig.now();
  if (entry.blockedUntil && t < entry.blockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - t) / 1000) };
  }
  if (entry.blockedUntil && t >= entry.blockedUntil) loginFailures.delete(ip);
  else if (t - entry.firstAt > LOGIN_WINDOW_MS) loginFailures.delete(ip);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedLogin(ip) {
  const t = sessionConfig.now();
  let entry = loginFailures.get(ip);
  if (!entry || t - entry.firstAt > LOGIN_WINDOW_MS) entry = { count: 0, firstAt: t, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILURES) entry.blockedUntil = t + LOGIN_BLOCK_MS;
  loginFailures.set(ip, entry);
}

export function resetLoginRateLimit(ip) {
  loginFailures.delete(ip);
}

/**
 * Lees het sessie-id uit de Cookie-header (zonder externe cookie-parser).
 */
export function parseSessionCookie(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * Express-middleware voor /admin/*: zonder admin-auth.json alles doorlaten; anders alleen met geldige sessie-cookie.
 * Authorization-headers en ?token= worden bewust genegeerd.
 */
export function hasValidSession(req) {
  const id = parseSessionCookie(req);
  if (id && getSession(id)) {
    req.adminSessionId = id;
    return true;
  }
  return false;
}

export function adminAuthMiddleware(req, res, next) {
  if (!isAuthRequired()) return next();
  if (hasValidSession(req)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}
```

- [ ] **Step 4: Draai de tests, verwacht slagen**

Run: `npm test`
Expected: `# pass 10`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/admin-auth.js test/admin-auth.test.js
git commit -m "Admin-auth: in-memory sessies, login rate-limit en middleware

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: CLI `npm run admin:set-token`

**Files:**
- Create: `scripts/set-admin-token.js`
- Modify: `package.json` (script `admin:set-token`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `hashToken`, `ADMIN_AUTH_FILE` uit Task 1.

- [ ] **Step 1: Voeg script en gitignore toe**

`package.json`, in `"scripts"` na `"test"`:

```json
    "admin:set-token": "node scripts/set-admin-token.js",
```

`.gitignore`, onder het blok `# Configuratie bestanden`:

```
# Admin token-hash (per installatie)
admin-auth.json
```

- [ ] **Step 2: Schrijf `scripts/set-admin-token.js`**

```js
#!/usr/bin/env node
/**
 * Stel de admin-token in voor de beheerinterface.
 *
 * Gebruik:
 *   npm run admin:set-token                 genereert een random token en toont die eenmalig
 *   npm run admin:set-token -- --token X    gebruikt een zelfgekozen token (min. 16 tekens)
 *   npm run admin:set-token -- --force      overschrijft een bestaand admin-auth.json
 *
 * Alleen de scrypt-hash wordt opgeslagen in admin-auth.json; de token zelf nergens.
 */
import fs from "fs";
import crypto from "crypto";
import { hashToken, ADMIN_AUTH_FILE } from "../lib/admin-auth.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const tokenIdx = args.indexOf("--token");
let token = tokenIdx >= 0 ? args[tokenIdx + 1] : null;

if (tokenIdx >= 0 && (!token || token.startsWith("--"))) {
  console.error("❌ --token vereist een waarde");
  process.exit(1);
}
if (token && token.length < 16) {
  console.error("❌ Token moet minimaal 16 tekens lang zijn");
  process.exit(1);
}
if (fs.existsSync(ADMIN_AUTH_FILE) && !force) {
  console.error(`❌ ${ADMIN_AUTH_FILE} bestaat al. Gebruik --force om te overschrijven.`);
  process.exit(1);
}

const generated = !token;
if (generated) token = crypto.randomBytes(32).toString("base64url");

fs.writeFileSync(ADMIN_AUTH_FILE, JSON.stringify(hashToken(token), null, 2) + "\n", { mode: 0o600 });

console.log(`✅ Admin token-hash opgeslagen in ${ADMIN_AUTH_FILE}`);
if (generated) {
  console.log("");
  console.log("🔑 Jouw admin token (wordt NIET opgeslagen, bewaar deze in een wachtwoordmanager):");
  console.log("");
  console.log(`   ${token}`);
  console.log("");
}
console.log("ℹ️ Herstart de service om de wijziging te activeren (npm run service:restart).");
```

- [ ] **Step 3: Test handmatig**

Run:
```bash
node scripts/set-admin-token.js --token te-kort
```
Expected: exit 1, `❌ Token moet minimaal 16 tekens lang zijn`

Run:
```bash
node scripts/set-admin-token.js && node scripts/set-admin-token.js; rm admin-auth.json
```
Expected: eerste aanroep toont `🔑 Jouw admin token` met een 43-teken base64url-token en maakt `admin-auth.json`; tweede aanroep faalt met `bestaat al. Gebruik --force`. Bestand daarna verwijderd.

- [ ] **Step 4: Commit**

```bash
git add scripts/set-admin-token.js package.json .gitignore
git commit -m "Admin-auth: npm run admin:set-token schrijft token-hash naar admin-auth.json

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: TLS-opties voor de admin-server in `lib/admin-tls.js`

**Files:**
- Create: `lib/admin-tls.js`
- Create: `test/admin-tls.test.js`
- Modify: `package.json` (dependency `selfsigned`)

**Interfaces:**
- Produces: `getAdminTlsOptions(adminConfig?: { tls?: { certFile?, keyFile? } }, opts?: { certsDir?: string }): Promise<{ key: Buffer, cert: Buffer, source: "config" | "file" | "generated" }>`

- [ ] **Step 1: Installeer `selfsigned`**

Run: `npm install selfsigned@^5.5.0`
Expected: `package.json` bevat `"selfsigned": "^5.5.0"` onder dependencies.

- [ ] **Step 2: Schrijf de failing test**

`test/admin-tls.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { X509Certificate } from "crypto";
import { getAdminTlsOptions } from "../lib/admin-tls.js";

test("genereert self-signed certificaat bij eerste keer en hergebruikt daarna", async () => {
  const certsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-certs-"));
  const first = await getAdminTlsOptions({}, { certsDir });
  assert.equal(first.source, "generated");
  assert.ok(fs.existsSync(path.join(certsDir, "admin-cert.pem")));
  assert.ok(fs.existsSync(path.join(certsDir, "admin-key.pem")));
  const x = new X509Certificate(first.cert);
  assert.match(x.subject, /CN=/);
  assert.match(x.subjectAltName, /DNS:localhost/);
  assert.match(x.subjectAltName, /IP Address:127\.0\.0\.1/);
  const yearsValid = (new Date(x.validTo) - new Date(x.validFrom)) / (365 * 24 * 3600 * 1000);
  assert.ok(yearsValid > 9.9 && yearsValid < 10.1);

  const second = await getAdminTlsOptions({}, { certsDir });
  assert.equal(second.source, "file");
  assert.equal(second.cert.toString(), first.cert.toString());
});

test("gebruikt geconfigureerd certificaat als certFile/keyFile zijn gezet", async () => {
  const certsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-certs-"));
  const gen = await getAdminTlsOptions({}, { certsDir });
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-certs2-"));
  fs.writeFileSync(path.join(otherDir, "mijn.crt"), gen.cert);
  fs.writeFileSync(path.join(otherDir, "mijn.key"), gen.key);
  const cfg = await getAdminTlsOptions({ tls: { certFile: path.join(otherDir, "mijn.crt"), keyFile: path.join(otherDir, "mijn.key") } }, { certsDir: otherDir });
  assert.equal(cfg.source, "config");
});

test("faalt duidelijk als geconfigureerd certificaat ontbreekt", async () => {
  await assert.rejects(
    () => getAdminTlsOptions({ tls: { certFile: "C:/bestaat/niet.crt", keyFile: "C:/bestaat/niet.key" } }),
    /niet gevonden/
  );
});
```

- [ ] **Step 3: Draai de test, verwacht falen**

Run: `npm test`
Expected: FAIL met `Cannot find module '.../lib/admin-tls.js'`

- [ ] **Step 4: Implementeer `lib/admin-tls.js`**

```js
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// Bepaal applicatie root op basis van waar dit script zich bevindt
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const DEFAULT_CERTS_DIR = path.join(ROOT, "certs");

const CERT_NAME = "admin-cert.pem";
const KEY_NAME = "admin-key.pem";

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

/**
 * Bepaal key/cert voor de HTTPS admin-server, in deze volgorde:
 *  1. service.admin.tls.certFile + keyFile uit config.json
 *  2. certs/admin-cert.pem + certs/admin-key.pem (eerder gegenereerd)
 *  3. nieuw self-signed certificaat genereren en opslaan als (2)
 */
export async function getAdminTlsOptions(adminConfig = {}, { certsDir = DEFAULT_CERTS_DIR } = {}) {
  const tls = adminConfig?.tls || {};
  if (tls.certFile || tls.keyFile) {
    if (!tls.certFile || !tls.keyFile) {
      throw new Error("service.admin.tls vereist zowel certFile als keyFile");
    }
    const certPath = resolveFromRoot(tls.certFile);
    const keyPath = resolveFromRoot(tls.keyFile);
    if (!fs.existsSync(certPath)) throw new Error(`Admin TLS certificaat niet gevonden: ${certPath}`);
    if (!fs.existsSync(keyPath)) throw new Error(`Admin TLS private key niet gevonden: ${keyPath}`);
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), source: "config" };
  }

  const certPath = path.join(certsDir, CERT_NAME);
  const keyPath = path.join(certsDir, KEY_NAME);
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), source: "file" };
  }

  const hostname = os.hostname();
  console.log(`🔐 Geen admin-certificaat gevonden, self-signed certificaat genereren voor ${hostname}...`);
  const { generate } = await import("selfsigned");
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 10);
  const pems = await generate([{ name: "commonName", value: hostname }], {
    keySize: 2048,
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [
        { type: 2, value: hostname },
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" }
      ] }
    ]
  });

  fs.mkdirSync(certsDir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert);
  console.log(`✅ Self-signed admin-certificaat opgeslagen: ${certPath}`);
  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert), source: "generated" };
}
```

- [ ] **Step 5: Draai de tests, verwacht slagen**

Run: `npm test`
Expected: `# pass 13`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add lib/admin-tls.js test/admin-tls.test.js package.json package-lock.json
git commit -m "Admin-TLS: certificaat uit config, bestand of self-signed genereren

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `index.js` — endpoints, middleware, HTTPS en bind-host

**Files:**
- Modify: `index.js` regels 211-213 (`ADMIN_PORT`/`ADMIN_TOKEN`), 255-310 (auth-blok), 2216-2218 (`app.listen`)

**Interfaces:**
- Consumes: alles uit Task 1, 2 en 4.

- [ ] **Step 1: Vervang de imports en constanten**

Bovenaan `index.js`, na `import os from "os";`:

```js
import https from "https";
import {
  loadAdminAuth, isAuthRequired, verifyToken, configureSessions,
  createSession, destroySession, checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit,
  adminAuthMiddleware, hasValidSession, parseSessionCookie, SESSION_COOKIE
} from "./lib/admin-auth.js";
import { getAdminTlsOptions } from "./lib/admin-tls.js";
```

Vervang:

```js
const ADMIN_PORT = process.env.ADMIN_PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
```

door:

```js
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || "8080", 10);

// Admin-authenticatie: alleen de scrypt-hash in admin-auth.json telt.
// De oude plaintext ADMIN_TOKEN (environment/register) wordt bewust genegeerd.
if (process.env.ADMIN_TOKEN) {
  console.warn(`⚠️ ADMIN_TOKEN (environment) wordt niet meer gebruikt. Verwijder deze uit het register/.env`);
  console.warn(`   en stel een token in met: npm run admin:set-token`);
}
loadAdminAuth();
```

- [ ] **Step 2: Vervang het auth-blok (`/admin/auth-status` t/m de `app.use("/admin", ...)`-middleware)**

Verwijder alles vanaf `app.get("/admin/auth-status", ...` tot en met de sluitende `});` van `app.use("/admin", (req, res, next) => { ... })` en zet ervoor in de plaats:

```js
const SESSION_COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Strict; Path=/";

app.get("/admin/auth-status", (req, res) => {
  const requiresAuth = isAuthRequired();
  const authenticated = !requiresAuth || hasValidSession(req);
  res.json({ requiresAuth, authenticated });
});

app.post("/admin/login", (req, res) => {
  const remoteIP = getRemoteIP(req);
  if (!isAuthRequired()) {
    return res.json({ ok: true, requiresAuth: false });
  }
  const limit = checkLoginRateLimit(remoteIP);
  if (!limit.allowed) {
    console.warn(`🔐 Login geblokkeerd (te veel pogingen) - Remote IP: ${remoteIP}`);
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Te veel mislukte pogingen", retryAfterSeconds: limit.retryAfterSeconds });
  }
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!verifyToken(token)) {
    recordFailedLogin(remoteIP);
    console.warn(`🔐 Login mislukt - Remote IP: ${remoteIP}`);
    return res.status(401).json({ error: "Ongeldige token" });
  }
  resetLoginRateLimit(remoteIP);
  const id = createSession();
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${id}; ${SESSION_COOKIE_ATTRS}`);
  console.log(`🔐 Login geslaagd - Remote IP: ${remoteIP}`);
  res.json({ ok: true, requiresAuth: true });
});

app.post("/admin/logout", (req, res) => {
  destroySession(parseSessionCookie(req));
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${SESSION_COOKIE_ATTRS}; Max-Age=0`);
  res.json({ ok: true });
});

// Alle overige /admin routes vereisen een geldige sessie (als admin-auth.json bestaat)
app.use("/admin", (req, res, next) => {
  if (isAuthRequired() && !hasValidSession(req)) {
    console.log(`❌ Unauthorized access attempt: ${req.method} ${req.path} - Remote IP: ${getRemoteIP(req)}`);
  }
  adminAuthMiddleware(req, res, next);
});
```

- [ ] **Step 3: Vervang `app.listen` door een HTTPS-server met bind-host**

Vervang:

```js
  // Start admin server
  app.listen(ADMIN_PORT, () => {
    console.log(`🌐 Admin server started on port ${ADMIN_PORT}`);
  });
```

door:

```js
  // Start admin server (altijd HTTPS)
  const adminCfg = config.service?.admin || {};
  configureSessions(adminCfg.session || {});
  const authRequired = isAuthRequired();
  // Zonder admin-auth.json is er geen authenticatie: dan uitsluitend op localhost luisteren
  const adminHost = authRequired ? (adminCfg.host || "0.0.0.0") : "127.0.0.1";
  const tlsOptions = await getAdminTlsOptions(adminCfg);
  const adminServer = https.createServer({ key: tlsOptions.key, cert: tlsOptions.cert }, app);
  adminServer.on("error", (err) => {
    console.error(`❌ Admin server kan niet luisteren op ${adminHost}:${ADMIN_PORT}: ${err.message} (${err.code})`);
    process.exit(1);
  });
  adminServer.listen(ADMIN_PORT, adminHost, () => {
    console.log(`🌐 Admin server gestart op https://${adminHost}:${ADMIN_PORT} (certificaat: ${tlsOptions.source})`);
    if (tlsOptions.source === "generated" || tlsOptions.source === "file") {
      console.log(`   ℹ️ Self-signed certificaat: de browser toont een waarschuwing. Eigen certificaat: service.admin.tls.certFile/keyFile in config.json`);
    }
    if (!authRequired) {
      console.warn(`⚠️ Geen admin-auth.json gevonden: admin-interface alleen bereikbaar op https://127.0.0.1:${ADMIN_PORT}`);
      console.warn(`   Stel een token in met: npm run admin:set-token`);
    }
  });
```

- [ ] **Step 4: Werk de resterende startup-logregels bij**

Vervang:

```js
  console.log(`🌐 Admin interface available at http://localhost:${ADMIN_PORT}`);
  if (ADMIN_TOKEN) {
    console.log(`🔐 Admin authentication enabled (ADMIN_TOKEN set)`);
  } else {
    console.log(`⚠️ Admin authentication disabled (no ADMIN_TOKEN set)`);
  }
```

door:

```js
  console.log(`🌐 Admin interface available at https://localhost:${ADMIN_PORT}`);
  console.log(authRequired ? `🔐 Admin authentication enabled (admin-auth.json)` : `⚠️ Admin authentication disabled (no admin-auth.json)`);
```

- [ ] **Step 5: Controleer dat `ADMIN_TOKEN` nergens meer voorkomt en de syntax klopt**

Run: `grep -n "ADMIN_TOKEN" index.js; node --check index.js`
Expected: alleen de twee `console.warn`-regels en het `if (process.env.ADMIN_TOKEN)` uit Step 1; `node --check` zonder output.

- [ ] **Step 6: Rooktest zonder auth-bestand**

Run (PowerShell):
```powershell
$p = Start-Process -FilePath cmd.exe -ArgumentList '/c','npm start > "%TEMP%\rs.log" 2>&1' -WorkingDirectory C:\Dev\RileeSurfis -PassThru -WindowStyle Hidden; Start-Sleep 7; Get-Content "$env:TEMP\rs.log" | Select-String "Admin server|admin-auth|certificaat"; Get-NetTCPConnection -State Listen -LocalPort 8080 | Select-Object LocalAddress; Invoke-WebRequest -Uri https://127.0.0.1:8080/admin/auth-status -SkipCertificateCheck | Select-Object -Expand Content; Get-NetTCPConnection -State Listen -LocalPort 8080 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```
Expected: log toont `self-signed certificaat genereren`, `Admin server gestart op https://127.0.0.1:8080`, waarschuwing `Geen admin-auth.json`; LocalAddress is `127.0.0.1`; auth-status geeft `{"requiresAuth":false,"authenticated":true}`.

- [ ] **Step 7: Commit**

```bash
git add index.js
git commit -m "Admin-API: login/logout met sessie-cookie, HTTPS en localhost-bind zonder token

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Admin-UI — cookie-sessies, login en uitloggen

**Files:**
- Modify: `admin-ui/index.html` regels 52-53 (header token-input), 728-745 (overlay)
- Modify: `admin-ui/app.js` — `headers()` (r. 76), `api()` (r. 85), `health()` (r. 118), `load()` (r. 878), `#saveToken`-handler (r. 1007), `setupOverlayEventHandlers` (r. 1134), `initToken` (r. 1222), `initializeApp` (r. 1241), `serverRequiresAuth` (r. 1306), `hasToken` (r. 1320), `loadStats` (r. 3374), `loadEvents` (r. 3566), en de vierde `frontendToken`-blok (r. 3755)

**Interfaces:**
- Consumes: `GET /admin/auth-status → { requiresAuth, authenticated }`, `POST /admin/login { token } → 200 | 401 | 429 { retryAfterSeconds }`, `POST /admin/logout`.

- [ ] **Step 1: `index.html` — header: token-veld vervangen door uitlogknop**

Vervang regels 52-53:

```html
      <input id="token" type="password" placeholder="Admin token (Bearer)" />
      <button id="saveToken" class="primary">Opslaan</button>
```

door:

```html
      <button id="logoutBtn" class="ghost hidden" title="Uitloggen">Uitloggen</button>
```

- [ ] **Step 2: `index.html` — overlay-tekst**

Vervang:

```html
    <input id="overlayToken" type="password" placeholder="Admin token (Bearer)" />
    <div class="actions">
      <button id="overlaySave" class="primary">Inloggen</button>
    </div>
    <small class="muted">Tip: je kunt ook openen met <code>?token=...</code> in de URL.</small>
```

door:

```html
    <input id="overlayToken" type="password" placeholder="Admin token" autocomplete="current-password" />
    <div class="actions">
      <button id="overlaySave" class="primary">Inloggen</button>
    </div>
    <small class="muted">De token is ingesteld met <code>npm run admin:set-token</code> op de server.</small>
```

- [ ] **Step 3: `app.js` — `headers()` en `api()`**

Vervang de functie `headers()` door:

```js
  function headers(){
    return {"Content-Type":"application/json"};
  }
```

In `api()` vervang de `fetch`-regel door:

```js
    const r = await fetch(url,{...o,headers:{...(o.headers||{}),...headers()},cache:"no-cache",credentials:"same-origin"});
```

en vervang:

```js
      if (r.status === 401) {
        m = "Authentication required. Please set ADMIN_TOKEN environment variable or provide valid token.";
      }
```

door:

```js
      if (r.status === 401 && !p.startsWith("/admin/login")) {
        m = "Sessie verlopen — log opnieuw in.";
        toggleLoginOverlay(true);
      }
```

- [ ] **Step 4: `app.js` — verwijder de vier `frontendToken`-blokken**

In `load()`, `loadStats()`, `loadEvents()` en het vierde voorkomen (r. ~3755): verwijder telkens het hele blok

```js
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
          ... return;
        }
        

      }
```

zodat de functie direct met de data-call begint (bv. `data = await api("/admin/tenants");`). Een 401 wordt nu centraal in `api()` afgehandeld.

In `health()` vervang de hele body door:

```js
  async function health(){
    try {
      await api("/admin/health");
      dot.style.background = "#22c55e";
      ht.textContent = "online";
    } catch (error) {
      dot.style.background = "#ef4444";
      ht.textContent = "offline";
    }
  }
```

- [ ] **Step 5: `app.js` — verwijder `#saveToken`-handler en `initToken`, vervang login-handler**

Verwijder de complete `$("#saveToken").addEventListener("click", ...)`-blok (r. ~1007-1080) en de functie `initToken()` (r. ~1222-1240).

Vervang in `setupOverlayEventHandlers()` de body van de `#overlaySave` click-handler (vanaf `const token = ...` t/m de afsluitende `catch`) door:

```js
      const token = $("#overlayToken").value.trim();
      if (!token) {
        toast("Voer een token in");
        return;
      }
      try {
        const r = await fetch("/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token })
        });
        if (r.status === 429) {
          const data = await r.json().catch(() => ({}));
          const minutes = Math.max(1, Math.ceil((data.retryAfterSeconds || 900) / 60));
          showLoginFeedback("error");
          toast(`❌ Te veel pogingen, probeer over ${minutes} minuten opnieuw`);
          return;
        }
        if (!r.ok) {
          showLoginFeedback("error");
          toast("❌ Ongeldige token");
          return;
        }
        showLoginFeedback("success");
        toast("✅ Ingelogd");
        $("#overlayToken").value = "";
        setTimeout(() => {
          toggleLoginOverlay(false);
          startApp();
        }, 600);
      } catch (error) {
        showLoginFeedback("error");
        toast("❌ Fout bij authenticatie: " + error.message);
      }
```

- [ ] **Step 6: `app.js` — `initializeApp`, `startApp`, uitloggen; verwijder `serverRequiresAuth`/`hasToken`**

Vervang `initializeApp()` (inclusief de eerder toegevoegde `serverRequiresAuth()` en `hasToken()`) door:

```js
  // Opruimen: oude installaties bewaarden de bearer-token in localStorage
  try { localStorage.removeItem("adminToken"); } catch {}

  async function getAuthStatus(){
    try {
      const r = await fetch("/admin/auth-status", { cache: "no-cache", credentials: "same-origin" });
      if (!r.ok) return { requiresAuth: true, authenticated: false };
      return await r.json();
    } catch {
      return { requiresAuth: true, authenticated: false };
    }
  }

  // Laad alle onderdelen van de app (na login, of direct als auth niet vereist is)
  function startApp(){
    try{
      loadVersion();
      setupVersionMenu();
      setupUpdateInfoModal();
      load();
      health();
      loadStats();
      if (typeof initLevelFilter === 'function') initLevelFilter();
      setTimeout(() => { loadEvents(); }, 150);
      populateTenantFilters && populateTenantFilters();
      setTimeout(() => { bindGlobalFilters(); }, 100);
      const eventsAuto = document.getElementById("eventsAuto");
      if (eventsAuto && eventsAuto.checked) toggleAutoRefresh(true);
    }catch(e){
      console.error("❌ Fout bij initialiseren:", e);
    }
  }

  async function initializeApp() {
    setupOverlayEventHandlers();
    $("#logoutBtn").addEventListener("click", async () => {
      try { await fetch("/admin/logout", { method: "POST", credentials: "same-origin" }); } catch {}
      location.reload();
    });

    const status = await getAuthStatus();
    $("#logoutBtn").classList.toggle("hidden", !status.requiresAuth);
    if (status.requiresAuth && !status.authenticated) {
      toggleLoginOverlay(true);
      return; // wacht op login
    }
    toggleLoginOverlay(false);
    startApp();
  }
```

Zoek daarna in `app.js` naar overgebleven verwijzingen en verwijder ze: `grep -n "adminToken\|hasToken\|initToken\|saveToken\|serverRequiresAuth\|#token\b" admin-ui/app.js` moet niets meer opleveren behalve de `localStorage.removeItem("adminToken")`-regel.

- [ ] **Step 7: Rooktest in de browser (met token)**

Run:
```bash
node scripts/set-admin-token.js --token test-token-1234567890
```
Start de app (zie Task 5 Step 6, maar zonder het `Stop-Process`-deel) en open `https://localhost:8080` in de browser (certificaatwaarschuwing accepteren).
Expected: login-scherm; foute token → "❌ Ongeldige token"; `test-token-1234567890` → "✅ Ingelogd", dashboard laadt, knop "Uitloggen" zichtbaar; na Uitloggen → login-scherm; 6× foute token → "Te veel pogingen". Devtools → Application → Cookies: `rs_session` met HttpOnly, Secure, SameSite=Strict; localStorage bevat geen `adminToken`.

Verwijder daarna `admin-auth.json` en stop de server.

- [ ] **Step 8: Commit**

```bash
git add admin-ui/app.js admin-ui/index.html
git commit -m "Admin-UI: sessie-cookie login/logout i.p.v. bearer-token in localStorage

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E-script, documentatie en installer

**Files:**
- Create: `test/e2e-admin-auth.mjs` (handmatig te draaien, niet via `npm test`)
- Modify: `README.md` (sectie "📊 Admin Interface"), `install-service-nssm.bat` r. 65-66, `service-installer.cjs` r. 37, `package.json` (script `test:e2e`)

- [ ] **Step 1: E2E-script**

`test/e2e-admin-auth.mjs`:

```js
// End-to-end test van de admin-authenticatie. Start de echte app op poort 18443.
// Draaien: npm run test:e2e   (niet onderdeel van `npm test`; heeft vrije poorten 18443/2525 nodig)
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hashToken } from "../lib/admin-auth.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // self-signed certificaat in de test accepteren
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 18443;
const BASE = `https://127.0.0.1:${PORT}`;
const AUTH_FILE = path.join(ROOT, "admin-auth.json");
const TOKEN = "e2e-test-token-1234567890";
let failures = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${name}${extra ? " — " + extra : ""}`); if (!cond) failures++; };

async function withApp(fn) {
  const child = spawn(process.execPath, ["index.js"], { cwd: ROOT, env: { ...process.env, ADMIN_PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", d => out += d);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/admin/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  try { await fn(() => out); } finally { child.kill(); await new Promise(r => setTimeout(r, 500)); }
}

const hadConfig = fs.existsSync(path.join(ROOT, "config.json"));
if (!hadConfig) fs.writeFileSync(path.join(ROOT, "config.json"), JSON.stringify({ service: { listenPort: 2525 } }));
const hadAuth = fs.existsSync(AUTH_FILE);
if (hadAuth) fs.copyFileSync(AUTH_FILE, AUTH_FILE + ".e2e-backup");

try {
  // --- Zonder admin-auth.json ---
  fs.rmSync(AUTH_FILE, { force: true });
  await withApp(async (log) => {
    const s = await (await fetch(BASE + "/admin/auth-status")).json();
    check("zonder auth-bestand: requiresAuth=false", s.requiresAuth === false && s.authenticated === true, JSON.stringify(s));
    check("zonder auth-bestand: bind op 127.0.0.1", /https:\/\/127\.0\.0\.1:18443/.test(log()));
    check("certificaat aangemaakt", fs.existsSync(path.join(ROOT, "certs", "admin-cert.pem")));
    check("tenants bereikbaar zonder login", (await fetch(BASE + "/admin/tenants")).status === 200);
  });

  // --- Met admin-auth.json ---
  fs.writeFileSync(AUTH_FILE, JSON.stringify(hashToken(TOKEN)));
  await withApp(async (log) => {
    check("met auth-bestand: bind op 0.0.0.0", /https:\/\/0\.0\.0\.0:18443/.test(log()));
    check("tenants zonder cookie → 401", (await fetch(BASE + "/admin/tenants")).status === 401);
    check("bearer geweigerd", (await fetch(BASE + "/admin/tenants", { headers: { Authorization: "Bearer " + TOKEN } })).status === 401);
    check("?token= geweigerd", (await fetch(BASE + "/admin/tenants?token=" + TOKEN)).status === 401);

    const bad = await fetch(BASE + "/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "fout" }) });
    check("login met foute token → 401", bad.status === 401);

    const ok = await fetch(BASE + "/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    const setCookie = ok.headers.get("set-cookie") || "";
    check("login met juiste token → 200 + cookie", ok.status === 200 && /rs_session=/.test(setCookie), setCookie);
    check("cookie-vlaggen", /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie), setCookie);
    const cookie = setCookie.split(";")[0];

    check("tenants met cookie → 200", (await fetch(BASE + "/admin/tenants", { headers: { cookie } })).status === 200);
    const s = await (await fetch(BASE + "/admin/auth-status", { headers: { cookie } })).json();
    check("auth-status met cookie: authenticated", s.requiresAuth === true && s.authenticated === true);

    await fetch(BASE + "/admin/logout", { method: "POST", headers: { cookie } });
    check("na logout → 401", (await fetch(BASE + "/admin/tenants", { headers: { cookie } })).status === 401);

    for (let i = 0; i < 5; i++) await fetch(BASE + "/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "fout" }) });
    const limited = await fetch(BASE + "/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    check("6e poging → 429 ook met juiste token", limited.status === 429 && !!limited.headers.get("retry-after"));
  });
} finally {
  fs.rmSync(AUTH_FILE, { force: true });
  if (hadAuth) fs.renameSync(AUTH_FILE + ".e2e-backup", AUTH_FILE);
  if (!hadConfig) fs.rmSync(path.join(ROOT, "config.json"), { force: true });
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
```

`package.json`, in `"scripts"` na `"test"`:

```json
    "test:e2e": "node test/e2e-admin-auth.mjs",
```

- [ ] **Step 2: Draai de e2e-test**

Run: `npm run test:e2e`
Expected: alle regels `PASS`, afsluitend `ALL PASS`. (Let op: `certs/admin-*.pem` blijven staan; dat is gewenst.)

- [ ] **Step 3: README**

Vervang de sectie `## 📊 Admin Interface` door:

```markdown
## 📊 Admin Interface

De beheerinterface draait altijd over **HTTPS**, standaard op `https://<server>:8080`
(poort via `ADMIN_PORT`).

### Admin-token instellen

```bash
npm run admin:set-token
```

Dit genereert een random token, toont die **eenmalig** en slaat alleen een scrypt-hash op in
`admin-auth.json`. Bewaar de token in een wachtwoordmanager; de server kan hem niet terughalen.
Eigen token kiezen: `npm run admin:set-token -- --token <minimaal 16 tekens>`; bestaand bestand
vervangen: `-- --force`. Herstart daarna de service.

Zonder `admin-auth.json` is er geen authenticatie en luistert de admin-interface **uitsluitend
op `127.0.0.1`**. De oude `ADMIN_TOKEN`-omgevingsvariabele wordt niet meer gebruikt.

Inloggen gebeurt via het loginscherm; de sessie zit in een `HttpOnly`-cookie (12 uur inactief,
maximaal 7 dagen). Na 5 mislukte pogingen wordt een IP 15 minuten geblokkeerd.

### Certificaat

Bij de eerste start wordt een self-signed certificaat aangemaakt in `certs/admin-cert.pem` en
`certs/admin-key.pem`; browsers tonen daarvoor een waarschuwing. Eigen certificaat gebruiken:

```json
{
  "service": {
    "admin": {
      "host": "0.0.0.0",
      "tls": { "certFile": "certs/mijn.crt", "keyFile": "certs/mijn.key" },
      "session": { "idleHours": 12, "maxDays": 7 }
    }
  }
}
```
```

- [ ] **Step 4: Installer-opmerkingen**

`install-service-nssm.bat` regels 65-66 vervangen door:

```bat
REM Admin-authenticatie: stel de token in met "npm run admin:set-token" (schrijft admin-auth.json)
```

`service-installer.cjs` regel 37 vervangen door:

```js
    // Admin-authenticatie: stel de token in met "npm run admin:set-token" (schrijft admin-auth.json)
```

- [ ] **Step 5: Draai alle tests nog een keer**

Run: `npm test && npm run test:e2e`
Expected: `# fail 0` en `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add test/e2e-admin-auth.mjs package.json README.md install-service-nssm.bat service-installer.cjs
git commit -m "Admin-auth: e2e-test, README en installer-instructies

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

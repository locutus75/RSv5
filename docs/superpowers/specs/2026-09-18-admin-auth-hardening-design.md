# Admin-authenticatie hardening — ontwerp

Datum: 2026-09-18
Branch: `feat/admin-auth-hardening` (bovenop `fix/code-review-security-and-smtp`)

## Probleem

De admin-API wordt beveiligd met een statische bearer-token uit de omgevingsvariabele
`ADMIN_TOKEN`. Die token staat in plaintext:

- in het register (`AppEnvironmentExtra` van de NSSM-service, leesbaar voor alle
  geauthenticeerde gebruikers op de machine);
- in het environment van het draaiende proces;
- in `localStorage` van elke beheerdersbrowser (bereikbaar voor XSS);
- op het netwerk, want de admin-UI draait over HTTP;
- in browser-history en proxy-logs, want `?token=` in de URL wordt geaccepteerd.

Zonder `ADMIN_TOKEN` staat de admin-API (inclusief config-schrijven en update-installatie)
volledig open op alle interfaces.

## Doel

De server hoeft de token niet te kennen, alleen te kunnen verifiëren. De token staat
nergens meer opgeslagen behalve bij de beheerder zelf, gaat nooit onversleuteld over het
netwerk, en zonder geconfigureerde token is de admin-API niet vanaf het netwerk bereikbaar.

## Besluiten

| Vraag | Besluit |
|---|---|
| Toegang tot de admin-UI | Op afstand vanaf werkstations → HTTPS verplicht |
| Certificaat | Automatisch self-signed genereren; eigen certificaat configureerbaar |
| Opslag van de hash | Apart bestand `admin-auth.json` (gitignored) |
| Oude `ADMIN_TOKEN` | Niet meer accepteren; waarschuwing bij start |
| Sessiemechanisme | In-memory sessies met HttpOnly-cookie (niet stateless HMAC) |

## 1. Token-verificatie

### `admin-auth.json`

Bestand in de app-root, gitignored:

```json
{
  "algorithm": "scrypt",
  "salt": "<32 bytes hex>",
  "hash": "<64 bytes hex>",
  "createdAt": "2026-09-18T12:00:00.000Z"
}
```

scrypt-parameters: `N=16384, r=8, p=1, keylen=64` (Node `crypto.scryptSync`).

### `npm run admin:set-token` (`scripts/set-admin-token.js`)

- Zonder argumenten: genereert een token van 32 random bytes (base64url), toont die
  **eenmalig** op stdout en schrijft `admin-auth.json`.
- `--token <waarde>`: gebruikt de opgegeven token (minimaal 16 tekens).
- Weigert een bestaand bestand te overschrijven zonder `--force`.
- Print daarna de instructie om de service te herstarten.

### `lib/admin-auth.js`

Nieuwe module met alle auth-logica; `index.js` gebruikt alleen de publieke functies.

```js
loadAdminAuth()              // leest admin-auth.json; null als afwezig/ongeldig
isAuthRequired()             // true als admin-auth.json geladen is
verifyToken(token)           // scrypt + timingSafeEqual → boolean
createSession()              // → sessionId (32 random bytes, base64url)
getSession(sessionId)        // → session of null; verlengt idle-timer
destroySession(sessionId)
checkLoginRateLimit(ip)      // → { allowed, retryAfterSeconds }
recordFailedLogin(ip)
resetLoginRateLimit(ip)
adminAuthMiddleware(req,res,next) // Express-middleware voor /admin/*
```

Sessies en rate-limit-state leven in `Map`s in het procesgeheugen.

### Oude `ADMIN_TOKEN`

Wordt genegeerd. Als `process.env.ADMIN_TOKEN` gezet is, logt de server bij start:

```
⚠️ ADMIN_TOKEN (environment) wordt niet meer gebruikt. Verwijder deze uit het
   register/.env en stel een token in met: npm run admin:set-token
```

## 2. Sessies

### Endpoints

| Endpoint | Auth | Gedrag |
|---|---|---|
| `POST /admin/login` `{ token }` | publiek | Rate-limit check → `verifyToken` → sessie + cookie; 401 bij fout, 429 bij te veel pogingen |
| `POST /admin/logout` | cookie | Vernietigt sessie, wist cookie |
| `GET /admin/auth-status` | publiek | `{ requiresAuth, authenticated }` |
| `GET /admin/health` | publiek | ongewijzigd |
| overige `/admin/*` | cookie | 401 `{ error: "Unauthorized" }` zonder geldige sessie |

`Authorization: Bearer` en `?token=` worden niet meer geaccepteerd.

### Cookie

`rs_session=<id>; HttpOnly; Secure; SameSite=Strict; Path=/`

Path is `/` (niet `/admin`) omdat de UI zelf op `/` wordt geserveerd en de cookie voor
`/admin/*`-calls vanuit die pagina nodig is; `SameSite=Strict` voorkomt cross-site gebruik.

### Levensduur

- Idle-timeout: 12 uur (elke geauthenticeerde request verlengt).
- Absolute timeout: 7 dagen.
- Beide configureerbaar in `config.json`: `service.admin.session.idleHours`,
  `service.admin.session.maxDays`.
- Sessies gaan verloren bij een herstart van de service (opnieuw inloggen).

### Rate-limiting op login

Per client-IP: na 5 mislukte pogingen binnen 15 minuten → 429 met `Retry-After`,
15 minuten blokkade. Succesvolle login reset de teller. State in geheugen.

### Zonder `admin-auth.json`

Geen authenticatie (alle `/admin/*` toegankelijk), **maar** de admin-server bindt dan
uitsluitend op `127.0.0.1`, ongeacht `service.admin.host`. Startlog:

```
⚠️ Geen admin-auth.json gevonden: admin-interface alleen bereikbaar op https://127.0.0.1:8080
   Stel een token in met: npm run admin:set-token
```

## 3. HTTPS

- Admin-server via `https.createServer(tlsOptions, app)`.
- Certificaat:
  1. `service.admin.tls.certFile` + `keyFile` uit `config.json` als geconfigureerd;
  2. anders `certs/admin-cert.pem` + `certs/admin-key.pem` als die bestaan;
  3. anders worden die gegenereerd met de npm-package `selfsigned` (pure JS): RSA 2048,
     10 jaar geldig, CN = hostname, SAN = hostname + `localhost` + `127.0.0.1`.
- Bind-adres: `service.admin.host` (default `0.0.0.0`), geforceerd `127.0.0.1` zonder auth.
- Poort: `ADMIN_PORT` env (default 8080), ongewijzigd.
- Geen HTTP-listener en geen redirect; startlog toont `https://…`.
- Bij een self-signed certificaat toont het log een hint over de browserwaarschuwing en
  hoe een eigen certificaat te configureren.

## 4. Admin-UI

- `localStorage.adminToken` wordt niet meer gebruikt en bij het laden gewist (opruimen
  van oude installaties).
- `headers()` stuurt geen `Authorization` meer; alle `fetch`-calls gebruiken
  `credentials: "same-origin"`.
- Init: `GET /admin/auth-status` → als `requiresAuth && !authenticated` → login-scherm;
  anders app laden.
- Login-scherm: `POST /admin/login`; bij 401 "Ongeldige token", bij 429 "Te veel
  pogingen, probeer over N minuten".
- Knop **Uitloggen** in de header (alleen zichtbaar als `requiresAuth`).
- `api()`: bij een 401 op welke call dan ook wordt het login-scherm getoond.
- Het token-invoerveld in de header (`#token`/`#saveToken`) verdwijnt; alleen het
  overlay-loginscherm blijft.

## 5. Configuratie

Nieuw optioneel blok in `config.json`:

```json
{
  "service": {
    "admin": {
      "host": "0.0.0.0",
      "tls": { "certFile": "certs/admin-cert.pem", "keyFile": "certs/admin-key.pem" },
      "session": { "idleHours": 12, "maxDays": 7 }
    }
  }
}
```

Alle velden optioneel; bovenstaande zijn de defaults.

## 6. Testen

- **Unit** (`node:test`, `npm test`): `lib/admin-auth.js` — hash/verify (juist, fout,
  timing-safe pad), sessie aanmaken/verlengen/verlopen (idle en absoluut, met
  geïnjecteerde klok), rate-limit (5 pogingen, reset bij succes, blokkade verloopt),
  middleware (401 zonder cookie, doorlaten met cookie, bearer genegeerd).
- **E2E-script** (zoals in de vorige PR): start de app met en zonder
  `admin-auth.json`; controleert localhost-bind zonder auth, self-signed cert wordt
  aangemaakt, login-flow, 401 zonder cookie, bearer/`?token=` geweigerd, logout.

## 7. Documentatie en deployment

- README: sectie "Admin-authenticatie" met `npm run admin:set-token`, browserwaarschuwing
  bij self-signed, eigen certificaat configureren, `service.admin`-opties.
- `install-service-nssm.bat` en `service-installer.cjs`: `ADMIN_TOKEN`-opmerkingen
  vervangen door verwijzing naar `npm run admin:set-token`.
- `.gitignore`: `admin-auth.json` toevoegen (`certs/` staat er al in).
- `package.json`: script `admin:set-token`, script `test`, dependency `selfsigned`.

## Buiten scope

- Meerdere beheerdersaccounts / rollen.
- Windows-authenticatie (SSPI) — mogelijke vervolgstap.
- HTTP→HTTPS redirect-listener.
- Persistente sessies over een herstart heen.

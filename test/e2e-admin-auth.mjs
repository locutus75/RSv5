// End-to-end test van de admin-authenticatie. Start de echte app op poort 18443.
// Draaien: npm run test:e2e   (niet onderdeel van `npm test`; heeft vrije poorten 18443 en de SMTP-poort uit config.json nodig)
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
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/admin/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
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
    check("certificaat aanwezig", fs.existsSync(path.join(ROOT, "certs", "admin-cert.pem")));
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

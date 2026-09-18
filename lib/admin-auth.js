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

// ---------------------------------------------------------------------------
// Sessies (in-memory) en login rate-limiting
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "rs_session";

const sessions = new Map();      // sessionId -> { createdAt, lastSeen }
const loginFailures = new Map(); // ip -> { count, firstAt, blockedUntil }

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

const sessionConfig = { idleMs: 12 * 60 * 60 * 1000, maxMs: 7 * 24 * 60 * 60 * 1000, now: () => Date.now() };

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
  // Blokkade verlopen of venster voorbij: teller opschonen
  if (entry.blockedUntil || t - entry.firstAt > LOGIN_WINDOW_MS) loginFailures.delete(ip);
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
 * Is er een geldige sessie-cookie? Zet req.adminSessionId als dat zo is.
 */
export function hasValidSession(req) {
  const id = parseSessionCookie(req);
  if (id && getSession(id)) {
    req.adminSessionId = id;
    return true;
  }
  return false;
}

/**
 * Express-middleware voor /admin/*: zonder admin-auth.json alles doorlaten; anders alleen met geldige sessie-cookie.
 * Authorization-headers en ?token= worden bewust genegeerd.
 */
export function adminAuthMiddleware(req, res, next) {
  if (!isAuthRequired()) return next();
  if (hasValidSession(req)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

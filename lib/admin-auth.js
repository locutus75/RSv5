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

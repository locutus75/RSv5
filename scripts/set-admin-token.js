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

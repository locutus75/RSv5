#!/usr/bin/env node

/**
 * Script om de versie te verhogen
 * 
 * Gebruik:
 *   node scripts/bump-version.js          # Verhoog patch (standaard)
 *   node scripts/bump-version.js --patch  # Verhoog patch expliciet
 *   node scripts/bump-version.js --minor # Verhoog minor
 *   node scripts/bump-version.js --major # Verhoog major
 */

import { incrementVersion, loadVersion } from "../lib/version.js";

const args = process.argv.slice(2);
let type = "patch";

if (args.includes("--major") || args.includes("-M")) {
  type = "major";
} else if (args.includes("--minor") || args.includes("-m")) {
  type = "minor";
} else if (args.includes("--patch") || args.includes("-p")) {
  type = "patch";
}

const oldVersion = loadVersion();
const newVersion = incrementVersion(type);

console.log(`✅ Versie verhoogd: ${oldVersion.version} → ${newVersion.version}`);
console.log(`📅 Bijgewerkt op: ${newVersion.lastUpdated}`);


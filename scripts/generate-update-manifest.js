#!/usr/bin/env node

/**
 * Script om een update manifest te genereren
 * Gebruik: node scripts/generate-update-manifest.js
 */

import { generateManifest, saveManifest } from "../lib/update-manifest.js";

try {
  console.log("📦 Update manifest genereren...");
  const manifest = generateManifest();
  saveManifest(manifest);
  
  console.log(`\n✅ Manifest succesvol gegenereerd!`);
  console.log(`   Versie: ${manifest.version} build ${manifest.buildNumber}`);
  console.log(`   Bestanden: ${manifest.files.length}`);
  console.log(`   Locatie: update-manifest.json\n`);
  
  process.exit(0);
} catch (error) {
  console.error("❌ Fout bij genereren manifest:", error);
  process.exit(1);
}


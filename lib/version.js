import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION_FILE = path.join(__dirname, "..", "version.json");

/**
 * Laad de huidige versie uit version.json
 */
export function loadVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const data = fs.readFileSync(VERSION_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("❌ Fout bij laden versie:", error);
  }
  
  // Fallback naar standaard versie
  return {
    version: "5.0.0",
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Sla de versie op naar version.json
 */
export function saveVersion(versionData) {
  try {
    fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("❌ Fout bij opslaan versie:", error);
    return false;
  }
}

/**
 * Parse een versie string (bijv. "5.0.0") naar object
 */
export function parseVersion(versionString) {
  const parts = versionString.split(".").map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

/**
 * Format een versie object naar string (bijv. "5.0.0")
 */
export function formatVersion(versionObj) {
  return `${versionObj.major}.${versionObj.minor}.${versionObj.patch}`;
}

/**
 * Verhoog de versie automatisch
 * - Standaard: patch verhogen
 * - Als patch 9: minor verhogen en patch resetten
 * - Als minor 9: major verhogen en minor/patch resetten
 * 
 * @param {string} type - "patch" (standaard), "minor", of "major"
 * @returns {object} Nieuwe versie data
 */
export function incrementVersion(type = "patch") {
  const current = loadVersion();
  const version = parseVersion(current.version);
  
  if (type === "major") {
    version.major += 1;
    version.minor = 0;
    version.patch = 0;
  } else if (type === "minor") {
    version.minor += 1;
    version.patch = 0;
  } else {
    // patch (standaard)
    version.patch += 1;
    
    // Als patch 10 wordt (na 9), verhoog minor automatisch
    if (version.patch >= 10) {
      version.minor += 1;
      version.patch = 0;
      
      // Als minor 10 wordt (na 9), verhoog major automatisch
      if (version.minor >= 10) {
        version.major += 1;
        version.minor = 0;
      }
    }
  }
  
  const newVersion = formatVersion(version);
  const newVersionData = {
    version: newVersion,
    lastUpdated: new Date().toISOString()
  };
  
  saveVersion(newVersionData);
  
  return newVersionData;
}


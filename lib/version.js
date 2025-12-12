import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION_FILE = path.join(__dirname, "..", "version.json");

/**
 * Genereer buildnummer op basis van huidige maand
 * Formaat: MMVV (maand, versie telling)
 * @param {number} buildCounter - Teller voor versies in dezelfde maand
 * @returns {string} Buildnummer (bijv. "1201")
 */
function generateBuildNumber(buildCounter = 1) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0"); // 01-12
  const counter = String(buildCounter).padStart(2, "0"); // 01-99
  
  return `${month}${counter}`;
}

/**
 * Haal de maand component uit buildnummer (MM)
 * @param {string} buildNumber - Buildnummer (bijv. "1201")
 * @returns {string} Maand component (bijv. "12")
 */
function getBuildMonth(buildNumber) {
  if (!buildNumber || buildNumber.length < 2) return null;
  return buildNumber.substring(0, 2);
}

/**
 * Verhoog buildnummer automatisch
 * Als de maand hetzelfde is als deze maand, verhoog de teller
 * Anders start een nieuwe teller op 1
 * @param {string} currentBuildNumber - Huidig buildnummer
 * @returns {string} Nieuw buildnummer
 */
function incrementBuildNumber(currentBuildNumber) {
  const thisMonth = getBuildMonth(generateBuildNumber(1));
  
  if (!currentBuildNumber) {
    // Geen huidig buildnummer, start met 1
    return generateBuildNumber(1);
  }
  
  const currentMonth = getBuildMonth(currentBuildNumber);
  
  if (currentMonth === thisMonth) {
    // Zelfde maand, verhoog teller
    const currentCounter = parseInt(currentBuildNumber.substring(2)) || 0;
    const newCounter = currentCounter + 1;
    
    // Maximaal 99 builds per maand
    if (newCounter > 99) {
      console.warn("⚠️ Maximum aantal builds per maand bereikt (99), reset naar 1");
      return generateBuildNumber(1);
    }
    
    return generateBuildNumber(newCounter);
  } else {
    // Nieuwe maand, start teller op 1
    return generateBuildNumber(1);
  }
}

/**
 * Laad de huidige versie uit version.json
 * Buildnummer wordt alleen gegenereerd als het nog niet bestaat
 */
export function loadVersion() {
  let versionData;
  
  try {
    if (fs.existsSync(VERSION_FILE)) {
      // Lees altijd vers bestand (geen caching)
      const data = fs.readFileSync(VERSION_FILE, "utf8");
      versionData = JSON.parse(data);
    }
  } catch (error) {
    console.error("❌ Fout bij laden versie:", error);
  }
  
  // Fallback naar standaard versie
  if (!versionData) {
    versionData = {
      version: "5.0.0",
      lastUpdated: new Date().toISOString()
    };
  }
  
  // Genereer alleen buildnummer als het nog niet bestaat
  if (!versionData.buildNumber) {
    const newBuild = generateBuildNumber(1);
    versionData.buildNumber = newBuild;
    versionData.lastBuildUpdate = new Date().toISOString();
    saveVersion(versionData);
  }
  
  return versionData;
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
 * Format een versie object naar string (bijv. "5.0.0 build 1201")
 * @param {object} versionObj - Versie object met major, minor, patch
 * @param {string} buildNumber - Buildnummer (optioneel)
 * @returns {string} Geformatteerde versie string
 */
export function formatVersion(versionObj, buildNumber = null) {
  const versionString = `${versionObj.major}.${versionObj.minor}.${versionObj.patch}`;
  if (buildNumber) {
    return `${versionString} build ${buildNumber}`;
  }
  return versionString;
}

/**
 * Verhoog de versie automatisch
 * - Standaard: patch verhogen
 * - Als patch 9: minor verhogen en patch resetten
 * - Als minor 9: major verhogen en minor/patch resetten
 * 
 * Buildnummer wordt automatisch verhoogd bij elke versie update
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
  
  // Verhoog buildnummer automatisch bij versie update
  const newBuild = incrementBuildNumber(current.buildNumber);
  
  const newVersionData = {
    version: newVersion,
    buildNumber: newBuild,
    lastUpdated: new Date().toISOString(),
    lastBuildUpdate: new Date().toISOString()
  };
  
  saveVersion(newVersionData);
  
  return newVersionData;
}


import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { loadVersion } from "./version.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

/**
 * Bestanden en mappen die moeten worden uitgesloten van updates
 */
const EXCLUDE_PATTERNS = [
  // Node modules
  /^node_modules/,
  // Logs
  /^logs\//,
  // Config bestand (per installatie verschillend)
  /^config\.json$/,
  // Config backups
  /^config\.json\.backup\./,
  // Certificaten (bevatten gevoelige data)
  /^certs\//,
  // Tenant configuraties (gebruikersdata)
  /^tenants\.d\//,
  // Service executables
  /^daemon\//,
  /^nssm\.exe$/,
  // Temporary files
  /^\./,
  /^delete$/,
  /^qc$/,
  /^query$/,
  // Update manifest zelf (wordt dynamisch gegenereerd)
  /^update-manifest\.json$/,
  // Version file (wordt dynamisch gegenereerd)
  /^version\.json$/,
  // Package lock (wordt automatisch gegenereerd)
  /^package-lock\.json$/,
];

/**
 * Bestandsextensies die moeten worden meegenomen
 */
const INCLUDE_EXTENSIONS = [
  ".js",
  ".json",
  ".html",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".md",
  ".txt",
  ".cjs",
  ".bat",
  ".ps1",
  ".cmd"
];

/**
 * Bereken SHA256 hash van een bestand
 */
function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (error) {
    console.error(`❌ Fout bij berekenen hash voor ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Controleer of een bestand moet worden uitgesloten
 */
function shouldExclude(filePath) {
  const relativePath = path.relative(ROOT, filePath).replace(/\\/g, "/");
  
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(relativePath)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Controleer of een bestand moet worden meegenomen op basis van extensie
 */
function shouldInclude(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return INCLUDE_EXTENSIONS.includes(ext);
}

/**
 * Recursief scan directory voor relevante bestanden
 */
function scanDirectory(dir, baseDir = ROOT) {
  const files = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      
      if (shouldExclude(fullPath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Recursief scan subdirectory
        files.push(...scanDirectory(fullPath, baseDir));
      } else if (entry.isFile()) {
        // Controleer of bestand moet worden meegenomen
        if (shouldInclude(fullPath)) {
          files.push(relativePath);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Fout bij scannen directory ${dir}:`, error.message);
  }
  
  return files;
}

/**
 * Genereer update manifest voor huidige versie
 */
export function generateManifest() {
  const versionData = loadVersion();
  const files = scanDirectory(ROOT);
  const manifest = {
    version: versionData.version,
    buildNumber: versionData.buildNumber,
    timestamp: new Date().toISOString(),
    files: []
  };
  
  console.log(`📦 Genereer manifest voor versie ${manifest.version} build ${manifest.buildNumber}`);
  console.log(`📁 Scan ${files.length} bestanden...`);
  
  for (const file of files) {
    const fullPath = path.join(ROOT, file);
    
    try {
      const stats = fs.statSync(fullPath);
      const hash = calculateFileHash(fullPath);
      
      if (hash) {
        manifest.files.push({
          path: file,
          hash: hash,
          size: stats.size,
          modified: stats.mtime.toISOString()
        });
      }
    } catch (error) {
      console.warn(`⚠️ Kon bestand niet verwerken ${file}:`, error.message);
    }
  }
  
  console.log(`✅ Manifest gegenereerd met ${manifest.files.length} bestanden`);
  
  return manifest;
}

/**
 * Laad manifest uit bestand
 */
export function loadManifest(manifestPath = path.join(ROOT, "update-manifest.json")) {
  try {
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    
    const content = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error("❌ Fout bij laden manifest:", error.message);
    return null;
  }
}

/**
 * Sla manifest op naar bestand
 */
export function saveManifest(manifest, manifestPath = path.join(ROOT, "update-manifest.json")) {
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`✅ Manifest opgeslagen naar ${manifestPath}`);
    return true;
  } catch (error) {
    console.error("❌ Fout bij opslaan manifest:", error.message);
    return false;
  }
}

/**
 * Haal remote manifest op van GitHub raw content
 */
export async function fetchRemoteManifest(repoUrl) {
  try {
    // Als repoUrl niet is opgegeven, probeer GitHub raw content URL
    if (!repoUrl) {
      // Standaard GitHub raw content URL voor update-manifest.json
      // Format: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/update-manifest.json
      // Voor nu gebruiken we een placeholder - dit moet worden geconfigureerd
      console.log(`ℹ️ Geen repository URL opgegeven voor remote manifest check`);
      return null;
    }
    
    // Normaliseer URL - voeg /update-manifest.json toe als het niet al in de URL zit
    let manifestUrl = repoUrl;
    if (!manifestUrl.endsWith('update-manifest.json')) {
      manifestUrl = manifestUrl.replace(/\/$/, '') + '/update-manifest.json';
    }
    
    console.log(`🔍 Controleren op updates via: ${manifestUrl}`);
    console.log(`📄 Bestand: update-manifest.json`);
    
    // Haal manifest op via fetch
    const fetch = (await import('node-fetch')).default;
    
    // Maak een AbortController voor timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconden timeout
    
    try {
      console.log(`📡 Versturen HTTP GET request naar ${manifestUrl}...`);
      const response = await fetch(manifestUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RileeSurfis-Update-Checker'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      console.log(`📥 HTTP Response: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ Geen remote manifest gevonden op ${manifestUrl}`);
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const manifest = await response.json();
      console.log(`✅ Remote manifest succesvol opgehaald: versie ${manifest.version} build ${manifest.buildNumber}`);
      return manifest;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error(`❌ Timeout bij ophalen remote manifest van ${manifestUrl} (10 seconden)`);
        throw new Error(`Timeout: Kon geen verbinding maken met ${manifestUrl} binnen 10 seconden`);
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`❌ Fout bij ophalen remote manifest van ${repoUrl}:`, error.message);
    console.error(`   Stack trace:`, error.stack);
    throw error; // Gooi error door zodat de caller deze kan afhandelen
  }
}

/**
 * Vergelijk versies (semantic versioning)
 * Retourneert: -1 als current < remote, 0 als gelijk, 1 als current > remote
 */
export function compareVersions(currentVersion, remoteVersion) {
  if (!currentVersion || !remoteVersion) return 0;
  
  const current = currentVersion.split('.').map(Number);
  const remote = remoteVersion.split('.').map(Number);
  
  for (let i = 0; i < Math.max(current.length, remote.length); i++) {
    const currentPart = current[i] || 0;
    const remotePart = remote[i] || 0;
    
    if (currentPart < remotePart) return -1;
    if (currentPart > remotePart) return 1;
  }
  
  return 0;
}

/**
 * Valideer lokale bestanden tegen manifest
 */
export function validateManifest(manifest) {
  const errors = [];
  const missing = [];
  const changed = [];
  const validFiles = [];
  
  if (!manifest || !manifest.files || !Array.isArray(manifest.files)) {
    return {
      valid: false,
      errors: ["Ongeldig manifest formaat"],
      missing: [],
      changed: [],
      valid: []
    };
  }
  
  for (const fileEntry of manifest.files) {
    const fullPath = path.join(ROOT, fileEntry.path);
    
    if (!fs.existsSync(fullPath)) {
      missing.push(fileEntry.path);
      continue;
    }
    
    const currentHash = calculateFileHash(fullPath);
    
    if (!currentHash) {
      errors.push(`Kon hash niet berekenen voor ${fileEntry.path}`);
      continue;
    }
    
    if (currentHash !== fileEntry.hash) {
      changed.push({
        path: fileEntry.path,
        expectedHash: fileEntry.hash,
        actualHash: currentHash
      });
    } else {
      validFiles.push(fileEntry.path);
    }
  }
  
  const isValid = errors.length === 0 && missing.length === 0 && changed.length === 0;
  
  return {
    valid: isValid,
    errors: errors,
    missing: missing,
    changed: changed,
    valid: validFiles
  };
}

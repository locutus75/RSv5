import { createServer } from "./lib/server.js"; 
import { loadConfig } from "./lib/config.js";
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { EventEmitter } from "events";

// Command-line argument parser
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    debug: false,
    verbose: false,
    logLevel: 'info',
    logFile: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--debug':
      case '-d':
        options.debug = true;
        options.logLevel = 'debug';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        options.logLevel = 'verbose';
        break;
      case '--log-level':
        if (i + 1 < args.length) {
          const level = args[++i];
          if (['error', 'warn', 'info', 'debug', 'verbose'].includes(level)) {
            options.logLevel = level;
                  } else {
          process.stderr.write(`❌ Ongeldig log niveau: ${level}\n`);
          process.exit(1);
        }
        }
        break;
      case '--log-file':
        if (i + 1 < args.length) {
          options.logFile = args[++i];
        }
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`❌ Onbekende optie: ${arg}\n`);
          process.stderr.write('Gebruik --help voor beschikbare opties\n');
          process.exit(1);
        }
    }
  }

  return options;
}

// Parse command-line arguments
const cliOptions = parseArguments();

// Toon help als gevraagd
if (cliOptions.help) {
  process.stdout.write(`
🚀 RSv5 Server - Command-line opties

Gebruik: node index.js [opties]

Opties:
  -d, --debug           Schakelt debug logging in voor mailserver (logLevel = debug)
  -v, --verbose         Schakelt verbose logging in voor mailserver (logLevel = verbose)
  --log-level <level>   Stelt log niveau in voor mailserver (error, warn, info, debug, verbose)
  --log-file <path>     Specificeert bestand voor mailserver logging
  -h, --help            Toont deze help informatie

Let op: Logging opties zijn alleen van toepassing op de mailserver functionaliteit.
De applicatie startup gebruikt altijd normale console logging.

Voorbeelden:
  node index.js --debug
  node index.js --verbose --log-file ./logs/mail.log
  node index.js --log-level warn
`);
  process.exit(0);
}

// Logger functie met verschillende niveaus
function log(level, message, ...args) {
  const timestamp = new Date().toISOString();
  const levelMap = {
    error: '❌',
    warn: '⚠️',
    info: 'ℹ️',
    debug: '🐛',
    verbose: '🔍'
  };
  
  const icon = levelMap[level] || 'ℹ️';
  const formattedMessage = `${timestamp} ${icon} ${message}`;
  
  // Controleer of we moeten loggen op basis van logLevel
  const logLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
  const currentLevel = logLevels.indexOf(cliOptions.logLevel);
  const messageLevel = logLevels.indexOf(level);
  
  if (messageLevel <= currentLevel) {
    // Schrijf naar console alleen als er GEEN log bestand is opgegeven
    if (!cliOptions.logFile) {
      process.stdout.write(formattedMessage + ' ' + args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ') + '\n');
    }
    
    // Schrijf naar log bestand als opgegeven
    if (cliOptions.logFile) {
      try {
        const logDir = path.dirname(cliOptions.logFile);
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logEntry = `${timestamp} [${level.toUpperCase()}] ${message} ${args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')}\n`;
        
        fs.appendFileSync(cliOptions.logFile, logEntry);
      } catch (error) {
        // Gebruik process.stderr.write om recursie te voorkomen
        process.stderr.write(`❌ Fout bij schrijven naar log bestand: ${error.message}\n`);
      }
    }
  }
}

// Helper functies voor verschillende log niveaus
const logger = {
  error: (message, ...args) => log('error', message, ...args),
  warn: (message, ...args) => log('warn', message, ...args),
  info: (message, ...args) => log('info', message, ...args),
  debug: (message, ...args) => log('debug', message, ...args),
  verbose: (message, ...args) => log('verbose', message, ...args)
};

// Mailserver-specifieke logger (gebruikt door de SMTP server)
export const mailServerLogger = {
  error: (message, ...args) => log('error', `[MAIL] ${message}`, ...args),
  warn: (message, ...args) => log('warn', `[MAIL] ${message}`, ...args),
  info: (message, ...args) => log('info', `[MAIL] ${message}`, ...args),
  debug: (message, ...args) => log('debug', `[MAIL] ${message}`, ...args),
  verbose: (message, ...args) => log('verbose', `[MAIL] ${message}`, ...args)
};

// Behoud originele console functies voor applicatie startup
// Overschrijf console functies NIET - alleen de mailserver gebruikt de logger

// Toon startup informatie
console.log(`🚀 RSv5 Server gestart`);
console.log(`📊 Logging configuratie: ${cliOptions.logLevel}`);
if (cliOptions.logFile) {
  console.log(`📝 Logging naar bestand: ${cliOptions.logFile}`);
}
if (cliOptions.debug) {
  console.log(`🐛 Debug mode ingeschakeld`);
}
if (cliOptions.verbose) {
  console.log(`🔍 Verbose mode ingeschakeld`);
}

// Load environment variables from .env file if it exists
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        if (value && !process.env[key]) {
          process.env[key] = value;
          console.log(`📝 Loaded environment variable: ${key}`);
        }
      }
    });
  }
} catch (error) {
  console.log('ℹ️ No .env file found or error loading it');
}

// Global event emitter voor communicatie tussen servers
global.serverEvents = new EventEmitter();

// Admin server setup
const app = express();
const ADMIN_PORT = process.env.ADMIN_PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ka8jajs@9djj3lsjdklsdfulij238sdfh";
const ROOT = process.cwd();
const TENANTS_DIR = path.join(ROOT, "tenants.d");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "schema", "tenant.schema.json"), "utf8"));

app.use(cors());
app.use(express.json());

// 1) Serve UI without auth
app.use("/", express.static(path.join(ROOT, "admin-ui")));

// 2) Public admin endpoints (altijd toegankelijk)
app.get("/admin/health", (req, res) => res.json({ ok: true }));

app.get("/admin/auth-status", (req, res) => {
  // Als er geen ADMIN_TOKEN is ingesteld, is authenticatie niet vereist
  if (!ADMIN_TOKEN) {
    console.log("🔐 /admin/auth-status: Geen ADMIN_TOKEN ingesteld, authenticatie niet vereist");
    return res.json({ 
      requiresAuth: false,
      hasToken: false 
    });
  }
  
  // Controleer of er een geldige token is meegestuurd
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.substring(7) : (req.query.token || "");
  
  console.log(`🔐 /admin/auth-status: Token check - Ontvangen: "${token}", Verwacht: "${ADMIN_TOKEN}", Match: ${token === ADMIN_TOKEN}`);
  
  if (token === ADMIN_TOKEN) {
    console.log("🔐 /admin/auth-status: Token geldig");
    return res.json({ 
      requiresAuth: true,
      hasToken: true,
      valid: true
    });
  }
  
  // Token is ongeldig of ontbreekt
  console.log("🔐 /admin/auth-status: Token ongeldig of ontbreekt");
  return res.json({ 
    requiresAuth: true,
    hasToken: false,
    valid: false
  });
});

// 3) Auth only for protected /admin routes (if ADMIN_TOKEN is set)
app.use("/admin", (req, res, next) => {
  if (!ADMIN_TOKEN) {
    console.log("ℹ️ No ADMIN_TOKEN set, skipping authentication");
    return next();
  }
  
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.substring(7) : (req.query.token || "");
  
  if (token === ADMIN_TOKEN) {
    return next();
  }
  
  console.log(`❌ Unauthorized access attempt: ${req.method} ${req.path}`);
  return res.status(401).json({ error: "Unauthorized" });
});

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(SCHEMA);

function listTenantFiles() {
  if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });
  return fs.readdirSync(TENANTS_DIR).filter(f => f.toLowerCase().endsWith(".json"));
}

function readTenant(nameOrFile) {
  const file = nameOrFile.endsWith(".json") ? nameOrFile : `${nameOrFile}.json`;
  const full = path.join(TENANTS_DIR, file);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

function writeTenant(name, data) {
  const provided = (name || "").toString().trim();
  const isJson = /\.json$/i.test(provided);
  let fileName;
  if (isJson && provided) {
    fileName = path.basename(provided).replace(/[\\/]/g, "");
  } else {
    const base = path.basename((name || data.name || "tenant").toString());
    const safe = base.replace(/\W+/g, "_");
    fileName = `${safe}.json`;
  }
  const full = path.join(TENANTS_DIR, fileName);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
  return { file: fileName };
}



// Tenants CRUD
app.get("/admin/tenants", (req, res) => {
  const files = listTenantFiles();
  const items = files.map(f => ({ file: f, ...(readTenant(f) || {}) }));
  res.json(items);
});

app.get("/admin/tenants/:name", (req, res) => {
  const data = readTenant(req.params.name);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

app.post("/admin/tenants/validate", (req, res) => {
  const data = req.body;
  const ok = validate(data);
  if (!ok) return res.status(400).json({ ok: false, errors: validate.errors });
  res.json({ ok: true });
});

app.post("/admin/tenants", (req, res) => {
  const data = req.body;
  const ok = validate(data);
  if (!ok) return res.status(400).json({ ok: false, errors: validate.errors });
  const out = writeTenant(data.name, data);
  
  // Trigger automatic reload na nieuwe tenant
  if (global.serverEvents) {
    global.serverEvents.emit("reload");
    console.log(`🔄 Auto-reload triggered after creating tenant: ${data.name}`);
    
    // Log configuratie wijziging
    global.serverEvents.emit("configChange", {
      type: "tenant_created",
      message: `Tenant created: ${data.name}`,
      timestamp: new Date().toISOString(),
      tenant: data.name
    });
  }
  
  res.status(201).json({ ok: true, ...out });
});

app.put("/admin/tenants/:name", (req, res) => {
  const data = req.body;
  const ok = validate(data);
  if (!ok) return res.status(400).json({ ok: false, errors: validate.errors });
  const out = writeTenant(req.params.name, data);
  
  // Trigger automatic reload na tenant wijziging
  if (global.serverEvents) {
    global.serverEvents.emit("reload");
    console.log(`🔄 Auto-reload triggered after updating tenant: ${req.params.name}`);
    
    // Log configuratie wijziging
    global.serverEvents.emit("configChange", {
      type: "tenant_updated",
      message: `Tenant updated: ${req.params.name}`,
      timestamp: new Date().toISOString(),
      tenant: req.params.name
    });
  }
  
  res.json({ ok: true, ...out });
});

app.delete("/admin/tenants/:name", (req, res) => {
  const file = req.params.name.endsWith(".json") ? req.params.name : `${req.params.name}.json`;
  const full = path.join(TENANTS_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Not found" });
  fs.unlinkSync(full);
  
  // Trigger automatic reload na tenant verwijdering
  if (global.serverEvents) {
    global.serverEvents.emit("reload");
    console.log(`🔄 Auto-reload triggered after deleting tenant: ${req.params.name}`);
    
    // Log configuratie wijziging
    global.serverEvents.emit("configChange", {
      type: "tenant_deleted",
      message: `Tenant deleted: ${req.params.name}`,
      timestamp: new Date().toISOString(),
      tenant: req.params.name
    });
  }
  
  res.json({ ok: true });
});

// Manual tenant reload endpoint
app.post("/admin/tenants/reload", async (req, res) => {
  try {
    if (global.serverEvents) {
      global.serverEvents.emit("reload");
      console.log(`🔄 Manual tenant reload requested`);
      
      // Log configuratie wijziging
      global.serverEvents.emit("configChange", {
        type: "manual_reload",
        message: "Manual tenant reload requested",
        timestamp: new Date().toISOString()
      });
      
      res.json({ 
        ok: true, 
        message: "Tenants reloaded successfully", 
        timestamp: new Date().toISOString()
      });
    } else {
      console.log("⚠️ Global server events not available");
      res.status(500).json({ 
        ok: false, 
        error: "Server events not available"
      });
    }
  } catch (error) {
    console.error("❌ Manual tenant reload failed:", error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to reload tenants", 
      message: error.message
    });
  }
});

// Stats & events (read logs/relay.jsonl)
const LOG_FILE = path.join(ROOT, "logs", "relay.jsonl");

function parseWindow(str) {
  if (!str) return 60 * 60 * 1000; // 60m default
  const t = String(str).trim().toLowerCase();
  if (t === "all" || t === "alles" || t === "*") return null; // onbeperkt
  const m = /^([0-9]+)\s*([smhd])$/.exec(t);
  if (!m) return 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return n * mult;
}

function readLogLines(maxBytes = 2 * 1024 * 1024) {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const stat = fs.statSync(LOG_FILE);
    const bytes = (maxBytes === Infinity ? stat.size : maxBytes);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(LOG_FILE, "r");
    const buf = Buffer.alloc(stat.size - start);
    const data = fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

app.get("/admin/stats", (req, res) => {
  const windowMs = parseWindow(req.query.window);
  const since = (windowMs == null) ? 0 : (Date.now() - windowMs);
  const tenant = req.query.tenant?.trim();
  const lines = readLogLines(windowMs == null ? Infinity : undefined);
  const tenants = {};
  
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.ts && since > 0 && ev.ts < since) continue;
      
      // Filter op tenant als deze is opgegeven
      if (tenant && ev.tenant !== tenant) continue;
      
      if (ev.level === "deliver.ok") {
        const t = ev.tenant || "unknown";
        tenants[t] = tenants[t] || { sent: 0, errors: 0 };
        tenants[t].sent++;
      } else if (ev.level === "deliver.err") {
        const t = ev.tenant || "unknown";
        tenants[t] = tenants[t] || { sent: 0, errors: 0 };
        tenants[t].errors++;
      }
    } catch {}
  }
  
  res.json({ tenants });
});

app.get("/admin/events", (req, res) => {
  const limit = parseInt(req.query.limit || "200", 10);
  const tenant = req.query.tenant?.trim();
  const reason = req.query.reason?.trim();
  const lines = readLogLines();
  const events = [];
  
  for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      
      // Filter op tenant als deze is opgegeven
      if (tenant && ev.tenant !== tenant) continue;
      
      // Filter op reason als deze is opgegeven
      if (reason && reason !== "all") {
        if (reason === "success" && ev.level !== "deliver.ok") continue;
        if (reason === "errors" && ev.level !== "deliver.err") continue;
        if (reason === "config" && !ev.level?.startsWith("config.")) continue;
        if (reason !== "success" && reason !== "errors" && reason !== "config" && ev.reason !== reason) continue;
      }
      
      events.push(ev);
    } catch {}
  }
  
  res.json({ events });
});

// Functie om configuratie te herladen
async function reloadConfig() {
  try {
    const config = await loadConfig();
    console.log(`🔄 Configuration reloaded - ${config.tenants?.length || 0} tenants`);
    return config;
  } catch (error) {
    console.error("❌ Failed to reload configuration:", error);
    throw error;
  }
}

// Start beide servers
loadConfig().then(async (config) => {
  // Start admin server
  app.listen(ADMIN_PORT, () => {
    console.log(`🌐 Admin server started on port ${ADMIN_PORT}`);
  });
  
  // Start SMTP server
  const { createServer, configureLogger } = await import("./lib/server.js");
  const smtpServer = await createServer(config);
  
  // Configureer de logger voor de mailserver als er logging opties zijn ingesteld
  if (cliOptions.logLevel !== 'info' || cliOptions.logFile) {
    configureLogger(mailServerLogger);
    console.log(`📝 Mailserver logging geconfigureerd: ${cliOptions.logLevel}${cliOptions.logFile ? ` → ${cliOptions.logFile}` : ''}`);
    
    // Als er een log bestand is opgegeven, schakel dan console output uit voor de mailserver
    if (cliOptions.logFile) {
      console.log(`🔇 Console output uitgeschakeld voor mailserver (logging naar: ${cliOptions.logFile})`);
    }
  }
  
  // Luister naar reload events
  global.serverEvents.on("reload", async () => {
    try {
      console.log(`🔄 Reload event received, reloading configuration...`);
      const newConfig = await reloadConfig();
      if (smtpServer.reloadTenants) {
        await smtpServer.reloadTenants();
        console.log(`✅ SMTP server tenants reloaded successfully`);
        
        // Log configuratie wijziging voor events
        if (global.serverEvents) {
          global.serverEvents.emit("configChange", {
            type: "tenants_reloaded",
            message: "Tenants configuration reloaded",
            timestamp: new Date().toISOString(),
            tenantCount: newConfig.tenants?.length || 0
          });
        }
      }
    } catch (error) {
      console.error("❌ Failed to reload SMTP server:", error);
    }
  });
  
  console.log("🚀 Both servers started successfully");
  console.log(`📧 SMTP server ready`);
  console.log(`🌐 Admin interface available at http://localhost:${ADMIN_PORT}`);
  if (ADMIN_TOKEN) {
    console.log(`🔐 Admin authentication enabled (ADMIN_TOKEN set)`);
  } else {
    console.log(`⚠️ Admin authentication disabled (no ADMIN_TOKEN set)`);
  }
}).catch(e => {
  console.error("❌ Failed to start servers:", e);
  process.exit(1);
});

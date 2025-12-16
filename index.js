import { createServer } from "./lib/server.js"; 
import { loadConfig } from "./lib/config.js";
import { loadVersion, incrementVersion } from "./lib/version.js";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { EventEmitter } from "events";
import os from "os";

// Bepaal applicatie root op basis van waar index.js zich bevindt
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = __dirname;

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
  const envPath = path.join(APP_ROOT, '.env');
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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const ROOT = APP_ROOT;
const TENANTS_DIR = path.join(ROOT, "tenants.d");
const CONFIG_FILE = path.join(ROOT, "config.json");
const UPDATE_CONFIG_FILE = path.join(ROOT, "update-config.json");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "schema", "tenant.schema.json"), "utf8"));

// Stel trust proxy in voor correcte IP detectie achter proxies
app.set('trust proxy', true);

app.use(cors());
// Verhoog body size limiet voor bijlages in test emails (50MB limiet)
// Base64 encoding maakt bestanden ~33% groter, dus dit ondersteunt bestanden tot ~37MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Helper functie om remote IP te krijgen (rekening houdend met proxies)
function getRemoteIP(req) {
  // Controleer x-forwarded-for header (wanneer achter een proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for kan meerdere IP's bevatten, neem de eerste
    return forwarded.split(',')[0].trim();
  }
  // Gebruik req.ip als beschikbaar (Express trust proxy moet ingesteld zijn)
  if (req.ip) {
    return req.ip;
  }
  // Fallback naar connection remoteAddress
  return req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

// Request logging middleware - log alle requests met remote IP
app.use((req, res, next) => {
  const remoteIP = getRemoteIP(req);
  const timestamp = new Date().toISOString();
  logger.info(`[${req.method}] ${req.path} - Remote IP: ${remoteIP}`);
  next();
});

// 2) Public admin endpoints (altijd toegankelijk) - MOET VOOR static route staan
app.get("/admin/health", (req, res) => res.json({ ok: true }));

app.get("/admin/auth-status", (req, res) => {
  const remoteIP = getRemoteIP(req);
  
  // Als er geen ADMIN_TOKEN is ingesteld, is authenticatie niet vereist
  if (!ADMIN_TOKEN) {
    console.log(`🔐 /admin/auth-status: Geen ADMIN_TOKEN ingesteld, authenticatie niet vereist - Remote IP: ${remoteIP}`);
    return res.json({ 
      requiresAuth: false,
      hasToken: false 
    });
  }
  
  // Controleer of er een geldige token is meegestuurd
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.substring(7) : (req.query.token || "");
  
  console.log(`🔐 /admin/auth-status: Token check - Ontvangen: "${token}", Verwacht: "${ADMIN_TOKEN}", Match: ${token === ADMIN_TOKEN} - Remote IP: ${remoteIP}`);
  
  if (token === ADMIN_TOKEN) {
    console.log(`🔐 /admin/auth-status: Token geldig - Remote IP: ${remoteIP}`);
    return res.json({ 
      requiresAuth: true,
      hasToken: true,
      valid: true
    });
  }
  
  // Token is ongeldig of ontbreekt
  console.log(`🔐 /admin/auth-status: Token ongeldig of ontbreekt - Remote IP: ${remoteIP}`);
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
  
  const remoteIP = getRemoteIP(req);
  console.log(`❌ Unauthorized access attempt: ${req.method} ${req.path} - Remote IP: ${remoteIP}`);
  return res.status(401).json({ error: "Unauthorized" });
});

// Test SMTP connection endpoint (protected, binnen /admin routes)
app.post("/admin/test-smtp-connection", async (req, res) => {
  try {
    const remoteIP = getRemoteIP(req);
    console.log(`📧 Test SMTP connection request ontvangen - Remote IP: ${remoteIP}`);
    const smtpServer = req.body;
    console.log(`📧 SMTP server data: ${JSON.stringify(smtpServer)} - Remote IP: ${remoteIP}`);
    
    if (!smtpServer || !smtpServer.adres || !smtpServer.poort) {
      console.log("❌ Ontbrekende velden:", { adres: smtpServer?.adres, poort: smtpServer?.poort });
      return res.status(400).json({ ok: false, error: "SMTP server adres en poort zijn verplicht" });
    }
    
    // Haal serverIP op uit configuratie voor uitgaande verbinding
    const { loadConfig } = await import("./lib/config.js");
    const config = await loadConfig();
    const serverIP = config.service?.serverIP || "0.0.0.0";
    
    // Dynamisch importeren van smtp module
    const { testSMTPConnection } = await import("./lib/smtp.js");
    const result = await testSMTPConnection(smtpServer, serverIP);
    
    console.log("📧 Test resultaat:", result);
    res.json(result);
  } catch (error) {
    console.error("❌ Error testing SMTP connection:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(SCHEMA);

// Functie om een aangepast schema te maken voor SMTP (zonder Graph API velden)
function createSchemaForDeliveryMethod(deliveryMethod) {
  const schema = JSON.parse(JSON.stringify(SCHEMA));
  if (deliveryMethod === "smtp") {
    // Bij SMTP: verwijder alleen Graph API velden uit het schema
    // allowedSenders blijft behouden - wordt gebruikt voor routing en sender validatie
    delete schema.properties.tenantId;
    delete schema.properties.clientId;
    delete schema.properties.auth;
    delete schema.properties.defaultMailbox;
  }
  return schema;
}

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

// BELANGRIJK: Specifieke routes moeten VOOR parameterized routes staan!
// Anders wordt "/admin/tenants/test" geïnterpreteerd als "/admin/tenants/:name" waarbij name="test"

app.post("/admin/tenants/validate", (req, res) => {
  const data = req.body;
  const ok = validate(data);
  if (!ok) return res.status(400).json({ ok: false, errors: validate.errors });
  res.json({ ok: true });
});

// Test endpoint voor tenant configuratie validatie (zonder opslaan)
app.post("/admin/tenants/test", (req, res) => {
  const data = req.body;
  const remoteIP = getRemoteIP(req);
  console.log(`🧪 Tenant configuratie testen - ontvangen data: ${JSON.stringify(data, null, 2)} - Remote IP: ${remoteIP}`);
  
  const validationResults = {
    ok: true,
    errors: [],
    warnings: [],
    checks: []
  };
  
  try {
    // Basis validatie: Tenant naam
    if (!data.name || !data.name.trim()) {
      validationResults.ok = false;
      validationResults.errors.push({ field: "name", message: "Tenant naam is verplicht" });
    } else {
      validationResults.checks.push({ field: "name", status: "ok", message: "Tenant naam is ingevuld" });
    }
    
    // Aangepaste validatie: Graph API velden zijn alleen verplicht als delivery method "graph" is
    const deliveryMethod = data.delivery?.method || "graph";
    
    // Bij SMTP: verwijder Graph API velden voordat schema validatie wordt uitgevoerd
    let dataForValidation = JSON.parse(JSON.stringify(data)); // Deep copy
    if (deliveryMethod === "smtp") {
      // Verwijder Graph API velden bij SMTP - ze worden niet gebruikt
      delete dataForValidation.tenantId;
      delete dataForValidation.clientId;
      delete dataForValidation.auth;
      delete dataForValidation.defaultMailbox;
    }
    
    // Validatie: Ten minste één routing criterium is verplicht (routing.senderDomains of allowedSenders)
    const hasRoutingDomains = data.routing?.senderDomains && data.routing.senderDomains.length > 0;
    const hasAllowedSenders = data.allowedSenders && data.allowedSenders.length > 0;
    
    if (!hasRoutingDomains && !hasAllowedSenders) {
      validationResults.ok = false;
      validationResults.errors.push({ 
        field: "routing", 
        message: "Ten minste één van de volgende velden is verplicht: Routing domains of Allowed senders (gebruikt voor tenant routing)" 
      });
    } else {
      if (hasRoutingDomains) {
        validationResults.checks.push({ field: "routing.senderDomains", status: "ok", message: `Routing domains geconfigureerd (${data.routing.senderDomains.length} domain(s))` });
      }
      if (hasAllowedSenders) {
        validationResults.checks.push({ field: "allowedSenders", status: "ok", message: `Allowed senders geconfigureerd (${data.allowedSenders.length} sender(s))` });
      }
    }
    
    // Delivery method validatie
    if (deliveryMethod === "graph") {
      // Voor Graph API zijn deze velden verplicht - controleer nieuwe structuur (delivery.graph) of legacy (top-level)
      const graphConfig = data.delivery?.graph || {};
      const hasGraphConfig = (graphConfig.tenantId && graphConfig.clientId && graphConfig.auth && graphConfig.defaultMailbox) ||
                            (data.tenantId && data.clientId && data.auth && data.defaultMailbox);
      if (!hasGraphConfig) {
        validationResults.ok = false;
        validationResults.errors.push({ 
          field: "delivery.graph", 
          message: "Voor Graph API zijn Tenant ID, Client ID, Auth en Default Mailbox verplicht" 
        });
      } else {
        validationResults.checks.push({ field: "delivery.graph", status: "ok", message: "Graph API configuratie compleet" });
      }
    } else if (deliveryMethod === "smtp") {
      // Voor SMTP is alleen de SMTP server verplicht
      const smtpServer = data.delivery?.smtp?.smtpServer || data.delivery?.smtpServer;
      if (!smtpServer) {
        validationResults.ok = false;
        validationResults.errors.push({ 
          field: "delivery.smtp", 
          message: "Voor SMTP delivery is een SMTP server verplicht" 
        });
      } else {
        validationResults.checks.push({ field: "delivery.smtp", status: "ok", message: `SMTP server geselecteerd: ${smtpServer}` });
      }
    }
    
    // Schema validatie op data zonder Graph API velden bij SMTP
    const validationSchema = createSchemaForDeliveryMethod(deliveryMethod);
    const validateForMethod = ajv.compile(validationSchema);
    const schemaOk = validateForMethod(dataForValidation);
    if (!schemaOk) {
      validationResults.ok = false;
      validationResults.errors.push(...validateForMethod.errors.map(err => ({
        field: err.instancePath || err.schemaPath,
        message: err.message
      })));
    } else {
      validationResults.checks.push({ field: "schema", status: "ok", message: "Schema validatie geslaagd" });
    }
    
    // Extra checks voor specifieke velden
    if (data.routing?.ipRanges && data.routing.ipRanges.length > 0) {
      validationResults.checks.push({ field: "routing.ipRanges", status: "ok", message: `IP ranges geconfigureerd (${data.routing.ipRanges.length} range(s))` });
    }
    
    if (data.policy?.maxMessageSizeKB) {
      validationResults.checks.push({ field: "policy.maxMessageSizeKB", status: "ok", message: `Max message size: ${data.policy.maxMessageSizeKB} KB` });
    }
    
    if (data.policy?.rateLimit) {
      const rateLimit = data.policy.rateLimit;
      if (rateLimit.perMinute) {
        validationResults.checks.push({ field: "policy.rateLimit.perMinute", status: "ok", message: `Rate limit per minuut: ${rateLimit.perMinute}` });
      }
      if (rateLimit.perHour) {
        validationResults.checks.push({ field: "policy.rateLimit.perHour", status: "ok", message: `Rate limit per uur: ${rateLimit.perHour}` });
      }
    }
    
    res.json(validationResults);
  } catch (error) {
    console.error("❌ Fout bij testen tenant configuratie:", error);
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      errors: [{ field: "general", message: error.message }]
    });
  }
});

// BELANGRIJK: Test email endpoint moet ook vóór parameterized routes staan
// Test email versturen endpoint
app.post("/admin/tenants/test-send", async (req, res) => {
  const remoteIP = getRemoteIP(req);
  console.log(`📧 Test email endpoint aangeroepen - Remote IP: ${remoteIP}`);
  console.log(`📧 Request body:`, JSON.stringify(req.body, null, 2));
  
  try {
    const { tenant, testEmail } = req.body;
    console.log(`📧 Test email versturen - Tenant: ${tenant?.name}, Remote IP: ${remoteIP}`);
    
    if (!tenant || !tenant.name) {
      return res.status(400).json({ ok: false, error: "Tenant configuratie ontbreekt" });
    }
    
    if (!testEmail || !testEmail.to || !testEmail.from) {
      return res.status(400).json({ ok: false, error: "Test email gegevens ontbreken (to en from zijn verplicht)" });
    }
    
    // Laad service configuratie om SMTP servers op te halen
    const config = await loadConfig();
    const svc = config.service || {};
    
    // Bepaal delivery method
    const deliveryMethod = tenant.delivery?.method || "graph";
    
    // Maak een mock parsed email object voor test
    const mailparser = await import("mailparser");
    const { simpleParser } = mailparser;
    
    // Simuleer een email bericht
    const emailText = `From: ${testEmail.from}
To: ${testEmail.to}
Subject: ${testEmail.subject || "Test Email"}
Content-Type: text/plain; charset=utf-8

${testEmail.body || "Dit is een test email verzonden via de tenant configuratie."}`;
    
    const parsed = await simpleParser(emailText);
    
    // Voeg bijlages toe als deze zijn opgegeven
    if (testEmail.attachments && testEmail.attachments.length > 0) {
      parsed.attachments = testEmail.attachments.map(att => {
        // Converteer base64 string terug naar Buffer
        const contentBuffer = Buffer.from(att.content, 'base64');
        return {
          filename: att.filename || 'attachment',
          contentType: att.contentType || 'application/octet-stream',
          content: contentBuffer,
          size: contentBuffer.length
        };
      });
      console.log(`📎 ${testEmail.attachments.length} bijlage(s) toegevoegd aan test email`);
    }
    
    const rcpts = [testEmail.to];
    const envelopeFrom = testEmail.from;
    
    let result;
    
    if (deliveryMethod === "smtp") {
      // SMTP delivery
      const smtpServerName = tenant.delivery?.smtp?.smtpServer || tenant.delivery?.smtpServer;
      if (!smtpServerName) {
        return res.status(400).json({ ok: false, error: "SMTP server niet geconfigureerd" });
      }
      
      const smtpServers = svc.smtpServers || [];
      const smtpServer = smtpServers.find(s => s.naam === smtpServerName);
      if (!smtpServer) {
        return res.status(400).json({ ok: false, error: `SMTP server niet gevonden: ${smtpServerName}` });
      }
      
      // Haal serverIP op uit configuratie voor uitgaande verbinding
      const { loadConfig } = await import("./lib/config.js");
      const config = await loadConfig();
      const serverIP = config.service?.serverIP || "0.0.0.0";
      
      const { sendViaSMTP } = await import("./lib/smtp.js");
      result = await sendViaSMTP({ tenant, parsed, rcpts, envelopeFrom, smtpServer, localAddress: serverIP });
      
    } else {
      // Graph API delivery
      const graphConfig = tenant.delivery?.graph || {};
      const mailbox = graphConfig.defaultMailbox || tenant.defaultMailbox;
      
      if (!mailbox) {
        return res.status(400).json({ ok: false, error: "Default mailbox niet geconfigureerd voor Graph API" });
      }
      
      // Controleer of Graph API configuratie compleet is
      const hasGraphConfig = (graphConfig.tenantId && graphConfig.clientId && graphConfig.auth) ||
                            (tenant.tenantId && tenant.clientId && tenant.auth);
      
      if (!hasGraphConfig) {
        return res.status(400).json({ ok: false, error: "Graph API configuratie niet compleet" });
      }
      
      // Maak tenant object met Graph API configuratie
      const graphTenant = {
        name: tenant.name,
        tenantId: graphConfig.tenantId || tenant.tenantId,
        clientId: graphConfig.clientId || tenant.clientId,
        auth: graphConfig.auth || tenant.auth,
        defaultMailbox: mailbox
      };
      
      const { sendViaGraph } = await import("./lib/graph.js");
      const bccRecipients = testEmail.bcc ? [testEmail.bcc] : [];
      result = await sendViaGraph({ 
        tenant: graphTenant, 
        mailbox, 
        parsed, 
        rcpts, 
        envelopeFrom,
        bccRecipients,
        saveToSent: false 
      });
    }
    
    res.json({ 
      ok: true, 
      message: "Test email succesvol verzonden",
      messageId: result?.messageId || "N/A",
      deliveryMethod 
    });
    
  } catch (error) {
    console.error("❌ Fout bij versturen test email:", error);
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      details: error.stack 
    });
  }
});

// Parameterized routes moeten NA specifieke routes staan
app.get("/admin/tenants/:name", (req, res) => {
  const data = readTenant(req.params.name);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

app.post("/admin/tenants", (req, res) => {
  const data = req.body;
  const remoteIP = getRemoteIP(req);
  console.log(`📝 Tenant opslaan - ontvangen data: ${JSON.stringify(data, null, 2)} - Remote IP: ${remoteIP}`);
  
  // Aangepaste validatie: Graph API velden zijn alleen verplicht als delivery method "graph" is
  const deliveryMethod = data.delivery?.method || "graph";
  
  // Bij SMTP: verwijder Graph API velden voordat schema validatie wordt uitgevoerd
  let dataForValidation = JSON.parse(JSON.stringify(data)); // Deep copy
  if (deliveryMethod === "smtp") {
    // Verwijder Graph API velden bij SMTP - ze worden niet gebruikt
    // allowedSenders blijft behouden - wordt gebruikt voor routing en sender validatie
    delete dataForValidation.tenantId;
    delete dataForValidation.clientId;
    delete dataForValidation.auth;
    delete dataForValidation.defaultMailbox;
    console.log("📝 SMTP geselecteerd - Graph API velden verwijderd voor validatie");
    console.log("📝 Data voor validatie:", JSON.stringify(dataForValidation, null, 2));
  }
  
  // Validatie: Ten minste één routing criterium is verplicht (routing.senderDomains of allowedSenders)
  const hasRoutingDomains = data.routing?.senderDomains && data.routing.senderDomains.length > 0;
  const hasAllowedSenders = data.allowedSenders && data.allowedSenders.length > 0;
  
  if (!hasRoutingDomains && !hasAllowedSenders) {
    return res.status(400).json({ 
      ok: false, 
      error: "Ten minste één van de volgende velden is verplicht: Routing domains of Allowed senders (gebruikt voor tenant routing)",
      errors: [
        { instancePath: "", message: "Routing configuratie ontbreekt: routing.senderDomains of allowedSenders is verplicht" }
      ]
    });
  }
  
  if (deliveryMethod === "graph") {
    // Voor Graph API zijn deze velden verplicht - controleer nieuwe structuur (delivery.graph) of legacy (top-level)
    const graphConfig = data.delivery?.graph || {};
    const hasGraphConfig = (graphConfig.tenantId && graphConfig.clientId && graphConfig.auth && graphConfig.defaultMailbox) ||
                          (data.tenantId && data.clientId && data.auth && data.defaultMailbox);
    if (!hasGraphConfig) {
      return res.status(400).json({ 
        ok: false, 
        error: "Voor Graph API zijn Tenant ID, Client ID, Auth en Default Mailbox verplicht",
        errors: [
          { instancePath: "", message: "Graph API configuratie ontbreekt" }
        ]
      });
    }
    // Bij Graph API mogen Graph API velden NIET ontbreken
  } else if (deliveryMethod === "smtp") {
    // Voor SMTP is alleen de SMTP server verplicht (nieuwe structuur: delivery.smtp.smtpServer of legacy: delivery.smtpServer)
    const smtpServer = data.delivery?.smtp?.smtpServer || data.delivery?.smtpServer;
    if (!smtpServer) {
      return res.status(400).json({ 
        ok: false, 
        error: "Voor SMTP delivery is een SMTP server verplicht",
        errors: [
          { instancePath: "/delivery/smtp/smtpServer", message: "SMTP server is verplicht" }
        ]
      });
    }
    // Bij SMTP mogen Graph API velden (tenantId, clientId, auth, etc.) ontbreken - ze worden niet gebruikt
  }
  
  // Schema validatie op data zonder Graph API velden bij SMTP
  // Maak een aangepast schema voor validatie dat geen Graph API velden vereist
  const validationSchema = createSchemaForDeliveryMethod(deliveryMethod);
  const validateForMethod = ajv.compile(validationSchema);
  const ok = validateForMethod(dataForValidation);
  if (!ok) {
    console.error("❌ Validatie gefaald:", JSON.stringify(validateForMethod.errors, null, 2));
    console.error("❌ Data die werd gevalideerd:", JSON.stringify(dataForValidation, null, 2));
    console.error("❌ Delivery method:", deliveryMethod);
    return res.status(400).json({ ok: false, errors: validateForMethod.errors });
  }
  
  // Gebruik de data zonder Graph API velden bij SMTP voor opslaan
  const out = writeTenant(dataForValidation.name, dataForValidation);
  
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
  const remoteIP = getRemoteIP(req);
  console.log(`📝 Tenant bijwerken - ontvangen data: ${JSON.stringify(data, null, 2)} - Remote IP: ${remoteIP}`);
  
  // Aangepaste validatie: Graph API velden zijn alleen verplicht als delivery method "graph" is
  const deliveryMethod = data.delivery?.method || "graph";
  
  // Bij SMTP: verwijder Graph API velden voordat schema validatie wordt uitgevoerd
  let dataForValidation = JSON.parse(JSON.stringify(data)); // Deep copy
  if (deliveryMethod === "smtp") {
    // Verwijder Graph API velden bij SMTP - ze worden niet gebruikt
    // allowedSenders blijft behouden - wordt gebruikt voor routing en sender validatie
    delete dataForValidation.tenantId;
    delete dataForValidation.clientId;
    delete dataForValidation.auth;
    delete dataForValidation.defaultMailbox;
    console.log("📝 SMTP geselecteerd - Graph API velden verwijderd voor validatie");
    console.log("📝 Data voor validatie:", JSON.stringify(dataForValidation, null, 2));
  }
  
  // Validatie: Ten minste één routing criterium is verplicht (routing.senderDomains of allowedSenders)
  const hasRoutingDomains = data.routing?.senderDomains && data.routing.senderDomains.length > 0;
  const hasAllowedSenders = data.allowedSenders && data.allowedSenders.length > 0;
  
  if (!hasRoutingDomains && !hasAllowedSenders) {
    return res.status(400).json({ 
      ok: false, 
      error: "Ten minste één van de volgende velden is verplicht: Routing domains of Allowed senders (gebruikt voor tenant routing)",
      errors: [
        { instancePath: "", message: "Routing configuratie ontbreekt: routing.senderDomains of allowedSenders is verplicht" }
      ]
    });
  }
  
  if (deliveryMethod === "graph") {
    // Voor Graph API zijn deze velden verplicht - controleer nieuwe structuur (delivery.graph) of legacy (top-level)
    const graphConfig = data.delivery?.graph || {};
    const hasGraphConfig = (graphConfig.tenantId && graphConfig.clientId && graphConfig.auth && graphConfig.defaultMailbox) ||
                          (data.tenantId && data.clientId && data.auth && data.defaultMailbox);
    if (!hasGraphConfig) {
      return res.status(400).json({ 
        ok: false, 
        error: "Voor Graph API zijn Tenant ID, Client ID, Auth en Default Mailbox verplicht",
        errors: [
          { instancePath: "", message: "Graph API configuratie ontbreekt" }
        ]
      });
    }
    // Bij Graph API mogen Graph API velden NIET ontbreken
  } else if (deliveryMethod === "smtp") {
    // Voor SMTP is alleen de SMTP server verplicht (nieuwe structuur: delivery.smtp.smtpServer of legacy: delivery.smtpServer)
    const smtpServer = data.delivery?.smtp?.smtpServer || data.delivery?.smtpServer;
    if (!smtpServer) {
      return res.status(400).json({ 
        ok: false, 
        error: "Voor SMTP delivery is een SMTP server verplicht",
        errors: [
          { instancePath: "/delivery/smtp/smtpServer", message: "SMTP server is verplicht" }
        ]
      });
    }
    // Bij SMTP mogen Graph API velden (tenantId, clientId, auth, etc.) ontbreken - ze worden niet gebruikt
  }
  
  // Schema validatie op data zonder Graph API velden bij SMTP
  // Maak een aangepast schema voor validatie dat geen Graph API velden vereist
  const validationSchema = createSchemaForDeliveryMethod(deliveryMethod);
  const validateForMethod = ajv.compile(validationSchema);
  const ok = validateForMethod(dataForValidation);
  if (!ok) {
    console.error("❌ Validatie gefaald:", JSON.stringify(validateForMethod.errors, null, 2));
    console.error("❌ Data die werd gevalideerd:", JSON.stringify(dataForValidation, null, 2));
    console.error("❌ Delivery method:", deliveryMethod);
    return res.status(400).json({ ok: false, errors: validateForMethod.errors });
  }
  
  // Gebruik de data zonder Graph API velden bij SMTP voor opslaan
  const out = writeTenant(req.params.name, dataForValidation);
  
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
  if (!str) return 24 * 60 * 60 * 1000; // 24h default
  const t = String(str).trim().toLowerCase();
  if (t === "all" || t === "alles" || t === "*") return null; // onbeperkt
  const m = /^([0-9]+)\s*([smhd])$/.exec(t);
  if (!m) return 24 * 60 * 60 * 1000; // 24h default
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

// Stats reset tijd opslag bestand
const STATS_RESET_FILE = path.join(ROOT, "logs", "stats-reset.json");

function getStatsResetTime() {
  try {
    if (fs.existsSync(STATS_RESET_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_RESET_FILE, "utf8"));
      return data.lastReset || null;
    }
  } catch (error) {
    console.error("❌ Error reading stats reset time:", error);
  }
  return null;
}

function setStatsResetTime() {
  try {
    const logDir = path.dirname(STATS_RESET_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const data = {
      lastReset: new Date().toISOString()
    };
    fs.writeFileSync(STATS_RESET_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Error saving stats reset time:", error);
  }
}

app.get("/admin/stats", (req, res) => {
  const windowMs = parseWindow(req.query.window);
  const since = (windowMs == null) ? 0 : (Date.now() - windowMs);
  const tenant = req.query.tenant?.trim();
  const lines = readLogLines(windowMs == null ? Infinity : undefined);
  const tenants = {};
  
  // Haal reset tijd op
  const resetTime = getStatsResetTime();
  
  // Als er een reset tijd is, filter alleen events na die tijd
  const effectiveSince = resetTime && (!since || new Date(resetTime).getTime() > since) 
    ? new Date(resetTime).getTime() 
    : since;
  
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.ts && effectiveSince > 0 && ev.ts < effectiveSince) continue;
      
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
  
  res.json({ tenants, lastReset: resetTime });
});

// Chart data endpoint voor trend grafieken
app.get("/admin/stats/chart", (req, res) => {
  try {
    const windowMs = parseWindow(req.query.window);
    const tenant = req.query.tenant?.trim();
    const since = (windowMs == null) ? 0 : (Date.now() - windowMs);
    
    // Lees alle log lines (voor chart hebben we alle data nodig binnen het window)
    const lines = readLogLines(windowMs == null ? Infinity : undefined);
    
    // Haal reset tijd op
    const resetTime = getStatsResetTime();
    
    // Als er een reset tijd is, filter alleen events na die tijd
    const effectiveSince = resetTime && (!since || new Date(resetTime).getTime() > since) 
      ? new Date(resetTime).getTime() 
      : since;
    
    console.log(`📊 Chart request: window=${req.query.window || "24h"}, tenant=${tenant || "all"}, since=${new Date(effectiveSince).toISOString()}, lines=${lines.length}`);
    
    // Bepaal aantal buckets op basis van window
    let bucketCount = 24; // Standaard 24 buckets
    let bucketSizeMs = windowMs ? windowMs / bucketCount : 60 * 60 * 1000; // 1 uur per bucket standaard
    
    if (windowMs) {
      if (windowMs <= 15 * 60 * 1000) {
        // 15 minuten of minder: 15 buckets van 1 minuut
        bucketCount = 15;
        bucketSizeMs = 60 * 1000;
      } else if (windowMs <= 60 * 60 * 1000) {
        // 1 uur of minder: 12 buckets van 5 minuten
        bucketCount = 12;
        bucketSizeMs = 5 * 60 * 1000;
      } else if (windowMs <= 24 * 60 * 60 * 1000) {
        // 24 uur of minder: 24 buckets van 1 uur
        bucketCount = 24;
        bucketSizeMs = 60 * 60 * 1000;
      } else if (windowMs <= 3 * 24 * 60 * 60 * 1000) {
        // 3 dagen of minder: 24 buckets van 3 uur
        bucketCount = 24;
        bucketSizeMs = 3 * 60 * 60 * 1000;
      } else if (windowMs <= 7 * 24 * 60 * 60 * 1000) {
        // 7 dagen of minder: 28 buckets van 6 uur
        bucketCount = 28;
        bucketSizeMs = 6 * 60 * 60 * 1000;
      } else {
        // 14 dagen of meer: 28 buckets van 12 uur
        bucketCount = 28;
        bucketSizeMs = 12 * 60 * 60 * 1000;
      }
    }
    
    // Initialiseer buckets
    const buckets = [];
    const now = Date.now();
    const startTime = effectiveSince > 0 ? effectiveSince : (windowMs ? now - windowMs : 0);
    const endTime = now;
    
    console.log(`📊 Chart setup: startTime=${new Date(startTime).toISOString()}, endTime=${new Date(endTime).toISOString()}, bucketCount=${bucketCount}, bucketSizeMs=${bucketSizeMs}ms`);
    
    for (let i = 0; i < bucketCount; i++) {
      buckets.push({
        time: startTime + (i * bucketSizeMs),
        sent: 0,
        errors: 0
      });
    }
    
    // Verwerk events
    let processedCount = 0;
    let matchedCount = 0;
    let timeFilteredCount = 0;
    let tenantFilteredCount = 0;
    let deliverOkCount = 0;
    let deliverErrCount = 0;
    
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (!ev.ts) continue;
        
        processedCount++;
        
        // Converteer timestamp naar milliseconden (kan ISO string of nummer zijn)
        let eventTime;
        if (typeof ev.ts === 'string') {
          eventTime = new Date(ev.ts).getTime();
        } else if (typeof ev.ts === 'number') {
          eventTime = ev.ts;
        } else {
          continue;
        }
        
        if (isNaN(eventTime)) continue;
        
        // Filter op tijd
        if (effectiveSince > 0 && eventTime < effectiveSince) {
          timeFilteredCount++;
          continue;
        }
        if (eventTime < startTime || eventTime > endTime) {
          timeFilteredCount++;
          continue;
        }
        
        // Filter op tenant als deze is opgegeven
        if (tenant && ev.tenant !== tenant) {
          tenantFilteredCount++;
          continue;
        }
        
        // Bepaal welke bucket
        // Bereken relatieve tijd sinds startTime
        const relativeTime = eventTime - startTime;
        const bucketIndex = Math.floor(relativeTime / bucketSizeMs);
        
        // Zorg dat bucketIndex binnen bereik valt
        if (bucketIndex >= 0 && bucketIndex < bucketCount) {
          matchedCount++;
          if (ev.level === "deliver.ok") {
            buckets[bucketIndex].sent++;
            deliverOkCount++;
          } else if (ev.level === "deliver.err") {
            buckets[bucketIndex].errors++;
            deliverErrCount++;
          }
        } else if (bucketIndex === bucketCount && relativeTime < bucketSizeMs * 1.1) {
          // Event valt net op de grens van de laatste bucket, plaats in laatste bucket
          matchedCount++;
          if (ev.level === "deliver.ok") {
            buckets[bucketCount - 1].sent++;
            deliverOkCount++;
          } else if (ev.level === "deliver.err") {
            buckets[bucketCount - 1].errors++;
            deliverErrCount++;
          }
        }
      } catch (err) {
        // Silently skip invalid lines
      }
    }
    
    const totalSent = buckets.reduce((sum, b) => sum + b.sent, 0);
    const totalErrors = buckets.reduce((sum, b) => sum + b.errors, 0);
    
    console.log(`📊 Chart data: ${processedCount} events verwerkt, ${matchedCount} gematcht (${deliverOkCount} ok, ${deliverErrCount} err), ${timeFilteredCount} gefilterd op tijd, ${tenantFilteredCount} gefilterd op tenant`);
    console.log(`📊 Chart totals: ${totalSent} verzonden, ${totalErrors} errors in ${bucketCount} buckets`);
    
    res.json({ 
      buckets,
      window: req.query.window || "24h",
      tenant: tenant || null
    });
  } catch (error) {
    console.error("❌ Error getting chart data:", error);
    res.status(500).json({ error: "Failed to get chart data", message: error.message });
  }
});

app.post("/admin/stats/reset", (req, res) => {
  try {
    const remoteIP = getRemoteIP(req);
    console.log(`📊 Statistieken reset aangevraagd - Remote IP: ${remoteIP}`);
    
    // Sla alleen reset tijd op (geen log bestand legen)
    setStatsResetTime();
    
    const resetTime = getStatsResetTime();
    console.log(`✅ Statistieken gereset - Reset tijd: ${resetTime}`);
    
    res.json({ 
      ok: true, 
      message: "Statistieken succesvol gereset",
      lastReset: resetTime
    });
  } catch (error) {
    console.error("❌ Error resetting stats:", error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to reset statistics", 
      message: error.message 
    });
  }
});

// Log reset tijd opslag bestand
const LOG_RESET_FILE = path.join(ROOT, "logs", "log-reset.json");

function getLogResetTime() {
  try {
    if (fs.existsSync(LOG_RESET_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOG_RESET_FILE, "utf8"));
      return data.lastReset || null;
    }
  } catch (error) {
    console.error("❌ Error reading log reset time:", error);
  }
  return null;
}

function setLogResetTime() {
  try {
    const logDir = path.dirname(LOG_RESET_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const data = {
      lastReset: new Date().toISOString()
    };
    fs.writeFileSync(LOG_RESET_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Error saving log reset time:", error);
  }
}

app.post("/admin/logs/reset", (req, res) => {
  try {
    const remoteIP = getRemoteIP(req);
    console.log(`📋 Logs reset aangevraagd - Remote IP: ${remoteIP}`);
    
    // Maak backup van huidige log bestand als het bestaat en niet leeg is
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > 0) {
        const logDir = path.dirname(LOG_FILE);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(logDir, `relay-backup-${timestamp}.jsonl`);
        
        try {
          fs.copyFileSync(LOG_FILE, backupFile);
          console.log(`📋 Log backup gemaakt: ${backupFile}`);
        } catch (backupError) {
          console.error("⚠️ Kon backup niet maken:", backupError.message);
          // Ga door met resetten ook als backup faalt
        }
      }
    }
    
    // Leeg het log bestand
    try {
      if (fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, '');
        console.log(`🗑️ Log bestand geleegd: ${LOG_FILE}`);
      } else {
        // Maak leeg bestand aan als het niet bestaat
        const logDir = path.dirname(LOG_FILE);
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        fs.writeFileSync(LOG_FILE, '');
        console.log(`📝 Nieuw leeg log bestand aangemaakt: ${LOG_FILE}`);
      }
    } catch (fileError) {
      console.error("❌ Kon log bestand niet legen:", fileError.message);
      throw new Error(`Kon log bestand niet legen: ${fileError.message}`);
    }
    
    // Sla reset tijd op
    setLogResetTime();
    
    const resetTime = getLogResetTime();
    console.log(`✅ Logs gereset - Reset tijd: ${resetTime}`);
    
    res.json({ 
      ok: true, 
      message: "Logs succesvol gereset",
      lastReset: resetTime
    });
  } catch (error) {
    console.error("❌ Error resetting logs:", error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to reset logs", 
      message: error.message 
    });
  }
});

app.get("/admin/logs/reset-time", (req, res) => {
  try {
    const resetTime = getLogResetTime();
    res.json({ lastReset: resetTime });
  } catch (error) {
    console.error("❌ Error getting log reset time:", error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to get log reset time", 
      message: error.message 
    });
  }
});

app.get("/admin/events", (req, res) => {
  const limit = parseInt(req.query.limit || "200", 10);
  const tenant = req.query.tenant?.trim();
  const reason = req.query.reason?.trim();
  const levelParam = req.query.level?.trim();
  const lines = readLogLines();
  const events = [];
  
  // Parse levels (comma-separated)
  const levels = levelParam && levelParam !== "all" 
    ? levelParam.split(",").map(l => l.trim()).filter(Boolean)
    : [];
  
  for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      
      // Filter op tenant als deze is opgegeven
      if (tenant && ev.tenant !== tenant) continue;
      
      // Filter op level(s) als deze zijn opgegeven
      if (levels.length > 0 && !levels.includes(ev.level)) continue;
      
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

// Server IP addresses endpoint
app.get("/admin/server-ips", (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    // Loop door alle netwerk interfaces
    for (const name of Object.keys(interfaces)) {
      const addrs = interfaces[name];
      if (!addrs) continue;
      
      for (const addr of addrs) {
        // Skip interne (loopback) en niet-IPv4 adressen
        if (addr.family === 'IPv4' && !addr.internal) {
          ips.push({
            address: addr.address,
            netmask: addr.netmask,
            interface: name
          });
        }
      }
    }
    
    // Voeg ook localhost toe voor lokale ontwikkeling
    ips.push({
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      interface: 'loopback'
    });
    
    res.json({ ips });
  } catch (error) {
    console.error("❌ Error getting server IPs:", error);
    res.status(500).json({ error: "Failed to get server IPs", message: error.message });
  }
});

// Version endpoints
app.get("/admin/version", (req, res) => {
  try {
    // Voeg cache-control headers toe om caching te voorkomen
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    const versionData = loadVersion();
    console.log("📦 Versie data geladen:", versionData);
    
    // Format versie string met buildnummer voor weergave
    const versionString = versionData.buildNumber 
      ? `${versionData.version} build ${versionData.buildNumber}`
      : versionData.version;
    
    console.log("📦 Versie string geformatteerd:", versionString);
    
    res.json({
      ...versionData,
      versionString // Voeg geformatteerde versie string toe
    });
  } catch (error) {
    console.error("❌ Error reading version:", error);
    res.status(500).json({ error: "Failed to read version", message: error.message });
  }
});

app.post("/admin/version/bump", (req, res) => {
  try {
    const { type = "patch" } = req.body; // "patch", "minor", of "major"
    
    if (!["patch", "minor", "major"].includes(type)) {
      return res.status(400).json({ 
        error: "Invalid version type", 
        message: "Type must be 'patch', 'minor', or 'major'" 
      });
    }
    
    const oldVersion = loadVersion();
    const newVersion = incrementVersion(type);
    
    res.json({ 
      ok: true, 
      oldVersion: oldVersion.version,
      newVersion: newVersion.version,
      lastUpdated: newVersion.lastUpdated
    });
  } catch (error) {
    console.error("❌ Error bumping version:", error);
    res.status(500).json({ error: "Failed to bump version", message: error.message });
  }
});

// Update manifest genereren endpoint
app.post("/admin/update/generate-manifest", async (req, res) => {
  try {
    const { generateManifest, saveManifest } = await import("./lib/update-manifest.js");
    const manifest = generateManifest();
    saveManifest(manifest);
    
    res.json({
      ok: true,
      manifest: manifest,
      message: `Manifest gegenereerd voor versie ${manifest.version} build ${manifest.buildNumber} met ${manifest.files.length} bestanden`
    });
  } catch (error) {
    console.error("❌ Error generating manifest:", error);
    res.status(500).json({ error: "Failed to generate manifest", message: error.message });
  }
});

// Update check endpoint - controleer op nieuwe versies
app.get("/admin/update/check", async (req, res) => {
  try {
    console.log("🔄 Update check gestart...");
    
    const currentVersion = loadVersion();
    const currentVersionString = currentVersion.version;
    console.log(`📌 Huidige versie: ${currentVersionString} build ${currentVersion.buildNumber}`);
    
    // Laad lokaal manifest om te valideren
    const { loadManifest, validateManifest, fetchRemoteManifest, compareVersions } = await import("./lib/update-manifest.js");
    const localManifest = loadManifest();
    
    // Valideer lokale bestanden tegen manifest
    let validationResult = null;
    const isDebugMode = cliOptions.debug || cliOptions.logLevel === 'debug' || cliOptions.logLevel === 'verbose';
    
    if (localManifest) {
      console.log(`📋 Lokaal manifest gevonden: versie ${localManifest.version} build ${localManifest.buildNumber}`);
      
      if (isDebugMode && localManifest.files) {
        console.log(`🐛 Debug: Lokaal manifest bevat ${localManifest.files.length} bestanden`);
        console.log(`🐛 Debug: Bestanden in lokaal manifest:`);
        localManifest.files.forEach((file, index) => {
          console.log(`🐛   ${index + 1}. ${file.path} (${file.size} bytes, hash: ${file.hash.substring(0, 8)}...)`);
        });
      }
      
      validationResult = validateManifest(localManifest);
      
      if (isDebugMode && validationResult) {
        console.log(`🐛 Debug: Validatie resultaat:`);
        console.log(`🐛   - Geldige bestanden: ${validationResult.valid ? validationResult.valid.length : 0}`);
        console.log(`🐛   - Ontbrekende bestanden: ${validationResult.missing ? validationResult.missing.length : 0}`);
        console.log(`🐛   - Gewijzigde bestanden: ${validationResult.changed ? validationResult.changed.length : 0}`);
        console.log(`🐛   - Fouten: ${validationResult.errors ? validationResult.errors.length : 0}`);
        
        if (validationResult.missing && validationResult.missing.length > 0) {
          console.log(`🐛 Debug: Ontbrekende bestanden:`);
          validationResult.missing.forEach((file, index) => {
            console.log(`🐛   ${index + 1}. ${file}`);
          });
        }
        
        if (validationResult.changed && validationResult.changed.length > 0) {
          console.log(`🐛 Debug: Gewijzigde bestanden:`);
          validationResult.changed.forEach((file, index) => {
            console.log(`🐛   ${index + 1}. ${file.path}`);
            console.log(`🐛      Verwacht hash: ${file.expectedHash.substring(0, 16)}...`);
            console.log(`🐛      Huidige hash:  ${file.actualHash.substring(0, 16)}...`);
          });
        }
        
        if (validationResult.errors && validationResult.errors.length > 0) {
          console.log(`🐛 Debug: Validatie fouten:`);
          validationResult.errors.forEach((error, index) => {
            console.log(`🐛   ${index + 1}. ${error}`);
          });
        }
      }
    } else {
      console.log(`ℹ️ Geen lokaal manifest gevonden`);
    }
    
    // Haal remote manifest op (van GitHub of andere bron)
    // Laad update configuratie uit update-config.json
    let repoUrl = null;
    let remoteCheckError = null;
    let configSource = null;
    
    try {
      if (fs.existsSync(UPDATE_CONFIG_FILE)) {
        console.log(`📂 Update configuratie bestand gevonden: ${UPDATE_CONFIG_FILE}`);
        const updateConfig = JSON.parse(fs.readFileSync(UPDATE_CONFIG_FILE, "utf8"));
        repoUrl = updateConfig.repositoryUrl || process.env.UPDATE_REPOSITORY_URL || null;
        // Alleen "environment variable" als source als updateConfig.repositoryUrl falsy is EN process.env.UPDATE_REPOSITORY_URL truthy is
        if (updateConfig.repositoryUrl) {
          configSource = "update-config.json";
        } else if (process.env.UPDATE_REPOSITORY_URL) {
          configSource = "environment variable";
        } else {
          configSource = null;
        }
        console.log(`🔗 Repository URL uit ${configSource || 'geen bron'}: ${repoUrl || '(niet ingesteld)'}`);
      } else {
        // Fallback naar environment variable als update-config.json niet bestaat
        console.log(`⚠️ Update configuratie bestand niet gevonden: ${UPDATE_CONFIG_FILE}`);
        repoUrl = process.env.UPDATE_REPOSITORY_URL || null;
        configSource = repoUrl ? "environment variable" : null;
        console.log(`🔗 Repository URL uit environment: ${repoUrl || '(niet ingesteld)'}`);
      }
    } catch (error) {
      console.error("❌ Fout bij laden update configuratie:", error.message);
      console.error("   Stack trace:", error.stack);
      remoteCheckError = `Fout bij laden update configuratie: ${error.message}`;
    }
    
    let remoteManifest = null;
    let updateAvailable = false;
    let latestVersion = currentVersionString;
    let latestBuildNumber = currentVersion.buildNumber;
    let manifestUrl = null;
    
    if (repoUrl) {
      try {
        // Bereken manifest URL voor logging
        manifestUrl = repoUrl;
        if (!manifestUrl.endsWith('update-manifest.json')) {
          manifestUrl = manifestUrl.replace(/\/$/, '') + '/update-manifest.json';
        }
        
        console.log(`🌐 Controleren op remote updates...`);
        console.log(`   Repository URL: ${repoUrl}`);
        console.log(`   Manifest URL: ${manifestUrl}`);
        console.log(`   Bestand: update-manifest.json`);
        
        remoteManifest = await fetchRemoteManifest(repoUrl);
        
        if (remoteManifest) {
          console.log(`✅ Remote manifest succesvol opgehaald`);
          console.log(`   Remote versie: ${remoteManifest.version} build ${remoteManifest.buildNumber}`);
          
          if (isDebugMode && remoteManifest.files) {
            console.log(`🐛 Debug: Remote manifest bevat ${remoteManifest.files.length} bestanden`);
            console.log(`🐛 Debug: Bestanden in remote manifest:`);
            remoteManifest.files.forEach((file, index) => {
              console.log(`🐛   ${index + 1}. ${file.path} (${file.size} bytes, hash: ${file.hash.substring(0, 8)}...)`);
            });
            
            // Vergelijk lokale en remote bestanden als beide beschikbaar zijn
            if (localManifest && localManifest.files) {
              const localFilePaths = new Set(localManifest.files.map(f => f.path));
              const remoteFilePaths = new Set(remoteManifest.files.map(f => f.path));
              
              const onlyInLocal = localManifest.files.filter(f => !remoteFilePaths.has(f.path));
              const onlyInRemote = remoteManifest.files.filter(f => !localFilePaths.has(f.path));
              const inBoth = localManifest.files.filter(f => remoteFilePaths.has(f.path));
              
              console.log(`🐛 Debug: Bestandsvergelijking tussen lokaal en remote:`);
              console.log(`🐛   - Alleen lokaal: ${onlyInLocal.length} bestanden`);
              console.log(`🐛   - Alleen remote: ${onlyInRemote.length} bestanden`);
              console.log(`🐛   - In beide: ${inBoth.length} bestanden`);
              
              if (onlyInLocal.length > 0) {
                console.log(`🐛 Debug: Bestanden alleen in lokaal manifest:`);
                onlyInLocal.forEach((file, index) => {
                  console.log(`🐛   ${index + 1}. ${file.path}`);
                });
              }
              
              if (onlyInRemote.length > 0) {
                console.log(`🐛 Debug: Bestanden alleen in remote manifest:`);
                onlyInRemote.forEach((file, index) => {
                  console.log(`🐛   ${index + 1}. ${file.path} (${file.size} bytes)`);
                });
              }
              
              // Check welke bestanden verschillen in hash
              const differentHashes = [];
              inBoth.forEach(localFile => {
                const remoteFile = remoteManifest.files.find(f => f.path === localFile.path);
                if (remoteFile && localFile.hash !== remoteFile.hash) {
                  differentHashes.push({
                    path: localFile.path,
                    localHash: localFile.hash,
                    remoteHash: remoteFile.hash,
                    localSize: localFile.size,
                    remoteSize: remoteFile.size
                  });
                }
              });
              
              if (differentHashes.length > 0) {
                console.log(`🐛 Debug: Bestanden met verschillende hashes (${differentHashes.length}):`);
                differentHashes.forEach((file, index) => {
                  console.log(`🐛   ${index + 1}. ${file.path}`);
                  console.log(`🐛      Lokaal:  ${file.localHash.substring(0, 16)}... (${file.localSize} bytes)`);
                  console.log(`🐛      Remote:  ${file.remoteHash.substring(0, 16)}... (${file.remoteSize} bytes)`);
                });
              } else if (inBoth.length > 0) {
                console.log(`🐛 Debug: Alle ${inBoth.length} gemeenschappelijke bestanden hebben dezelfde hash`);
              }
            }
          }
          
          // Vergelijk versies
          const versionComparison = compareVersions(currentVersionString, remoteManifest.version);
          console.log(`🔍 Versie vergelijking: ${currentVersionString} vs ${remoteManifest.version} = ${versionComparison}`);
          
          if (versionComparison < 0) {
            // Remote versie is nieuwer
            updateAvailable = true;
            latestVersion = remoteManifest.version;
            latestBuildNumber = remoteManifest.buildNumber;
            console.log(`✨ Nieuwe versie beschikbaar: ${latestVersion} build ${latestBuildNumber}`);
          } else if (versionComparison === 0) {
            // Versies zijn gelijk, check buildnummer
            const currentBuild = parseInt(currentVersion.buildNumber) || 0;
            const remoteBuild = parseInt(remoteManifest.buildNumber) || 0;
            console.log(`🔍 Build nummer vergelijking: ${currentBuild} vs ${remoteBuild}`);
            
            if (remoteBuild > currentBuild) {
              updateAvailable = true;
              latestVersion = remoteManifest.version;
              latestBuildNumber = remoteManifest.buildNumber;
              console.log(`✨ Nieuwe build beschikbaar: ${latestVersion} build ${latestBuildNumber}`);
            } else {
              console.log(`✅ Je gebruikt de nieuwste versie`);
            }
          } else {
            console.log(`✅ Je gebruikt een nieuwere versie dan remote`);
          }
        } else {
          // remoteManifest is null - dit betekent meestal een 404 (manifest niet gevonden)
          console.log(`ℹ️ Geen remote manifest gevonden of beschikbaar`);
          remoteCheckError = `Remote manifest niet gevonden op ${manifestUrl}. Controleer of het bestand bestaat in de repository.`;
        }
      } catch (error) {
        console.error("❌ Fout bij controleren remote manifest:", error.message);
        console.error("   Stack trace:", error.stack);
        remoteCheckError = error.message;
      }
    } else {
      remoteCheckError = "Geen repository URL geconfigureerd. Voeg 'repositoryUrl' toe aan update-config.json of stel UPDATE_REPOSITORY_URL environment variable in.";
      console.log(`⚠️ ${remoteCheckError}`);
    }
    
    const responseData = {
      ok: true,
      currentVersion: currentVersionString,
      currentBuildNumber: currentVersion.buildNumber,
      updateAvailable: updateAvailable,
      latestVersion: latestVersion,
      latestBuildNumber: latestBuildNumber,
      localManifestValid: validationResult ? validationResult.valid : null,
      localManifestErrors: validationResult ? validationResult.errors : [],
      localManifestMissing: validationResult ? validationResult.missing : [],
      localManifestChanged: validationResult ? validationResult.changed : [],
      remoteCheckError: remoteCheckError,
      remoteManifest: remoteManifest, // Voeg remote manifest toe voor download
      checkDetails: {
        configFile: UPDATE_CONFIG_FILE,
        configExists: fs.existsSync(UPDATE_CONFIG_FILE),
        configSource: configSource,
        repositoryUrl: repoUrl,
        manifestUrl: manifestUrl,
        checkedFile: "update-manifest.json"
      },
      message: updateAvailable 
        ? `Nieuwe versie beschikbaar: ${latestVersion} build ${latestBuildNumber}`
        : remoteCheckError 
          ? `Kan niet controleren op updates: ${remoteCheckError}`
          : "Je gebruikt de nieuwste versie"
    };
    
    if (isDebugMode) {
      console.log(`🐛 Debug: Update check samenvatting:`);
      console.log(`🐛   - Huidige versie: ${currentVersionString} build ${currentVersion.buildNumber}`);
      console.log(`🐛   - Laatste versie: ${latestVersion} build ${latestBuildNumber}`);
      console.log(`🐛   - Update beschikbaar: ${updateAvailable ? 'Ja' : 'Nee'}`);
      console.log(`🐛   - Lokaal manifest: ${localManifest ? `versie ${localManifest.version} (${localManifest.files ? localManifest.files.length : 0} bestanden)` : 'niet gevonden'}`);
      console.log(`🐛   - Remote manifest: ${remoteManifest ? `versie ${remoteManifest.version} (${remoteManifest.files ? remoteManifest.files.length : 0} bestanden)` : 'niet gevonden'}`);
      console.log(`🐛   - Configuratie bron: ${configSource || 'geen'}`);
      console.log(`🐛   - Repository URL: ${repoUrl || 'niet ingesteld'}`);
      console.log(`🐛   - Remote check fout: ${remoteCheckError || 'geen'}`);
    }
    
    console.log("✅ Update check voltooid");
    res.json(responseData);
  } catch (error) {
    console.error("❌ Error checking for updates:", error);
    console.error("   Stack trace:", error.stack);
    res.status(500).json({ 
      error: "Failed to check for updates", 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update download endpoint - download nieuwe versie
app.post("/admin/update/download", async (req, res) => {
  try {
    const { manifestUrl, manifestData } = req.body;
    
    // Als geen manifestData is opgegeven, probeer het remote manifest op te halen
    let manifestToUse = manifestData;
    
    if (!manifestToUse) {
      // Haal remote manifest op
      let repoUrl = null;
      try {
        if (fs.existsSync(UPDATE_CONFIG_FILE)) {
          const updateConfig = JSON.parse(fs.readFileSync(UPDATE_CONFIG_FILE, "utf8"));
          repoUrl = updateConfig.repositoryUrl || process.env.UPDATE_REPOSITORY_URL;
        } else {
          repoUrl = process.env.UPDATE_REPOSITORY_URL || null;
        }
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Fout bij laden configuratie",
          message: error.message
        });
      }
      
      if (!repoUrl) {
        return res.status(400).json({
          ok: false,
          error: "Geen repository URL geconfigureerd",
          message: "Voeg 'repositoryUrl' toe aan update-config.json of stel UPDATE_REPOSITORY_URL environment variable in."
        });
      }
      
      const { fetchRemoteManifest } = await import("./lib/update-manifest.js");
      manifestToUse = await fetchRemoteManifest(repoUrl);
      
      if (!manifestToUse) {
        return res.status(404).json({
          ok: false,
          error: "Remote manifest niet gevonden",
          message: "Kon remote manifest niet ophalen. Controleer of het bestand bestaat in de repository."
        });
      }
    }
    
    if (!manifestToUse) {
      return res.status(400).json({
        ok: false,
        error: "Geen manifest data beschikbaar",
        message: "Stuur manifestData in de request body of configureer repository URL"
      });
    }
    
    // Valideer manifest structuur
    if (!manifestToUse.version || !manifestToUse.files || !Array.isArray(manifestToUse.files)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Ongeldig manifest formaat",
        message: "Manifest moet versie en files array bevatten"
      });
    }
    
    console.log(`📥 Download update gestart voor versie ${manifestToUse.version} build ${manifestToUse.buildNumber}`);
    
    // Haal repository URL op uit configuratie
    let repoUrl = null;
    try {
      if (fs.existsSync(UPDATE_CONFIG_FILE)) {
        const updateConfig = JSON.parse(fs.readFileSync(UPDATE_CONFIG_FILE, "utf8"));
        repoUrl = updateConfig.repositoryUrl || process.env.UPDATE_REPOSITORY_URL;
      } else {
        repoUrl = process.env.UPDATE_REPOSITORY_URL || null;
      }
    } catch (error) {
      console.error("❌ Fout bij laden update configuratie:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Fout bij laden configuratie",
        message: error.message
      });
    }
    
    if (!repoUrl) {
      return res.status(400).json({
        ok: false,
        error: "Geen repository URL geconfigureerd",
        message: "Voeg 'repositoryUrl' toe aan update-config.json of stel UPDATE_REPOSITORY_URL environment variable in."
      });
    }
    
    // Normaliseer repoUrl
    repoUrl = repoUrl.replace(/\/$/, '');
    
    const { downloadFile, shouldExcludeFile } = await import("./lib/update-manifest.js");
    const downloadedFiles = [];
    const errors = [];
    const skipped = [];
    
    console.log(`📦 Downloaden van ${manifestToUse.files.length} bestanden...`);
    
    // Download alle bestanden uit het manifest
    for (const fileEntry of manifestToUse.files) {
      try {
        // Skip bestanden die uitgesloten moeten worden
        if (shouldExcludeFile(fileEntry.path)) {
          skipped.push(fileEntry.path);
          console.log(`⏭️  Overgeslagen (uitgesloten): ${fileEntry.path}`);
          continue;
        }
        
        console.log(`⬇️  Downloaden: ${fileEntry.path}...`);
        const fileContent = await downloadFile(repoUrl, fileEntry.path);
        
        // Valideer hash
        const { validateFileHash } = await import("./lib/update-manifest.js");
        if (!validateFileHash(fileContent, fileEntry.hash)) {
          throw new Error(`Hash validatie gefaald voor ${fileEntry.path}`);
        }
        
        downloadedFiles.push({
          path: fileEntry.path,
          content: fileContent.toString('base64'), // Encode als base64 voor transport
          hash: fileEntry.hash,
          size: fileEntry.size
        });
        
        console.log(`✅ Gedownload: ${fileEntry.path} (${fileEntry.size} bytes)`);
      } catch (error) {
        console.error(`❌ Fout bij downloaden ${fileEntry.path}:`, error.message);
        errors.push({
          path: fileEntry.path,
          error: error.message
        });
      }
    }
    
    if (errors.length > 0 && downloadedFiles.length === 0) {
      return res.status(500).json({
        ok: false,
        error: "Download gefaald",
        message: `Kon geen bestanden downloaden. ${errors.length} fouten opgetreden.`,
        errors: errors
      });
    }
    
    console.log(`✅ Download voltooid: ${downloadedFiles.length} bestanden gedownload, ${skipped.length} overgeslagen, ${errors.length} fouten`);
    
    res.json({
      ok: true,
      message: `Download voltooid: ${downloadedFiles.length} bestanden gedownload`,
      version: manifestToUse.version,
      buildNumber: manifestToUse.buildNumber,
      manifestData: manifestToUse, // Retourneer manifest voor installatie
      files: downloadedFiles, // Retourneer gedownloade bestanden
      downloaded: downloadedFiles.length,
      skipped: skipped.length,
      errors: errors.length,
      skippedFiles: skipped,
      downloadErrors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("❌ Error downloading update:", error);
    console.error("   Stack trace:", error.stack);
    res.status(500).json({ 
      ok: false,
      error: "Failed to download update", 
      message: error.message 
    });
  }
});

// Update install endpoint - installeer en activeer nieuwe versie
app.post("/admin/update/install", async (req, res) => {
  try {
    const { manifestData, files } = req.body;
    
    if (!manifestData || !files) {
      return res.status(400).json({
        ok: false,
        error: "Manifest data en files zijn verplicht",
        message: "Stuur manifestData en files array in de request body"
      });
    }
    
    // Valideer manifest structuur
    if (!manifestData.version || !manifestData.files || !Array.isArray(manifestData.files)) {
      return res.status(400).json({
        ok: false,
        error: "Ongeldig manifest formaat",
        message: "Manifest moet versie en files array bevatten"
      });
    }
    
    console.log(`🔧 Installatie update gestart voor versie ${manifestData.version} build ${manifestData.buildNumber}`);
    
    const { validateFileHash, shouldExcludeFile, backupFile } = await import("./lib/update-manifest.js");
    const installedFiles = [];
    const backedUpFiles = [];
    const errors = [];
    const skipped = [];
    
    // Valideer en installeer bestanden
    console.log(`📝 Installeren van ${files.length} bestanden...`);
    
    for (const fileData of files) {
      try {
        const filePath = fileData.path;
        const fileContent = Buffer.from(fileData.content, 'base64');
        
        // Skip bestanden die uitgesloten moeten worden
        if (shouldExcludeFile(filePath)) {
          skipped.push(filePath);
          console.log(`⏭️  Overgeslagen (uitgesloten): ${filePath}`);
          continue;
        }
        
        // Vind bijbehorende manifest entry
        const manifestEntry = manifestData.files.find(f => f.path === filePath);
        if (!manifestEntry) {
          throw new Error(`Geen manifest entry gevonden voor ${filePath}`);
        }
        
        // Valideer hash
        if (!validateFileHash(fileContent, manifestEntry.hash)) {
          throw new Error(`Hash validatie gefaald voor ${filePath}`);
        }
        
        // Maak volledig pad
        const fullPath = path.join(ROOT, filePath);
        const dirPath = path.dirname(fullPath);
        
        // Maak directory aan als deze niet bestaat
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          console.log(`📁 Directory aangemaakt: ${dirPath}`);
        }
        
        // Maak backup van bestaand bestand
        const backupPath = backupFile(fullPath);
        if (backupPath) {
          backedUpFiles.push({ original: filePath, backup: backupPath });
          console.log(`💾 Backup gemaakt: ${backupPath}`);
        }
        
        // Schrijf bestand
        fs.writeFileSync(fullPath, fileContent);
        installedFiles.push(filePath);
        console.log(`✅ Geïnstalleerd: ${filePath} (${fileContent.length} bytes)`);
      } catch (error) {
        console.error(`❌ Fout bij installeren ${fileData.path}:`, error.message);
        errors.push({
          path: fileData.path,
          error: error.message
        });
      }
    }
    
    if (errors.length > 0 && installedFiles.length === 0) {
      return res.status(500).json({
        ok: false,
        error: "Installatie gefaald",
        message: `Kon geen bestanden installeren. ${errors.length} fouten opgetreden.`,
        errors: errors
      });
    }
    
    // Update versie bestand
    try {
      const { saveVersion } = await import("./lib/version.js");
      saveVersion({
        version: manifestData.version,
        buildNumber: manifestData.buildNumber,
        lastUpdated: new Date().toISOString(),
        lastBuildUpdate: new Date().toISOString()
      });
      console.log(`✅ Versie bijgewerkt naar ${manifestData.version} build ${manifestData.buildNumber}`);
    } catch (error) {
      console.error(`⚠️ Kon versie niet bijwerken:`, error.message);
    }
    
    // Update lokaal manifest
    try {
      const { saveManifest } = await import("./lib/update-manifest.js");
      saveManifest(manifestData);
      console.log(`✅ Lokaal manifest bijgewerkt`);
    } catch (error) {
      console.error(`⚠️ Kon manifest niet bijwerken:`, error.message);
    }
    
    console.log(`✅ Installatie voltooid: ${installedFiles.length} bestanden geïnstalleerd, ${skipped.length} overgeslagen, ${errors.length} fouten`);
    
    // Stuur response VOORDAT server wordt herstart
    res.json({
      ok: true,
      message: `Update succesvol geïnstalleerd: versie ${manifestData.version} build ${manifestData.buildNumber}`,
      version: manifestData.version,
      buildNumber: manifestData.buildNumber,
      installed: installedFiles.length,
      skipped: skipped.length,
      errors: errors.length,
      backedUp: backedUpFiles.length,
      installedFiles: installedFiles,
      skippedFiles: skipped,
      backedUpFiles: backedUpFiles,
      errors: errors.length > 0 ? errors : undefined,
      restartRequired: true,
      restartMessage: "Server moet worden herstart om de update te activeren. Gebruik 'npm run service:restart' of herstart de service handmatig."
    });
    
    // Geef tijd voor response om te worden verzonden
    setTimeout(() => {
      console.log(`🔄 Update geïnstalleerd. Server herstart wordt aanbevolen.`);
      console.log(`   Gebruik: npm run service:restart`);
      console.log(`   Of herstart de service handmatig via Windows Service Manager`);
    }, 1000);
    
  } catch (error) {
    console.error("❌ Error installing update:", error);
    console.error("   Stack trace:", error.stack);
    res.status(500).json({ 
      ok: false,
      error: "Failed to install update", 
      message: error.message 
    });
  }
});

// Config/Settings CRUD
app.get("/admin/config", (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.status(404).json({ error: "Config file not found" });
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    res.json(config);
  } catch (error) {
    console.error("❌ Error reading config:", error);
    res.status(500).json({ error: "Failed to read config", message: error.message });
  }
});

app.put("/admin/config", (req, res) => {
  try {
    const config = req.body;
    
    // Valideer basis structuur
    if (!config.service) {
      return res.status(400).json({ error: "Config must have 'service' property" });
    }
    
    // Backup maken van huidige config
    if (fs.existsSync(CONFIG_FILE)) {
      const backupFile = CONFIG_FILE + ".backup." + Date.now();
      fs.copyFileSync(CONFIG_FILE, backupFile);
      console.log(`📋 Config backup gemaakt: ${backupFile}`);
    }
    
    // Schrijf nieuwe config
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`✅ Config opgeslagen`);
    
    // Trigger reload event
    if (global.serverEvents) {
      global.serverEvents.emit("reload");
      console.log(`🔄 Auto-reload triggered after config update`);
      
      // Log configuratie wijziging
      global.serverEvents.emit("configChange", {
        type: "config_updated",
        message: "Service configuration updated",
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ ok: true, message: "Config updated successfully" });
  } catch (error) {
    console.error("❌ Error writing config:", error);
    res.status(500).json({ error: "Failed to write config", message: error.message });
  }
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
  // Serve UI (na alle routes zodat specifieke routes eerst worden gematcht)
  app.use("/", express.static(path.join(ROOT, "admin-ui")));
  
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

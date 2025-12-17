import { SMTPServer } from "smtp-server"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url"; import Matcher from "cidr-matcher"; import { simpleParser } from "mailparser"; import { v4 as uuidv4 } from "uuid"; import { sendViaGraph } from "./graph.js"; import { sendViaSMTP } from "./smtp.js"; import { checkRate } from "./rateLimiter.js";

// Bepaal applicatie root op basis van waar dit script zich bevindt
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "relay.jsonl");
function writeLine(obj){ try{ if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR,{recursive:true}); fs.appendFileSync(LOG_FILE, JSON.stringify(obj)+"\n"); }catch{} }

// Bewaar originele console functies voordat ze mogelijk worden overschreven
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

// Log functie die kan worden geconfigureerd met een externe logger
let log = (lvl, d) => {
  const rec = { ts: new Date().toISOString(), level: lvl, ...d };
  originalConsoleLog(JSON.stringify(rec));
  writeLine(rec);
};

// Functie om de logger te configureren
export function configureLogger(externalLogger) {
  if (externalLogger) {
    log = (lvl, d) => {
      const rec = { ts: new Date().toISOString(), level: lvl, ...d };
      // Gebruik de externe logger voor gestructureerde logging
      externalLogger.info(`[${lvl}] ${JSON.stringify(d)}`);
      // Schrijf ook naar het relay.jsonl bestand voor backward compatibility
      writeLine(rec);
    };
    
    // Vervang alle console functies door no-ops wanneer externe logger wordt gebruikt
    // MAAR: behoud de originele functies voor directe console.log calls in deze module
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};
    console.debug = () => {};
  }
}

// Helper functie voor directe console output (gebruikt originele console functies)
function directLog(...args) {
  originalConsoleLog(...args);
}

// Verbeterde CIDR matching functie die lege strings en ongeldige entries filtert
const cidr=(ip,list=[])=>{
  if(!ip || !list || list.length === 0) return false;
  
  // Filter en valideer de lijst: verwijder lege strings, null, undefined en ongeldige CIDR notaties
  const validRanges = list
    .filter(range => range && typeof range === 'string' && range.trim().length > 0)
    .map(range => range.trim())
    .filter(range => {
      // Basis validatie: moet formaat hebben zoals "x.x.x.x/y" of "x.x.x.x"
      const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
      return cidrPattern.test(range);
    });
  
  if(validRanges.length === 0) return false;
  
  try{
    const m=new Matcher(validRanges);
    return m.contains(ip);
  }catch(err){
    // Log de fout voor debugging, maar retourneer false om veilig te blijven
    console.error(`CIDR matching fout voor IP ${ip} met ranges ${validRanges.join(", ")}:`, err.message);
    return false;
  }
};

function pickTenant(tenants, ip, rcpts, routingPriority = ["allowedSenders", "senderDomains", "ipRanges"]) {
  const s = [...tenants].sort((a, b) => (a.routing?.priority ?? 100) - (b.routing?.priority ?? 100));
  
  // Routing checks op basis van geconfigureerde prioriteit
  const checks = {
    allowedSenders: () => {
      // Exacte ontvanger match via allowedSenders (gebruikt als ontvanger whitelist)
  for (const t of s) {
    if (t.allowedSenders && t.allowedSenders.length > 0) {
      if (rcpts.some(rcpt => 
        t.allowedSenders.map(v => v.toLowerCase()).includes(rcpt.toLowerCase())
      )) {
        return t;
      }
    }
  }
      return null;
    },
    senderDomains: () => {
      // Domain-based routing op ontvangers
  for (const t of s) {
    if (t.routing?.senderDomains && t.routing.senderDomains.length > 0) {
      if (rcpts.some(rcpt => {
        const domain = rcpt.split("@").pop()?.toLowerCase();
        return domain && t.routing.senderDomains.map(d => d.toLowerCase()).includes(domain);
      })) {
        return t;
      }
    }
  }
      return null;
    },
    ipRanges: () => {
      // IP-based routing
      // Let op: ipRanges wordt hier gebruikt voor ROUTING (welke tenant te gebruiken),
      // maar ook later voor RESTRICTIE (of het IP toegestaan is voor die tenant).
      // Als een tenant ipRanges heeft, wordt deze gebruikt voor beide doeleinden.
  for (const t of s) {
    if (t.routing?.ipRanges && t.routing.ipRanges.length > 0) {
      if (cidr(ip, t.routing.ipRanges)) {
        return t;
      }
        }
      }
      return null;
    }
  };
  
  // Voer routing checks uit in de geconfigureerde volgorde
  for (const method of routingPriority) {
    if (checks[method]) {
      const result = checks[method]();
      if (result) {
        return result;
      }
    }
  }
  
  // Fallback naar eerste tenant (niet aanbevolen)
  const fallbackTenant = s[0];
  log("deliver.warn", {
    tenant: fallbackTenant?.name, 
    rcpts: rcpts.join(", "), 
    remoteIP: ip, 
    message: "No specific tenant match found, using fallback", 
    reason: "fallback"
  });
  return fallbackTenant;
}
export async function createServer(cfg){
  let tenants=cfg.tenants; let svc=cfg.service;
  
  // Debug: log de volledige service configuratie om te zien wat er wordt doorgegeven
  console.log(`🔍 Service configuratie bij createServer:`);
  console.log(`   svc.serverIP: ${svc?.serverIP || 'NIET AANWEZIG'}`);
  console.log(`   svc keys: ${Object.keys(svc || {}).join(', ')}`);
  console.log(`   Volledige svc: ${JSON.stringify(svc, null, 2)}`);
  
  // Bewaar serverIP voor gebruik in sendViaSMTP - moet dynamisch worden bijgewerkt bij reload
  let serverIP = svc?.serverIP || "0.0.0.0";
  console.log(`🔧 serverIP waarde: ${serverIP}`);
  // Routing prioriteit configuratie (standaard: allowedSenders, senderDomains, ipRanges)
  // routingPriority wordt dynamisch gelezen uit svc bij elke mail verwerking
  // Globale IP allowlist matcher
  // Als allowlistIPs leeg is, wordt een lege matcher gebruikt (geen IPs toegestaan voor globale check)
  // Als allowlistIPs gevuld is, worden alleen IPs in deze lijst toegestaan voor globale toegang
  const allow=new Matcher(svc.allowlistIPs||[]);
  const haveTLS=!!(svc.tls?.certFile && svc.tls?.keyFile); const tlsMode=svc.tls?.mode||"starttls";
  const tlsOpts=haveTLS?{key:fs.readFileSync(svc.tls.keyFile),cert:fs.readFileSync(svc.tls.certFile)}:{};
  
  // Hot-reload functie voor tenants en service configuratie
  async function reloadTenants() {
    try {
      // Dynamisch importeren van config module
      const { loadConfig } = await import("./config.js");
      const config = await loadConfig();
      const newTenants = config.tenants || [];
      
      // Update service configuratie (inclusief routingPriority, smtpServers en serverIP)
      if (config.service) {
        svc = config.service;
        // Update serverIP bij reload zodat uitgaande verbindingen het juiste IP gebruiken
        serverIP = svc.serverIP || "0.0.0.0";
        log("config.info", { 
          message: "Service configuration reloaded (including routingPriority, smtpServers and serverIP)", 
          routingPriority: svc.routingPriority || ["allowedSenders", "senderDomains", "ipRanges"],
          smtpServersCount: (svc.smtpServers || []).length,
          serverIP: serverIP
        });
      }
      
      if (newTenants.length > 0) {
        tenants = newTenants;
        log("config.info", { 
          message: "Tenants reloaded successfully", 
          count: newTenants.length,
          tenants: newTenants.map(t => t.name || 'unnamed')
        });
      } else {
        log("config.warn", { message: "No tenants found during reload" });
      }
    } catch (error) {
      log("config.error", { 
        message: "Failed to reload tenants", 
        error: error.message,
        stack: error.stack 
      });
    }
  }
  
  // File watcher verwijderd - reload wordt nu getriggerd bij tenant opslaan
  log("config.info", { message: "Tenant reload ready - triggered on save" });
  
  const server=new SMTPServer({
            name: serverIP !== "0.0.0.0" ? serverIP : "rileesurfis",
    secure: haveTLS && svc.requireTLS && tlsMode==="implicit",
    ...tlsOpts,
    disabledCommands: haveTLS?[]:["STARTTLS"],
    authOptional: true, // Authenticatie is altijd optioneel voor SMTP service
    // Gebruik geconfigureerd IP adres of fallback naar alle interfaces
    host: serverIP,
    onAuth(a,s,cb){ 
      // Authenticatie is altijd optioneel - accepteer altijd (ook zonder credentials)
      // Als er credentials zijn opgegeven en er zijn gebruikers gedefinieerd, valideer deze
      if (a?.username && a?.password && svc.authUsers && svc.authUsers.length > 0) {
        const ok = svc.authUsers.some(u => u.username === a.username && u.password === a.password);
        if (ok) {
          return cb(null, {user: a.username});
        }
        // Als authenticatie is opgegeven maar niet geldig, accepteer als anonymous
        return cb(null, {user: "anonymous"});
      }
      // Geen authenticatie opgegeven of geen gebruikers gedefinieerd - accepteer als anonymous
      return cb(null, {user: a?.username || "anonymous"});
    },
    onMailFrom(address, session, callback) {
      const id = uuidv4();
      log("debug", {
        msgId: id,
        message: "MAIL FROM command ontvangen",
        mailFrom: address.address,
        remoteIP: session.remoteAddress,
        authenticated: session.user?.user || "anonymous"
      });
      // Accepteer alle envelope FROM adressen - validatie gebeurt later in onData
      callback();
    },
    onRcptTo(address, session, callback) {
      const id = uuidv4();
      log("debug", {
        msgId: id,
        message: "RCPT TO command ontvangen",
        rcptTo: address.address,
        remoteIP: session.remoteAddress
      });
      // Accepteer alle ontvangers - validatie gebeurt later in onData
      callback();
    },
    onConnect(s,cb){
      const id = uuidv4();
      directLog(`🔌 Nieuwe SMTP verbinding van ${s.remoteAddress}`);
      log("debug", { 
        msgId: id,
        message: "Nieuwe SMTP client verbinding", 
        remoteIP: s.remoteAddress,
        remotePort: s.remotePort,
        allowlistIPs: svc.allowlistIPs,
        allowlistIPsConfigured: svc.allowlistIPs && svc.allowlistIPs.length > 0
      });
      
      // IP TOEGANGS CONTROLE
      // Primaire controle: tenant ipRanges (LEIDEND)
      // Optionele controle: allowlistIPs (alleen als extra beveiligingslaag wanneer ingesteld)
      //
      // LOGICA:
      // 1. Als allowlistIPs is ingesteld (niet leeg): gebruik als optionele extra check
      // 2. Controleer altijd of IP in ten minste één tenant ipRanges staat
      // 3. Beide checks moeten slagen (als allowlistIPs is ingesteld)
      //
      // AANBEVELING: Laat allowlistIPs leeg en gebruik alleen tenant ipRanges voor duidelijkheid
      
      // Optionele extra check: allowlistIPs (alleen als ingesteld)
      if(svc.allowlistIPs && svc.allowlistIPs.length > 0){
      if(!(allow.contains(s.remoteAddress))){
        const id = uuidv4();
          log("deliver.err",{msgId:id,tenant:"unknown",remoteIP:s.remoteAddress,error:"IP not allowed (allowlistIPs check)",reason:"ip_not_allowed"});
          return cb(new Error("IP not allowed"));
        }
      }
      
      // Primaire check: IP moet in ten minste één tenant ipRanges staan
      // Dit is LEIDEND - alle IP filtering gebeurt op tenant niveau
      // Als er tenants zijn met ipRanges gedefinieerd, controleer dan of het IP toegestaan is
      // Als er geen tenants zijn met ipRanges, sla deze check over (routing kan via allowedSenders/senderDomains)
      const tenantsWithIpRanges = tenants.filter(t => 
        t.routing?.ipRanges && t.routing.ipRanges.length > 0
      );
      
      if (tenantsWithIpRanges.length > 0) {
        // Alleen controleren als er tenants zijn met ipRanges
        const ipInAnyTenant = tenantsWithIpRanges.some(t => 
          cidr(s.remoteAddress, t.routing.ipRanges)
        );
        
        if(!ipInAnyTenant){
          const id = uuidv4();
          log("deliver.err",{msgId:id,tenant:"unknown",remoteIP:s.remoteAddress,error:"IP not allowed (geen match in tenant ipRanges)",reason:"ip_not_allowed"});
        return cb(new Error("IP not allowed"));
      }
      } else {
        // Geen tenants met ipRanges - routing gebeurt via allowedSenders/senderDomains
        log("debug", { 
          message: "IP check overgeslagen - geen tenants met ipRanges, routing via allowedSenders/senderDomains", 
          remoteIP: s.remoteAddress
        });
      }
      
      log("debug", { 
        message: "IP toegestaan", 
        remoteIP: s.remoteAddress,
        allowlistIPsUsed: svc.allowlistIPs && svc.allowlistIPs.length > 0
      });
      
      if(svc.requireTLS && tlsMode==="implicit" && !s.secure) return cb(new Error("TLS required"));
      return cb();
    },
    onData(st,s,cb){ const id=uuidv4(); let raw=Buffer.alloc(0); 
      log("debug", {
        msgId: id,
        message: "onData gestart - email ontvangen",
        remoteIP: s.remoteAddress,
        envelopeFrom: s.envelope?.mailFrom?.address || "unknown",
        envelopeTo: (s.envelope?.rcptTo || []).map(r => r.address).join(", ") || "unknown"
      });
      st.on("data",ch=>raw=Buffer.concat([raw,ch])); 
      st.on("end",async()=>{
      const ip=s.remoteAddress; let tenantName="unknown"; let fromAddr=""; let rcptCount=0; let rcpts=[]; try{
        log("debug", {
          msgId: id,
          message: "Email data compleet - start verwerking",
          remoteIP: ip,
          sizeBytes: raw.length
        });
        if(svc.requireTLS && !s.secure) throw new Error("TLS required");
        const parsed=await simpleParser(raw);
        const envFrom=(s.envelope.mailFrom?.address) || (parsed.from?.value?.[0]?.address) || ""; fromAddr=envFrom;
        log("debug", {
          msgId: id,
          message: "Email geparsed",
          envelopeFrom: envFrom,
          parsedFrom: parsed.from?.value?.[0]?.address || "none"
        });
        rcpts=(s.envelope.rcptTo||[]).map(r=>r.address); rcptCount = rcpts.length;
        // STAP 2: TENANT SELECTIE
        // Tenant routing op basis van geconfigureerde prioriteit
        // Lees routingPriority dynamisch uit de huidige svc configuratie
        const currentRoutingPriority = svc.routingPriority || ["allowedSenders", "senderDomains", "ipRanges"];
        const t=pickTenant(tenants, ip, rcpts, currentRoutingPriority); tenantName = t?.name || tenantName;
        
        // TENANT-SPECIFIEKE IP RESTRICTIE CONTROLE
        // ipRanges in tenant configuratie bepaalt of een IP toegestaan is voor deze specifieke tenant.
        // Deze check is LEIDEND - alle IP filtering gebeurt op tenant niveau.
        //
        // BELANGRIJK: 
        // - Als een tenant ipRanges heeft ingesteld, MOET het IP hierin staan.
        // - Als een tenant GEEN ipRanges heeft, wordt de check overgeslagen (niet aanbevolen voor beveiliging).
        // - De globale allowlistIPs check (als ingesteld) is alleen een optionele extra beveiligingslaag.
        if (t.routing?.ipRanges && t.routing.ipRanges.length > 0) {
          const ipAllowed = cidr(ip, t.routing.ipRanges);
          if (!ipAllowed) {
            throw new Error(`IP not allowed for tenant: ${ip} not in ranges: ${t.routing.ipRanges.join(", ")}`);
          }
        }
        
        // Dan controleren of de afzender toegestaan is voor deze tenant
        if(t.allowedSenders && t.allowedSenders.length > 0) {
          const senderAllowed = t.allowedSenders.some(sender => 
            sender.toLowerCase() === envFrom.toLowerCase()
          );
          if (!senderAllowed) {
            throw new Error("Sender not allowed: "+envFrom+" for tenant: "+t.name);
          }
        }
        const from=t.policy?.forceFrom || envFrom;
        const sizeKB=Math.ceil(raw.length/1024); 
        if(t.policy?.maxMessageSizeKB && sizeKB>t.policy.maxMessageSizeKB) {
          throw new Error(`Message too large (${sizeKB}KB > ${t.policy.maxMessageSizeKB}KB)`);
        }
        checkRate(t);
        const bcc=t.policy?.bccArchive ? [t.policy.bccArchive] : [];
        const save=t.policy?.saveToSentItems===true;
        
        // Bepaal delivery method
        const deliveryMethod = t.delivery?.method || "graph";
        
        if (deliveryMethod === "smtp") {
          // SMTP delivery - gebruik nieuwe structuur (delivery.smtp) of legacy (delivery.smtpServer)
          const smtpServerName = t.delivery?.smtp?.smtpServer || t.delivery?.smtpServer;
          if (!smtpServerName) {
            throw new Error("SMTP delivery geselecteerd maar geen SMTP server opgegeven");
          }
          
          // Gebruik dynamisch svc.smtpServers om hot-reload te ondersteunen
          const globalSmtpServers = svc.smtpServers || [];
          const smtpServer = globalSmtpServers.find(s => s.naam === smtpServerName);
          if (!smtpServer) {
            throw new Error(`SMTP server niet gevonden: ${smtpServerName}`);
          }
          
          log("deliver.info",{msgId:id,tenant:t.name,from,rcptCount:rcpts.length,rcpts:rcpts.join(", "),sizeKB,remoteIP:ip,deliveryMethod:"smtp",smtpServer:smtpServerName,message:"Start SMTP verzending"});
          try {
            await sendViaSMTP({tenant:t, parsed, rcpts, envelopeFrom:from, smtpServer, localAddress: serverIP});
            log("deliver.ok",{msgId:id,tenant:t.name,from,rcptCount:rcpts.length,rcpts:rcpts.join(", "),sizeKB,remoteIP:ip,deliveryMethod:"smtp",smtpServer:smtpServerName,reason:"message_delivered"});
          } catch (smtpError) {
            // Bepaal specifieke reason voor SMTP errors
            const errorMsg = String(smtpError.message || "");
            let smtpReason = "smtp_send_failed";
            if (errorMsg.includes("Relay access denied") || errorMsg.includes("relay access denied") || errorMsg.includes("relay denied")) {
              smtpReason = "smtp_relay_denied";
            } else if (errorMsg.includes("sender name") || errorMsg.includes("sender address")) {
              smtpReason = "smtp_sender_rejected";
            }
            
            // Log met SMTP server informatie zodat duidelijk is welke server de fout rapporteert
            const smtpServerInfo = `${smtpServerName} (${smtpServer.adres}:${smtpServer.poort})`;
            log("deliver.err",{
              msgId:id,
              tenant:t.name,
              from,
              rcptCount:rcpts.length,
              rcpts:rcpts.join(", "),
              sizeKB,
              remoteIP:ip,
              deliveryMethod:"smtp",
              smtpServer:smtpServerName,
              smtpServerAddress:`${smtpServer.adres}:${smtpServer.poort}`,
              error:smtpError.message,
              reason:smtpReason,
              note: `Foutmelding komt van externe SMTP server: ${smtpServerInfo}`
            });
            throw smtpError;
          }
        } else {
          // Graph API delivery (standaard) - gebruik nieuwe structuur (delivery.graph) of legacy (top-level velden)
          const graphConfig = t.delivery?.graph || {};
          const tenantForGraph = {
            ...t,
            tenantId: graphConfig.tenantId || t.tenantId,
            clientId: graphConfig.clientId || t.clientId,
            auth: graphConfig.auth || t.auth,
            defaultMailbox: graphConfig.defaultMailbox || t.defaultMailbox
          };
          
          await sendViaGraph({tenant:tenantForGraph, mailbox:tenantForGraph.defaultMailbox, parsed, rcpts, envelopeFrom:from, bccRecipients:bcc, saveToSent:save});
          log("deliver.ok",{msgId:id,tenant:t.name,from,rcptCount:rcpts.length,rcpts:rcpts.join(", "),sizeKB,remoteIP:ip,deliveryMethod:"graph",reason:"message_delivered"});
        }
        
        cb();
      }catch(e){
        const msg = String(e||"");
        let reason = "unknown";
        
        // Bepaal de reden op basis van de error message
        if (msg.includes("Sender not allowed")) reason = "sender_not_allowed";
        else if (msg.includes("Message too large")) reason = "message_too_large";
        else if (msg.includes("IP not allowed")) reason = "ip_not_allowed";
        else if (msg.includes("IP not allowed for tenant")) reason = "tenant_ip_not_allowed";
        else if (msg.includes("TLS required")) reason = "tls_required";
        else if (msg.includes("Graph send failed")) reason = "graph_api_error";
        else if (msg.includes("Relay access denied") || msg.includes("relay access denied") || msg.includes("relay denied")) reason = "smtp_relay_denied";
        else if (msg.includes("SMTP send failed")) reason = "smtp_send_failed";
        else if (msg.includes("sender name") || msg.includes("sender address")) reason = "smtp_sender_rejected";
        
        log("mail.error", { 
          message: "Email verwerking gefaald",
          tenant: tenantName,
          afzender: fromAddr,
          ontvangers: rcpts.join(", "),
          error: msg,
          reason: reason
        });
        
        // Log alle errors op één plek met consistente reden
        log("deliver.err",{msgId:id,tenant:tenantName,from:fromAddr,rcptCount,rcpts:rcpts.join(", "),remoteIP:ip,error:msg,reason}); cb(e);
      }
    }); }
  });
  const port=svc.listenPort || (svc.requireTLS && tlsMode==="implicit" ? 465 : 25);
  const listenAddress = serverIP;
  
  // Log welke serverIP wordt gebruikt
  console.log(`🔧 ServerIP configuratie: ${serverIP} (uit svc.serverIP: ${svc.serverIP || 'niet ingesteld'})`);
  directLog(`🔌 SMTP server starten op poort ${port} (${listenAddress}:${port})`);
  log("config.info", { message: `Starting SMTP server on port ${port}`, host: listenAddress, serverIP: serverIP, svcServerIP: svc.serverIP });
  
  // Gebruik geconfigureerd IP adres of fallback naar alle interfaces
  server.listen(port, listenAddress, () => {
    directLog(`✅ SMTP server succesvol gestart op ${listenAddress}:${port}`);
    log("config.info", { message: `SMTP server ready on ${listenAddress}:${port}`, port: port, host: listenAddress, serverIP: serverIP });
    
    // Forceer socket acceptie in service context
    server.maxConnections = 100;
    server.allowHalfOpen = false;
    
    log("config.info", { message: `SMTP server configured for service context`, maxConnections: 100 });
  }).on('error', (err) => {
    originalConsoleError(`❌ SMTP server bind error: ${err.message} (code: ${err.code})`);
    log("config.error", { 
      message: `SMTP server bind error on port ${port}`, 
      error: err.message,
      code: err.code 
    });
    
    // Probeer opnieuw te binden op localhost als fallback
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      log("config.warn", { message: `Retrying bind on localhost:${port}` });
      server.listen(port, "127.0.0.1", () => {
        log("config.info", { message: `Admin/SMTP ready on localhost:${port}` });
      });
    }
  });
  server.setTenants=(t)=>{tenants=t;};
  server.reloadTenants=()=>reloadTenants().catch(err=>{
    log("config.error", { message: "Manual reload failed", error: err.message });
  });
  return server;
}

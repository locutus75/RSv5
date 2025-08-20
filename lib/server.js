import { SMTPServer } from "smtp-server"; import fs from "fs"; import path from "path"; import Matcher from "cidr-matcher"; import { simpleParser } from "mailparser"; import { v4 as uuidv4 } from "uuid"; import { sendViaGraph } from "./graph.js"; import { checkRate } from "./rateLimiter.js";

const ROOT=process.cwd(); const LOG_DIR=path.join(ROOT,"logs"); const LOG_FILE=path.join(LOG_DIR,"relay.jsonl");
function writeLine(obj){ try{ if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR,{recursive:true}); fs.appendFileSync(LOG_FILE, JSON.stringify(obj)+"\n"); }catch{} }

// Log functie die kan worden geconfigureerd met een externe logger
let log = (lvl, d) => {
  const rec = { ts: new Date().toISOString(), level: lvl, ...d };
  console.log(JSON.stringify(rec));
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
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};
    console.debug = () => {};
  }
}

const cidr=(ip,list=[])=>{try{const m=new Matcher(list);return m.contains(ip);}catch{return false;}};

function pickTenant(tenants, ip, rcpts) {
  const s = [...tenants].sort((a, b) => (a.routing?.priority ?? 100) - (b.routing?.priority ?? 100));
  
  // 1. HOOGSTE PRIORITEIT: Exacte ontvanger match via allowedSenders (gebruikt als ontvanger whitelist)
  for (const t of s) {
    if (t.allowedSenders && t.allowedSenders.length > 0) {
      if (rcpts.some(rcpt => 
        t.allowedSenders.map(v => v.toLowerCase()).includes(rcpt.toLowerCase())
      )) {
        return t;
      }
    }
  }
  
  // 2. MIDDEL: Domain-based routing op ontvangers
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
  
  // 3. LAGER: IP-based routing (minder specifiek) - alleen voor routing, niet voor restrictie
  for (const t of s) {
    if (t.routing?.ipRanges && t.routing.ipRanges.length > 0) {
      if (cidr(ip, t.routing.ipRanges)) {
        return t;
      }
    }
  }
  
  // 4. LAAGSTE: Fallback naar eerste tenant (niet aanbevolen)
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
  let tenants=cfg.tenants; const svc=cfg.service; const allow=new Matcher(svc.allowlistIPs||[]);
  const haveTLS=!!(svc.tls?.certFile && svc.tls?.keyFile); const tlsMode=svc.tls?.mode||"starttls";
  const tlsOpts=haveTLS?{key:fs.readFileSync(svc.tls.keyFile),cert:fs.readFileSync(svc.tls.certFile)}:{};
  
  // Hot-reload functie voor tenants
  async function reloadTenants() {
    try {
      // Dynamisch importeren van config module
      const { loadConfig } = await import("./config.js");
      const config = await loadConfig();
      const newTenants = config.tenants || [];
      
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
            name: svc.hostName || "rileesurfis",
    secure: haveTLS && svc.requireTLS && tlsMode==="implicit",
    ...tlsOpts,
    disabledCommands: haveTLS?[]:["STARTTLS"],
    authOptional: svc.optionalBasicAuth===true,
    // Forceer binding op alle interfaces
    host: "0.0.0.0",
    onAuth(a,s,cb){ if(!svc.optionalBasicAuth){const ok=(svc.users||[]).some(u=>u.username===a?.username && u.password===a?.password); return ok?cb(null,{user:a.username}):cb(new Error("Invalid credentials"));} else { return cb(null,{user:a?.username||"anonymous"});} },
    onConnect(s,cb){
      // Debug logging voor IP check
      log("debug", { 
        message: "Client verbinding", 
        remoteIP: s.remoteAddress,
        allowlistIPs: svc.allowlistIPs,
        allowed: allow.contains(s.remoteAddress)
      });
      
      if(!(allow.contains(s.remoteAddress))){
        const id = uuidv4();
        log("deliver.err",{msgId:id,tenant:"unknown",remoteIP:s.remoteAddress,error:"IP not allowed",reason:"ip_not_allowed"});
        return cb(new Error("IP not allowed"));
      }
      if(svc.requireTLS && tlsMode==="implicit" && !s.secure) return cb(new Error("TLS required"));
      return cb();
    },
    onData(st,s,cb){ const id=uuidv4(); let raw=Buffer.alloc(0); st.on("data",ch=>raw=Buffer.concat([raw,ch])); st.on("end",async()=>{
      const ip=s.remoteAddress; let tenantName="unknown"; let fromAddr=""; let rcptCount=0; let rcpts=[]; try{
        if(svc.requireTLS && !s.secure) throw new Error("TLS required");
        const parsed=await simpleParser(raw);
        const envFrom=(s.envelope.mailFrom?.address) || (parsed.from?.value?.[0]?.address) || ""; fromAddr=envFrom;
        rcpts=(s.envelope.rcptTo||[]).map(r=>r.address); rcptCount = rcpts.length;
        // Eerst kijken naar ontvangers voor tenant routing
        const t=pickTenant(tenants, ip, rcpts); tenantName = t?.name || tenantName;
        
        // Controleer IP range restricties voor de geselecteerde tenant
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
        

        
        await sendViaGraph({tenant:t, mailbox:t.defaultMailbox, parsed, rcpts, envelopeFrom:from, bccRecipients:bcc, saveToSent:save});
        log("deliver.ok",{msgId:id,tenant:t.name,from,rcptCount:rcpts.length,rcpts:rcpts.join(", "),sizeKB,remoteIP:ip}); cb();
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
  
  // Forceer binding op alle interfaces, ook in service context
  server.listen(port, "0.0.0.0", () => {
    log("config.info", { message: `Admin/SMTP ready on ${port}` });
    
    // Forceer socket acceptie in service context
    server.maxConnections = 100;
    server.allowHalfOpen = false;
    
    log("config.info", { message: `SMTP server configured for service context` });
  }).on('error', (err) => {
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

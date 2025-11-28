import fs from "fs";
import path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = process.cwd();
const SERVICE = path.join(ROOT, "config.json");
const TENANTS = path.join(ROOT, "tenants.d");

// Laad schema
let schema;
try {
  schema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema", "tenant.schema.json"), "utf8"));
} catch (error) {
  console.error(`❌ Fout bij laden van schema: ${error.message}`);
  throw error;
}

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const read = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`❌ Fout bij lezen van bestand ${filePath}: ${error.message}`);
    throw error;
  }
};

/**
 * Migreer oude tenant configuratie naar nieuwe structuur
 * Converteert legacy configuraties naar nieuwe delivery structuur
 */
function migrateTenantConfig(tenant) {
  // Maak een kopie om origineel niet te wijzigen
  const migrated = JSON.parse(JSON.stringify(tenant));
  
  // Detecteer of dit een oude configuratie is
  const hasLegacyGraphFields = migrated.tenantId || migrated.clientId || migrated.auth || migrated.defaultMailbox;
  const hasLegacySmtpField = migrated.delivery?.smtpServer && !migrated.delivery?.smtp;
  const hasNewStructure = migrated.delivery?.graph || migrated.delivery?.smtp;
  
  // Alleen migreren als er legacy velden zijn en geen nieuwe structuur
  if ((hasLegacyGraphFields || hasLegacySmtpField) && !hasNewStructure) {
    console.log(`🔄 Migreer tenant configuratie: ${migrated.name || 'unknown'}`);
    
    // Zorg dat delivery object bestaat
    if (!migrated.delivery) {
      migrated.delivery = {};
    }
    
    // Migreer Graph API configuratie (van top-level naar delivery.graph)
    if (hasLegacyGraphFields) {
      migrated.delivery.graph = {};
      if (migrated.tenantId) {
        migrated.delivery.graph.tenantId = migrated.tenantId;
        delete migrated.tenantId;
      }
      if (migrated.clientId) {
        migrated.delivery.graph.clientId = migrated.clientId;
        delete migrated.clientId;
      }
      if (migrated.auth) {
        migrated.delivery.graph.auth = migrated.auth;
        delete migrated.auth;
      }
      if (migrated.defaultMailbox) {
        migrated.delivery.graph.defaultMailbox = migrated.defaultMailbox;
        delete migrated.defaultMailbox;
      }
      
      // Stel delivery method in op graph als deze nog niet is ingesteld
      if (!migrated.delivery.method) {
        migrated.delivery.method = "graph";
      }
    }
    
    // Migreer SMTP configuratie (van delivery.smtpServer naar delivery.smtp.smtpServer)
    if (hasLegacySmtpField) {
      migrated.delivery.smtp = {
        smtpServer: migrated.delivery.smtpServer
      };
      delete migrated.delivery.smtpServer;
      
      // Stel delivery method in op smtp als deze nog niet is ingesteld
      if (!migrated.delivery.method) {
        migrated.delivery.method = "smtp";
      }
    }
    
    // Als er geen delivery method is ingesteld, gebruik graph als standaard
    if (!migrated.delivery.method) {
      migrated.delivery.method = "graph";
    }
    
    console.log(`✅ Tenant gemigreerd: ${migrated.name || 'unknown'} - delivery method: ${migrated.delivery.method}`);
  }
  
  return migrated;
}

export async function loadConfig() {
  try {
    console.log(`📁 Configuratie laden van: ${SERVICE}`);
    
    if (!fs.existsSync(SERVICE)) {
      console.warn(`⚠️ Configuratie bestand niet gevonden: ${SERVICE}`);
      return { service: {}, tenants: [] };
    }
    
    const cfg = read(SERVICE);
    console.log(`✅ Service configuratie geladen`);
    
    if (!fs.existsSync(TENANTS)) {
      console.log(`📁 Tenants directory aanmaken: ${TENANTS}`);
      fs.mkdirSync(TENANTS, { recursive: true });
    }
    
    const files = fs.readdirSync(TENANTS).filter(f => f.toLowerCase().endsWith(".json"));
    console.log(`📋 ${files.length} tenant bestanden gevonden`);
    
    const tenants = [];
    for (const f of files) {
      try {
        const tenantPath = path.join(TENANTS, f);
        console.log(`🔍 Tenant laden: ${f}`);
        
        let d = read(tenantPath);
        
        // Migreer oude configuratie naar nieuwe structuur (in-memory)
        const originalD = JSON.parse(JSON.stringify(d)); // Backup voor vergelijking
        d = migrateTenantConfig(d);
        
        // Als er migratie heeft plaatsgevonden, sla de gemigreerde versie op
        if (JSON.stringify(originalD) !== JSON.stringify(d)) {
          console.log(`💾 Opslaan gemigreerde configuratie: ${f}`);
          try {
            fs.writeFileSync(tenantPath, JSON.stringify(d, null, 2), "utf8");
            console.log(`✅ Gemigreerde configuratie opgeslagen: ${f}`);
          } catch (writeError) {
            console.warn(`⚠️ Kon gemigreerde configuratie niet opslaan voor ${f}: ${writeError.message}`);
            // Ga door met in-memory versie
          }
        }
        
        // Valideer na migratie
        if (!validate(d)) {
          console.error(`❌ Tenant ${f} is ongeldig na migratie:`, validate.errors);
          throw new Error(`Tenant ${f} is ongeldig: ${JSON.stringify(validate.errors)}`);
        }
        
        tenants.push(d);
        console.log(`✅ Tenant geladen: ${d.name || f}`);
      } catch (error) {
        console.error(`❌ Fout bij laden van tenant ${f}: ${error.message}`);
        throw error;
      }
    }
    
    console.log(`🎯 Configuratie succesvol geladen - ${tenants.length} tenants`);
    return { service: cfg.service, tenants };
    
  } catch (error) {
    console.error(`❌ Fout bij laden van configuratie: ${error.message}`);
    throw error;
  }
}

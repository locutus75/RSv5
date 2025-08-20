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
        
        const d = read(tenantPath);
        if (!validate(d)) {
          console.error(`❌ Tenant ${f} is ongeldig:`, validate.errors);
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

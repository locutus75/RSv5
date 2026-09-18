import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// Bepaal applicatie root op basis van waar dit script zich bevindt
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const DEFAULT_CERTS_DIR = path.join(ROOT, "certs");

const CERT_NAME = "admin-cert.pem";
const KEY_NAME = "admin-key.pem";

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

/**
 * Bepaal key/cert voor de HTTPS admin-server, in deze volgorde:
 *  1. service.admin.tls.certFile + keyFile uit config.json
 *  2. certs/admin-cert.pem + certs/admin-key.pem (eerder gegenereerd)
 *  3. nieuw self-signed certificaat genereren en opslaan als (2)
 */
export async function getAdminTlsOptions(adminConfig = {}, { certsDir = DEFAULT_CERTS_DIR } = {}) {
  const tls = adminConfig?.tls || {};
  if (tls.certFile || tls.keyFile) {
    if (!tls.certFile || !tls.keyFile) {
      throw new Error("service.admin.tls vereist zowel certFile als keyFile");
    }
    const certPath = resolveFromRoot(tls.certFile);
    const keyPath = resolveFromRoot(tls.keyFile);
    if (!fs.existsSync(certPath)) throw new Error(`Admin TLS certificaat niet gevonden: ${certPath}`);
    if (!fs.existsSync(keyPath)) throw new Error(`Admin TLS private key niet gevonden: ${keyPath}`);
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), source: "config" };
  }

  const certPath = path.join(certsDir, CERT_NAME);
  const keyPath = path.join(certsDir, KEY_NAME);
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), source: "file" };
  }

  const hostname = os.hostname();
  console.log(`🔐 Geen admin-certificaat gevonden, self-signed certificaat genereren voor ${hostname}...`);
  const { generate } = await import("selfsigned");
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 10);
  const pems = await generate([{ name: "commonName", value: hostname }], {
    keySize: 2048,
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [
        { type: 2, value: hostname },
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" }
      ] }
    ]
  });

  fs.mkdirSync(certsDir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert);
  console.log(`✅ Self-signed admin-certificaat opgeslagen: ${certPath}`);
  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert), source: "generated" };
}

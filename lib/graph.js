import fs from "fs";
import fetch from "node-fetch";
import { ConfidentialClientApplication } from "@azure/msal-node";

// Cache van MSAL applicaties per tenant-configuratie. MSAL cachet intern de access tokens,
// maar alleen als dezelfde ConfidentialClientApplication-instantie hergebruikt wordt.
// Zonder deze cache doet elke e-mail een token-roundtrip naar login.microsoftonline.com.
const msalCache = new Map();

function msal(tenant) {
  const { certPath, thumbprint } = tenant.auth;
  const key = [tenant.tenantId, tenant.clientId, thumbprint, certPath].join("|");
  let app = msalCache.get(key);
  if (!app) {
    const pem = fs.readFileSync(certPath, "utf8");
    app = new ConfidentialClientApplication({
      auth: {
        clientId: tenant.clientId,
        authority: `https://login.microsoftonline.com/${tenant.tenantId}`,
        clientCertificate: { thumbprint, privateKey: pem }
      }
    });
    msalCache.set(key, app);
  }
  return app;
}

/** Leeg de MSAL cache (bv. na een configuratie-reload of certificaat-rotatie). */
export function clearMsalCache() {
  msalCache.clear();
}

async function token(app) {
  const r = await app.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  if (!r?.accessToken) throw new Error("no token");
  return r.accessToken;
}

// Zet een mailparser adres-lijst om naar losse e-mailadressen. Groepen ("Team: a@x, b@x;")
// worden platgeslagen; entries zonder adres worden overgeslagen.
function addressesOf(addressObject) {
  const out = [];
  const walk = (list) => {
    for (const v of list || []) {
      if (v?.group) walk(v.group);
      else if (v?.address) out.push(v.address);
    }
  };
  walk(addressObject?.value);
  return out;
}

const toGraph = (addr) => ({ emailAddress: { address: addr } });
const lower = (s) => String(s || "").toLowerCase();

export async function sendViaGraph({ tenant, mailbox, parsed, rcpts, envelopeFrom, bccRecipients = [], saveToSent = false }) {
  console.log(`🔐 MSAL authenticatie voor tenant: ${tenant.name}`);
  const app = msal(tenant);

  let tk;
  try {
    console.log(`🎫 Ophalen access token...`);
    tk = await token(app);
    console.log(`✅ Access token opgehaald`);
  } catch (error) {
    console.error(`❌ MSAL authenticatie gefaald:`, error.message);
    // Bij een auth-fout de gecachte app weggooien zodat een volgende poging vers start
    clearMsalCache();
    throw error;
  }

  const body = parsed.html ? { contentType: "HTML", content: parsed.html } : { contentType: "Text", content: parsed.text || "" };

  // Header-ontvangers (To/Cc) bepalen wat de ontvanger ziet; de envelope (RCPT TO) bepaalt
  // wie de mail daadwerkelijk krijgt. Envelope-ontvangers die niet in To/Cc staan (Bcc's)
  // gaan als bccRecipients mee, zodat ze wél bezorgd worden maar niet zichtbaar zijn.
  const toAddrs = addressesOf(parsed.to);
  const ccAddrs = addressesOf(parsed.cc);
  const visible = new Set([...toAddrs, ...ccAddrs].map(lower));
  const envelopeOnly = (rcpts || []).filter(a => !visible.has(lower(a)));

  // Zonder To-header: gebruik de envelope-ontvangers als To, anders weigert Graph het bericht
  const to = (toAddrs.length > 0 ? toAddrs : envelopeOnly).map(toGraph);
  const cc = ccAddrs.map(toGraph);
  const bccSet = new Set();
  if (toAddrs.length > 0) envelopeOnly.forEach(a => bccSet.add(a));
  addressesOf(parsed.bcc).forEach(a => bccSet.add(a));
  bccRecipients.forEach(a => bccSet.add(a));
  const bcc = [...bccSet].map(toGraph);

  // Converteer attachments naar Graph API formaat
  const attachments = [];
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      let contentBytes;
      if (Buffer.isBuffer(att.content)) {
        contentBytes = att.content.toString('base64');
      } else if (typeof att.content === 'string') {
        contentBytes = Buffer.from(att.content).toString('base64');
      } else {
        console.warn(`⚠️ Attachment ${att.filename || 'unknown'} heeft onbekend content type, wordt overgeslagen`);
        continue;
      }

      attachments.push({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.filename || "attachment",
        contentType: att.contentType || "application/octet-stream",
        contentBytes
      });
    }
  }

  const msg = {
    subject: parsed.subject || "(no subject)",
    body,
    toRecipients: to,
    ccRecipients: cc,
    bccRecipients: bcc,
    attachments: attachments.length > 0 ? attachments : undefined
  };

  console.log(`📧 Email bericht samengesteld:`);
  console.log(`   Onderwerp: ${msg.subject}`);
  console.log(`   Type: ${body.contentType}`);
  console.log(`   To: ${to.map(r => r.emailAddress.address).join(", ")}`);
  console.log(`   CC: ${cc.map(r => r.emailAddress.address).join(", ") || "geen"}`);
  console.log(`   BCC: ${bcc.map(r => r.emailAddress.address).join(", ") || "geen"}`);
  console.log(`   Bijlages: ${attachments.length > 0 ? attachments.length + " bestand(en)" : "geen"}`);
  attachments.forEach((att, idx) => console.log(`      ${idx + 1}. ${att.name} (${att.contentType})`));

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
  console.log(`🌐 Graph API URL: ${url}`);

  try {
    console.log(`📤 Verzenden naar Graph API...`);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, saveToSentItems: !!saveToSent })
    });

    console.log(`📊 Graph API Response: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      let errorBody = "";
      try {
        errorBody = await res.text();
        console.error(`❌ Graph API Error Body:`, errorBody);
      } catch (e) {
        console.error(`❌ Kon error body niet lezen:`, e.message);
      }
      throw new Error(`Graph send failed ${res.status} ${res.statusText}${errorBody ? ` - ${errorBody}` : ""}`);
    }

    console.log(`✅ Email succesvol verzonden via Graph API`);
  } catch (error) {
    console.error(`❌ Graph API verzending gefaald:`, error.message);
    throw error;
  }
}

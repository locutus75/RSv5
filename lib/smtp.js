import nodemailer from "nodemailer";

/**
 * Verzend email via SMTP server
 * @param {Object} options - Delivery opties
 * @param {Object} options.tenant - Tenant configuratie
 * @param {Object} options.parsed - Geparsed email bericht (van mailparser)
 * @param {Array} options.rcpts - Ontvangers array
 * @param {String} options.envelopeFrom - Afzender email adres
 * @param {Object} options.smtpServer - SMTP server configuratie (naam, adres, poort)
 */
export async function sendViaSMTP({ tenant, parsed, rcpts, envelopeFrom, smtpServer }) {
  if (!smtpServer || !smtpServer.adres || !smtpServer.poort) {
    throw new Error("SMTP server configuratie ontbreekt: adres en poort zijn verplicht");
  }

  console.log(`📧 SMTP verzending voor tenant: ${tenant.name}`);
  console.log(`   SMTP Server: ${smtpServer.naam} (${smtpServer.adres}:${smtpServer.poort})`);

  // Maak transporter configuratie
  const transporterConfig = {
    host: smtpServer.adres,
    port: parseInt(smtpServer.poort),
    secure: false, // STARTTLS wordt automatisch onderhandeld
    requireTLS: true,
    auth: smtpServer.auth || undefined
  };

  // Maak transporter
  const transporter = nodemailer.createTransport(transporterConfig);

  // Verzamel email data
  const mailOptions = {
    from: envelopeFrom,
    to: rcpts,
    subject: parsed.subject || "(no subject)",
    text: parsed.text || "",
    html: parsed.html || undefined,
    cc: parsed.cc?.value?.map(c => c.address) || undefined,
    bcc: parsed.bcc?.value?.map(b => b.address) || undefined,
    attachments: parsed.attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType
    })) || undefined
  };

  try {
    console.log(`📤 Verzenden naar SMTP server...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email succesvol verzonden via SMTP: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ SMTP verzending gefaald:`, error.message);
    throw new Error(`SMTP send failed: ${error.message}`);
  }
}

/**
 * Test SMTP server connectie
 * @param {Object} smtpServer - SMTP server configuratie
 * @returns {Promise<Object>} Test resultaat
 */
export async function testSMTPConnection(smtpServer) {
  if (!smtpServer || !smtpServer.adres || !smtpServer.poort) {
    throw new Error("SMTP server configuratie ontbreekt: adres en poort zijn verplicht");
  }

  console.log(`🔍 Testen SMTP connectie: ${smtpServer.naam || 'Unknown'} (${smtpServer.adres}:${smtpServer.poort})`);

  const transporterConfig = {
    host: smtpServer.adres,
    port: parseInt(smtpServer.poort),
    secure: false,
    requireTLS: true,
    auth: smtpServer.auth || undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  };

  const transporter = nodemailer.createTransport(transporterConfig);

  try {
    await transporter.verify();
    console.log(`✅ SMTP connectie succesvol`);
    return { ok: true, message: "SMTP connectie succesvol" };
  } catch (error) {
    console.error(`❌ SMTP connectie gefaald:`, error.message);
    return { ok: false, error: error.message };
  } finally {
    try {
      transporter.close();
    } catch (e) {
      // Ignore close errors
    }
  }
}


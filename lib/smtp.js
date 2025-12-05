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
  console.log(`   Originele envelope FROM: ${envelopeFrom}`);
  console.log(`   Authenticatie: ${smtpServer.auth ? 'Ja (' + (smtpServer.auth.user || 'unknown') + ')' : 'Nee'}`);

  const port = parseInt(smtpServer.poort);
  
  // Bepaal TLS configuratie op basis van poort en configuratie
  // Poort 465 gebruikt implicit TLS (secure: true)
  // Poort 587 en 25 gebruiken STARTTLS (secure: false)
  // Als requireTLS niet is opgegeven, proberen we STARTTLS maar falen niet als het niet beschikbaar is
  const isSecurePort = port === 465;
  const requireTLS = smtpServer.requireTLS !== undefined ? smtpServer.requireTLS : false;
  
  // Maak transporter configuratie
  const transporterConfig = {
    host: smtpServer.adres,
    port: port,
    secure: isSecurePort, // Implicit TLS voor poort 465
    requireTLS: requireTLS && !isSecurePort, // Alleen voor non-secure poorten, en alleen als expliciet gevraagd
    auth: smtpServer.auth || undefined,
    // IgnoreTLS: als requireTLS false is, accepteren we ook niet-versleutelde verbindingen
    ignoreTLS: !requireTLS && !isSecurePort
  };

  // Maak transporter
  const transporter = nodemailer.createTransport(transporterConfig);

  // Bepaal envelope FROM: als er authenticatie is, gebruik de geauthenticeerde gebruiker als envelope FROM
  // Dit is nodig omdat veel SMTP servers vereisen dat MAIL FROM overeenkomt met de geauthenticeerde gebruiker
  // De FROM header in het bericht blijft het originele adres
  let mailFrom = envelopeFrom;
  if (smtpServer.auth && smtpServer.auth.user) {
    mailFrom = smtpServer.auth.user;
    console.log(`   ⚠️ Envelope FROM aangepast naar geauthenticeerde gebruiker: ${mailFrom}`);
    console.log(`   Originele FROM header blijft: ${envelopeFrom}`);
  } else {
    console.log(`   Envelope FROM gebruikt: ${mailFrom}`);
  }

  // Bepaal FROM header voor het bericht zelf (niet envelope)
  const fromHeader = parsed.from?.value?.[0]?.address || envelopeFrom;
  console.log(`   FROM header in bericht: ${fromHeader}`);
  
  // Verzamel email data
  const mailOptions = {
    from: mailFrom, // Envelope FROM (MAIL FROM command) - moet overeenkomen met auth user als auth gebruikt wordt
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
    })) || undefined,
    // Behoud de originele FROM header in het bericht zelf
    headers: {
      'From': fromHeader
    }
  };
  
  console.log(`   Mail opties - Envelope FROM: ${mailOptions.from}, FROM header: ${mailOptions.headers.From}`);

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

  const port = parseInt(smtpServer.poort);
  const isSecurePort = port === 465;
  const requireTLS = smtpServer.requireTLS !== undefined ? smtpServer.requireTLS : false;

  const transporterConfig = {
    host: smtpServer.adres,
    port: port,
    secure: isSecurePort,
    requireTLS: requireTLS && !isSecurePort,
    auth: smtpServer.auth || undefined,
    ignoreTLS: !requireTLS && !isSecurePort,
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


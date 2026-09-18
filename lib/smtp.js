import nodemailer from "nodemailer";

/**
 * Bouw de nodemailer transporter configuratie voor een SMTP server.
 *
 * TLS gedrag:
 * - Poort 465: implicit TLS (secure: true)
 * - Andere poorten: opportunistische STARTTLS (nodemailer default). Als de server
 *   STARTTLS aanbiedt wordt die gebruikt; met requireTLS: true is STARTTLS verplicht.
 * - Certificaten worden altijd gevalideerd (geen rejectUnauthorized: false).
 *
 * Uitgaand IP: nodemailer ondersteunt `localAddress` native (wordt doorgegeven aan
 * net.connect), dus er is geen custom socket factory nodig.
 */
function buildTransporterConfig(smtpServer, localAddress, extra = {}) {
  const hasAuth = !!(smtpServer.auth && smtpServer.auth.user && smtpServer.auth.pass);
  const port = parseInt(smtpServer.poort, 10);
  const isSecurePort = port === 465;
  const requireTLS = smtpServer.requireTLS === true;

  const config = {
    host: smtpServer.adres,
    port,
    secure: isSecurePort,
    requireTLS: requireTLS && !isSecurePort,
    auth: hasAuth ? { user: smtpServer.auth.user, pass: smtpServer.auth.pass } : undefined,
    ...extra
  };

  if (localAddress && localAddress !== "0.0.0.0") {
    console.log(`   🔧 Uitgaand IP adres geconfigureerd: ${localAddress}`);
    config.localAddress = localAddress;
  }

  return { config, hasAuth, port, isSecurePort, requireTLS };
}

/**
 * Verzend email via SMTP server
 * @param {Object} options - Delivery opties
 * @param {Object} options.tenant - Tenant configuratie
 * @param {Object} options.parsed - Geparsed email bericht (van mailparser)
 * @param {Array} options.rcpts - Envelope ontvangers (RCPT TO), inclusief eventuele Bcc's
 * @param {String} options.envelopeFrom - Afzender email adres
 * @param {Object} options.smtpServer - SMTP server configuratie (naam, adres, poort)
 * @param {String} options.localAddress - Optioneel lokaal IP adres voor uitgaande verbinding
 */
export async function sendViaSMTP({ tenant, parsed, rcpts, envelopeFrom, smtpServer, localAddress }) {
  if (!smtpServer || !smtpServer.adres || !smtpServer.poort) {
    throw new Error("SMTP server configuratie ontbreekt: adres en poort zijn verplicht");
  }

  console.log(`📧 SMTP verzending voor tenant: ${tenant.name}`);
  console.log(`   SMTP Server: ${smtpServer.naam} (${smtpServer.adres}:${smtpServer.poort})`);
  console.log(`   Originele envelope FROM: ${envelopeFrom}`);

  const { config: transporterConfig, hasAuth, isSecurePort, requireTLS } = buildTransporterConfig(smtpServer, localAddress);
  console.log(`   Authenticatie: ${hasAuth ? `Ja (gebruiker: ${smtpServer.auth.user})` : 'Nee (geen gebruikers gedefinieerd)'}`);
  console.log(`   TLS: ${isSecurePort ? 'implicit (465)' : requireTLS ? 'STARTTLS verplicht' : 'STARTTLS opportunistisch'}`);

  const transporter = nodemailer.createTransport(transporterConfig);

  // Bepaal envelope FROM (MAIL FROM): als er authenticatie is, gebruik de geauthenticeerde
  // gebruiker, omdat veel SMTP servers vereisen dat MAIL FROM overeenkomt met de auth user.
  // De From-header in het bericht zelf blijft het originele adres (zie `from` hieronder).
  let mailFrom = envelopeFrom;
  if (hasAuth) {
    mailFrom = smtpServer.auth.user;
    console.log(`   ⚠️ Envelope FROM aangepast naar geauthenticeerde gebruiker: ${mailFrom}`);
  } else {
    console.log(`   Envelope FROM gebruikt: ${mailFrom}`);
    console.log(`   ℹ️ Geen authenticatie geconfigureerd - server kan authenticatie vereisen`);
  }

  // Header-adressen komen uit het originele bericht; de envelope (MAIL FROM / RCPT TO)
  // wordt apart gezet zodat Bcc-ontvangers NIET in de zichtbare To-header terechtkomen.
  const fromHeader = parsed.from?.text || parsed.from?.value?.[0]?.address || envelopeFrom;
  console.log(`   FROM header in bericht: ${fromHeader}`);

  const mailOptions = {
    from: fromHeader,
    to: parsed.to?.text || undefined,
    cc: parsed.cc?.text || undefined,
    subject: parsed.subject || "(no subject)",
    text: parsed.text || "",
    html: parsed.html || undefined,
    attachments: parsed.attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType
    })) || undefined,
    envelope: {
      from: mailFrom,
      to: rcpts
    }
  };

  console.log(`   Envelope: FROM ${mailOptions.envelope.from} → TO ${rcpts.join(", ")}`);

  try {
    console.log(`📤 Verzenden naar SMTP server...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email succesvol verzonden via SMTP: ${info.messageId}`);
    return info;
  } catch (error) {
    const smtpServerInfo = `${smtpServer.naam || 'Unknown'} (${smtpServer.adres}:${smtpServer.poort})`;
    console.error(`❌ SMTP verzending gefaald naar ${smtpServerInfo}:`, error.message);
    // Voeg SMTP server informatie toe aan de error message zodat duidelijk is welke server de fout rapporteert
    throw new Error(`SMTP send failed [${smtpServerInfo}]: ${error.message}`);
  } finally {
    try { transporter.close(); } catch { /* ignore */ }
  }
}

/**
 * Test SMTP server connectie
 * @param {Object} smtpServer - SMTP server configuratie
 * @param {String} localAddress - Optioneel lokaal IP adres voor uitgaande verbinding
 * @returns {Promise<Object>} Test resultaat
 */
export async function testSMTPConnection(smtpServer, localAddress) {
  if (!smtpServer || !smtpServer.adres || !smtpServer.poort) {
    throw new Error("SMTP server configuratie ontbreekt: adres en poort zijn verplicht");
  }

  console.log(`🔍 Testen SMTP connectie: ${smtpServer.naam || 'Unknown'} (${smtpServer.adres}:${smtpServer.poort})`);

  const { config: transporterConfig, hasAuth } = buildTransporterConfig(smtpServer, localAddress, {
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  });
  console.log(`   Authenticatie configuratie: ${hasAuth ? `Ja (gebruiker: ${smtpServer.auth.user})` : 'Nee (geen gebruikers gedefinieerd)'}`);

  if (!hasAuth) {
    console.log(`   ⚠️ Let op: Geen authenticatie geconfigureerd - de server kan authenticatie vereisen`);
    console.log(`   💡 Tip: Voeg een authenticatie gebruiker toe in de configuratie als de server authenticatie vereist`);
  }

  const transporter = nodemailer.createTransport(transporterConfig);

  try {
    await transporter.verify();
    console.log(`✅ SMTP connectie succesvol`);
    const resultMessage = hasAuth
      ? "SMTP connectie succesvol met authenticatie"
      : "SMTP connectie succesvol zonder authenticatie";
    return { ok: true, message: resultMessage, authUsed: hasAuth };
  } catch (error) {
    console.error(`❌ SMTP connectie gefaald:`, error.message);

    // Geef specifieke feedback als authenticatie mogelijk nodig is
    let errorMessage = error.message;
    if (!hasAuth && (error.message.includes('authentication') || error.message.includes('530') || error.message.includes('535'))) {
      errorMessage = `${error.message} - Mogelijk is authenticatie vereist. Voeg een authenticatie gebruiker toe aan de SMTP server configuratie.`;
    } else if (error.code === 'EADDRNOTAVAIL') {
      errorMessage = `${error.message} - Het geconfigureerde uitgaande IP adres (${localAddress}) is niet beschikbaar op deze server.`;
    }

    return { ok: false, error: errorMessage, authUsed: hasAuth };
  } finally {
    try {
      transporter.close();
    } catch (e) {
      // Ignore close errors
    }
  }
}

import nodemailer from "nodemailer";

/**
 * Verzend email via SMTP server
 * @param {Object} options - Delivery opties
 * @param {Object} options.tenant - Tenant configuratie
 * @param {Object} options.parsed - Geparsed email bericht (van mailparser)
 * @param {Array} options.rcpts - Ontvangers array
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
  
  // Bepaal of authenticatie moet worden gebruikt
  // Authenticatie wordt alleen gebruikt als er gebruikersgegevens zijn gedefinieerd
  const hasAuth = smtpServer.auth && smtpServer.auth.user && smtpServer.auth.pass;
  const authInfo = hasAuth ? `Ja (gebruiker: ${smtpServer.auth.user})` : 'Nee (geen gebruikers gedefinieerd)';
  console.log(`   Authenticatie: ${authInfo}`);

  const port = parseInt(smtpServer.poort);
  
  // Bepaal TLS configuratie op basis van poort en configuratie
  // Poort 465 gebruikt implicit TLS (secure: true)
  // Poort 587 en 25 gebruiken STARTTLS (secure: false)
  // Als requireTLS niet is opgegeven, proberen we STARTTLS maar falen niet als het niet beschikbaar is
  const isSecurePort = port === 465;
  const requireTLS = smtpServer.requireTLS !== undefined ? smtpServer.requireTLS : false;
  
  // Maak transporter configuratie
  // Authenticatie wordt alleen toegevoegd als er gebruikersgegevens zijn gedefinieerd
  const transporterConfig = {
    host: smtpServer.adres,
    port: port,
    secure: isSecurePort, // Implicit TLS voor poort 465
    requireTLS: requireTLS && !isSecurePort, // Alleen voor non-secure poorten, en alleen als expliciet gevraagd
    auth: hasAuth ? smtpServer.auth : undefined, // Alleen authenticatie als gebruikers zijn gedefinieerd
    // IgnoreTLS: als requireTLS false is, accepteren we ook niet-versleutelde verbindingen
    ignoreTLS: !requireTLS && !isSecurePort
  };
  
  // Gebruik custom socket factory om expliciet te binden aan het juiste IP adres
  // Dit is nodig wanneer er meerdere IP adressen op een interface zijn
  if (localAddress && localAddress !== "0.0.0.0") {
    console.log(`   🔧 Uitgaand IP adres geconfigureerd: ${localAddress}`);
    
    // Import net en tls modules voor socket binding
    const net = await import("net");
    const tls = await import("tls");
    
    transporterConfig.getSocket = function(options, callback) {
      console.log(`   🔌 Socket factory aangeroepen - Doel: ${options.host}:${options.port}, Lokaal IP: ${localAddress}`);
      
      // Maak eerst een socket zonder verbinding
      const socket = new net.Socket();
      
      // Bind expliciet aan het gekozen IP adres VOORDAT we verbinden
      socket.bind(0, localAddress, () => {
        const boundAddress = socket.address();
        console.log(`   ✅ Socket gebonden aan lokaal adres: ${boundAddress.address}:${boundAddress.port} (interface: ${boundAddress.family})`);
        
        // Nu verbinden naar de remote host
        socket.connect(options.port, options.host, () => {
          const localAddr = socket.localAddress;
          const localPort = socket.localPort;
          const remoteAddr = socket.remoteAddress;
          const remotePort = socket.remotePort;
          console.log(`   ✅ Verbinding tot stand gebracht:`);
          console.log(`      Lokaal: ${localAddr}:${localPort}`);
          console.log(`      Remote: ${remoteAddr}:${remotePort}`);
          
          // Verifieer dat het juiste IP adres wordt gebruikt
          if (localAddr !== localAddress) {
            console.warn(`   ⚠️ WAARSCHUWING: Socket gebruikt ${localAddr} in plaats van geconfigureerd ${localAddress}`);
          } else {
            console.log(`   ✅ Bevestigd: Socket gebruikt correct IP adres ${localAddress}`);
          }
          
          // Als secure (TLS) verbinding, upgrade naar TLS socket
          if (options.secure) {
            console.log(`   🔒 Upgraden naar TLS verbinding...`);
            const tlsSocket = tls.connect({
              socket: socket,
              host: options.host,
              rejectUnauthorized: false // Accepteer zelf-ondertekende certificaten
            }, () => {
              console.log(`   ✅ TLS verbinding tot stand gebracht`);
              callback(null, { connection: tlsSocket });
            });
            
            tlsSocket.on('error', (err) => {
              console.error(`   ❌ TLS socket error: ${err.message}`);
              callback(err);
            });
          } else {
            callback(null, { connection: socket });
          }
        });
      });
      
      socket.on('error', (err) => {
        console.error(`   ❌ Socket error tijdens binding/verbinding: ${err.message} (code: ${err.code})`);
        callback(err);
      });
      
      return socket;
    };
  }

  // Maak transporter
  const transporter = nodemailer.createTransport(transporterConfig);

  // Bepaal envelope FROM: als er authenticatie is, gebruik de geauthenticeerde gebruiker als envelope FROM
  // Dit is nodig omdat veel SMTP servers vereisen dat MAIL FROM overeenkomt met de geauthenticeerde gebruiker
  // De FROM header in het bericht blijft het originele adres
  let mailFrom = envelopeFrom;
  if (hasAuth && smtpServer.auth.user) {
    mailFrom = smtpServer.auth.user;
    console.log(`   ⚠️ Envelope FROM aangepast naar geauthenticeerde gebruiker: ${mailFrom}`);
    console.log(`   Originele FROM header blijft: ${envelopeFrom}`);
  } else {
    console.log(`   Envelope FROM gebruikt: ${mailFrom}`);
    if (!hasAuth) {
      console.log(`   ℹ️ Geen authenticatie geconfigureerd - server kan authenticatie vereisen`);
    }
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
    const smtpServerInfo = `${smtpServer.naam || 'Unknown'} (${smtpServer.adres}:${smtpServer.poort})`;
    console.error(`❌ SMTP verzending gefaald naar ${smtpServerInfo}:`, error.message);
    // Voeg SMTP server informatie toe aan de error message zodat duidelijk is welke server de fout rapporteert
    throw new Error(`SMTP send failed [${smtpServerInfo}]: ${error.message}`);
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

  // Bepaal of authenticatie moet worden gebruikt
  // Authenticatie wordt alleen gebruikt als er gebruikersgegevens zijn gedefinieerd
  const hasAuth = smtpServer.auth && smtpServer.auth.user && smtpServer.auth.pass;
  const authInfo = hasAuth ? `Ja (gebruiker: ${smtpServer.auth.user})` : 'Nee (geen gebruikers gedefinieerd)';
  console.log(`   Authenticatie configuratie: ${authInfo}`);
  
  if (!hasAuth) {
    console.log(`   ⚠️ Let op: Geen authenticatie geconfigureerd - de server kan authenticatie vereisen`);
    console.log(`   💡 Tip: Voeg een authenticatie gebruiker toe in de configuratie als de server authenticatie vereist`);
  }

  const port = parseInt(smtpServer.poort);
  const isSecurePort = port === 465;
  const requireTLS = smtpServer.requireTLS !== undefined ? smtpServer.requireTLS : false;

  const transporterConfig = {
    host: smtpServer.adres,
    port: port,
    secure: isSecurePort,
    requireTLS: requireTLS && !isSecurePort,
    auth: hasAuth ? smtpServer.auth : undefined, // Alleen authenticatie als gebruikers zijn gedefinieerd
    ignoreTLS: !requireTLS && !isSecurePort,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  };
  
  // Gebruik custom socket factory om expliciet te binden aan het juiste IP adres
  // Dit is nodig wanneer er meerdere IP adressen op een interface zijn
  if (localAddress && localAddress !== "0.0.0.0") {
    console.log(`   🔧 Uitgaand IP adres geconfigureerd: ${localAddress}`);
    
    // Import net en tls modules voor socket binding
    const net = await import("net");
    const tls = await import("tls");
    
    transporterConfig.getSocket = function(options, callback) {
      console.log(`   🔌 Socket factory aangeroepen - Doel: ${options.host}:${options.port}, Lokaal IP: ${localAddress}`);
      
      // Maak eerst een socket zonder verbinding
      const socket = new net.Socket();
      
      // Bind expliciet aan het gekozen IP adres VOORDAT we verbinden
      socket.bind(0, localAddress, () => {
        const boundAddress = socket.address();
        console.log(`   ✅ Socket gebonden aan lokaal adres: ${boundAddress.address}:${boundAddress.port} (interface: ${boundAddress.family})`);
        
        // Nu verbinden naar de remote host
        socket.connect(options.port, options.host, () => {
          const localAddr = socket.localAddress;
          const localPort = socket.localPort;
          const remoteAddr = socket.remoteAddress;
          const remotePort = socket.remotePort;
          console.log(`   ✅ Verbinding tot stand gebracht:`);
          console.log(`      Lokaal: ${localAddr}:${localPort}`);
          console.log(`      Remote: ${remoteAddr}:${remotePort}`);
          
          // Verifieer dat het juiste IP adres wordt gebruikt
          if (localAddr !== localAddress) {
            console.warn(`   ⚠️ WAARSCHUWING: Socket gebruikt ${localAddr} in plaats van geconfigureerd ${localAddress}`);
          } else {
            console.log(`   ✅ Bevestigd: Socket gebruikt correct IP adres ${localAddress}`);
          }
          
          // Als secure (TLS) verbinding, upgrade naar TLS socket
          if (options.secure) {
            console.log(`   🔒 Upgraden naar TLS verbinding...`);
            const tlsSocket = tls.connect({
              socket: socket,
              host: options.host,
              rejectUnauthorized: false // Accepteer zelf-ondertekende certificaten
            }, () => {
              console.log(`   ✅ TLS verbinding tot stand gebracht`);
              callback(null, { connection: tlsSocket });
            });
            
            tlsSocket.on('error', (err) => {
              console.error(`   ❌ TLS socket error: ${err.message}`);
              callback(err);
            });
          } else {
            callback(null, { connection: socket });
          }
        });
      });
      
      socket.on('error', (err) => {
        console.error(`   ❌ Socket error tijdens binding/verbinding: ${err.message} (code: ${err.code})`);
        callback(err);
      });
      
      return socket;
    };
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


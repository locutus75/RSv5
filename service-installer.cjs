const Service = require('node-windows').Service;
const path = require('path');
const fs = require('fs');

console.log('🔧 RileeSurfis Windows Service Installer');
console.log('==========================================');
console.log('');

// Controleer of we in de juiste directory zijn
const scriptPath = path.join(__dirname, 'index.js');
if (!fs.existsSync(scriptPath)) {
  console.error('❌ index.js niet gevonden in:', __dirname);
  console.error('   Zorg ervoor dat je dit script uitvoert vanuit de project directory');
  process.exit(1);
}

// Controleer Node.js path
const nodePath = process.execPath;
console.log('📁 Project directory:', __dirname);
console.log('📜 Script path:', scriptPath);
console.log('🟢 Node.js path:', nodePath);
console.log('');

// Maak een nieuwe service met de juiste configuratie
const svc = new Service({
  name: 'RileeSurfis SMTP Server',
  description: 'RileeSurfis SMTP relay server met Graph API integratie',
  script: scriptPath,
  // Belangrijke configuratie opties
  workingDirectory: __dirname,
  // Gebruik lokale Node.js in plaats van globale
  nodePath: nodePath,
  // Environment variables
  env: [
    { name: "NODE_ENV", value: "production" },
    { name: "PWD", value: __dirname }
    // Admin-authenticatie: stel de token in met "npm run admin:set-token" (schrijft admin-auth.json)
  ]
});

// Luister naar service events
svc.on('install', function() {
  console.log('✅ Service succesvol geïnstalleerd!');
  console.log('');
  console.log('🚀 Service starten...');
  svc.start();
});

svc.on('start', function() {
  console.log('✅ Service succesvol gestart!');
  console.log('');
  console.log('📋 Volgende stappen:');
  console.log('   1. Open Windows Services (services.msc)');
  console.log('   2. Zoek naar "RileeSurfis SMTP Server"');
  console.log('   3. Controleer of de service draait');
  console.log('');
  console.log('🔧 Service beheren:');
  console.log('   npm run service:start      # Start service');
  console.log('   npm run service:stop       # Stop service');
  console.log('   npm run service:restart    # Herstart service');
  console.log('   npm run service:status     # Toon status');
  console.log('   npm run service:uninstall  # Verwijder service');
  console.log('');
  process.exit(0);
});

svc.on('stop', function() {
  console.log('⏹️ Service gestopt');
});

svc.on('uninstall', function() {
  console.log('🗑️ Service verwijderd');
});

svc.on('error', function(err) {
  console.error('❌ Service error:', err);
  console.error('');
  console.error('🔍 Mogelijke oplossingen:');
  console.error('   1. Run dit script als Administrator');
  console.error('   2. Controleer of de service al bestaat');
  console.error('   3. Controleer Windows Event Log voor details');
  console.error('   4. Controleer of alle dependencies geïnstalleerd zijn');
  console.error('');
  process.exit(1);
});

// Controleer of de service al bestaat
if (svc.exists) {
  console.log('⚠️ Service bestaat al!');
  console.log('   Wil je de bestaande service vervangen? (y/N)');
  
  // Voor nu, ga door met installatie
  console.log('   Doorgaan met installatie...');
}

// Installeer de service
console.log('🔧 Service installeren...');
console.log('   Dit kan even duren...');
console.log('');

try {
  svc.install();
} catch (error) {
  console.error('❌ Fout bij installeren:', error.message);
  console.error('');
  console.error('🔍 Mogelijke oplossingen:');
  console.error('   1. Run dit script als Administrator');
  console.error('   2. Controleer of je antivirus de installatie blokkeert');
  console.error('   3. Controleer Windows Event Log');
  console.error('   4. Controleer of alle dependencies geïnstalleerd zijn');
  console.error('');
  process.exit(1);
}

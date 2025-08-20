const Service = require('node-windows').Service;
const path = require('path');
const fs = require('fs');

console.log('🔍 RileeSurfis Service Debug Script');
console.log('====================================');
console.log('');

// Controleer basis vereisten
console.log('📋 Basis vereisten:');
console.log('   Project directory:', __dirname);
console.log('   index.js bestaat:', fs.existsSync(path.join(__dirname, 'index.js')));
console.log('   node-windows versie:', require('node-windows/package.json').version);
console.log('');

// Controleer service status
const serviceName = 'RileeSurfis SMTP Server';
const svc = new Service({
  name: serviceName,
  script: path.join(__dirname, 'index.js')
});

console.log('🔍 Service status:');
console.log('   Service naam:', serviceName);
console.log('   Service bestaat:', svc.exists);
console.log('   Service draait:', svc.isRunning);
console.log('');

// Probeer service informatie op te halen
try {
  if (svc.exists) {
    console.log('✅ Service bestaat en is geïnstalleerd');
    console.log('   Status:', svc.isRunning ? 'Draait' : 'Gestopt');
    
    // Toon service details
    console.log('   Script path:', svc.script);
    console.log('   Working directory:', svc.workingDirectory);
    
  } else {
    console.log('❌ Service bestaat niet');
    console.log('   Mogelijke oorzaken:');
    console.log('   - Installatie mislukt');
    console.log('   - Onvoldoende rechten');
    console.log('   - node-windows probleem');
  }
} catch (error) {
  console.error('❌ Fout bij ophalen service info:', error.message);
}

console.log('');
console.log('🔧 Volgende stappen:');
console.log('   1. Run als Administrator');
console.log('   2. Controleer Windows Event Log');
console.log('   3. Probeer handmatige installatie: node service-installer.js');
console.log('   4. Controleer of antivirus blokkeert');
console.log('');

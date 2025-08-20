const Service = require('node-windows').Service;
const path = require('path');

const serviceName = 'RileeSurfis SMTP Server';
const scriptPath = path.join(__dirname, 'index.js');

// Maak een service referentie
const svc = new Service({
  name: serviceName,
  script: scriptPath
});

// Command line argumenten
const command = process.argv[2] || 'status';

switch (command.toLowerCase()) {
  case 'start':
    console.log('🚀 Service starten...');
    svc.start();
    break;
    
  case 'stop':
    console.log('⏹️ Service stoppen...');
    svc.stop();
    break;
    
  case 'restart':
    console.log('🔄 Service herstarten...');
    svc.restart();
    break;
    
  case 'status':
    console.log('📊 Service status controleren...');
    // Controleer of service draait
    const isRunning = svc.exists && svc.isRunning;
    console.log(`Service "${serviceName}": ${isRunning ? '🟢 Draait' : '🔴 Niet actief'}`);
    break;
    
  case 'install':
    console.log('🔧 Service installeren...');
    svc.install();
    break;
    
  case 'uninstall':
    console.log('🗑️ Service verwijderen...');
    svc.uninstall();
    break;
    
  default:
    console.log(`
🚀 RileeSurfis Service Manager

Gebruik: node service-manager.js [command]

Commands:
  start      - Start de service
  stop       - Stop de service
  restart    - Herstart de service
  status     - Toon service status
  install    - Installeer de service
  uninstall  - Verwijder de service

Voorbeelden:
  node service-manager.js start
  node service-manager.js status
  node service-manager.js restart
`);
    break;
}

// Event handlers
svc.on('start', function() {
  console.log('✅ Service gestart');
  process.exit(0);
});

svc.on('stop', function() {
  console.log('⏹️ Service gestopt');
  process.exit(0);
});

svc.on('install', function() {
  console.log('✅ Service geïnstalleerd');
  process.exit(0);
});

svc.on('uninstall', function() {
  console.log('🗑️ Service verwijderd');
  process.exit(0);
});

svc.on('error', function(err) {
  console.error('❌ Service error:', err);
  process.exit(1);
});

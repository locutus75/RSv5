const Service = require('node-windows').Service;
const path = require('path');

// Maak een service referentie
const svc = new Service({
  name: 'RileeSurfis SMTP Server',
  script: path.join(__dirname, 'index.js')
});

// Luister naar uninstall events
svc.on('uninstall', function() {
  console.log('🗑️ Service succesvol verwijderd');
  process.exit(0);
});

svc.on('error', function(err) {
  console.error('❌ Service error:', err);
});

// Stop en verwijder de service
console.log('🛑 Service stoppen en verwijderen...');
svc.uninstall();

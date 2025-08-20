# RileeSurfis

Een moderne SMTP relay server met Graph API integratie en hot-reload functionaliteit.

## ✨ Features

- **SMTP Server**: Ontvangt emails en routeert ze naar de juiste tenant
- **Graph API Integratie**: Verzendt emails via Microsoft Graph API
- **Tenant Management**: Multi-tenant ondersteuning met JSON configuratie
- **Hot-Reload**: Tenant configuraties worden automatisch herladen zonder server restart
- **Admin UI**: Web-based beheer interface voor monitoring en configuratie
- **Real-time Logging**: Gedetailleerde logging van alle email transacties
- **Rate Limiting**: Bescherming tegen spam en misbruik
- **IP Range Beveiliging**: Tenant-specifieke IP range restricties voor afzenders
- **Flexibele Logging**: Command-line opties voor debug en verbose logging

## 🚀 Quick Start

```bash
# Installeer dependencies
npm install

# Start de server
npm start
```

## 🔧 Command-line Opties

De applicatie ondersteunt verschillende command-line opties voor **mailserver logging**. Deze opties zijn alleen van toepassing op de SMTP server functionaliteit, niet op de applicatie startup zelf.

### Basis Opties
```bash
# Normale start
npm start

# Debug mode (logLevel = debug)
npm run start:debug

# Verbose mode (logLevel = verbose)
npm run start:verbose

# Logging naar bestand
npm run start:log-file

# Debug logging naar bestand
npm run start:debug-log

# Verbose logging naar bestand
npm run start:verbose-log

# Toon help informatie
npm run start:help
```

### Handmatige Command-line Opties
```bash
# Debug mode voor mailserver
node index.js --debug

# Verbose mode voor mailserver
node index.js --verbose

# Specifiek log niveau voor mailserver
node index.js --log-level debug

# Logging naar bestand voor mailserver
node index.js --log-file ./logs/mail.log

# Combinatie van opties
node index.js --verbose --log-file ./logs/mail-verbose.log

# Help informatie
node index.js --help
```

### Log Niveaus
- **error**: Alleen fouten
- **warn**: Waarschuwingen en fouten
- **info**: Informatie, waarschuwingen en fouten (standaard)
- **debug**: Debug informatie, informatie, waarschuwingen en fouten
- **verbose**: Alle log berichten inclusief zeer gedetailleerde informatie

**Let op**: Deze log niveaus zijn alleen van toepassing op de mailserver functionaliteit. De applicatie startup gebruikt altijd normale console logging.

## 📁 Project Structuur

```
rileesurfis/
├── lib/           # Core server functionaliteit
├── admin-ui/      # Web-based admin interface
├── tenants.d/     # Tenant configuratie bestanden
├── logs/          # Log bestanden
├── certs/         # SSL certificaten
└── schema/        # JSON schema validatie
```

## 🔧 Configuratie

Bekijk `config.json` voor server instellingen en `tenants.d/` voor tenant configuraties.

## 🛡️ Beveiliging

### IP Range Controle
De applicatie controleert IP ranges op twee niveaus:

1. **Globale IP Allowlist** (`config.json`): Controleert of een IP überhaupt toegang heeft tot de SMTP server
2. **Tenant-specifieke IP Ranges** (`tenants.d/*.json`): Controleert of een IP toegestaan is voor een specifieke tenant

```json
{
  "routing": {
    "ipRanges": ["192.168.1.0/24", "10.0.0.0/8"]
  }
}
```

### Afzender Controle
Elke tenant kan een `allowedSenders` lijst hebben om te bepalen welke email adressen emails mogen verzenden.

### Tenant Routing Prioriteit
1. **Exacte ontvanger match** (hoogste prioriteit)
2. **Domain-based routing**
3. **IP-based routing**
4. **Fallback naar eerste tenant** (laagste prioriteit)

## 📊 Admin Interface

Open `http://localhost:3000` in je browser voor de admin interface.

## 📝 Licentie

Private project - Alle rechten voorbehouden.

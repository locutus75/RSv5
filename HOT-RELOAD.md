# 🔄 Hot-Reload Functionaliteit

## Overzicht
De RileeSurfis server heeft nu **hot-reload** functionaliteit voor tenant configuraties. Dit betekent dat je **geen server restart** meer nodig hebt bij het wijzigen van tenant instellingen!

## ✨ Features

### 1. **Automatische Reload bij Opslaan** 
- **Reload wordt getriggerd** bij het opslaan van nieuwe/bewerkte tenants
- **Geen file monitoring** - alleen actie bij daadwerkelijke wijzigingen
- **Direct actief** na tenant opslaan via admin UI

### 2. **Handmatige Reload Knop**
- **"🔄 Reload Tenants"** knop in de admin UI
- **On-demand herladen** zonder tenant wijzigingen
- **Visuele feedback** tijdens het reloaden

### 3. **Real-time Updates**
- **Geen downtime** bij tenant wijzigingen
- **Direct actief** na configuratie wijzigingen
- **Live monitoring** van tenant status

## 🚀 Hoe het werkt

### **Automatische Reload**
```bash
# Wijzig een tenant bestand
vim tenants.d/example.json

# Server detecteert automatisch de wijziging
# En herlaadt de configuratie binnen 1 seconde
```

### **Handmatige Reload**
1. Klik op **"🔄 Reload Tenants"** in de admin UI
2. Server herlaadt alle tenant configuraties
3. Wijzigingen zijn direct actief

## 📁 Bestandsstructuur

```
tenants.d/
├── tenant1.json     ← File watcher monitort deze directory
├── tenant2.json     ← Automatische detectie van wijzigingen
└── tenant3.json     ← Hot-reload zonder server restart
```

## 🔧 Technische Details

### **Trigger System**
- **Reload wordt getriggerd** bij tenant CRUD operaties
- **POST/PUT/DELETE** endpoints trigger automatisch reload
- **Geen file monitoring** - alleen actie bij API calls

### **Event System**
- **Global EventEmitter** voor communicatie tussen servers
- **Reload events** worden getriggerd bij tenant opslaan
- **SMTP server** wordt automatisch bijgewerkt

### **Error Handling**
- **Graceful fallback** bij file watcher fouten
- **Logging** van alle reload acties
- **Validation** van JSON bestanden

## 📊 Monitoring

### **Console Output**
```
✅ Tenant reload ready - triggered on save
🔄 Auto-reload triggered after creating tenant: example
🔄 Auto-reload triggered after updating tenant: example
🔄 Auto-reload triggered after deleting tenant: example
🔄 Manual tenant reload requested - 3 tenants loaded
```

### **Admin UI Feedback**
- **Loading state** tijdens reload
- **Success/error messages** via toast notifications
- **Tenant count** updates na reload

## ⚠️ Belangrijke Notities

### **Best Practices**
1. **Wacht 1 seconde** na het opslaan van wijzigingen
2. **Valideer JSON** voordat je opslaat
3. **Gebruik handmatige reload** bij twijfel

### **Limitaties**
- **Alleen JSON bestanden** worden gemonitord
- **1 seconde debounce** voor file events
- **Geen subdirectory monitoring** (alleen directe bestanden)

### **Troubleshooting**
- **File watcher failed**: Controleer bestandsrechten
- **Reload not working**: Gebruik handmatige reload knop
- **Configuration errors**: Check console logs

## 🎯 Voordelen

✅ **Geen downtime** bij tenant wijzigingen  
✅ **Direct testen** van nieuwe configuratie  
✅ **Betere developer experience**  
✅ **Productie-omgeving** blijft beschikbaar  
✅ **Real-time updates** zonder handmatige acties  

## 🔮 Toekomstige Verbeteringen

- **Webhook support** voor externe triggers
- **Selective reload** van specifieke tenants
- **Reload history** en audit logging
- **Configuration validation** tijdens reload
- **Rollback functionaliteit** bij fouten

---

**💡 Tip**: De hot-reload werkt het beste met een goede code editor die bestanden atomisch opslaat (zoals VS Code, Vim, etc.).

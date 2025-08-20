(function(){
  const $=s=>document.querySelector(s);
  const tbody=$("#tenantsTable tbody");
  const dot=$("#healthDot"),ht=$("#healthText");
  let name=null,data=[];
  
  // Auto-refresh timer variabele (moet bovenaan staan)
  let eventsTimer = null;

  function toast(t){
    const el=$("#toast");
    el.textContent=t;
    el.classList.remove("hidden");
    setTimeout(()=>el.classList.add("hidden"),2500);
  }

  function headers(){
    const t = localStorage.getItem("adminToken") || "";
    if (t) {
      return {"Authorization":"Bearer "+t,"Content-Type":"application/json"};
    } else {
      return {"Content-Type":"application/json"};
    }
  }

  async function api(p,o={}){
    const r = await fetch(p,{...o,headers:{...(o.headers||{}),...headers()}});
    if(!r.ok){
      let m = r.status + " " + r.statusText;
      try {
        const b = await r.json();
        if(b?.error) m += " — " + b.error;
      } catch {}
      
      if (r.status === 401) {
        m = "Authentication required. Please set ADMIN_TOKEN environment variable or provide valid token.";
      }
      
      throw new Error(m);
    }
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? r.json() : r.text();
  }

  // Exposeer API helper voor modules buiten deze IIFE
  window.api = api;

  async function health(){
    try {
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        try {
          await api("/admin/health");
          dot.style.background = "#22c55e";
          ht.textContent = "online";
        } catch (error) {
          if (error.message.includes("401")) {
            dot.style.background = "#eab308";
            ht.textContent = "auth required";
          } else {
            dot.style.background = "#ef4444";
            ht.textContent = "offline";
          }
        }
      } else {
        await api("/admin/health");
        dot.style.background = "#22c55e";
        ht.textContent = "online";
      }
    } catch (error) {
      dot.style.background = "#ef4444";
      ht.textContent = "offline";
    }
  }

  // Exposeer health voor globale initializers
  window.health = health;

  function render(){
    tbody.innerHTML="";
    if(!data.length){
      tbody.innerHTML="<tr><td colspan='5' class='muted'>Geen tenants gevonden</td></tr>";
      return;
    }
    for(const t of data){
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${t.name||"(naamloos)"}</td><td>${t.defaultMailbox||""}</td><td>${t.tenantId||""}</td><td>${t.clientId||""}</td><td><button data-e='${t.file}'>Bewerken</button><button data-d='${t.file}'>Verwijderen</button></td>`;
      tbody.appendChild(tr);
    }
  }

  async function load(){
    tbody.innerHTML="<tr><td colspan='5'>Laden…</td></tr>";
    try {
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
          tbody.innerHTML = `<tr><td colspan='5' class='muted'>🔐 Authenticatie vereist. Voer een token in via de browser console.</td></tr>`;
          return;
        }
        

      }
      
      data = await api("/admin/tenants");
      render();
      try{populateTenantFilters && populateTenantFilters();}catch{}
    } catch(e){
      console.error("❌ Fout bij laden tenants:", e);
      tbody.innerHTML = `<tr><td colspan='5'>Fout: ${e.message}</tr>`;
    }
  }

  // Exposeer tenants loader onder verwachte naam
  window.loadTenants = load;

  // Event handlers
  tbody.addEventListener("click",async e=>{
    const E=e.target.getAttribute("data-e");
    const D=e.target.getAttribute("data-d");
    if(E){
      try{
        const d=await api(`/admin/tenants/${encodeURIComponent(E)}`);
        name=E;
        // Prefill modal met bestaande data en open
        const set=(id,val)=>{
          const el=document.getElementById(id);
          if(el) el.value = (val==null?"":val)
        };
        
        set("tfName", d.name);
        set("tfTenantId", d.tenantId);
        set("tfClientId", d.clientId);
        set("tfDefaultMailbox", d.defaultMailbox);
        set("tfAllowedSenders", d.allowedSenders?.join("\n"));
        set("tfCertPath", d.auth?.certPath);
        set("tfThumbprint", d.auth?.thumbprint);
        set("tfForceFrom", d.policy?.forceFrom);
        set("tfMaxSize", d.policy?.maxMessageSizeKB);
        set("tfSaveToSent", d.policy?.saveToSentItems);
        set("tfBccArchive", d.policy?.bccArchive);
        set("tfIpRanges", d.routing?.ipRanges?.join("\n"));
        set("tfSenderDomains", d.routing?.senderDomains?.join(", "));
        set("tfPriority", d.routing?.priority);
        set("tfTags", d.tags?.join(", "));
        
        document.getElementById("tenantModalTitle").textContent = "Tenant bewerken";
        document.getElementById("tenantModal").classList.remove("hidden");
      }catch(e){
        toast("Fout bij laden tenant: " + e.message);
      }
    }else if(D){
      if(confirm("Weet je zeker dat je deze tenant wilt verwijderen?")){
        try{
          await api(`/admin/tenants/${encodeURIComponent(D)}`,{method:"DELETE"});
          toast("Tenant verwijderd");
          load();
        }catch(e){
          toast("Fout bij verwijderen: " + e.message);
        }
      }
    }
  });

  // Token management
  $("#saveToken").addEventListener("click",async()=>{
    const t=$("#token").value.trim();
    if (!t) {
      toast("Voer een token in");
      return;
    }
    
    try {
      // Test de token eerst met de backend
      const testResponse = await fetch("/admin/auth-status", {
        headers: {
          "Authorization": "Bearer " + t,
          "Content-Type": "application/json"
        }
      });
      
      if (!testResponse.ok) {
        toast("❌ Fout bij verbinding met server");
        return;
      }
      
      const authData = await testResponse.json();
      
      
      if (!authData.valid) {
        toast("❌ Ongeldige token");
        return;
      }
      
      // Token is geldig, sla op en ga door
      localStorage.setItem("adminToken",t);
      toast("✅ Token geaccepteerd");
      
      // Sync met overlay input
      $("#overlayToken").value = t;
      
      // Verberg overlay als deze zichtbaar was
      toggleLoginOverlay(false);
      
      // Initialize alles na login
      try{ 
        load(); // Dit laadt tenants
        health(); 
        loadStats(); 
        loadEvents(); 
        populateTenantFilters && populateTenantFilters(); 
        
        // Bind filters nadat ze zijn gepopuleerd
        setTimeout(() => {
          bindGlobalFilters();
        }, 100);
        
        // Start auto-refresh als deze is ingeschakeld
        const eventsAuto = document.getElementById("eventsAuto");
        if (eventsAuto && eventsAuto.checked) {
          toggleAutoRefresh(true);
        }
      }catch{}
    } catch (error) {
      toast("❌ Fout bij authenticatie: " + error.message);
    }
  });

  // Event handler voor header input wijzigingen (reset feedback)
  $("#token").addEventListener("input", () => {
    // Reset visuele feedback bij nieuwe invoer in header
    const overlayCard = $("#loginOverlay .overlay-card");
    if (overlayCard) {
      overlayCard.classList.remove("error", "success");
    }
  });

  // Functie om de login overlay te tonen/verbergen
  function toggleLoginOverlay(show) {
    const overlay = $("#loginOverlay");
    const mainContent = $("main");
    const header = $("header");
    
    if (show) {
      overlay.classList.remove("hidden");
      mainContent.classList.add("blurred");
      header.classList.add("blurred");
    } else {
      overlay.classList.add("hidden");
      mainContent.classList.remove("blurred");
      header.classList.remove("blurred");
    }
  }

  // Functie voor visuele feedback op login overlay
  function showLoginFeedback(type) {
    const overlayCard = $("#loginOverlay .overlay-card");
    
    // Verwijder alle bestaande feedback classes
    overlayCard.classList.remove("error", "success");
    
    if (type === "error") {
      // Toon rode rand + shake animatie
      overlayCard.classList.add("error");
      // Reset na 2 seconden
      setTimeout(() => {
        overlayCard.classList.remove("error");
      }, 2000);
    } else if (type === "success") {
      // Toon groene rand + success animatie
      overlayCard.classList.add("success");
      // Reset na 1 seconde
      setTimeout(() => {
        overlayCard.classList.remove("success");
      }, 1000);
    }
  }

  // Functie om input veld te resetten en feedback te verwijderen
  function resetLoginInput() {
    const overlayCard = $("#loginOverlay .overlay-card");
    const tokenInput = $("#overlayToken");
    
    // Verwijder feedback classes
    overlayCard.classList.remove("error", "success");
    
    // Reset input veld
    tokenInput.value = "";
    tokenInput.focus();
  }

  // Event handlers voor de overlay
  function setupOverlayEventHandlers() {
    // Event handler voor overlay login knop
    $("#overlaySave").addEventListener("click", async () => {
      const token = $("#overlayToken").value.trim();
      if (!token) {
        toast("Voer een token in");
        return;
      }
      
      try {
        // Test de token eerst met de backend
        const testResponse = await fetch("/admin/auth-status", {
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
          }
        });
        
        if (!testResponse.ok) {
          showLoginFeedback("error");
          toast("❌ Fout bij verbinding met server");
          return;
        }
        
        const authData = await testResponse.json();

        
        if (!authData.valid) {
          showLoginFeedback("error");
          toast("❌ Ongeldige token");
          return;
        }
        
        // Token is geldig, toon success feedback
        showLoginFeedback("success");
        toast("✅ Token geaccepteerd");
        
        // Wacht 1 seconde voordat doorverwijzing
        setTimeout(() => {
          // Token opslaan en doorverwijzen
          localStorage.setItem("adminToken", token);
          $("#token").value = token; // Sync met header input
          toggleLoginOverlay(false);
          
          // Initialize alles na login
          try{ 
            load(); // Dit laadt tenants
            health(); 
            loadStats(); 
            loadEvents(); 
            populateTenantFilters && populateTenantFilters(); 
            
            // Bind filters nadat ze zijn gepopuleerd
            setTimeout(() => {
              bindGlobalFilters();
            }, 100);
            
            // Start auto-refresh als deze is ingeschakeld
            const eventsAuto = document.getElementById("eventsAuto");
            if (eventsAuto && eventsAuto.checked) {
              toggleAutoRefresh(true);
            }
          }catch{}
        }, 1000);
        
      } catch (error) {
        showLoginFeedback("error");
        toast("❌ Fout bij authenticatie: " + error.message);
      }
    });

    // Event handler voor Enter toets in overlay input
    $("#overlayToken").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        $("#overlaySave").click();
      }
    });

    // Event handler voor input wijzigingen (reset feedback)
    $("#overlayToken").addEventListener("input", () => {
      // Reset visuele feedback bij nieuwe invoer
      const overlayCard = $("#loginOverlay .overlay-card");
      overlayCard.classList.remove("error", "success");
    });
  }

  // Token initialisatie
  function initToken(){
    const p=new URLSearchParams(location.search);
    const t=p.get("token");
    if(t){
      localStorage.setItem("adminToken",t);
      const tokenInput = document.getElementById("token");
      const overlayTokenInput = document.getElementById("overlayToken");
      if (tokenInput) tokenInput.value = t;
      if (overlayTokenInput) overlayTokenInput.value = t;
    }else{
      const storedToken = localStorage.getItem("adminToken") || "";
      const tokenInput = document.getElementById("token");
      const overlayTokenInput = document.getElementById("overlayToken");
      if (tokenInput) tokenInput.value = storedToken;
      if (overlayTokenInput) overlayTokenInput.value = storedToken;
    }
  }

  // Hoofd initialisatie functie
  function initializeApp() {

    
    // Setup event handlers voor de overlay
    setupOverlayEventHandlers();
    
    // Initialiseer token (sync header en overlay inputs)
    initToken();
    
    if(!hasToken()){

      // Geen token, toon overlay en blur content
      toggleLoginOverlay(true);
      return; // wacht op gebruiker login
    }
    
    
    // Token aanwezig, verberg overlay en laad alles
    toggleLoginOverlay(false);
    
    // If token via URL, persist and continue
    const urlTok = (new URLSearchParams(location.search)).get("token");
    if(urlTok){ localStorage.setItem("adminToken", urlTok); }
    
    // Kick off initial loads
    try{ 
      load(); // Dit laadt tenants
      health(); 
      loadStats(); 
      loadEvents(); 
      populateTenantFilters && populateTenantFilters(); 
      
      // Bind filters nadat ze zijn gepopuleerd
      setTimeout(() => {
        bindGlobalFilters();
      }, 100);
      
      // Start auto-refresh als deze is ingeschakeld
      const eventsAuto = document.getElementById("eventsAuto");
      if (eventsAuto && eventsAuto.checked) {
        toggleAutoRefresh(true);
      }
    }catch(e){
      console.error("❌ Fout bij initialiseren:", e);
    }
  }

  // Helper functie om te controleren of er een token is
  function hasToken(){ 
    return !!(localStorage.getItem("adminToken") || (new URLSearchParams(location.search)).get("token")); 
  }

  // Start de app wanneer DOM klaar is
  document.addEventListener("DOMContentLoaded", initializeApp);
  
  // Event listeners voor event kleur configuratie
  document.addEventListener("DOMContentLoaded", () => {
    // Laad configuratie
    loadEventColorConfig();
    
    // Event listeners voor knoppen
    const saveBtn = document.getElementById("saveEventColors");
    const resetBtn = document.getElementById("resetEventColors");
    const configBtn = document.getElementById("eventColorConfigBtn");
    const closeBtn = document.getElementById("closeEventColorConfig");
    const modal = document.getElementById("eventColorConfigModal");
    
    if (saveBtn) {
      saveBtn.addEventListener("click", saveEventColorConfig);
    }
    
    if (resetBtn) {
      resetBtn.addEventListener("click", resetEventColorConfig);
    }
    
    if (configBtn) {
      configBtn.addEventListener("click", () => {
        if (modal) modal.classList.remove("hidden");
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        if (modal) modal.classList.add("hidden");
      });
    }
    
    // Sluit modal bij klik buiten de content
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.classList.add("hidden");
        }
      });
    }
  });

  // Exposeer functies voor globale gebruik
  window.hasToken = hasToken;
  window.toggleLoginOverlay = toggleLoginOverlay;

  // Tenant modal handlers
  $("#newTenantBtn").addEventListener("click",()=>{
    name=null;
    document.getElementById("tenantModalTitle").textContent = "Nieuwe tenant";
    // Reset alle velden
    const fields = ["tfName","tfTenantId","tfClientId","tfDefaultMailbox","tfAllowedSenders","tfCertPath","tfThumbprint","tfForceFrom","tfMaxSize","tfSaveToSent","tfBccArchive","tfIpRanges","tfSenderDomains","tfPriority","tfTags"];
    fields.forEach(f => {
      const el = document.getElementById(f);
      if(el) el.value = "";
    });
    document.getElementById("tenantModal").classList.remove("hidden");
  });

  $("#tenantClose").addEventListener("click",()=>{
    document.getElementById("tenantModal").classList.add("hidden");
  });

  $("#tenantSave").addEventListener("click",async()=>{
    try{
      const tenant = {
        name: $("#tfName").value.trim(),
        tenantId: $("#tfTenantId").value.trim(),
        clientId: $("#tfClientId").value.trim(),
        auth: {
          type: "certificate",
          certPath: $("#tfCertPath").value.trim(),
          thumbprint: $("#tfThumbprint").value.trim()
        },
        defaultMailbox: $("#tfDefaultMailbox").value.trim(),
        allowedSenders: $("#tfAllowedSenders").value.split("\n").map(s=>s.trim()).filter(Boolean),
        senderOverrides: {},
        routing: {
          ipRanges: $("#tfIpRanges").value.split("\n").map(s=>s.trim()).filter(Boolean),
          senderDomains: $("#tfSenderDomains").value.split(",").map(s=>s.trim()).filter(Boolean),
          priority: parseInt($("#tfPriority").value) || 100
        },
        policy: {
          maxMessageSizeKB: parseInt($("#tfMaxSize").value) || 5120,
          saveToSentItems: $("#tfSaveToSent").checked,
          bccArchive: $("#tfBccArchive").value.trim() || undefined
        },
        tags: $("#tfTags").value.split(",").map(s=>s.trim()).filter(Boolean)
      };

      if(!tenant.name || !tenant.tenantId || !tenant.clientId){
        toast("Naam, Tenant ID en Client ID zijn verplicht");
        return;
      }

      const method = name ? "PUT" : "POST";
      const url = name ? `/admin/tenants/${encodeURIComponent(name)}` : "/admin/tenants";
      
      await api(url, {method, body: JSON.stringify(tenant)});
      toast(name ? "Tenant bijgewerkt" : "Tenant aangemaakt");
      document.getElementById("tenantModal").classList.add("hidden");
      load();
    }catch(e){
      toast("Fout bij opslaan: " + e.message);
    }
  });

  // Reload button
  $("#reloadBtn").addEventListener("click",async()=>{
    try{
      const r=await api("/admin/tenants/reload",{method:"POST"});
      toast(r.message||"Reload OK");
      try{populateTenantFilters();load();}catch{}
    }catch(e){
      toast("Reload faalde: "+e.message);
    }
  });

  // Chart modal handlers
  $("#closeChart").addEventListener("click",()=>{
    document.getElementById("chartModal").classList.add("hidden");
  });

  // Export CSV
  $("#exportStatsCsv").addEventListener("click",()=>{
    const csv = [
      ["Tenant", "Verzonden", "Errors", "Trend"],
      ...data.map(t => [t.name || "(naamloos)", t.sent || 0, t.errors || 0, ""])
    ].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stats.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Stats window change
  $("#statsWindow").addEventListener("change",()=>{
    try{loadStats();}catch{}
  });

  // Refresh stats
  $("#refreshStats").addEventListener("click",()=>{
    try{loadStats();}catch{}
  });

  // Refresh events
  $("#refreshEvents").addEventListener("click",()=>{
    try{loadEvents();}catch{}
  });

  // Export events naar CSV
  $("#exportEventsCsv").addEventListener("click", async () => {
    try {
      // Haal alle events op (zonder limiet voor export)
      const r = await api("/admin/events?limit=10000");
      const events = r.events || [];
      
      if (events.length === 0) {
        toast("❌ Geen events om te exporteren");
        return;
      }
      
      // Filter debug events uit (consistent met weergave)
      const filteredEvents = events.filter(ev => {
        if (ev.level === "debug" || ev.level === "verbose") return false;
        if (ev.reason && ev.reason.includes("debug")) return false;
        return true;
      });
      
      // CSV headers
      const headers = ["Timestamp", "Level", "Reason", "Tenant", "From", "Recipient Count", "Size (KB)", "Message/Error"];
      
      // CSV data rijen
      const csvRows = [headers.join(",")];
      
      filteredEvents.forEach(ev => {
        const ts = ev.ts ? new Date(ev.ts).toLocaleString() : "";
        const level = ev.level || "";
        const reason = ev.reason || "";
        const tenant = ev.tenant || "";
        const from = ev.from || "";
        const rcptCount = ev.rcptCount || "";
        const sizeKB = ev.sizeKB || "";
        const info = (ev.message || ev.error || "").replace(/"/g, '""'); // Escape quotes
        
        const row = [
          `"${ts}"`,
          `"${level}"`,
          `"${reason}"`,
          `"${tenant}"`,
          `"${from}"`,
          `"${rcptCount}"`,
          `"${sizeKB}"`,
          `"${info}"`
        ].join(",");
        
        csvRows.push(row);
      });
      
      // Maak CSV bestand en download
      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `events_export_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        toast(`✅ ${filteredEvents.length} events geëxporteerd naar CSV`);
      } else {
        toast("❌ Download wordt niet ondersteund door deze browser");
      }
    } catch (error) {
      console.error("❌ Fout bij exporteren:", error);
      toast(`❌ Fout bij exporteren: ${error.message}`);
    }
  });

  // Tenant filter change
  $("#tenantFilterStats").addEventListener("change",()=>{
    try{loadStats();}catch{}
  });

  // Events filter change
  $("#tenantFilterEvents").addEventListener("change",()=>{
    try{loadEvents();}catch{}
  });

  // Events reason filter change
  $("#eventsReasonFilter").addEventListener("change",()=>{
    try{loadEvents();}catch{}
  });

  // Auto-refresh toggle
  $("#eventsAuto").addEventListener("change", (e) => {
    toggleAutoRefresh(e.target.checked);
  });

  // Initialiseer token input
  initToken();

  // --- Stats & Events ---
  async function loadStats(){
    try{
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
          const tbody = document.querySelector("#statsTable tbody");
          if (tbody) {
            tbody.innerHTML = "<tr><td colspan='5' class='muted'>🔐 Authenticatie vereist</td></tr>";
          }
          return;
        }
        

      }
      
      const win = document.querySelector("#statsWindow")?.value || "60m";
      const statsFilter = document.querySelector("#tenantFilterStats")?.value?.trim() || "";
      
      
      const apiUrl = `/admin/stats?window=${encodeURIComponent(win)}${statsFilter?`&tenant=${encodeURIComponent(statsFilter)}`:""}`;
      
      
      const r = await api(apiUrl);
      
      const tbody = document.querySelector("#statsTable tbody");
      if (!tbody) return;
      
      const entries = Object.entries(r.tenants || {})
        .filter(([name, agg]) => name !== "unknown" && name !== "Unknown" && name !== "")
        .sort((a,b)=> (b[1].sent+b[1].errors)-(a[1].sent+a[1].errors));
      if(entries.length===0){ 
        tbody.innerHTML = "<tr><td colspan='5' class='muted'>Geen data</td></tr>"; 
        return; 
      }
      
      if (tbody.children.length === 0) {
        for(const [name, agg] of entries){
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${name}</td>
            <td>${agg.sent}</td>
            <td>${agg.errors>0?`<span style='color:#ef4444'>${agg.errors}</span>`:agg.errors}</td>
            <td></td>
            <td></td>
          `;
          tbody.appendChild(tr);
        }
      } else {
        const existingRows = Array.from(tbody.children);
        entries.forEach(([name, agg], index) => {
          if (existingRows[index]) {
            const cells = existingRows[index].children;
            cells[1].textContent = agg.sent;
            cells[2].innerHTML = agg.errors>0?`<span style='color:#ef4444'>${agg.errors}</span>`:agg.errors;
          }
        });
        
        while (tbody.children.length > entries.length) {
          tbody.removeChild(tbody.lastChild);
        }
      }
      
    }catch(e){
      const tbody = document.querySelector("#statsTable tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan='5'>Fout: ${e.message}</td></tr>`;
    }
  }

  async function loadEvents(){
    try{
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
          const tbody = document.querySelector("#eventsTable tbody");
          if (tbody) {
            tbody.innerHTML = "<tr><td colspan='8' class='muted'>🔐 Authenticatie vereist</td></tr>";
          }
          return;
        }
      }
      
      const t = document.querySelector("#tenantFilterEvents")?.value?.trim() || "";
      const limit = document.querySelector("#eventsLimit")?.value || "200";
      const reason = document.querySelector("#eventsReasonFilter")?.value || "all";
      
      const r = await api(`/admin/events?limit=${encodeURIComponent(limit)}${t?`&tenant=${encodeURIComponent(t)}`:""}${reason !== "all" ? `&reason=${encodeURIComponent(reason)}` : ""}`);
      
      const tbody = document.querySelector("#eventsTable tbody");
      if (!tbody) return;
      
      let events = r.events || [];
      
      // Filter debug events uit
      events = events.filter(ev => {
        // Verberg events met level "debug" of "verbose"
        if (ev.level === "debug" || ev.level === "verbose") {
          return false;
        }
        // Verberg events met debug-gerelateerde redenen
        if (ev.reason && ev.reason.includes("debug")) {
          return false;
        }
        return true;
      });
      
      if(events.length===0){ 
        tbody.innerHTML = "<tr><td colspan='8' class='muted'>Geen events</td></tr>"; 
        return; 
      }
      
      // Event detectie wordt nu afgehandeld in de update logica hierboven
      
                  // Anti-knipper update: alleen nieuwe events toevoegen
      let hasNewEvents = false;
      let newEventType = null;
      let newEventsAdded = 0; // Verplaatst naar hier
      let existingIds = new Set(); // Verplaatst naar hier
      
      if (tbody.children.length === 0) {
        // Eerste keer laden - vul de tabel
        for(const ev of events){
          const tr = document.createElement("tr");
          tr.setAttribute("data-event-id", ev.msgId || `event-${ev.ts}-${ev.from}`);
          const ts = ev.ts ? new Date(ev.ts).toLocaleString() : "";
          const badge = ev.reason ? `<span class="badge ${ev.reason === 'fallback' ? 'warn' : ev.reason === 'tenant_ip_not_allowed' ? 'err' : 'err'}">${ev.reason}</span>` : "";
          const info = ev.message || ev.error || "";
          tr.innerHTML = `<td>${ts}</td><td>${ev.level}</td><td>${badge}</td><td>${ev.tenant||""}</td><td>${ev.from||""}</td><td>${ev.rcptCount||""}</td><td>${ev.sizeKB||""}</td><td>${info.toString().slice(0,200)}</td>`;
          tbody.appendChild(tr);
        }
        // Bij eerste keer laden zijn alle events "nieuw"
        newEventsAdded = events.length;
      } else {
        // Bij updates: voeg alleen nieuwe events toe bovenaan
        // Vul existingIds met bestaande event IDs
        Array.from(tbody.children).forEach(row => {
          const id = row.getAttribute("data-event-id");
          if (id) existingIds.add(id);
        });
        
        // Voeg nieuwe events toe bovenaan
        for (const ev of events) {
          const eventId = ev.msgId || `event-${ev.ts}-${ev.from}`;
          if (!existingIds.has(eventId)) {
            const tr = document.createElement("tr");
            tr.setAttribute("data-event-id", eventId);
            tr.style.opacity = "0"; // Start onzichtbaar
            
            const ts = ev.ts ? new Date(ev.ts).toLocaleString() : "";
            const badge = ev.reason ? `<span class="badge ${ev.reason === 'fallback' ? 'warn' : ev.reason === 'tenant_ip_not_allowed' ? 'err' : 'err'}">${ev.reason}</span>` : "";
            const info = ev.message || ev.error || "";
            tr.innerHTML = `<td>${ts}</td><td>${ev.level}</td><td>${badge}</td><td>${ev.tenant||""}</td><td>${ev.from||""}</td><td>${ev.rcptCount||""}</td><td>${ev.sizeKB||""}</td><td>${info.toString().slice(0,200)}</td>`;
            
            // Voeg toe bovenaan
            tbody.insertBefore(tr, tbody.firstChild);
            newEventsAdded++;
            
            // Fade in effect
            setTimeout(() => {
              tr.style.transition = "opacity 0.3s ease-in";
              tr.style.opacity = "1";
            }, 10);
          }
        }
        
        // Behoud maximaal 200 rijen
        while (tbody.children.length > 200) {
          tbody.removeChild(tbody.lastChild);
        }
        
        // Toon feedback als er nieuwe events zijn
        if (newEventsAdded > 0) {
          hasNewEvents = true;
        }
      }
      
      // Bepaal het event type voor feedback (alleen voor nieuwe events)
      if (newEventsAdded > 0) {
        console.log("🔍 Debug: Nieuwe events gevonden, bepalen kleur...");
        console.log("📊 Debug: newEventsAdded:", newEventsAdded);
        console.log("📊 Debug: events.length:", events.length);
        
        // Zoek naar het OUDSTE nieuwe event (laatste in de lijst)
        // Events worden toegevoegd bovenaan, dus de laatste is de oudste
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          const eventId = ev.msgId || `event-${ev.ts}-${ev.from}`;
          if (!existingIds.has(eventId)) {
            console.log("🎯 Debug: Nieuw event gevonden:", {
              index: i,
              eventId,
              level: ev.level,
              reason: ev.reason,
              message: ev.message?.substring(0, 50),
              error: ev.error?.substring(0, 50)
            });
            
            // Dit is een nieuw event, bepaal het type op basis van configuratie
            newEventType = determineEventType(ev);
            console.log(`🎨 Debug: Event type bepaald als ${newEventType.toUpperCase()}`);
            break; // Stop bij het eerste nieuwe event (van onder naar boven)
          }
        }
        
        console.log("🎨 Debug: Uiteindelijke newEventType:", newEventType);
      }
      
      // Toon feedback alleen bij nieuwe events
      if (hasNewEvents && newEventType) {
        showEventFeedback(newEventType);
      }
      
      // GEEN load() aanroep - alleen events bijwerken
    }catch(e){
      const tbody = document.querySelector("#eventsTable tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan='8'>Fout: ${e.message}</td></tr>`;
    }
  }

  // Populate tenant filters from /admin/tenants
  async function populateTenantFilters(){
    try{

      
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
  
          return;
        }
        

      }
      
      const list = await api("/admin/tenants");
      
      const names = Array.from(new Set(
        (list||[])
          .map(t => (t && (t.name || (t.file||"").replace(/\.json$/i, ""))) || "")
          .filter(Boolean)
      )).sort((a,b)=> a.localeCompare(b));
      
      const selS = document.getElementById("tenantFilterStats");
      const selE = document.getElementById("tenantFilterEvents");
      
      function fill(sel){
        if(!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">Alle tenants</option>' + names.map(n=>`<option value="${n}">${n}</option>`).join("");
        if(cur) sel.value = cur;

      }
      fill(selS); fill(selE);
    }catch(e){ 
      console.error(`❌ Fout bij populeren tenant filters:`, e);
    }
  }

  // Filter binding functie
  function bindGlobalFilters(){

    
    const s = document.getElementById("tenantFilterStats");
    const e = document.getElementById("tenantFilterEvents");
    
    
    
    if (s) {
      s.addEventListener("change", ()=>{

        loadStats();
      });
      
    }
    
    if (e) {
      e.addEventListener("change", ()=>{

        loadEvents();
      });
      
    }
  }

  // Exposeer functies voor globale gebruik
  window.loadStats = loadStats;
  window.loadEvents = loadEvents;
  window.populateTenantFilters = populateTenantFilters;
  window.bindGlobalFilters = bindGlobalFilters;
  
  // Variabele om bij te houden welke events al zijn gezien
  let seenEventIds = new Set();

  // --- Eenvoudige Auto-Refresh Functionaliteit ---
  


  // Functie voor visuele event feedback
  function showEventFeedback(type) {
    const eventsCard = document.getElementById("eventsCard");
    
    // Verwijder alle bestaande feedback classes
    eventsCard.classList.remove("success", "error", "warning", "info");
    
    // Voeg de juiste feedback class toe op basis van event type
    if (type === "success" || type === "deliver.ok" || type === "ok") {
      eventsCard.classList.add("success");
    } else if (type === "error" || type === "err") {
      eventsCard.classList.add("error");
    } else if (type === "warning" || type === "warn") {
      eventsCard.classList.add("warning");
    } else {
      // Voor info, debug, en andere event types
      eventsCard.classList.add("info");
    }
    
    // Reset naar rust stand na 2 seconden
    setTimeout(() => {
      eventsCard.classList.remove("success", "error", "warning", "info");
      // Nu heeft de card automatisch de rust stand styling
    }, 2000);
  }

  // Eenvoudige update functie - laadt alles opnieuw
  async function simpleUpdate() {
    try {
      // Laad events en stats opnieuw
      await loadEvents();
      await loadStats();
      
      // GEEN automatische feedback - alleen bij nieuwe events
    } catch (error) {
      console.error("❌ Fout bij update:", error);
    }
  }
  
  // Alleen events update voor auto-refresh (geen stats/tenants)
  async function eventsOnlyUpdate() {
    try {
      // Laad alleen events opnieuw - geen stats, geen tenants
      await loadEvents();
      
      // GEEN automatische feedback - alleen bij nieuwe events
    } catch (error) {
      console.error("❌ Fout bij events update:", error);
    }
  }

  // Functie om auto-refresh te starten/stoppen
  function toggleAutoRefresh(enable) {
    if (enable && !eventsTimer) {
      eventsTimer = setInterval(() => {
        eventsOnlyUpdate(); // Alleen events, geen stats/tenants
      }, 7000); // 7 seconden interval
    } else if (!enable && eventsTimer) {
      clearInterval(eventsTimer);
      eventsTimer = null;
    }
  }

  // Exposeer auto-refresh functies
  window.simpleUpdate = simpleUpdate;
  window.eventsOnlyUpdate = eventsOnlyUpdate;
  window.toggleAutoRefresh = toggleAutoRefresh;

  // Test functie voor debugging (aanroepen vanuit browser console)
  window.testAutoRefresh = () => {
    // Test handmatige update
    eventsOnlyUpdate(); // Alleen events, geen stats/tenants
  };
  
  // Event kleur configuratie
  const defaultEventColors = {
    error: {
      levels: "error,mail.error",
      reasons: "err,sender_not_allowed,tenant_ip_not_allowed,fallback,quota_exceeded,invalid_recipient,authentication_failed,connection_failed,timeout,rate_limited"
    },
    warning: {
      levels: "warning",
      reasons: "warn,quota_warning,retry_required"
    },
    info: {
      levels: "info,debug,verbose",
      reasons: "info,debug"
    },
    success: {
      levels: "success,ok",
      reasons: "deliver.ok,ok"
    }
  };

  // Laad event kleur configuratie
  function loadEventColorConfig() {
    const config = localStorage.getItem("eventColorConfig");
    if (config) {
      try {
        const parsed = JSON.parse(config);
        Object.keys(parsed).forEach(type => {
          const errorLevels = document.getElementById(`${type}Levels`);
          const errorReasons = document.getElementById(`${type}Reasons`);
          if (errorLevels) errorLevels.value = parsed[type].levels || "";
          if (errorReasons) errorReasons.value = parsed[type].reasons || "";
        });
      } catch (e) {
        console.error("❌ Fout bij laden event kleur config:", e);
      }
    } else {
      // Gebruik standaard waarden
      Object.keys(defaultEventColors).forEach(type => {
        const errorLevels = document.getElementById(`${type}Levels`);
        const errorReasons = document.getElementById(`${type}Reasons`);
        if (errorLevels) errorLevels.value = defaultEventColors[type].levels;
        if (errorReasons) errorLevels.value = defaultEventColors[type].reasons;
      });
    }
  }

  // Sla event kleur configuratie op
  function saveEventColorConfig() {
    const config = {};
    Object.keys(defaultEventColors).forEach(type => {
      const levels = document.getElementById(`${type}Levels`);
      const reasons = document.getElementById(`${type}Reasons`);
      config[type] = {
        levels: levels ? levels.value : "",
        reasons: reasons ? reasons.value : ""
      };
    });
    
    localStorage.setItem("eventColorConfig", JSON.stringify(config));
    toast("✅ Event kleur configuratie opgeslagen!");
  }

  // Reset naar standaard waarden
  function resetEventColorConfig() {
    Object.keys(defaultEventColors).forEach(type => {
      const levels = document.getElementById(`${type}Levels`);
      const reasons = document.getElementById(`${type}Reasons`);
      if (levels) levels.value = defaultEventColors[type].levels;
      if (reasons) reasons.value = defaultEventColors[type].reasons;
    });
    
    localStorage.removeItem("eventColorConfig");
    toast("🔄 Event kleur configuratie gereset naar standaard!");
  }

  // Functie om event type te bepalen op basis van configuratie
  function determineEventType(ev) {
    const config = localStorage.getItem("eventColorConfig");
    let rules;
    
    if (config) {
      try {
        rules = JSON.parse(config);
      } catch (e) {
        rules = defaultEventColors;
      }
    } else {
      rules = defaultEventColors;
    }

    // Check error rules
    if (rules.error) {
      const levels = rules.error.levels.split(",").map(s => s.trim()).filter(Boolean);
      const reasons = rules.error.reasons.split(",").map(s => s.trim()).filter(Boolean);
      
      if (levels.some(level => ev.level && ev.level.includes(level)) || 
          reasons.some(reason => ev.reason && ev.reason.includes(reason))) {
        return "error";
      }
    }

    // Check warning rules
    if (rules.warning) {
      const levels = rules.warning.levels.split(",").map(s => s.trim()).filter(Boolean);
      const reasons = rules.warning.reasons.split(",").map(s => s.trim()).filter(Boolean);
      
      if (levels.some(level => ev.level && ev.level.includes(level)) || 
          reasons.some(reason => ev.reason && ev.reason.includes(reason))) {
        return "warning";
      }
    }

    // Check info rules
    if (rules.info) {
      const levels = rules.info.levels.split(",").map(s => s.trim()).filter(Boolean);
      const reasons = rules.info.reasons.split(",").map(s => s.trim()).filter(Boolean);
      
      if (levels.some(level => ev.level && ev.level.includes(level)) || 
          reasons.some(reason => ev.reason && ev.reason.includes(reason))) {
        return "info";
      }
    }

    // Check success rules
    if (rules.success) {
      const levels = rules.success.levels.split(",").map(s => s.trim()).filter(Boolean);
      const reasons = rules.success.reasons.split(",").map(s => s.trim()).filter(Boolean);
      
      if (levels.some(level => ev.level && ev.level.includes(level)) || 
          reasons.some(reason => ev.reason && ev.reason.includes(reason))) {
        return "success";
      }
    }

    // Fallback naar standaard logica
    return "success";
  }

  // Debug functie om event data te inspecteren
  window.debugEvents = async () => {
    try {
      const r = await api("/admin/events?limit=10");
      const events = r.events || [];
      console.log("🔍 Debug: Eerste 10 events:", events.map(ev => ({
        level: ev.level,
        reason: ev.reason,
        message: ev.message?.substring(0, 50),
        error: ev.error?.substring(0, 50),
        // Voeg alle beschikbare velden toe voor debugging
        allFields: Object.keys(ev),
        allValues: ev
      })));
      
      // Debug de kleur logica
      console.log("🎨 Debug: Kleur logica test");
      events.forEach((ev, index) => {
        const eventType = determineEventType(ev);
        console.log(`Event ${index}:`, {
          level: ev.level,
          reason: ev.reason,
          determinedType: eventType
        });
      });
    } catch (error) {
      console.error("❌ Fout bij debug:", error);
    }
  };

})();

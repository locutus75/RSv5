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
      let errorData = null;
      try {
        errorData = await r.json();
        if(errorData?.error) m += " — " + errorData.error;
        if(errorData?.errors && Array.isArray(errorData.errors)) {
          m += "\nValidatie fouten:\n" + errorData.errors.map(err => 
            `${err.instancePath || err.schemaPath || '?'}: ${err.message}`
          ).join("\n");
        }
      } catch {}
      
      if (r.status === 401) {
        m = "Authentication required. Please set ADMIN_TOKEN environment variable or provide valid token.";
      }
      
      const error = new Error(m);
      error.status = r.status;
      error.data = errorData;
      throw error;
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

  // Laad versie en update UI
  async function loadVersion(){
    try {
      const versionData = await api("/admin/version");
      const versionString = `v${versionData.version}`;
      
      // Update versie in header
      const versionHeader = document.getElementById("versionHeader");
      if (versionHeader) {
        versionHeader.textContent = versionString;
      }
      
      // Update versie in login overlay
      const versionLogin = document.getElementById("versionLogin");
      if (versionLogin) {
        versionLogin.textContent = versionString;
      }
    } catch (error) {
      console.error("❌ Fout bij laden versie:", error);
      // Fallback naar hardcoded versie blijft staan
    }
  }

  function render(){
    tbody.innerHTML="";
    if(!data.length){
      tbody.innerHTML="<tr><td colspan='3' class='muted'>Geen tenants gevonden</td></tr>";
      return;
    }
    for(const t of data){
      const tr=document.createElement("tr");
      
      // Bepaal delivery method en toon informatie
      const deliveryMethod = t.delivery?.method || "graph";
      let deliveryInfo = "";
      
      if (deliveryMethod === "smtp") {
        // SMTP delivery - toon SMTP server naam
        const smtpServer = t.delivery?.smtp?.smtpServer || t.delivery?.smtpServer || "";
        deliveryInfo = smtpServer ? `SMTP: ${smtpServer}` : "SMTP (geen server)";
      } else {
        // Graph API delivery - toon mailbox
        const mailbox = t.delivery?.graph?.defaultMailbox || t.defaultMailbox || "";
        deliveryInfo = mailbox ? `Graph API: ${mailbox}` : "Graph API (geen mailbox)";
      }
      
      // Acties kolom met iconen
      const actionsCell = document.createElement("td");
      actionsCell.style.textAlign = "right";
      actionsCell.className = "actions-cell";
      
      const editBtn = document.createElement("button");
      editBtn.className = "action-btn ghost";
      editBtn.setAttribute("data-e", t.file);
      editBtn.title = "Bewerken";
      editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>`;
      
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "action-btn ghost";
      deleteBtn.setAttribute("data-d", t.file);
      deleteBtn.title = "Verwijderen";
      deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>`;
      
      actionsCell.appendChild(editBtn);
      actionsCell.appendChild(deleteBtn);
      
      tr.innerHTML = `<td>${t.name||"(naamloos)"}</td><td>${deliveryInfo}</td>`;
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    }
  }

  async function load(){
    tbody.innerHTML="<tr><td colspan='3'>Laden…</td></tr>";
    try {
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
          tbody.innerHTML = `<tr><td colspan='3' class='muted'>🔐 Authenticatie vereist. Voer een token in via de browser console.</td></tr>`;
          return;
        }
        

      }
      
      data = await api("/admin/tenants");
      render();
      try{populateTenantFilters && populateTenantFilters();}catch{}
    } catch(e){
      console.error("❌ Fout bij laden tenants:", e);
      tbody.innerHTML = `<tr><td colspan='3'>Fout: ${e.message}</tr>`;
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
        set("tfRatePerMinute", d.policy?.rateLimit?.perMinute);
        set("tfRatePerHour", d.policy?.rateLimit?.perHour);
        
        // Delivery method - bepaal welke actief is
        const deliveryMethod = d.delivery?.method || "graph";
        document.querySelector(`input[name="deliveryMethod"][value="${deliveryMethod}"]`).checked = true;
        
        // Allowed Senders wordt altijd geladen (beschikbaar voor beide delivery methods)
        set("tfAllowedSenders", d.allowedSenders?.join("\n"));
        
        // Laad beide configuraties (Graph API en SMTP) zodat ze behouden blijven
        // Graph API configuratie (uit delivery.graph of legacy velden)
        if (d.delivery?.graph) {
          set("tfTenantId", d.delivery.graph.tenantId);
          set("tfClientId", d.delivery.graph.clientId);
          set("tfDefaultMailbox", d.delivery.graph.defaultMailbox);
          set("tfCertPath", d.delivery.graph.auth?.certPath);
          set("tfThumbprint", d.delivery.graph.auth?.thumbprint);
        } else {
          // Legacy: laad uit top-level velden (voor backwards compatibility)
          set("tfTenantId", d.tenantId);
          set("tfClientId", d.clientId);
          set("tfDefaultMailbox", d.defaultMailbox);
          set("tfCertPath", d.auth?.certPath);
          set("tfThumbprint", d.auth?.thumbprint);
        }
        
        // SMTP configuratie (uit delivery.smtp)
        if (d.delivery?.smtp) {
          $("#tfSmtpServer").value = d.delivery.smtp.smtpServer || "";
        } else {
          // Legacy: laad uit delivery.smtpServer (voor backwards compatibility)
          $("#tfSmtpServer").value = d.delivery?.smtpServer || "";
        }
        
        // Update SMTP select dropdown when opening tenant modal
        if (settingsData && settingsData.service?.smtpServers) {
          updateTenantSmtpSelect(settingsData.service.smtpServers);
          if (deliveryMethod === "smtp" && d.delivery?.smtpServer) {
            $("#tfSmtpServer").value = d.delivery.smtpServer;
          }
        }
        
        // Update zichtbaarheid van Graph configuratie velden
        toggleDeliveryMethod();
        
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
      loadVersion(); // Laad versie
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
  $("#newTenantBtn").addEventListener("click",async()=>{
    name=null;
    document.getElementById("tenantModalTitle").textContent = "Nieuwe tenant";
    // Reset alle velden
    const fields = ["tfName","tfTenantId","tfClientId","tfDefaultMailbox","tfAllowedSenders","tfCertPath","tfThumbprint","tfForceFrom","tfMaxSize","tfRatePerMinute","tfRatePerHour","tfSaveToSent","tfBccArchive","tfIpRanges","tfSenderDomains","tfPriority","tfTags"];
    fields.forEach(f => {
      const el = document.getElementById(f);
      if(el) {
        el.value = "";
        if (el.type === "checkbox") el.checked = false;
      }
    });
    // Reset delivery method
    document.querySelector('input[name="deliveryMethod"][value="graph"]').checked = true;
    $("#tfSmtpServer").value = "";
    toggleDeliveryMethod(); // Update zichtbaarheid van Graph velden
    
    // Load SMTP servers for dropdown
    if (!settingsData) {
      await loadSettings();
    }
    if (settingsData && settingsData.service?.smtpServers) {
      updateTenantSmtpSelect(settingsData.service.smtpServers);
    }
    
    document.getElementById("tenantModal").classList.remove("hidden");
  });

  $("#tenantClose").addEventListener("click",()=>{
    document.getElementById("tenantModal").classList.add("hidden");
  });

  // Toggle Graph configuratie velden op basis van delivery method
  function toggleDeliveryMethod() {
    const deliveryMethod = document.querySelector('input[name="deliveryMethod"]:checked')?.value || "graph";
    const graphFields = $("#graphConfigFields");
    
    if (graphFields) {
      if (deliveryMethod === "graph") {
        // Graph API geselecteerd - toon Graph velden
        graphFields.style.display = "block";
        // Maak Graph velden verplicht (allowedSenders is niet meer verplicht voor Graph API)
        const graphRequiredFields = ["tfTenantId", "tfClientId", "tfDefaultMailbox", "tfCertPath", "tfThumbprint"];
        graphRequiredFields.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.setAttribute("required", "required");
        });
      } else {
        // SMTP geselecteerd - verberg Graph velden
        graphFields.style.display = "none";
        // Maak Graph velden optioneel
        const graphRequiredFields = ["tfTenantId", "tfClientId", "tfDefaultMailbox", "tfCertPath", "tfThumbprint"];
        graphRequiredFields.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.removeAttribute("required");
        });
      }
    }
  }
  
  // Luister naar delivery method wijzigingen
  document.querySelectorAll('input[name="deliveryMethod"]').forEach(radio => {
    radio.addEventListener("change", toggleDeliveryMethod);
  });
  
  // Event listener voor SMTP server select dropdown - wordt ook toegevoegd in updateTenantSmtpSelect
  const smtpSelect = $("#tfSmtpServer");
  if (smtpSelect) {
    smtpSelect.addEventListener("change", handleSmtpServerChange);
  }

  $("#tenantSave").addEventListener("click",async()=>{
    try{
      const tenantName = $("#tfName").value.trim();
      if (!tenantName) {
        toast("Tenant naam is verplicht");
        return;
      }
      
      // Delivery method configuratie
      const deliveryMethodRadio = document.querySelector('input[name="deliveryMethod"]:checked');
      if (!deliveryMethodRadio) {
        toast("Selecteer een mail delivery method");
        return;
      }
      const deliveryMethod = deliveryMethodRadio.value;
      
      // Basis tenant object
      const tenant = {
        name: tenantName,
        senderOverrides: {},
        routing: {
          ipRanges: $("#tfIpRanges").value.split("\n").map(s=>s.trim()).filter(Boolean),
          senderDomains: $("#tfSenderDomains").value.split(",").map(s=>s.trim()).filter(Boolean)
        },
        policy: {
          saveToSentItems: $("#tfSaveToSent").checked
        },
        tags: $("#tfTags").value.split(",").map(s=>s.trim()).filter(Boolean)
      };
      
      // Voeg priority alleen toe als het is ingevuld
      const priorityValue = $("#tfPriority").value.trim();
      if (priorityValue) {
        const priority = parseInt(priorityValue);
        if (!isNaN(priority)) {
          tenant.routing.priority = priority;
        }
      }
      
      // Voeg maxMessageSizeKB alleen toe als het is ingevuld
      const maxSizeValue = $("#tfMaxSize").value.trim();
      if (maxSizeValue) {
        const maxSize = parseInt(maxSizeValue);
        if (!isNaN(maxSize)) {
          tenant.policy.maxMessageSizeKB = maxSize;
        }
      }
      
      // Allowed Senders - beschikbaar voor beide delivery methods (gebruikt voor routing en sender validatie)
      const allowedSenders = $("#tfAllowedSenders").value.split("\n").map(s=>s.trim()).filter(Boolean);
      if (allowedSenders.length > 0) {
        tenant.allowedSenders = allowedSenders;
      }
      
      // Validatie: Ten minste één routing criterium is verplicht (routing.senderDomains of allowedSenders)
      const hasRoutingDomains = tenant.routing.senderDomains && tenant.routing.senderDomains.length > 0;
      const hasAllowedSenders = allowedSenders.length > 0;
      
      if (!hasRoutingDomains && !hasAllowedSenders) {
        toast("Ten minste één van de volgende velden is verplicht: Routing domains of Allowed senders (gebruikt voor tenant routing)");
        return;
      }
      
      // Voeg bccArchive alleen toe als het is ingevuld
      const bccArchive = $("#tfBccArchive").value.trim();
      if (bccArchive) {
        tenant.policy.bccArchive = bccArchive;
      }
      
      // Voeg forceFrom alleen toe als het is ingevuld
      const forceFrom = $("#tfForceFrom").value.trim();
      if (forceFrom) {
        tenant.policy.forceFrom = forceFrom;
      }
      
      // Rate limit configuratie
      const ratePerMinute = parseInt($("#tfRatePerMinute").value);
      const ratePerHour = parseInt($("#tfRatePerHour").value);
      if (ratePerMinute || ratePerHour) {
        tenant.policy.rateLimit = {};
        if (ratePerMinute) tenant.policy.rateLimit.perMinute = ratePerMinute;
        if (ratePerHour) tenant.policy.rateLimit.perHour = ratePerHour;
      }
      
      // Delivery method configuratie - sla beide configuraties op
      const deliveryConfig = {
        method: deliveryMethod
      };
      
      // Graph API configuratie - altijd opslaan (ook als niet actief)
      const tenantId = $("#tfTenantId").value.trim();
      const clientId = $("#tfClientId").value.trim();
      const defaultMailbox = $("#tfDefaultMailbox").value.trim();
      const certPath = $("#tfCertPath").value.trim();
      const thumbprint = $("#tfThumbprint").value.trim();
      
      if (tenantId || clientId || defaultMailbox || certPath || thumbprint) {
        // Alleen opslaan als er ten minste één veld is ingevuld
        deliveryConfig.graph = {};
        if (tenantId) deliveryConfig.graph.tenantId = tenantId;
        if (clientId) deliveryConfig.graph.clientId = clientId;
        if (defaultMailbox) deliveryConfig.graph.defaultMailbox = defaultMailbox;
        if (certPath || thumbprint) {
          deliveryConfig.graph.auth = {
            type: "certificate"
          };
          if (certPath) deliveryConfig.graph.auth.certPath = certPath;
          if (thumbprint) deliveryConfig.graph.auth.thumbprint = thumbprint;
        }
      }
      
      // SMTP configuratie - altijd opslaan (ook als niet actief)
      const smtpServer = $("#tfSmtpServer").value.trim();
      if (smtpServer) {
        deliveryConfig.smtp = {
          smtpServer: smtpServer
        };
      }
      
      // Validatie: controleer of de actieve delivery method correct is geconfigureerd
      if (deliveryMethod === "smtp") {
        if (!smtpServer) {
          toast("Selecteer een SMTP server voor SMTP delivery");
          return;
        }
      } else {
        // Graph API - controleer of alle verplichte velden zijn ingevuld
        if (!tenantId || !clientId || !defaultMailbox || !certPath || !thumbprint) {
          toast("Voor Graph API zijn Tenant ID, Client ID, Default Mailbox, Cert Path en Thumbprint verplicht");
          return;
        }
      }
      
      tenant.delivery = deliveryConfig;
      
      // Verwijder eventuele extra velden die niet in schema staan (zoals 'file')
      const cleanTenant = {
        name: tenant.name
      };
      
      // senderOverrides is altijd verplicht volgens schema, maar kan leeg zijn
      if (tenant.senderOverrides && Object.keys(tenant.senderOverrides).length > 0) {
        cleanTenant.senderOverrides = tenant.senderOverrides;
      } else {
        cleanTenant.senderOverrides = {}; // Leeg object is toegestaan volgens schema
      }
      
      // Graph API velden worden nu opgeslagen in delivery.graph, niet meer op top-level
      // (behalve voor backwards compatibility met bestaande configuraties)
      
      // allowedSenders is beschikbaar voor beide delivery methods - wordt gebruikt voor routing en sender validatie
      if (tenant.allowedSenders && tenant.allowedSenders.length > 0) {
        cleanTenant.allowedSenders = tenant.allowedSenders;
      }
      
      // Routing object - alleen toevoegen als er ten minste één veld is ingevuld
      if (tenant.routing) {
        const cleanRouting = {};
        if (tenant.routing.ipRanges && Array.isArray(tenant.routing.ipRanges) && tenant.routing.ipRanges.length > 0) {
          cleanRouting.ipRanges = tenant.routing.ipRanges;
        }
        if (tenant.routing.senderDomains && Array.isArray(tenant.routing.senderDomains) && tenant.routing.senderDomains.length > 0) {
          cleanRouting.senderDomains = tenant.routing.senderDomains;
        }
        if (tenant.routing.priority !== undefined && tenant.routing.priority !== null && tenant.routing.priority !== "") {
          const priorityValue = parseInt(tenant.routing.priority);
          if (!isNaN(priorityValue)) {
            cleanRouting.priority = priorityValue;
          }
        }
        if (Object.keys(cleanRouting).length > 0) {
          cleanTenant.routing = cleanRouting;
        }
      }
      
      // Policy object - alleen toevoegen als er ten minste één veld is ingevuld
      if (tenant.policy) {
        const cleanPolicy = {};
        if (tenant.policy.maxMessageSizeKB !== undefined && tenant.policy.maxMessageSizeKB !== null && tenant.policy.maxMessageSizeKB !== "") {
          cleanPolicy.maxMessageSizeKB = tenant.policy.maxMessageSizeKB;
        }
        if (tenant.policy.saveToSentItems !== undefined) {
          cleanPolicy.saveToSentItems = tenant.policy.saveToSentItems;
        }
        if (tenant.policy.forceFrom && tenant.policy.forceFrom.trim() !== "") {
          cleanPolicy.forceFrom = tenant.policy.forceFrom;
        }
        if (tenant.policy.bccArchive && tenant.policy.bccArchive.trim() !== "") {
          cleanPolicy.bccArchive = tenant.policy.bccArchive;
        }
        if (tenant.policy.rateLimit) {
          const cleanRateLimit = {};
          if (tenant.policy.rateLimit.perMinute !== undefined && tenant.policy.rateLimit.perMinute !== null && tenant.policy.rateLimit.perMinute !== "") {
            cleanRateLimit.perMinute = tenant.policy.rateLimit.perMinute;
          }
          if (tenant.policy.rateLimit.perHour !== undefined && tenant.policy.rateLimit.perHour !== null && tenant.policy.rateLimit.perHour !== "") {
            cleanRateLimit.perHour = tenant.policy.rateLimit.perHour;
          }
          if (Object.keys(cleanRateLimit).length > 0) {
            cleanPolicy.rateLimit = cleanRateLimit;
          }
        }
        if (Object.keys(cleanPolicy).length > 0) {
          cleanTenant.policy = cleanPolicy;
        }
      }
      
      // Tags - alleen toevoegen als er tags zijn
      if (tenant.tags && tenant.tags.length > 0) {
        cleanTenant.tags = tenant.tags;
      }
      
      // Delivery - sla beide configuraties op (graph en smtp)
      // Gebruik de deliveryConfig die we eerder hebben gemaakt (bevat beide configuraties)
      if (tenant.delivery) {
        const cleanDelivery = {
          method: tenant.delivery.method || deliveryMethod || "graph"
        };
        
        // Graph API configuratie - gebruik de configuratie die we hebben gemaakt
        if (tenant.delivery.graph && Object.keys(tenant.delivery.graph).length > 0) {
          cleanDelivery.graph = tenant.delivery.graph;
        }
        
        // SMTP configuratie - gebruik de configuratie die we hebben gemaakt
        if (tenant.delivery.smtp && Object.keys(tenant.delivery.smtp).length > 0) {
          cleanDelivery.smtp = tenant.delivery.smtp;
        }
        
        // Zorg dat delivery altijd wordt toegevoegd als er een method is
        cleanTenant.delivery = cleanDelivery;
      }

      // Final cleanup: verwijder alle velden die niet in het schema staan
      const schemaProperties = [
        "name", "tenantId", "clientId", "auth", "defaultMailbox", "allowedSenders",
        "senderOverrides", "routing", "policy", "tags", "delivery"
      ];
      const finalTenant = {};
      schemaProperties.forEach(prop => {
        if (cleanTenant.hasOwnProperty(prop) && cleanTenant[prop] !== undefined) {
          // Controleer of het geen lege array of leeg object is
          if (Array.isArray(cleanTenant[prop])) {
            if (cleanTenant[prop].length > 0) {
              finalTenant[prop] = cleanTenant[prop];
            }
          } else if (typeof cleanTenant[prop] === "object" && cleanTenant[prop] !== null) {
            // Voor senderOverrides: leeg object {} is toegestaan (verplicht veld volgens schema)
            if (prop === "senderOverrides") {
              finalTenant[prop] = cleanTenant[prop];
            } else if (prop === "delivery") {
              // Delivery object moet altijd worden toegevoegd (bevat altijd minstens method)
              finalTenant[prop] = cleanTenant[prop];
            } else if (Object.keys(cleanTenant[prop]).length > 0) {
              finalTenant[prop] = cleanTenant[prop];
            }
          } else if (cleanTenant[prop] !== null && cleanTenant[prop] !== "") {
            finalTenant[prop] = cleanTenant[prop];
          }
        }
      });
      
      console.log("📝 Tenant data voor opslaan:", JSON.stringify(finalTenant, null, 2));
      console.log("📝 Delivery method:", deliveryMethod);
      console.log("📝 Heeft Graph API velden:", {
        tenantId: !!finalTenant.tenantId,
        clientId: !!finalTenant.clientId,
        auth: !!finalTenant.auth,
        defaultMailbox: !!finalTenant.defaultMailbox,
        allowedSenders: !!finalTenant.allowedSenders
      });

      const method = name ? "PUT" : "POST";
      const url = name ? `/admin/tenants/${encodeURIComponent(name)}` : "/admin/tenants";
      
      await api(url, {method, body: JSON.stringify(finalTenant)});
      toast(name ? "Tenant bijgewerkt" : "Tenant aangemaakt");
      document.getElementById("tenantModal").classList.add("hidden");
      load();
    }catch(e){
      let errorMsg = e.message;
      if (e.data?.errors && Array.isArray(e.data.errors)) {
        errorMsg = "Validatie fouten:\n" + e.data.errors.map(err => 
          `${err.instancePath || err.schemaPath || '?'}: ${err.message}`
        ).join("\n");
      }
      toast("Fout bij opslaan: " + errorMsg);
      console.error("Tenant save error:", e, e.data);
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

  // Settings management
  let settingsData = null;

  async function loadSettings(){
    try{
      settingsData = await api("/admin/config");
      updateSettingsPreview(settingsData);
      // Update SMTP server dropdown in tenant form if modal is open
      if (!document.getElementById("tenantModal").classList.contains("hidden")) {
        if (settingsData && settingsData.service?.smtpServers) {
          updateTenantSmtpSelect(settingsData.service.smtpServers);
        }
      }
    }catch(e){
      console.error("Failed to load settings:", e);
      toast("Fout bij laden settings: " + e.message);
    }
  }

  function updateSettingsPreview(config){
    // Preview functie wordt niet meer gebruikt omdat we geen preview sectie hebben
    // Maar we houden de functie voor eventuele toekomstige gebruik
  }

  // SMTP Server Management State
  let configuredSmtpServers = [];
  let configuredAuthUsers = [];

  function renderSmtpList() {
    const list = $("#smtpList");
    list.innerHTML = "";
    
    if (configuredSmtpServers.length === 0) {
      list.innerHTML = '<li class="empty">Geen servers geconfigureerd</li>';
      updateTestSmtpSelect([]);
      updateTenantSmtpSelect([]);
      return;
    }

    configuredSmtpServers.forEach((server, index) => {
      const li = document.createElement("li");
      const authInfo = server.auth ? ` [Auth: ${server.authUser || server.auth.user}]` : "";
      li.innerHTML = `
        <div>
          <strong>${server.naam}</strong> 
          <span class="muted">(${server.adres}:${server.poort}${authInfo})</span>
        </div>
        <div class="actions">
          <button class="secondary small delete-smtp" data-index="${index}">Verwijder</button>
        </div>
      `;
      list.appendChild(li);
    });

    // Add delete handlers
    list.querySelectorAll(".delete-smtp").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.index);
        configuredSmtpServers.splice(idx, 1);
        renderSmtpList();
      });
    });
    
    updateTestSmtpSelect(configuredSmtpServers);
    updateTenantSmtpSelect(configuredSmtpServers);
  }

  function updateTestSmtpSelect(servers) {
    const sel = $("#testSmtpSelect");
    sel.innerHTML = '<option value="">Selecteer server uit lijst...</option>';
    servers.forEach((s, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = s.naam || `Server ${i+1} (${s.adres})`;
      sel.appendChild(opt);
    });
  }

  function updateTenantSmtpSelect(servers) {
    const sel = $("#tfSmtpServer");
    const currentValue = sel.value;
    sel.innerHTML = '<option value="">Kies een server...</option>';
    servers.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.naam;
      opt.textContent = `${s.naam} (${s.adres}:${s.poort})`;
      sel.appendChild(opt);
    });
    if (currentValue) {
      sel.value = currentValue;
    }
    
    // Event listener: als een SMTP server wordt geselecteerd, zet automatisch de radio button naar SMTP
    sel.removeEventListener("change", handleSmtpServerChange);
    sel.addEventListener("change", handleSmtpServerChange);
  }
  
  function handleSmtpServerChange() {
    const sel = $("#tfSmtpServer");
    if (sel.value && sel.value !== "") {
      // Als een SMTP server is geselecteerd, zet de radio button naar SMTP
      const smtpRadio = document.querySelector('input[name="deliveryMethod"][value="smtp"]');
      if (smtpRadio && !smtpRadio.checked) {
        smtpRadio.checked = true;
        toggleDeliveryMethod(); // Update zichtbaarheid van Graph velden
      }
    }
  }

  function populateSettingsForm(config){
    const svc = config.service || {};
    $("#sfListenPort").value = svc.listenPort || 2525;
    $("#sfHostName").value = svc.hostName || "";
    $("#sfRequireTLS").checked = svc.requireTLS || false;
    $("#sfOptionalBasicAuth").checked = svc.optionalBasicAuth !== false;
    $("#sfCertFile").value = svc.tls?.certFile || "";
    $("#sfKeyFile").value = svc.tls?.keyFile || "";
    $("#sfTLSMode").value = svc.tls?.mode || "starttls";
    const ips = svc.allowlistIPs || [];
    $("#sfAllowlistIPs").value = ips.join("\n");
    
    // Routing priority configuratie
    const routingPriority = svc.routingPriority || ["allowedSenders", "senderDomains", "ipRanges"];
    const list = $("#sfRoutingPriorityList");
    if (list) {
      // Sorteer items volgens de geconfigureerde volgorde
      const items = Array.from(list.children);
      const sortedItems = routingPriority.map(method => 
        items.find(item => item.dataset.value === method)
      ).filter(Boolean);
      
      // Voeg items toe die niet in routingPriority staan (fallback)
      items.forEach(item => {
        if (!routingPriority.includes(item.dataset.value)) {
          sortedItems.push(item);
        }
      });
      
      // Herplaats items in de juiste volgorde
      sortedItems.forEach(item => list.appendChild(item));
    }
    
    // Initialize routing priority drag and drop
    initRoutingPrioritySortable();
    
    // Load SMTP servers into memory and render list
    configuredSmtpServers = svc.smtpServers || [];
    renderSmtpList();
    
    // Load auth users
    configuredAuthUsers = svc.authUsers || [];
    renderAuthUsersList();
  }
  
  // Auth Users Management
  function renderAuthUsersList() {
    const list = $("#authUsersList");
    if (!list) return;
    
    list.innerHTML = "";
    
    if (configuredAuthUsers.length === 0) {
      list.innerHTML = '<li class="empty">Geen gebruikers geconfigureerd</li>';
      updateSmtpAuthUserSelect([]);
      return;
    }

    configuredAuthUsers.forEach((user, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <strong>${user.username}</strong>
        </div>
        <div class="actions">
          <button class="secondary small delete-auth-user" data-index="${index}">Verwijder</button>
        </div>
      `;
      list.appendChild(li);
    });

    // Add delete handlers
    list.querySelectorAll(".delete-auth-user").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.index);
        const deletedUser = configuredAuthUsers[idx];
        configuredAuthUsers.splice(idx, 1);
        renderAuthUsersList();
        // Update SMTP servers die deze gebruiker gebruiken
        configuredSmtpServers.forEach(s => {
          if (s.authUser === deletedUser?.username) {
            delete s.auth;
            delete s.authUser;
          }
        });
        renderSmtpList();
      });
    });
    
    updateSmtpAuthUserSelect(configuredAuthUsers);
  }

  function updateSmtpAuthUserSelect(users) {
    const sel = $("#newSmtpAuthUser");
    if (!sel) return;
    
    sel.innerHTML = '<option value="">Geen authenticatie</option>';
    users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.username;
      opt.textContent = u.username;
      sel.appendChild(opt);
    });
    
    // Show/hide select based on checkbox
    const requireAuth = $("#newSmtpRequireAuth");
    if (requireAuth) {
      requireAuth.addEventListener("change", () => {
        sel.style.display = requireAuth.checked ? "block" : "none";
      });
    }
  }
  
  // Add Auth User Button Handler
  $("#addAuthUserBtn")?.addEventListener("click", () => {
    const username = $("#newAuthUsername").value.trim();
    const password = $("#newAuthPassword").value.trim();
    
    if (!username || !password) {
      toast("Gebruikersnaam en wachtwoord zijn verplicht");
      return;
    }

    const newUser = {
      username,
      password
    };

    configuredAuthUsers.push(newUser);
    renderAuthUsersList();
    
    // Reset form fields
    $("#newAuthUsername").value = "";
    $("#newAuthPassword").value = "";
  });

  $("#settingsBtn").addEventListener("click",async()=>{
    try{
      if(!settingsData){
        await loadSettings();
      }
      populateSettingsForm(settingsData);
      document.getElementById("settingsModal").classList.remove("hidden");
    }catch(e){
      toast("Fout bij laden settings: " + e.message);
    }
  });

  $("#settingsClose").addEventListener("click",()=>{
    document.getElementById("settingsModal").classList.add("hidden");
  });

  $("#settingsSave").addEventListener("click",async()=>{
    try{
      // Clean up SMTP servers - verwijder authUser referentie (alleen voor UI)
      const cleanSmtpServers = configuredSmtpServers.map(s => {
        const { authUser, ...rest } = s;
        return rest;
      });

      const config = {
        service: {
          listenPort: parseInt($("#sfListenPort").value) || 2525,
          requireTLS: $("#sfRequireTLS").checked,
          hostName: $("#sfHostName").value.trim(),
          tls: {
            certFile: $("#sfCertFile").value.trim(),
            keyFile: $("#sfKeyFile").value.trim(),
            mode: $("#sfTLSMode").value || "starttls"
          },
          allowlistIPs: $("#sfAllowlistIPs").value.split("\n").map(s=>s.trim()).filter(Boolean),
          routingPriority: Array.from($("#sfRoutingPriorityList").children).map(li => li.dataset.value),
          optionalBasicAuth: $("#sfOptionalBasicAuth").checked,
          smtpServers: cleanSmtpServers,
          authUsers: configuredAuthUsers
        }
      };

      await api("/admin/config", {method: "PUT", body: JSON.stringify(config)});
      toast("Settings opgeslagen");
      document.getElementById("settingsModal").classList.add("hidden");
      await loadSettings();
    }catch(e){
      toast("Fout bij opslaan settings: " + e.message);
    }
  });

  // Add SMTP Server Button Handler
  $("#addSmtpServerBtn").addEventListener("click", () => {
    const naam = $("#newSmtpName").value.trim();
    const adres = $("#newSmtpAdres").value.trim();
    const poort = parseInt($("#newSmtpPoort").value);
    const requireAuth = $("#newSmtpRequireAuth").checked;
    const authUser = $("#newSmtpAuthUser").value;
    
    if (!naam || !adres || !poort) {
      toast("Naam, Adres en Poort zijn verplicht");
      return;
    }

    if (requireAuth && !authUser) {
      toast("Selecteer een gebruiker voor authenticatie");
      return;
    }

    const newServer = {
      naam,
      adres,
      poort
    };
    
    if (requireAuth && authUser) {
      const user = configuredAuthUsers.find(u => u.username === authUser);
      if (user) {
        newServer.auth = {
          user: user.username,
          pass: user.password
        };
        newServer.authUser = user.username; // Voor referentie in UI
      }
    }

    configuredSmtpServers.push(newServer);
    renderSmtpList();
    
    // Reset form fields
    $("#newSmtpName").value = "";
    $("#newSmtpAdres").value = "";
    $("#newSmtpPoort").value = "";
    $("#newSmtpRequireAuth").checked = false;
    $("#newSmtpAuthUser").value = "";
    $("#newSmtpAuthUser").style.display = "none";
  });

  // Test SMTP Connection Button Handler
  $("#testSmtpBtn").addEventListener("click", async () => {
    const idx = $("#testSmtpSelect").value;
    if (idx === "") {
      toast("Selecteer eerst een SMTP server");
      return;
    }
    
    try {
      const server = configuredSmtpServers[idx];
      if (!server) {
        toast("SMTP server niet gevonden");
        return;
      }
      
      $("#testSmtpResult").textContent = "Testen...";
      
      // Clean server object voor test (verwijder authUser referentie)
      const { authUser, ...testServer } = server;
      
      const res = await api("/admin/test-smtp-connection", {
        method: "POST",
        body: JSON.stringify(testServer)
      });
      
      if (res.ok) {
        $("#testSmtpResult").innerHTML = '<span style="color:var(--acc)">✅ Verbinding succesvol</span>';
      } else {
        $("#testSmtpResult").innerHTML = `<span style="color:var(--err)">❌ Fout: ${res.error || "Onbekende fout"}</span>`;
      }
    } catch (e) {
      console.error("Test SMTP error:", e);
      $("#testSmtpResult").innerHTML = `<span style="color:var(--err)">❌ Fout: ${e.message}</span>`;
    }
  });

  // Load settings on page load
  loadSettings();

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
  
  // Initialize routing priority sortable list
  function initRoutingPrioritySortable() {
    const list = $("#sfRoutingPriorityList");
    if (!list) return;
    
    let draggedElement = null;
    
    // Maak alle items sorteerbaar
    Array.from(list.children).forEach(item => {
      item.draggable = true;
      
      item.addEventListener("dragstart", (e) => {
        draggedElement = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/html", item.innerHTML);
      });
      
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        draggedElement = null;
      });
      
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        
        const afterElement = getDragAfterElement(list, e.clientY);
        if (afterElement == null) {
          list.appendChild(draggedElement);
        } else {
          list.insertBefore(draggedElement, afterElement);
        }
      });
      
      item.addEventListener("drop", (e) => {
        e.preventDefault();
      });
    });
  }
  
  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".routing-priority-item:not(.dragging)")];
    
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

})();

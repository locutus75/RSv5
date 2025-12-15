(function(){
  const $=s=>document.querySelector(s);
  const tbody=$("#tenantsTable tbody");
  const dot=$("#healthDot"),ht=$("#healthText");
  let name=null,data=[];
  
  // Auto-refresh timer variabele (moet bovenaan staan)
  let eventsTimer = null;
  let isInitialLoad = true; // Track eerste keer laden

  function toast(t){
    const el=$("#toast");
    el.textContent=t;
    
    // Verwijder oude type classes
    el.classList.remove("ok", "err", "info", "warn");
    
    // Bepaal type op basis van emoji of tekst
    if (t.includes("✅") || t.includes("success") || t.toLowerCase().includes("succes")) {
      el.classList.add("ok");
    } else if (t.includes("❌") || t.includes("error") || t.toLowerCase().includes("fout")) {
      el.classList.add("err");
    } else if (t.includes("ℹ️") || t.includes("info") || t.toLowerCase().includes("informatie")) {
      el.classList.add("info");
    } else if (t.includes("⚠️") || t.includes("warning") || t.toLowerCase().includes("waarschuwing")) {
      el.classList.add("warn");
    }
    
    el.classList.remove("hidden");
    // Verleng timeout naar 6 seconden voor betere leesbaarheid
    setTimeout(()=>el.classList.add("hidden"),6000);
  }

  // Custom confirm modal functie
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const modal = $("#confirmModal");
      const titleEl = $("#confirmTitle");
      const messageEl = $("#confirmMessage");
      const okBtn = $("#confirmOk");
      const cancelBtn = $("#confirmCancel");
      
      titleEl.textContent = title;
      messageEl.textContent = message;
      
      // Verwijder oude event listeners
      const newOkBtn = okBtn.cloneNode(true);
      const newCancelBtn = cancelBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOkBtn, okBtn);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      
      newOkBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
        resolve(true);
      });
      
      newCancelBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
        resolve(false);
      });
      
      // Sluit modal bij klik buiten content
      const handleModalClick = (e) => {
        if (e.target === modal) {
          modal.classList.add("hidden");
          modal.removeEventListener("click", handleModalClick);
          resolve(false);
        }
      };
      modal.addEventListener("click", handleModalClick);
      
      modal.classList.remove("hidden");
    });
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
    // Voeg cache-busting toe voor versie endpoint om altijd de nieuwste versie op te halen
    const url = p.includes("/admin/version") ? `${p}?_t=${Date.now()}` : p;
    const r = await fetch(url,{...o,headers:{...(o.headers||{}),...headers()},cache:"no-cache"});
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
      // Gebruik cache-busting om altijd de nieuwste versie op te halen
      const versionData = await api(`/admin/version?_t=${Date.now()}`);
      console.log("📦 Versie data ontvangen:", versionData);
      
      // Format versie string met buildnummer
      let versionString = `v${versionData.version}`;
      if (versionData.buildNumber) {
        versionString += ` build ${versionData.buildNumber}`;
      }
      
      console.log("📦 Versie string geformatteerd:", versionString);
      
      // Update versie in header
      const versionHeader = document.getElementById("versionHeader");
      if (versionHeader) {
        versionHeader.textContent = versionString;
        console.log("✅ Versie header bijgewerkt:", versionString);
      } else {
        console.warn("⚠️ Versie header element niet gevonden");
      }
      
      // Update versie in login overlay
      const versionLogin = document.getElementById("versionLogin");
      if (versionLogin) {
        versionLogin.textContent = versionString;
        console.log("✅ Versie login bijgewerkt:", versionString);
      } else {
        console.warn("⚠️ Versie login element niet gevonden");
      }
    } catch (error) {
      console.error("❌ Fout bij laden versie:", error);
      // Fallback naar hardcoded versie blijft staan
    }
  }

  // Update check functionaliteit
  let updateCheckData = null;

  async function checkForUpdates() {
    try {
      const checkBtn = document.getElementById("checkUpdateBtn");
      const downloadBtn = document.getElementById("downloadUpdateBtn");
      const installBtn = document.getElementById("installUpdateBtn");
      
      if (checkBtn) {
        checkBtn.classList.add("disabled");
        checkBtn.innerHTML = '<span>⏳</span> Controleren...';
      }
      
      const result = await api("/admin/update/check");
      updateCheckData = result;
      
      if (result.updateAvailable) {
        toast(`✅ Nieuwe versie beschikbaar: ${result.latestVersion} build ${result.latestBuildNumber}`);
        const downloadAndInstallBtn = document.getElementById("downloadAndInstallBtn");
        if (downloadBtn) {
          downloadBtn.classList.remove("hidden");
        }
        if (installBtn) {
          installBtn.classList.remove("hidden");
        }
        if (downloadAndInstallBtn) {
          downloadAndInstallBtn.classList.remove("hidden");
        }
      } else {
        toast("ℹ️ Je gebruikt de nieuwste versie");
        const downloadAndInstallBtn = document.getElementById("downloadAndInstallBtn");
        if (downloadBtn) {
          downloadBtn.classList.add("hidden");
        }
        if (installBtn) {
          installBtn.classList.add("hidden");
        }
        if (downloadAndInstallBtn) {
          downloadAndInstallBtn.classList.add("hidden");
        }
      }
      
      // Update update info modal als deze open is
      const updateInfoModal = document.getElementById("updateInfoModal");
      const updateInfoContent = document.getElementById("updateInfoContent");
      if (updateInfoModal && updateInfoContent && !updateInfoModal.classList.contains("hidden")) {
        updateInfoContent.innerHTML = generateUpdateInfoHTML(result);
      }
      
      if (checkBtn) {
        checkBtn.classList.remove("disabled");
        checkBtn.innerHTML = '<span>🔄</span> Controleren op updates';
      }
    } catch (error) {
      console.error("❌ Fout bij controleren op updates:", error);
      toast(`❌ Fout bij controleren op updates: ${error.message}`);
      
      const checkBtn = document.getElementById("checkUpdateBtn");
      if (checkBtn) {
        checkBtn.classList.remove("disabled");
        checkBtn.innerHTML = '<span>🔄</span> Controleren op updates';
      }
    }
  }

  async function downloadUpdate() {
    try {
      const downloadBtn = document.getElementById("downloadUpdateBtn");
      const installBtn = document.getElementById("installUpdateBtn");
      
      if (!updateCheckData || !updateCheckData.updateAvailable) {
        toast("❌ Geen update beschikbaar om te downloaden");
        return;
      }
      
      if (downloadBtn) {
        downloadBtn.classList.add("disabled");
        downloadBtn.innerHTML = '<span>⏳</span> Downloaden...';
      }
      
      // Gebruik remote manifest uit update check data
      const manifestData = updateCheckData.remoteManifest;
      
      if (!manifestData) {
        toast("❌ Geen manifest beschikbaar. Voer eerst een update check uit.");
        if (downloadBtn) {
          downloadBtn.classList.remove("disabled");
          downloadBtn.innerHTML = '<span>⬇️</span> Download update';
        }
        return;
      }
      
      const result = await api("/admin/update/download", {
        method: "POST",
        body: JSON.stringify({ manifestData: manifestData })
      });
      
      if (result.ok) {
        // Sla gedownloade bestanden op voor installatie
        updateCheckData.downloadedFiles = result.files;
        updateCheckData.downloadedManifest = result.manifestData;
        
        toast(`✅ Update gedownload: ${result.downloaded} bestanden`);
        if (installBtn) {
          installBtn.classList.remove("hidden");
        }
      } else {
        toast(`❌ Fout bij downloaden: ${result.error || result.message}`);
        if (result.downloadErrors && result.downloadErrors.length > 0) {
          console.error("Download fouten:", result.downloadErrors);
        }
      }
      
      if (downloadBtn) {
        downloadBtn.classList.remove("disabled");
        downloadBtn.innerHTML = '<span>⬇️</span> Download update';
      }
    } catch (error) {
      console.error("❌ Fout bij downloaden update:", error);
      toast(`❌ Fout bij downloaden: ${error.message}`);
      
      const downloadBtn = document.getElementById("downloadUpdateBtn");
      if (downloadBtn) {
        downloadBtn.classList.remove("disabled");
        downloadBtn.innerHTML = '<span>⬇️</span> Download update';
      }
    }
  }

  async function downloadAndInstallUpdate() {
    if (!updateCheckData || !updateCheckData.updateAvailable) {
      toast("❌ Geen update beschikbaar om te downloaden en installeren");
      return;
    }
    
    // Vraag bevestiging voor download en install
    const confirmed = await showConfirm(
      "Update downloaden en installeren",
      `Weet je zeker dat je wilt updaten naar versie ${updateCheckData.latestVersion} build ${updateCheckData.latestBuildNumber}?\n\n` +
      `De update wordt gedownload en direct geïnstalleerd.\n\n` +
      `De server moet handmatig worden herstart na installatie.`
    );
    
    if (!confirmed) {
      return;
    }
    
    try {
      const downloadAndInstallBtn = document.getElementById("downloadAndInstallBtn");
      if (downloadAndInstallBtn) {
        downloadAndInstallBtn.classList.add("disabled");
        downloadAndInstallBtn.innerHTML = '<span>⏳</span> Downloaden en installeren...';
      }
      
      // Stap 1: Download update
      await downloadUpdate();
      
      // Wacht even zodat download kan voltooien
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Controleer of download succesvol was
      if (!updateCheckData || !updateCheckData.downloadedFiles || !updateCheckData.downloadedManifest) {
        toast("❌ Download gefaald. Kan niet installeren.");
        if (downloadAndInstallBtn) {
          downloadAndInstallBtn.classList.remove("disabled");
          downloadAndInstallBtn.innerHTML = '<span>🚀</span> Download en installeer';
        }
        return;
      }
      
      // Stap 2: Installeer update (zonder extra bevestiging, gebruiker heeft al bevestigd)
      await installUpdate(true); // true = skip confirmation
      
      if (downloadAndInstallBtn) {
        downloadAndInstallBtn.classList.remove("disabled");
        downloadAndInstallBtn.innerHTML = '<span>🚀</span> Download en installeer';
      }
    } catch (error) {
      console.error("❌ Fout bij downloaden en installeren:", error);
      toast(`❌ Fout bij downloaden en installeren: ${error.message}`);
      
      const downloadAndInstallBtn = document.getElementById("downloadAndInstallBtn");
      if (downloadAndInstallBtn) {
        downloadAndInstallBtn.classList.remove("disabled");
        downloadAndInstallBtn.innerHTML = '<span>🚀</span> Download en installeer';
      }
    }
  }

  async function installUpdate(skipConfirmation = false) {
    if (!updateCheckData || !updateCheckData.updateAvailable) {
      toast("❌ Geen update beschikbaar om te installeren");
      return;
    }
    
    // Controleer of bestanden zijn gedownload
    if (!updateCheckData.downloadedFiles || !updateCheckData.downloadedManifest) {
      toast("❌ Bestanden niet gedownload. Download eerst de update.");
      return;
    }
    
    // Vraag bevestiging tenzij skipConfirmation true is
    if (!skipConfirmation) {
      const confirmed = await showConfirm(
        "Update installeren",
        `Weet je zeker dat je wilt updaten naar versie ${updateCheckData.latestVersion} build ${updateCheckData.latestBuildNumber}?\n\n` +
        `Er worden ${updateCheckData.downloadedFiles.length} bestanden geïnstalleerd.\n\n` +
        `De server moet handmatig worden herstart na installatie.`
      );
      
      if (!confirmed) {
        return;
      }
    }
    
    try {
      const installBtn = document.getElementById("installUpdateBtn");
      
      if (installBtn) {
        installBtn.classList.add("disabled");
        installBtn.innerHTML = '<span>⏳</span> Installeren...';
      }
      
      const result = await api("/admin/update/install", {
        method: "POST",
        body: JSON.stringify({
          manifestData: updateCheckData.downloadedManifest,
          files: updateCheckData.downloadedFiles
        })
      });
      
      if (result.ok) {
        toast(`✅ Update geïnstalleerd: ${result.installed} bestanden. ${result.restartMessage || 'Herstart de server handmatig.'}`);
        
        // Reset update check data
        updateCheckData = null;
        
        // Verberg download en install knoppen
        const downloadBtn = document.getElementById("downloadUpdateBtn");
        const downloadAndInstallBtn = document.getElementById("downloadAndInstallBtn");
        const checkBtn = document.getElementById("checkUpdateBtn");
        if (downloadBtn) downloadBtn.classList.add("hidden");
        if (installBtn) installBtn.classList.add("hidden");
        if (downloadAndInstallBtn) downloadAndInstallBtn.classList.add("hidden");
        if (checkBtn) {
          checkBtn.classList.remove("disabled");
          checkBtn.innerHTML = '<span>🔄</span> Controleren op updates';
        }
        
        // Herlaad pagina na 3 seconden om nieuwe versie te tonen
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        toast(`❌ Fout bij installeren: ${result.error || result.message}`);
        if (result.errors && result.errors.length > 0) {
          console.error("Installatie fouten:", result.errors);
        }
      }
      
      if (installBtn) {
        installBtn.classList.remove("disabled");
        installBtn.innerHTML = '<span>⚡</span> Installeer en activeer';
      }
    } catch (error) {
      console.error("❌ Fout bij installeren update:", error);
      toast(`❌ Fout bij installeren: ${error.message}`);
      
      const installBtn = document.getElementById("installUpdateBtn");
      if (installBtn) {
        installBtn.classList.remove("disabled");
        installBtn.innerHTML = '<span>⚡</span> Installeer en activeer';
      }
    }
  }

  async function showUpdateInfo() {
    try {
      // Toon modal
      const modal = document.getElementById("updateInfoModal");
      const content = document.getElementById("updateInfoContent");
      
      if (!modal || !content) return;
      
      modal.classList.remove("hidden");
      content.innerHTML = '<div style="text-align: center; padding: 20px;"><p class="muted">Update informatie wordt geladen...</p></div>';
      
      // Haal update check data op
      const result = await api("/admin/update/check");
      
      // Update checkData voor gebruik in andere functies
      updateCheckData = result;
      
      // Genereer HTML content
      content.innerHTML = generateUpdateInfoHTML(result);
      
    } catch (error) {
      console.error("❌ Fout bij ophalen update informatie:", error);
      const content = document.getElementById("updateInfoContent");
      if (content) {
        content.innerHTML = `
          <div style="text-align: center; padding: 20px;">
            <p style="color: var(--danger);">❌ Fout bij ophalen update informatie: ${error.message}</p>
          </div>
        `;
      }
    }
  }

  function generateUpdateInfoHTML(data) {
    if (!data) {
      return '<div style="text-align: center; padding: 20px;"><p class="muted">Geen update informatie beschikbaar</p></div>';
    }
    
    const statusIcon = data.updateAvailable ? '✨' : (data.remoteCheckError ? '⚠️' : '✅');
    const statusText = data.updateAvailable ? 'Update beschikbaar' : (data.remoteCheckError ? 'Fout bij controleren' : 'Up-to-date');
    const statusColor = data.updateAvailable ? 'var(--success)' : (data.remoteCheckError ? 'var(--danger)' : 'var(--muted)');
    
    let html = `
      <div style="display: grid; gap: 20px;">
        <!-- Status Sectie -->
        <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <span style="font-size: 24px;">${statusIcon}</span>
            <h3 style="margin: 0; color: ${statusColor};">${statusText}</h3>
          </div>
          <p style="margin: 0; color: var(--muted); font-size: 14px;">${data.message || 'Geen bericht'}</p>
        </div>
        
        <!-- Versie Informatie -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
            <h4 style="margin: 0 0 12px 0; color: var(--muted); font-size: 12px; text-transform: uppercase;">Huidige Versie</h4>
            <div style="font-size: 24px; font-weight: bold; margin-bottom: 4px;">${data.currentVersion || 'Onbekend'}</div>
            <div style="color: var(--muted); font-size: 14px;">Build ${data.currentBuildNumber || 'Onbekend'}</div>
          </div>
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
            <h4 style="margin: 0 0 12px 0; color: var(--muted); font-size: 12px; text-transform: uppercase;">Laatste Versie</h4>
            <div style="font-size: 24px; font-weight: bold; margin-bottom: 4px; color: ${data.updateAvailable ? 'var(--success)' : 'inherit'};">${data.latestVersion || 'Onbekend'}</div>
            <div style="color: var(--muted); font-size: 14px;">Build ${data.latestBuildNumber || 'Onbekend'}</div>
          </div>
        </div>
    `;
    
    // Lokaal Manifest Informatie
    if (data.localManifestValid !== null) {
      const localStatus = data.localManifestValid ? '✅' : '⚠️';
      const localStatusColor = data.localManifestValid ? 'var(--success)' : 'var(--warning)';
      
      html += `
        <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
          <h4 style="margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
            <span>${localStatus}</span>
            <span>Lokaal Manifest</span>
            <span style="color: ${localStatusColor}; font-size: 12px; margin-left: auto;">
              ${data.localManifestValid ? 'Geldig' : 'Ongeldig'}
            </span>
          </h4>
      `;
      
      if (!data.localManifestValid) {
        if (data.localManifestMissing && data.localManifestMissing.length > 0) {
          html += `
            <div style="margin-top: 12px;">
              <strong style="color: var(--danger); font-size: 13px;">Ontbrekende bestanden (${data.localManifestMissing.length}):</strong>
              <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 12px; color: var(--muted);">
                ${data.localManifestMissing.slice(0, 10).map(f => `<li>${f}</li>`).join('')}
                ${data.localManifestMissing.length > 10 ? `<li><em>... en ${data.localManifestMissing.length - 10} meer</em></li>` : ''}
              </ul>
            </div>
          `;
        }
        
        if (data.localManifestChanged && data.localManifestChanged.length > 0) {
          html += `
            <div style="margin-top: 12px;">
              <strong style="color: var(--warning); font-size: 13px;">Gewijzigde bestanden (${data.localManifestChanged.length}):</strong>
              <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 12px; color: var(--muted);">
                ${data.localManifestChanged.slice(0, 10).map(f => `<li>${typeof f === 'string' ? f : f.path}</li>`).join('')}
                ${data.localManifestChanged.length > 10 ? `<li><em>... en ${data.localManifestChanged.length - 10} meer</em></li>` : ''}
              </ul>
            </div>
          `;
        }
        
        if (data.localManifestErrors && data.localManifestErrors.length > 0) {
          html += `
            <div style="margin-top: 12px;">
              <strong style="color: var(--danger); font-size: 13px;">Fouten (${data.localManifestErrors.length}):</strong>
              <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 12px; color: var(--muted);">
                ${data.localManifestErrors.slice(0, 10).map(e => `<li>${e}</li>`).join('')}
                ${data.localManifestErrors.length > 10 ? `<li><em>... en ${data.localManifestErrors.length - 10} meer</em></li>` : ''}
              </ul>
            </div>
          `;
        }
      }
      
      html += `</div>`;
    }
    
    // Remote Check Details
    if (data.checkDetails) {
      html += `
        <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
          <h4 style="margin: 0 0 12px 0;">🔗 Configuratie Details</h4>
          <div style="display: grid; gap: 8px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Configuratie bestand:</span>
              <span style="font-family: monospace; font-size: 12px;">${data.checkDetails.configFile || 'Onbekend'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Bestand bestaat:</span>
              <span style="color: ${data.checkDetails.configExists ? 'var(--success)' : 'var(--danger)'};">
                ${data.checkDetails.configExists ? '✅ Ja' : '❌ Nee'}
              </span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Configuratie bron:</span>
              <span>${data.checkDetails.configSource || 'Geen'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Repository URL:</span>
              <span style="font-family: monospace; font-size: 11px; word-break: break-all; text-align: right; max-width: 60%;">
                ${data.checkDetails.repositoryUrl || 'Niet ingesteld'}
              </span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Manifest URL:</span>
              <span style="font-family: monospace; font-size: 11px; word-break: break-all; text-align: right; max-width: 60%;">
                ${data.checkDetails.manifestUrl || 'Niet beschikbaar'}
              </span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Gecheckt bestand:</span>
              <span style="font-family: monospace; font-size: 12px;">${data.checkDetails.checkedFile || 'update-manifest.json'}</span>
            </div>
          </div>
        </div>
      `;
    }
    
    // Remote Check Error
    if (data.remoteCheckError) {
      html += `
        <div style="background: rgba(239, 68, 68, 0.1); padding: 16px; border-radius: 8px; border: 1px solid var(--danger);">
          <h4 style="margin: 0 0 8px 0; color: var(--danger);">⚠️ Remote Check Fout</h4>
          <p style="margin: 0; color: var(--muted); font-size: 13px;">${data.remoteCheckError}</p>
        </div>
      `;
    }
    
    // Remote Manifest Informatie
    if (data.remoteManifest) {
      html += `
        <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
          <h4 style="margin: 0 0 12px 0;">📦 Remote Manifest</h4>
          <div style="display: grid; gap: 8px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Versie:</span>
              <span style="font-weight: bold;">${data.remoteManifest.version || 'Onbekend'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Build nummer:</span>
              <span>${data.remoteManifest.buildNumber || 'Onbekend'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Timestamp:</span>
              <span style="font-family: monospace; font-size: 11px;">${data.remoteManifest.timestamp || 'Onbekend'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Aantal bestanden:</span>
              <span>${data.remoteManifest.files ? data.remoteManifest.files.length : 0}</span>
            </div>
          </div>
        </div>
      `;
    }
    
    html += `</div>`;
    
    return html;
  }

  async function showVersionInfo() {
    try {
      const versionData = await api(`/admin/version?_t=${Date.now()}`);
      const versionString = versionData.buildNumber 
        ? `v${versionData.version} build ${versionData.buildNumber}`
        : `v${versionData.version}`;
      toast(`Huidige versie: ${versionString}`);
    } catch (error) {
      console.error("❌ Fout bij ophalen versie info:", error);
      toast("❌ Kon versie informatie niet ophalen");
    }
  }

  // Versie menu functionaliteit
  function setupVersionMenu() {
    const versionHeader = document.getElementById("versionHeader");
    const versionMenu = document.getElementById("versionMenu");
    
    if (!versionHeader || !versionMenu) return;
    
    // Toggle menu bij klik op versienummer
    versionHeader.addEventListener("click", (e) => {
      e.stopPropagation();
      versionMenu.classList.toggle("hidden");
    });
    
    // Sluit menu bij klik buiten menu
    document.addEventListener("click", (e) => {
      if (!versionMenu.contains(e.target) && e.target !== versionHeader) {
        versionMenu.classList.add("hidden");
      }
    });
    
    // Event listeners voor menu items
    const checkUpdateBtn = document.getElementById("checkUpdateBtn");
    const downloadUpdateBtn = document.getElementById("downloadUpdateBtn");
    const installUpdateBtn = document.getElementById("installUpdateBtn");
    // Update Info Modal handlers
    const updateInfoModal = document.getElementById("updateInfoModal");
    const updateInfoClose = document.getElementById("updateInfoClose");
    const updateInfoCloseBtn = document.getElementById("updateInfoCloseBtn");
    const updateInfoRefresh = document.getElementById("updateInfoRefresh");
    
    if (updateInfoClose) {
      updateInfoClose.addEventListener("click", () => {
        if (updateInfoModal) updateInfoModal.classList.add("hidden");
      });
    }
    
    if (updateInfoCloseBtn) {
      updateInfoCloseBtn.addEventListener("click", () => {
        if (updateInfoModal) updateInfoModal.classList.add("hidden");
      });
    }
    
    if (updateInfoRefresh) {
      updateInfoRefresh.addEventListener("click", async () => {
        await showUpdateInfo();
      });
    }
    
    // Sluit modal bij klik buiten de content
    if (updateInfoModal) {
      updateInfoModal.addEventListener("click", (e) => {
        if (e.target === updateInfoModal) {
          updateInfoModal.classList.add("hidden");
        }
      });
    }
    
    const versionInfoBtn = document.getElementById("versionInfoBtn");
    
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        versionMenu.classList.add("hidden");
        checkForUpdates();
      });
    }
    
    if (downloadUpdateBtn) {
      downloadUpdateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        versionMenu.classList.add("hidden");
        downloadUpdate();
      });
    }
    
    if (installUpdateBtn) {
      installUpdateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        versionMenu.classList.add("hidden");
        installUpdate();
      });
    }
    
    const downloadAndInstallBtn = document.getElementById("downloadAndInstallBtn");
    if (downloadAndInstallBtn) {
      downloadAndInstallBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        versionMenu.classList.add("hidden");
        downloadAndInstallUpdate();
      });
    }
    
    if (versionInfoBtn) {
      versionInfoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        versionMenu.classList.add("hidden");
        showUpdateInfo(); // Toon update info in plaats van alleen versie info
      });
    }
  }
  
  // Update Info Modal handlers
  function setupUpdateInfoModal() {
    const updateInfoModal = document.getElementById("updateInfoModal");
    const updateInfoClose = document.getElementById("updateInfoClose");
    const updateInfoCloseBtn = document.getElementById("updateInfoCloseBtn");
    const updateInfoRefresh = document.getElementById("updateInfoRefresh");
    
    if (updateInfoClose) {
      updateInfoClose.addEventListener("click", () => {
        if (updateInfoModal) updateInfoModal.classList.add("hidden");
      });
    }
    
    if (updateInfoCloseBtn) {
      updateInfoCloseBtn.addEventListener("click", () => {
        if (updateInfoModal) updateInfoModal.classList.add("hidden");
      });
    }
    
    if (updateInfoRefresh) {
      updateInfoRefresh.addEventListener("click", async () => {
        await showUpdateInfo();
      });
    }
    
    // Sluit modal bij klik buiten de content
    if (updateInfoModal) {
      updateInfoModal.addEventListener("click", (e) => {
        if (e.target === updateInfoModal) {
          updateInfoModal.classList.add("hidden");
        }
      });
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
    // Zoek naar de button element (kan direct zijn of via SVG child)
    const button = e.target.closest("button.action-btn");
    if (!button) return;
    
    const E=button.getAttribute("data-e");
    const D=button.getAttribute("data-d");
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
        set("tfBccArchive", d.policy?.bccArchive);
        set("tfIpRanges", d.routing?.ipRanges?.join("\n"));
        set("tfSenderDomains", d.routing?.senderDomains?.join("\n"));
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
        
        // Bepaal SMTP server waarde (nieuwe structuur heeft voorrang)
        const smtpServerValue = d.delivery?.smtp?.smtpServer || d.delivery?.smtpServer || "";
        
        // Update SMTP select dropdown when opening tenant modal
        if (settingsData && settingsData.service?.smtpServers) {
          updateTenantSmtpSelect(settingsData.service.smtpServers);
          // Zet de waarde NA het opbouwen van de dropdown
          if (smtpServerValue) {
            $("#tfSmtpServer").value = smtpServerValue;
          }
        } else {
          // Als settingsData nog niet geladen is, zet de waarde direct
          $("#tfSmtpServer").value = smtpServerValue;
        }
        
        // Update zichtbaarheid van Graph configuratie velden
        toggleDeliveryMethod();
        
        document.getElementById("tenantModalTitle").textContent = "Tenant bewerken";
        document.getElementById("tenantModal").classList.remove("hidden");
      }catch(e){
        toast("Fout bij laden tenant: " + e.message);
      }
    }else if(D){
      const tenantName = data.find(t => t.file === D)?.name || D;
      const confirmed = await showConfirm(
        "Tenant verwijderen",
        `Weet je zeker dat je de tenant "${tenantName}" wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.`
      );
      if(confirmed){
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
      setupVersionMenu(); // Setup versie menu functionaliteit
      setupUpdateInfoModal(); // Setup update info modal
      load(); // Dit laadt tenants
      health(); 
      loadStats(); 
      
      // Initialiseer level filter eerst zodat selectie kan worden hersteld
      if (typeof initLevelFilter === 'function') {
        initLevelFilter();
      }
      
      // Laad events na een korte delay zodat level filter selectie is hersteld
      setTimeout(() => {
        loadEvents();
      }, 150);
      
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
    const saveBtnTop = document.getElementById("saveEventColorsTop");
    const resetBtn = document.getElementById("resetEventColors");
    const configBtn = document.getElementById("eventColorConfigBtn");
    const closeBtn = document.getElementById("closeEventColorConfig");
    const closeBtnBottom = document.getElementById("closeEventColorConfigBottom");
    const modal = document.getElementById("eventColorConfigModal");
    
    if (saveBtn) {
      saveBtn.addEventListener("click", saveEventColorConfig);
    }
    
    // Top save button
    if (saveBtnTop) {
      saveBtnTop.addEventListener("click", saveEventColorConfig);
    }
    
    // Bottom close button
    if (closeBtnBottom) {
      closeBtnBottom.addEventListener("click", () => {
        if (modal) modal.classList.add("hidden");
      });
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

  // Event listeners voor event kolom zichtbaarheid configuratie
  document.addEventListener("DOMContentLoaded", () => {
    // Laad configuratie
    loadEventColumnConfig();
    applyEventColumnVisibility();
    
    // Event listeners voor knoppen
    const saveBtn = document.getElementById("saveEventColumns");
    const saveBtnTop = document.getElementById("saveEventColumnsTop");
    const resetBtn = document.getElementById("resetEventColumns");
    const configBtn = document.getElementById("eventColumnConfigBtn");
    const closeBtn = document.getElementById("closeEventColumnConfig");
    const closeBtnBottom = document.getElementById("closeEventColumnConfigBottom");
    const modal = document.getElementById("eventColumnConfigModal");
    
    if (saveBtn) {
      saveBtn.addEventListener("click", saveEventColumnConfig);
    }
    
    // Top save button
    if (saveBtnTop) {
      saveBtnTop.addEventListener("click", saveEventColumnConfig);
    }
    
    // Bottom close button
    if (closeBtnBottom) {
      closeBtnBottom.addEventListener("click", () => {
        if (modal) modal.classList.add("hidden");
      });
    }
    
    if (resetBtn) {
      resetBtn.addEventListener("click", resetEventColumnConfig);
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
    const fields = ["tfName","tfTenantId","tfClientId","tfDefaultMailbox","tfAllowedSenders","tfCertPath","tfThumbprint","tfForceFrom","tfMaxSize","tfRatePerMinute","tfRatePerHour","tfBccArchive","tfIpRanges","tfSenderDomains","tfPriority","tfTags"];
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
  
  // Tenant modal: Top save button
  $("#tenantSaveTop")?.addEventListener("click",()=>{
    $("#tenantSave").click();
  });
  
  // Tenant modal: Bottom close button
  $("#tenantCloseBottom")?.addEventListener("click",()=>{
    $("#tenantClose").click();
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

  // Event listener voor knop om server IP-adressen toe te voegen
  $("#addServerIPsBtn")?.addEventListener("click", async () => {
    try {
      const ipRangesField = $("#tfIpRanges");
      if (!ipRangesField) return;
      
      // Haal server IP-adressen op
      const response = await api("/admin/server-ips");
      const serverIPs = response.ips || [];
      
      if (serverIPs.length === 0) {
        toast("⚠️ Geen server IP-adressen gevonden");
        return;
      }
      
      // Haal huidige IP ranges op
      const currentRanges = ipRangesField.value.split("\n").map(s => s.trim()).filter(Boolean);
      const existingIPs = new Set(currentRanges);
      
      // Voeg server IP-adressen toe (alleen als ze nog niet bestaan)
      const newIPs = [];
      serverIPs.forEach(ipInfo => {
        // Converteer IP + netmask naar CIDR notatie
        const ip = ipInfo.address;
        const netmask = ipInfo.netmask;
        
        // Converteer netmask naar CIDR prefix
        let cidrPrefix = 32;
        if (netmask) {
          const parts = netmask.split('.').map(Number);
          const binary = parts.map(p => p.toString(2).padStart(8, '0')).join('');
          cidrPrefix = binary.split('1').length - 1;
        }
        
        const cidr = `${ip}/${cidrPrefix}`;
        
        // Voeg alleen toe als het nog niet bestaat
        if (!existingIPs.has(cidr) && !existingIPs.has(ip)) {
          newIPs.push(cidr);
          existingIPs.add(cidr);
        }
      });
      
      if (newIPs.length === 0) {
        toast("ℹ️ Alle server IP-adressen zijn al toegevoegd");
        return;
      }
      
      // Voeg nieuwe IP's toe aan het veld
      const updatedRanges = [...currentRanges, ...newIPs];
      ipRangesField.value = updatedRanges.join("\n");
      
      toast(`✅ ${newIPs.length} server IP-adres(sen) toegevoegd`);
    } catch (error) {
      console.error("❌ Fout bij ophalen server IP-adressen:", error);
      toast(`❌ Fout: ${error.message}`);
    }
  });

  // Helper functie om tenant data structuur te maken (gebruikt door zowel save als test)
  function buildTenantData() {
    const tenantName = $("#tfName").value.trim();
    
    // Delivery method configuratie
    const deliveryMethodRadio = document.querySelector('input[name="deliveryMethod"]:checked');
    if (!deliveryMethodRadio) {
      throw new Error("Selecteer een mail delivery method");
    }
    const deliveryMethod = deliveryMethodRadio.value;
    
    // Basis tenant object
    const tenant = {
      name: tenantName,
      senderOverrides: {},
      routing: {
        ipRanges: $("#tfIpRanges").value.split("\n").map(s=>s.trim()).filter(Boolean),
        senderDomains: $("#tfSenderDomains").value.split("\n").map(s=>s.trim()).filter(Boolean)
      },
      policy: {
        saveToSentItems: false
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
    
    return { tenant: finalTenant, deliveryMethod };
  }

  // Sla tenant data op voor test email functionaliteit
  let currentTestTenant = null;

  // Test tenant configuratie functie
  async function testTenantConfig() {
    try {
      const tenantName = $("#tfName").value.trim();
      if (!tenantName) {
        toast("Tenant naam is verplicht");
        return;
      }
      
      const { tenant, deliveryMethod } = buildTenantData();
      
      // Sla tenant data op voor test email
      currentTestTenant = tenant;
      
      // Roep test endpoint aan
      const result = await api("/admin/tenants/test", {
        method: "POST",
        body: JSON.stringify(tenant)
      });
      
      // Toon resultaten in overlay
      showTestResults(result, tenant);
    } catch (e) {
      let errorMsg = e.message;
      let errors = [];
      if (e.data?.errors && Array.isArray(e.data.errors)) {
        errors = e.data.errors.map(err => ({
          field: err.field || err.instancePath || 'Algemeen',
          message: err.message || errorMsg
        }));
      } else {
        errors = [{ field: "Algemeen", message: errorMsg }];
      }
      showTestResults({ ok: false, errors, checks: [], warnings: [] }, null);
      console.error("Tenant test error:", e, e.data);
    }
  }

  // Toon test resultaten in overlay modal
  function showTestResults(result, tenant) {
    const modal = document.getElementById("testResultModal");
    const title = document.getElementById("testResultTitle");
    const content = document.getElementById("testResultContent");
    const testEmailSection = document.getElementById("testEmailSection");
    const testEmailResult = document.getElementById("testEmailResult");
    
    if (!modal || !title || !content) {
      // Fallback naar toast als modal niet bestaat
      if (result.ok) {
        toast("✅ Configuratie is geldig!");
      } else {
        toast("❌ Configuratie bevat fouten");
      }
      return;
    }
    
    // Reset test email result
    if (testEmailResult) {
      testEmailResult.style.display = "none";
      testEmailResult.innerHTML = "";
    }
    
    // Toon test email sectie alleen als configuratie geldig is
    if (testEmailSection) {
      testEmailSection.style.display = result.ok ? "block" : "none";
    }
    
    // Vul test email velden met standaard waarden
    if (result.ok && tenant) {
      const testEmailFrom = document.getElementById("testEmailFrom");
      const testEmailTo = document.getElementById("testEmailTo");
      const testEmailSubject = document.getElementById("testEmailSubject");
      const testEmailBody = document.getElementById("testEmailBody");
      
      if (testEmailFrom && !testEmailFrom.value) {
        // Gebruik defaultMailbox of allowedSenders[0] als from
        const defaultFrom = tenant.delivery?.graph?.defaultMailbox || 
                           tenant.defaultMailbox || 
                           (tenant.allowedSenders && tenant.allowedSenders.length > 0 ? tenant.allowedSenders[0] : "");
        testEmailFrom.value = defaultFrom;
      }
      
      if (testEmailSubject && !testEmailSubject.value) {
        testEmailSubject.value = `Test Email - ${tenant.name}`;
      }
      
      if (testEmailBody && !testEmailBody.value) {
        testEmailBody.value = `Dit is een test email verzonden via de tenant configuratie "${tenant.name}".\n\nAls je deze email ontvangt, werkt de configuratie correct!`;
      }
    }
    
    // Stel titel in
    if (result.ok) {
      title.textContent = "✅ Test Geslaagd";
      title.style.color = "var(--acc)";
    } else {
      title.textContent = "❌ Test Gefaald";
      title.style.color = "var(--err)";
    }
    
    // Bouw HTML voor resultaten
    let html = "";
    
    // Status indicator
    if (result.ok) {
      html += `<div style="padding: 16px; background: rgba(34, 197, 94, 0.1); border: 1px solid var(--acc); border-radius: 8px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 24px;">✅</span>
          <strong style="color: var(--acc);">De configuratie is geldig en kan worden opgeslagen.</strong>
        </div>
      </div>`;
    } else {
      html += `<div style="padding: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid var(--err); border-radius: 8px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 24px;">❌</span>
          <strong style="color: var(--err);">De configuratie bevat fouten en moet worden gecorrigeerd voordat deze kan worden opgeslagen.</strong>
        </div>
      </div>`;
    }
    
    // Errors sectie
    if (result.errors && result.errors.length > 0) {
      html += `<div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: var(--err); font-size: 14px; font-weight: 600;">Fouten:</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">`;
      result.errors.forEach(err => {
        html += `<div style="padding: 10px; background: rgba(239, 68, 68, 0.05); border-left: 3px solid var(--err); border-radius: 4px;">
          <div style="font-weight: 600; color: var(--text); margin-bottom: 4px;">${err.field || 'Algemeen'}</div>
          <div style="color: var(--muted); font-size: 13px;">${err.message}</div>
        </div>`;
      });
      html += `</div></div>`;
    }
    
    // Warnings sectie
    if (result.warnings && result.warnings.length > 0) {
      html += `<div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: var(--warn); font-size: 14px; font-weight: 600;">Waarschuwingen:</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">`;
      result.warnings.forEach(warn => {
        html += `<div style="padding: 10px; background: rgba(234, 179, 8, 0.05); border-left: 3px solid var(--warn); border-radius: 4px;">
          <div style="font-weight: 600; color: var(--text); margin-bottom: 4px;">${warn.field || 'Algemeen'}</div>
          <div style="color: var(--muted); font-size: 13px;">${warn.message}</div>
        </div>`;
      });
      html += `</div></div>`;
    }
    
    // Checks sectie (succesvolle validaties)
    if (result.checks && result.checks.length > 0) {
      html += `<div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: var(--acc); font-size: 14px; font-weight: 600;">Gecontroleerde velden:</h4>
        <div style="display: flex; flex-direction: column; gap: 6px;">`;
      result.checks.forEach(check => {
        html += `<div style="padding: 8px 10px; background: rgba(34, 197, 94, 0.05); border-left: 3px solid var(--acc); border-radius: 4px; display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--acc); font-size: 16px;">✓</span>
          <span style="color: var(--text); font-size: 13px;">${check.message}</span>
        </div>`;
      });
      html += `</div></div>`;
    }
    
    content.innerHTML = html;
    modal.classList.remove("hidden");
  }

  // Helper functie om bestand naar base64 te converteren
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Verwijder data URL prefix (data:mime/type;base64,)
        const base64 = reader.result.split(',')[1];
        resolve({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          content: base64,
          size: file.size
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Update bijlage lijst weergave
  function updateAttachmentList() {
    const attachmentInput = document.getElementById("testEmailAttachment");
    const attachmentList = document.getElementById("testEmailAttachmentList");
    
    if (!attachmentInput || !attachmentList) return;
    
    const files = Array.from(attachmentInput.files);
    if (files.length === 0) {
      attachmentList.textContent = "";
      return;
    }
    
    const fileList = files.map((file, idx) => 
      `${idx + 1}. ${file.name} (${(file.size / 1024).toFixed(2)} KB)`
    ).join("\n");
    
    attachmentList.textContent = `${files.length} bestand(en) geselecteerd:\n${fileList}`;
    attachmentList.style.whiteSpace = "pre-line";
  }

  // Event listener voor bijlage selectie
  document.addEventListener("DOMContentLoaded", () => {
    const attachmentInput = document.getElementById("testEmailAttachment");
    if (attachmentInput) {
      attachmentInput.addEventListener("change", updateAttachmentList);
    }
  });

  // Verstuur test email
  async function sendTestEmail() {
    if (!currentTestTenant) {
      toast("Geen tenant configuratie beschikbaar voor test email");
      return;
    }
    
    const testEmailTo = document.getElementById("testEmailTo")?.value.trim();
    const testEmailFrom = document.getElementById("testEmailFrom")?.value.trim();
    const testEmailSubject = document.getElementById("testEmailSubject")?.value.trim();
    const testEmailBody = document.getElementById("testEmailBody")?.value.trim();
    const testEmailAttachment = document.getElementById("testEmailAttachment");
    const testEmailResult = document.getElementById("testEmailResult");
    const testEmailSendBtn = document.getElementById("testEmailSendBtn");
    
    if (!testEmailTo) {
      toast("Email adres 'Naar' is verplicht");
      return;
    }
    
    if (!testEmailFrom) {
      toast("Email adres 'Van' is verplicht");
      return;
    }
    
    try {
      // Disable button tijdens verzenden
      if (testEmailSendBtn) {
        testEmailSendBtn.disabled = true;
        testEmailSendBtn.textContent = "⏳ Verzenden...";
      }
      
      // Verberg vorige resultaten
      if (testEmailResult) {
        testEmailResult.style.display = "none";
      }
      
      // Lees bijlages als base64
      const attachments = [];
      if (testEmailAttachment && testEmailAttachment.files.length > 0) {
        const files = Array.from(testEmailAttachment.files);
        for (const file of files) {
          try {
            const attachment = await fileToBase64(file);
            attachments.push(attachment);
          } catch (error) {
            console.error("Fout bij lezen bijlage:", error);
            toast(`Fout bij lezen bijlage ${file.name}: ${error.message}`);
            return;
          }
        }
      }
      
      const result = await api("/admin/tenants/test-send", {
        method: "POST",
        body: JSON.stringify({
          tenant: currentTestTenant,
          testEmail: {
            from: testEmailFrom,
            to: testEmailTo,
            subject: testEmailSubject || "Test Email",
            body: testEmailBody || "Dit is een test email.",
            attachments: attachments.length > 0 ? attachments : undefined
          }
        })
      });
      
      if (result.ok) {
        if (testEmailResult) {
          testEmailResult.style.display = "block";
          testEmailResult.style.background = "rgba(34, 197, 94, 0.1)";
          testEmailResult.style.border = "1px solid var(--acc)";
          testEmailResult.style.color = "var(--acc)";
          testEmailResult.innerHTML = `✅ Test email succesvol verzonden via ${result.deliveryMethod || 'onbekend'}!`;
        }
        toast(`✅ Test email verzonden naar ${testEmailTo}`);
      } else {
        throw new Error(result.error || "Onbekende fout");
      }
    } catch (e) {
      let errorMsg = e.message;
      if (e.data?.error) {
        errorMsg = e.data.error;
      }
      
      if (testEmailResult) {
        testEmailResult.style.display = "block";
        testEmailResult.style.background = "rgba(239, 68, 68, 0.1)";
        testEmailResult.style.border = "1px solid var(--err)";
        testEmailResult.style.color = "var(--err)";
        testEmailResult.innerHTML = `❌ Fout bij verzenden: ${errorMsg}`;
      }
      toast(`❌ Fout bij verzenden: ${errorMsg}`);
      console.error("Test email error:", e, e.data);
    } finally {
      // Re-enable button
      if (testEmailSendBtn) {
        testEmailSendBtn.disabled = false;
        testEmailSendBtn.textContent = "📧 Verstuur Test Email";
      }
    }
  }

  // Event listeners voor test knoppen
  $("#tenantTestTop")?.addEventListener("click", testTenantConfig);
  $("#tenantTestBottom")?.addEventListener("click", testTenantConfig);
  
  // Event listeners voor test result modal
  $("#testResultClose")?.addEventListener("click", () => {
    document.getElementById("testResultModal")?.classList.add("hidden");
  });
  $("#testResultCloseBottom")?.addEventListener("click", () => {
    document.getElementById("testResultModal")?.classList.add("hidden");
  });
  
  // Event listener voor test email verzenden
  $("#testEmailSendBtn")?.addEventListener("click", sendTestEmail);
  
  // Sluit modal bij klik buiten de content
  const testResultModal = document.getElementById("testResultModal");
  if (testResultModal) {
    testResultModal.addEventListener("click", (e) => {
      if (e.target === testResultModal) {
        testResultModal.classList.add("hidden");
      }
    });
  }

  $("#tenantSave").addEventListener("click",async()=>{
    try{
      const tenantName = $("#tfName").value.trim();
      if (!tenantName) {
        toast("Tenant naam is verplicht");
        return;
      }
      
      const { tenant: finalTenant, deliveryMethod } = buildTenantData();
      
      // Validatie: controleer of de actieve delivery method correct is geconfigureerd
      if (deliveryMethod === "smtp") {
        const smtpServer = finalTenant.delivery?.smtp?.smtpServer;
        if (!smtpServer) {
          toast("Selecteer een SMTP server voor SMTP delivery");
          return;
        }
      } else {
        // Graph API - controleer of alle verplichte velden zijn ingevuld
        const graphConfig = finalTenant.delivery?.graph || {};
        if (!graphConfig.tenantId || !graphConfig.clientId || !graphConfig.auth || !graphConfig.defaultMailbox) {
          toast("Voor Graph API zijn Tenant ID, Client ID, Default Mailbox, Cert Path en Thumbprint verplicht");
          return;
        }
      }
      
      console.log("📝 Tenant data voor opslaan:", JSON.stringify(finalTenant, null, 2));
      console.log("📝 Delivery method:", deliveryMethod);

      const name = tenantName;
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
  let editingSmtpIndex = null; // null = nieuwe server, number = index van te bewerken server

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
      const hasAuth = server.auth && server.auth.user && server.auth.pass;
      const authInfo = hasAuth 
        ? ` [Auth: ${server.authUser || server.auth.user}]` 
        : ` <span style="color:var(--warn)">[Geen authenticatie]</span>`;
      const tlsInfo = server.requireTLS ? ` [STARTTLS vereist]` : "";
      const isEditing = editingSmtpIndex === index;
      li.innerHTML = `
        <div>
          <strong>${server.naam}</strong> 
          <span class="muted">(${server.adres}:${server.poort}${authInfo}${tlsInfo})</span>
          ${isEditing ? '<span class="muted" style="margin-left: 8px;">[Wordt bewerkt]</span>' : ''}
        </div>
        <div class="actions">
          <button class="secondary small edit-smtp" data-index="${index}">Bewerken</button>
          <button class="secondary small delete-smtp" data-index="${index}">Verwijder</button>
        </div>
      `;
      list.appendChild(li);
    });

    // Add edit handlers
    list.querySelectorAll(".edit-smtp").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.index);
        editSmtpServer(idx);
      });
    });

    // Add delete handlers
    list.querySelectorAll(".delete-smtp").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const idx = parseInt(e.target.closest("button").dataset.index);
        const server = configuredSmtpServers[idx];
        if (!server) return;
        
        const confirmed = await showConfirm(
          "SMTP Server verwijderen",
          `Weet je zeker dat je de SMTP server "${server.naam}" wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.`
        );
        
        if (confirmed) {
          configuredSmtpServers.splice(idx, 1);
          editingSmtpIndex = null; // Reset editing state als server wordt verwijderd
          resetSmtpForm();
          renderSmtpList();
          toast("SMTP server verwijderd");
        }
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
    $("#sfEnableDebug").checked = svc.enableDebug === true;
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
    editingSmtpIndex = null; // Reset editing state bij laden
    resetSmtpForm();
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
      btn.addEventListener("click", async (e) => {
        const idx = parseInt(e.target.closest("button").dataset.index);
        const deletedUser = configuredAuthUsers[idx];
        if (!deletedUser) return;
        
        const confirmed = await showConfirm(
          "Authenticatie Gebruiker verwijderen",
          `Weet je zeker dat je de gebruiker "${deletedUser.username}" wilt verwijderen? SMTP servers die deze gebruiker gebruiken zullen hun authenticatie verliezen.`
        );
        
        if (confirmed) {
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
          toast("Authenticatie gebruiker verwijderd");
        }
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
      // Verwijder oude listeners om duplicates te voorkomen
      const newRequireAuth = requireAuth.cloneNode(true);
      requireAuth.parentNode.replaceChild(newRequireAuth, requireAuth);
      newRequireAuth.addEventListener("change", () => {
        sel.style.display = newRequireAuth.checked ? "block" : "none";
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
      resetSmtpForm(); // Reset editing state bij openen modal
      document.getElementById("settingsModal").classList.remove("hidden");
    }catch(e){
      toast("Fout bij laden settings: " + e.message);
    }
  });

  $("#settingsClose").addEventListener("click",()=>{
    resetSmtpForm();
    document.getElementById("settingsModal").classList.add("hidden");
  });
  
  // Settings modal: Top save button
  $("#settingsSaveTop")?.addEventListener("click",()=>{
    $("#settingsSave").click();
  });
  
  // Settings modal: Bottom close button
  $("#settingsCloseBottom")?.addEventListener("click",()=>{
    $("#settingsClose").click();
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
          enableDebug: $("#sfEnableDebug").checked,
          smtpServers: cleanSmtpServers,
          authUsers: configuredAuthUsers
        }
      };

      await api("/admin/config", {method: "PUT", body: JSON.stringify(config)});
      toast("Settings opgeslagen");
      resetSmtpForm();
      document.getElementById("settingsModal").classList.add("hidden");
      await loadSettings();
      // Herlaad events om debug filter direct toe te passen
      try{loadEvents();}catch{}
    }catch(e){
      toast("Fout bij opslaan settings: " + e.message);
    }
  });

  function editSmtpServer(index) {
    const server = configuredSmtpServers[index];
    if (!server) return;
    
    editingSmtpIndex = index;
    
    // Vul formuliervelden met bestaande waarden
    $("#newSmtpName").value = server.naam || "";
    $("#newSmtpAdres").value = server.adres || "";
    $("#newSmtpPoort").value = server.poort || "";
    $("#newSmtpRequireAuth").checked = !!server.auth;
    $("#newSmtpAuthUser").value = server.authUser || server.auth?.user || "";
    $("#newSmtpAuthUser").style.display = server.auth ? "block" : "none";
    $("#newSmtpRequireTLS").checked = server.requireTLS === true;
    
    // Update knop tekst en voeg annuleer knop toe
    updateSmtpFormButtons();
    renderSmtpList();
  }
  
  function resetSmtpForm() {
    editingSmtpIndex = null;
    $("#newSmtpName").value = "";
    $("#newSmtpAdres").value = "";
    $("#newSmtpPoort").value = "";
    $("#newSmtpRequireAuth").checked = false;
    $("#newSmtpAuthUser").value = "";
    $("#newSmtpAuthUser").style.display = "none";
    $("#newSmtpRequireTLS").checked = false;
    updateSmtpFormButtons();
  }
  
  function updateSmtpFormButtons() {
    const btn = $("#addSmtpServerBtn");
    const formLabel = document.querySelector('.smtp-form label');
    
    if (editingSmtpIndex !== null) {
      btn.textContent = "Bijwerken";
      if (formLabel) {
        formLabel.textContent = "Server Bewerken";
      }
      
      // Voeg annuleer knop toe als deze nog niet bestaat
      let cancelBtn = document.getElementById("cancelSmtpEditBtn");
      if (!cancelBtn) {
        cancelBtn = document.createElement("button");
        cancelBtn.id = "cancelSmtpEditBtn";
        cancelBtn.className = "ghost small";
        cancelBtn.textContent = "Annuleren";
        cancelBtn.addEventListener("click", () => {
          resetSmtpForm();
          renderSmtpList();
        });
        const btnContainer = btn.parentElement;
        btnContainer.insertBefore(cancelBtn, btn);
      }
      cancelBtn.style.display = "inline-block";
    } else {
      btn.textContent = "Toevoegen";
      if (formLabel) {
        formLabel.textContent = "Nieuwe Server Toevoegen";
      }
      
      // Verberg annuleer knop
      const cancelBtn = document.getElementById("cancelSmtpEditBtn");
      if (cancelBtn) {
        cancelBtn.style.display = "none";
      }
    }
  }

  // Add SMTP Server Button Handler (ook voor bijwerken)
  $("#addSmtpServerBtn").addEventListener("click", () => {
    const naam = $("#newSmtpName").value.trim();
    const adres = $("#newSmtpAdres").value.trim();
    const poort = parseInt($("#newSmtpPoort").value);
    const requireAuth = $("#newSmtpRequireAuth").checked;
    const authUser = $("#newSmtpAuthUser").value;
    const requireTLS = $("#newSmtpRequireTLS").checked;
    
    if (!naam || !adres || !poort) {
      toast("Naam, Adres en Poort zijn verplicht");
      return;
    }

    if (requireAuth && !authUser) {
      toast("Selecteer een gebruiker voor authenticatie");
      return;
    }

    const serverData = {
      naam,
      adres,
      poort
    };
    
    // Voeg requireTLS toe als het is aangevinkt
    if (requireTLS) {
      serverData.requireTLS = true;
    }
    
    if (requireAuth && authUser) {
      const user = configuredAuthUsers.find(u => u.username === authUser);
      if (user) {
        serverData.auth = {
          user: user.username,
          pass: user.password
        };
        serverData.authUser = user.username; // Voor referentie in UI
      }
    }

    if (editingSmtpIndex !== null) {
      // Bijwerken van bestaande server
      configuredSmtpServers[editingSmtpIndex] = serverData;
      toast("SMTP server bijgewerkt");
    } else {
      // Nieuwe server toevoegen
      configuredSmtpServers.push(serverData);
      toast("SMTP server toegevoegd");
    }
    
    resetSmtpForm();
    renderSmtpList();
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
        const authStatus = res.authUsed 
          ? " met authenticatie" 
          : " zonder authenticatie";
        $("#testSmtpResult").innerHTML = `<span style="color:var(--acc)">✅ Verbinding succesvol${authStatus}</span>`;
      } else {
        let errorMsg = res.error || "Onbekende fout";
        // Voeg waarschuwing toe als authenticatie mogelijk nodig is
        const hasAuth = testServer.auth && testServer.auth.user && testServer.auth.pass;
        if (!hasAuth && (errorMsg.includes('authentication') || errorMsg.includes('530') || errorMsg.includes('535'))) {
          errorMsg += '<br><span style="color:var(--warn); font-size:0.9em;">💡 Tip: Deze server vereist mogelijk authenticatie. Voeg een authenticatie gebruiker toe aan de SMTP server configuratie.</span>';
        }
        $("#testSmtpResult").innerHTML = `<span style="color:var(--err)">❌ Fout: ${errorMsg}</span>`;
      }
    } catch (e) {
      console.error("Test SMTP error:", e);
      $("#testSmtpResult").innerHTML = `<span style="color:var(--err)">❌ Fout: ${e.message}</span>`;
    }
  });

  // Load settings on page load
  loadSettings();

  // Chart modal handlers
  let currentChartTenant = null;
  
  const closeChart = () => {
    document.getElementById("chartModal").classList.add("hidden");
    currentChartTenant = null;
  };
  
  $("#closeChart")?.addEventListener("click", closeChart);
  $("#closeChartTop")?.addEventListener("click", closeChart);
  $("#closeChartBottom")?.addEventListener("click", closeChart);
  
  // Chart window change handler
  $("#chartWindow")?.addEventListener("change", () => {
    if (currentChartTenant) {
      loadChart(currentChartTenant);
    }
  });
  
  // Laad en render chart data
  async function loadChart(tenantName) {
    try {
      currentChartTenant = tenantName;
      const chartWindow = document.getElementById("chartWindow")?.value || "24h";
      const chartBody = document.getElementById("chartBody");
      
      if (!chartBody) return;
      
      // Toon loading
      chartBody.innerHTML = "<div style='text-align: center; padding: 40px; color: var(--muted);'>Laden...</div>";
      
      const chartData = await api(`/admin/stats/chart?window=${encodeURIComponent(chartWindow)}${tenantName ? `&tenant=${encodeURIComponent(tenantName)}` : ""}`);
      
      console.log("📊 Chart data ontvangen:", {
        buckets: chartData.buckets?.length || 0,
        window: chartData.window,
        tenant: chartData.tenant,
        sampleBucket: chartData.buckets?.[0]
      });
      
      if (!chartData.buckets || chartData.buckets.length === 0) {
        chartBody.innerHTML = "<div style='text-align: center; padding: 40px; color: var(--muted);'>Geen data beschikbaar voor de geselecteerde periode.</div>";
        return;
      }
      
      // Debug: toon totale aantallen
      const totalSent = chartData.buckets.reduce((sum, b) => sum + (b.sent || 0), 0);
      const totalErrors = chartData.buckets.reduce((sum, b) => sum + (b.errors || 0), 0);
      console.log(`📊 Chart totals: ${totalSent} verzonden, ${totalErrors} errors`);
      
      renderChart(chartBody, chartData.buckets, tenantName || "Alle tenants");
    } catch (e) {
      const chartBody = document.getElementById("chartBody");
      if (chartBody) {
        chartBody.innerHTML = `<div style='text-align: center; padding: 40px; color: var(--err);'>Fout bij laden chart: ${e.message}</div>`;
      }
      console.error("Chart load error:", e);
    }
  }
  
  // Render SVG chart
  function renderChart(container, buckets, title) {
    if (!buckets || buckets.length === 0) {
      container.innerHTML = "<div style='text-align: center; padding: 40px; color: var(--muted);'>Geen data beschikbaar.</div>";
      return;
    }
    
    const width = 800;
    const height = 300;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Bepaal max waarde voor schaling
    const maxSent = Math.max(...buckets.map(b => b.sent), 0);
    const maxErrors = Math.max(...buckets.map(b => b.errors), 0);
    const actualMax = Math.max(maxSent, maxErrors);
    
    // Rond max waarde af naar boven naar een mooie waarde voor Y-as
    let maxValue = 10; // Minimum schaal
    if (actualMax > 0) {
      if (actualMax <= 10) {
        maxValue = 10;
      } else if (actualMax <= 50) {
        maxValue = Math.ceil(actualMax / 10) * 10;
      } else if (actualMax <= 100) {
        maxValue = Math.ceil(actualMax / 20) * 20;
      } else if (actualMax <= 500) {
        maxValue = Math.ceil(actualMax / 50) * 50;
      } else if (actualMax <= 1000) {
        maxValue = Math.ceil(actualMax / 100) * 100;
      } else {
        maxValue = Math.ceil(actualMax / 500) * 500;
      }
    }
    
    // Genereer punten voor sent en errors
    const sentPoints = [];
    const errorPoints = [];
    
    buckets.forEach((bucket, i) => {
      const x = padding.left + (i / Math.max(buckets.length - 1, 1)) * chartWidth;
      // Bereken Y positie (0 is onderaan, maxValue is bovenaan)
      const sentY = padding.top + chartHeight - (bucket.sent / maxValue) * chartHeight;
      const errorY = padding.top + chartHeight - (bucket.errors / maxValue) * chartHeight;
      
      sentPoints.push(`${x},${sentY}`);
      errorPoints.push(`${x},${errorY}`);
    });
    
    // Format tijd labels
    const timeLabels = [];
    const labelCount = Math.min(8, buckets.length);
    for (let i = 0; i < labelCount; i++) {
      const index = Math.floor((i / Math.max(labelCount - 1, 1)) * Math.max(buckets.length - 1, 0));
      const bucket = buckets[index];
      const date = new Date(bucket.time);
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      
      let label;
      if (buckets.length <= 24) {
        label = `${hours}:${minutes}`;
      } else {
        label = `${day}/${month} ${hours}:${minutes}`;
      }
      
      const x = padding.left + (index / Math.max(buckets.length - 1, 1)) * chartWidth;
      timeLabels.push({ x, label });
    }
    
    // Genereer grid lines met mooie afgeronde waarden
    const gridLines = [];
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (i / gridCount) * chartHeight;
      const value = Math.round((maxValue - (i / gridCount) * maxValue));
      gridLines.push({ y, value });
    }
    
    // Bouw SVG met zichtbare lijnen
    const svg = `
      <svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <!-- Grid lines -->
        ${gridLines.map(g => `
          <line class="grid" x1="${padding.left}" y1="${g.y}" x2="${width - padding.right}" y2="${g.y}"/>
          <text x="${padding.left - 10}" y="${g.y + 4}" text-anchor="end" class="axis" font-size="11">${g.value}</text>
        `).join("")}
        
        <!-- Axes -->
        <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke-width="1.5"/>
        <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke-width="1.5"/>
        
        <!-- Sent line (groen) -->
        ${sentPoints.length > 0 ? `
          <path d="M ${sentPoints.join(" L ")}" stroke="#22c55e" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          ${sentPoints.map((p, i) => {
            const [x, y] = p.split(",");
            return `<circle cx="${x}" cy="${y}" r="3.5" fill="#22c55e" stroke="#0f172a" stroke-width="1"/>`;
          }).join("")}
        ` : ""}
        
        <!-- Errors line (rood) -->
        ${errorPoints.length > 0 ? `
          <path d="M ${errorPoints.join(" L ")}" stroke="#ef4444" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          ${errorPoints.map((p, i) => {
            const [x, y] = p.split(",");
            return `<circle cx="${x}" cy="${y}" r="3.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/>`;
          }).join("")}
        ` : ""}
        
        <!-- Time labels -->
        ${timeLabels.map(t => `
          <text x="${t.x}" y="${height - padding.bottom + 20}" text-anchor="middle" class="axis" font-size="11">${t.label}</text>
        `).join("")}
        
        <!-- Legend -->
        <g transform="translate(${width - padding.right - 120}, ${padding.top + 10})">
          <line x1="0" y1="0" x2="20" y2="0" stroke="#22c55e" stroke-width="2.5"/>
          <text x="25" y="4" class="axis" font-size="12">Verzonden</text>
          <line x1="0" y1="15" x2="20" y2="15" stroke="#ef4444" stroke-width="2.5"/>
          <text x="25" y="19" class="axis" font-size="12">Errors</text>
        </g>
      </svg>
      <div style="margin-top: 16px; padding: 12px; background: rgba(59, 130, 246, 0.05); border-radius: 8px; border: 1px solid var(--border);">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; font-size: 13px;">
          <div>
            <strong style="color: var(--acc);">Totaal Verzonden:</strong>
            <div style="color: var(--text); margin-top: 4px;">${buckets.reduce((sum, b) => sum + b.sent, 0)}</div>
          </div>
          <div>
            <strong style="color: var(--err);">Totaal Errors:</strong>
            <div style="color: var(--text); margin-top: 4px;">${buckets.reduce((sum, b) => sum + b.errors, 0)}</div>
          </div>
        </div>
      </div>
    `;
    
    container.innerHTML = svg;
  }

  // Export CSV
  $("#exportStatsCsv").addEventListener("click",()=>{
    const csv = [
      ["Tenant", "Verzonden", "Success", "Errors", "Trend"],
      ...data.map(t => {
        const success = Math.max(0, (t.sent || 0) - (t.errors || 0));
        return [t.name || "(naamloos)", t.sent || 0, success, t.errors || 0, ""];
      })
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

  // Reset stats
  $("#resetStats")?.addEventListener("click", async () => {
    try {
      const confirmed = await showConfirm(
        "Statistieken Resetten",
        "Weet je zeker dat je de statistieken wilt resetten? Alle statistieken vanaf nu worden opnieuw geteld vanaf dit moment."
      );
      
      if (!confirmed) {
        return;
      }
      
      const result = await api("/admin/stats/reset", { method: "POST" });
      
      if (result.ok) {
        toast("✅ Statistieken succesvol gereset");
        // Herlaad statistieken om de reset tijd te tonen
        await loadStats();
      } else {
        toast(`❌ Fout bij resetten: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error("❌ Fout bij resetten statistieken:", error);
      toast(`❌ Fout bij resetten: ${error.message}`);
    }
  });

  // Refresh events
  $("#refreshEvents").addEventListener("click",()=>{
    try{loadEvents();}catch{}
  });

  // Reset logs
  $("#resetLogs")?.addEventListener("click", async () => {
    try {
      const confirmed = await showConfirm(
        "Logs Resetten",
        "Weet je zeker dat je de logs wilt resetten? Het log bestand wordt geleegd en er wordt een backup gemaakt. Alle events worden verwijderd."
      );
      
      if (!confirmed) {
        return;
      }
      
      const result = await api("/admin/logs/reset", { method: "POST" });
      
      if (result.ok) {
        toast("✅ Logs succesvol gereset");
        // Update reset tijd weergave
        await updateLogResetTime();
        // Herlaad events (zou nu leeg moeten zijn)
        await loadEvents();
      } else {
        toast(`❌ Fout bij resetten: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error("❌ Fout bij resetten logs:", error);
      toast(`❌ Fout bij resetten: ${error.message}`);
    }
  });

  // Functie om log reset tijd op te halen en weer te geven
  async function updateLogResetTime() {
    try {
      const r = await api("/admin/logs/reset-time");
      const resetTimeEl = document.getElementById("logsResetTime");
      if (resetTimeEl && r.lastReset) {
        const resetDate = new Date(r.lastReset);
        const formattedDate = resetDate.toLocaleString('nl-NL', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        resetTimeEl.textContent = `(gereset: ${formattedDate})`;
      } else if (resetTimeEl) {
        resetTimeEl.textContent = '';
      }
    } catch (error) {
      console.error("❌ Fout bij ophalen log reset tijd:", error);
    }
  }

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
      const headers = ["Timestamp", "Level", "Reason", "Tenant", "From", "Recipient Count", "Size (KB)", "Remote IP", "Message/Error"];
      
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
        const remoteIP = ev.remoteIP || "";
        const info = (ev.message || ev.error || "").replace(/"/g, '""'); // Escape quotes
        
        const row = [
          `"${ts}"`,
          `"${level}"`,
          `"${reason}"`,
          `"${tenant}"`,
          `"${from}"`,
          `"${rcptCount}"`,
          `"${sizeKB}"`,
          `"${remoteIP}"`,
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

  // Multiselect level filter - Globale functies
  let levelFilterWrapper, levelFilterTrigger, levelFilterDropdown, levelFilterText;
  let levelFilterInitialized = false;
  
  // Functie om geselecteerde levels op te slaan in localStorage
  function saveLevelFilterSelection() {
    const levelCheckboxes = document.querySelectorAll(".level-checkbox");
    const selected = Array.from(levelCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    localStorage.setItem("eventsLevelFilter", JSON.stringify(selected));
  }
  
  // Functie om geselecteerde levels te herstellen uit localStorage
  function restoreLevelFilterSelection() {
    try {
      const saved = localStorage.getItem("eventsLevelFilter");
      const levelCheckboxes = document.querySelectorAll(".level-checkbox");
      
      if (saved && levelCheckboxes.length > 0) {
        const selectedLevels = JSON.parse(saved);
        levelCheckboxes.forEach(checkbox => {
          checkbox.checked = selectedLevels.includes(checkbox.value);
        });
        updateLevelFilterText();
      } else if (levelCheckboxes.length > 0) {
        // Geen opgeslagen selectie, reset alle checkboxes
        levelCheckboxes.forEach(checkbox => {
          checkbox.checked = false;
        });
        updateLevelFilterText();
      }
    } catch (e) {
      console.error("❌ Fout bij herstellen level filter:", e);
    }
  }
  
  // Functie om level filter text bij te werken
  function updateLevelFilterText() {
    const levelCheckboxes = document.querySelectorAll(".level-checkbox");
    const selected = Array.from(levelCheckboxes).filter(cb => cb.checked);
    
    if (!levelFilterText) {
      levelFilterText = document.getElementById("eventsLevelFilterText");
    }
    
    if (!levelFilterText) return;
    
    if (selected.length === 0) {
      levelFilterText.textContent = "Alle niveaus";
    } else if (selected.length === 1) {
      levelFilterText.textContent = selected[0].value;
    } else {
      levelFilterText.textContent = `${selected.length} niveaus`;
    }
  }
  
  // Initialiseer multiselect
  function initLevelFilter() {
    // Voorkom dubbele initialisatie
    if (levelFilterInitialized) {
      console.log("⚠️ Level filter al geïnitialiseerd, skip");
      return;
    }
    
    levelFilterWrapper = document.querySelector(".multiselect-wrapper");
    levelFilterTrigger = document.getElementById("eventsLevelFilterTrigger");
    levelFilterDropdown = document.getElementById("eventsLevelFilterDropdown");
    levelFilterText = document.getElementById("eventsLevelFilterText");
    
    if (!levelFilterTrigger || !levelFilterDropdown) {
      console.warn("⚠️ Level filter elementen niet gevonden");
      return;
    }
    
    // Herstel geselecteerde levels bij het laden
    restoreLevelFilterSelection();
    
    // Toggle dropdown
    levelFilterTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isActive = levelFilterWrapper.classList.contains("active");
      levelFilterWrapper.classList.toggle("active");
      levelFilterDropdown.classList.toggle("hidden");
      console.log("🔍 Dropdown toggle:", !isActive ? "open" : "sluiten");
    });
    
    // Sluit dropdown bij klik buiten
    document.addEventListener("click", (e) => {
      if (levelFilterWrapper && !levelFilterWrapper.contains(e.target)) {
        levelFilterWrapper.classList.remove("active");
        levelFilterDropdown.classList.add("hidden");
      }
    });
    
    // Update text en laad events bij checkbox change
    // Gebruik event delegation op de dropdown container
    levelFilterDropdown.addEventListener("change", (e) => {
      if (e.target.classList.contains("level-checkbox")) {
        saveLevelFilterSelection();
        updateLevelFilterText();
        isInitialLoad = false;
        try{loadEvents();}catch{}
      }
    });
    
    levelFilterInitialized = true;
    console.log("✅ Level filter geïnitialiseerd");
  }
  
  // Initialiseer multiselect wanneer DOM klaar is
  // Deze functie wordt ook aangeroepen vanuit initializeApp
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initLevelFilter();
    });
  } else {
    // DOM is al geladen - wordt aangeroepen vanuit initializeApp
  }

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
      
      // Update reset tijd weergave
      const resetTimeEl = document.getElementById("statsResetTime");
      if (resetTimeEl && r.lastReset) {
        const resetDate = new Date(r.lastReset);
        const formattedDate = resetDate.toLocaleString('nl-NL', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        resetTimeEl.textContent = `(gereset: ${formattedDate})`;
      } else if (resetTimeEl) {
        resetTimeEl.textContent = '';
      }
      
      const tbody = document.querySelector("#statsTable tbody");
      if (!tbody) return;
      
      const entries = Object.entries(r.tenants || {})
        .filter(([name, agg]) => name !== "unknown" && name !== "Unknown" && name !== "")
        .sort((a,b)=> (b[1].sent+b[1].errors)-(a[1].sent+a[1].errors));
      if(entries.length===0){ 
        tbody.innerHTML = "<tr><td colspan='6' class='muted'>Geen data</td></tr>"; 
        return; 
      }
      
      if (tbody.children.length === 0) {
        for(const [name, agg] of entries){
          const tr = document.createElement("tr");
          // Trend kolom - knop om chart te openen
          const trendCell = document.createElement("td");
          const trendBtn = document.createElement("button");
          trendBtn.className = "ghost";
          trendBtn.style.padding = "4px 8px";
          trendBtn.style.fontSize = "12px";
          trendBtn.title = "Bekijk trend";
          trendBtn.innerHTML = "📈";
          trendBtn.addEventListener("click", () => {
            // Open chart modal voor deze tenant
            const chartTitle = document.getElementById("chartTitle");
            const chartModal = document.getElementById("chartModal");
            if (chartTitle) chartTitle.textContent = `Trend - ${name}`;
            if (chartModal) {
              chartModal.classList.remove("hidden");
              loadChart(name);
            }
          });
          trendCell.appendChild(trendBtn);
          
          // Acties kolom - knoppen voor acties
          const actionsCell = document.createElement("td");
          actionsCell.className = "actions-cell";
          actionsCell.style.textAlign = "right";
          
          // Filter events knop
          const filterBtn = document.createElement("button");
          filterBtn.className = "action-btn ghost";
          filterBtn.title = "Filter events op deze tenant";
          filterBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
          </svg>`;
          filterBtn.addEventListener("click", () => {
            const tenantFilter = document.querySelector("#tenantFilterEvents");
            if (tenantFilter) {
              tenantFilter.value = name;
              tenantFilter.dispatchEvent(new Event("change"));
              // Scroll naar events sectie
              document.getElementById("eventsCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          });
          actionsCell.appendChild(filterBtn);
          
          const success = Math.max(0, (agg.sent || 0) - (agg.errors || 0));
          tr.innerHTML = `
            <td>${name}</td>
            <td>${agg.sent || 0}</td>
            <td><span style='color:#86efac'>${success}</span></td>
            <td>${agg.errors>0?`<span style='color:#ef4444'>${agg.errors}</span>`:agg.errors || 0}</td>
          `;
          tr.appendChild(trendCell);
          tr.appendChild(actionsCell);
          tbody.appendChild(tr);
        }
      } else {
        const existingRows = Array.from(tbody.children);
        entries.forEach(([name, agg], index) => {
          if (existingRows[index]) {
            const cells = existingRows[index].children;
            // Update alleen de data kolommen (Tenant naam kan veranderen)
            if (cells[0].textContent !== name) {
              cells[0].textContent = name;
            }
            cells[1].textContent = agg.sent || 0;
            const success = Math.max(0, (agg.sent || 0) - (agg.errors || 0));
            cells[2].innerHTML = `<span style='color:#86efac'>${success}</span>`;
            cells[3].innerHTML = agg.errors>0?`<span style='color:#ef4444'>${agg.errors}</span>`:agg.errors || 0;
            // Trend en Acties kolommen (cells[4] en cells[5]) blijven behouden
          } else {
            // Nieuwe rij toevoegen
            const tr = document.createElement("tr");
            const trendCell = document.createElement("td");
            const trendBtn = document.createElement("button");
            trendBtn.className = "ghost";
            trendBtn.style.padding = "4px 8px";
            trendBtn.style.fontSize = "12px";
            trendBtn.title = "Bekijk trend";
            trendBtn.innerHTML = "📈";
            trendBtn.addEventListener("click", () => {
              const chartTitle = document.getElementById("chartTitle");
              const chartModal = document.getElementById("chartModal");
              if (chartTitle) chartTitle.textContent = `Trend - ${name}`;
              if (chartModal) {
                chartModal.classList.remove("hidden");
                loadChart(name);
              }
            });
            trendCell.appendChild(trendBtn);
            
            const actionsCell = document.createElement("td");
            actionsCell.className = "actions-cell";
            actionsCell.style.textAlign = "right";
            
            // Filter events knop
            const filterBtn = document.createElement("button");
            filterBtn.className = "action-btn ghost";
            filterBtn.title = "Filter events op deze tenant";
            filterBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>`;
            filterBtn.addEventListener("click", () => {
              const tenantFilter = document.querySelector("#tenantFilterEvents");
              if (tenantFilter) {
                tenantFilter.value = name;
                tenantFilter.dispatchEvent(new Event("change"));
                // Scroll naar events sectie
                document.getElementById("eventsCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            });
            actionsCell.appendChild(filterBtn);
            
            const success = Math.max(0, (agg.sent || 0) - (agg.errors || 0));
            tr.innerHTML = `
              <td>${name}</td>
              <td>${agg.sent || 0}</td>
              <td><span style='color:#86efac'>${success}</span></td>
              <td>${agg.errors>0?`<span style='color:#ef4444'>${agg.errors}</span>`:agg.errors || 0}</td>
            `;
            tr.appendChild(trendCell);
            tr.appendChild(actionsCell);
            tbody.appendChild(tr);
          }
        });
        
        while (tbody.children.length > entries.length) {
          tbody.removeChild(tbody.lastChild);
        }
      }
      
    }catch(e){
      const tbody = document.querySelector("#statsTable tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan='6'>Fout: ${e.message}</td></tr>`;
    }
  }

  async function loadEvents(){
    try{
      // Update log reset tijd weergave
      await updateLogResetTime();
      
      const authStatus = await api("/admin/auth-status");
      
      if (authStatus.requiresAuth) {
        const frontendToken = localStorage.getItem("adminToken");
        
        if (!frontendToken) {
          const tbody = document.querySelector("#eventsTable tbody");
          if (tbody) {
            tbody.innerHTML = "<tr><td colspan='9' class='muted'>🔐 Authenticatie vereist</td></tr>";
          }
          return;
        }
      }
      
      const t = document.querySelector("#tenantFilterEvents")?.value?.trim() || "";
      // Bij eerste keer laden: laad alle events (10000), anders gebruik de geselecteerde limiet
      const limit = isInitialLoad ? "10000" : (document.querySelector("#eventsLimit")?.value || "200");
      const reason = document.querySelector("#eventsReasonFilter")?.value || "all";
      
      // Haal geselecteerde levels op uit checkboxes
      const levelCheckboxes = document.querySelectorAll(".level-checkbox:checked");
      const selectedLevels = Array.from(levelCheckboxes).map(cb => cb.value);
      const levelParam = selectedLevels.length > 0 ? selectedLevels.join(",") : "all";
      
      // Toon loading overlay bij eerste keer laden
      const loadingOverlay = document.getElementById("eventsLoadingOverlay");
      if (isInitialLoad && loadingOverlay) {
        loadingOverlay.classList.remove("hidden");
      }
      
      const r = await api(`/admin/events?limit=${encodeURIComponent(limit)}${t?`&tenant=${encodeURIComponent(t)}`:""}${reason !== "all" ? `&reason=${encodeURIComponent(reason)}` : ""}${levelParam !== "all" ? `&level=${encodeURIComponent(levelParam)}` : ""}`);
      
      const tbody = document.querySelector("#eventsTable tbody");
      if (!tbody) return;
      
      let events = r.events || [];
      
      // Haal enableDebug status op uit settings
      const enableDebug = settingsData?.service?.enableDebug === true;
      
      // Filter debug events uit (tenzij enableDebug is ingeschakeld)
      if (!enableDebug) {
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
      }
      
      // Verberg loading overlay na laden (ook bij geen events)
      if (isInitialLoad && loadingOverlay) {
        loadingOverlay.classList.add("hidden");
        isInitialLoad = false; // Markeer dat eerste keer laden is voltooid
      }
      
      if(events.length===0){ 
        tbody.innerHTML = "<tr><td colspan='9' class='muted'>Geen events</td></tr>"; 
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
          const badge = ev.reason ? `<span class="badge ${ev.reason === 'message_delivered' ? 'success' : ev.reason === 'fallback' ? 'warn' : ev.reason === 'tenant_ip_not_allowed' ? 'err' : 'err'}">${ev.reason}</span>` : "";
          const info = ev.message || ev.error || "";
          const remoteIP = ev.remoteIP || "";
          tr.innerHTML = `<td>${ts}</td><td>${ev.level}</td><td>${badge}</td><td>${ev.tenant||""}</td><td>${ev.from||""}</td><td>${ev.rcptCount||""}</td><td>${ev.sizeKB||""}</td><td>${remoteIP}</td><td>${info.toString().slice(0,200)}</td>`;
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
            const badge = ev.reason ? `<span class="badge ${ev.reason === 'message_delivered' ? 'success' : ev.reason === 'fallback' ? 'warn' : ev.reason === 'tenant_ip_not_allowed' ? 'err' : 'err'}">${ev.reason}</span>` : "";
            const info = ev.message || ev.error || "";
            const remoteIP = ev.remoteIP || "";
            tr.innerHTML = `<td>${ts}</td><td>${ev.level}</td><td>${badge}</td><td>${ev.tenant||""}</td><td>${ev.from||""}</td><td>${ev.rcptCount||""}</td><td>${ev.sizeKB||""}</td><td>${remoteIP}</td><td>${info.toString().slice(0,200)}</td>`;
            
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
      
      // Pas kolom zichtbaarheid toe
      applyEventColumnVisibility();
      
      // GEEN load() aanroep - alleen events bijwerken
    }catch(e){
      const tbody = document.querySelector("#eventsTable tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan='9'>Fout: ${e.message}</td></tr>`;
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
      reasons: "deliver.ok,ok,message_delivered"
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

  // Event kolom zichtbaarheid configuratie
  const defaultEventColumns = {
    time: true,
    level: true,
    reason: true,
    tenant: true,
    from: true,
    rcpts: true,
    kb: true,
    remoteip: true,
    info: true
  };

  // Laad event kolom zichtbaarheid configuratie
  function loadEventColumnConfig() {
    const config = localStorage.getItem("eventColumnConfig");
    const columnIdMap = {
      time: 'colTime',
      level: 'colLevel',
      reason: 'colReason',
      tenant: 'colTenant',
      from: 'colFrom',
      rcpts: 'colRcpts',
      kb: 'colKb',
      remoteip: 'colRemoteIP',
      info: 'colInfo'
    };
    
    if (config) {
      try {
        const parsed = JSON.parse(config);
        Object.keys(defaultEventColumns).forEach(col => {
          const checkbox = document.getElementById(columnIdMap[col]);
          if (checkbox) {
            checkbox.checked = parsed[col] !== false; // Default true als niet ingesteld
          }
        });
      } catch (e) {
        console.error("❌ Fout bij laden event kolom config:", e);
      }
    } else {
      // Gebruik standaard waarden
      Object.keys(defaultEventColumns).forEach(col => {
        const checkbox = document.getElementById(columnIdMap[col]);
        if (checkbox) {
          checkbox.checked = defaultEventColumns[col];
        }
      });
    }
  }

  // Sla event kolom zichtbaarheid configuratie op
  function saveEventColumnConfig() {
    const config = {};
    const columnIdMap = {
      time: 'colTime',
      level: 'colLevel',
      reason: 'colReason',
      tenant: 'colTenant',
      from: 'colFrom',
      rcpts: 'colRcpts',
      kb: 'colKb',
      remoteip: 'colRemoteIP',
      info: 'colInfo'
    };
    
    Object.keys(defaultEventColumns).forEach(col => {
      const checkbox = document.getElementById(columnIdMap[col]);
      if (checkbox) {
        config[col] = checkbox.checked;
      } else {
        config[col] = defaultEventColumns[col];
      }
    });
    
    localStorage.setItem("eventColumnConfig", JSON.stringify(config));
    applyEventColumnVisibility();
    toast("✅ Event kolom zichtbaarheid opgeslagen!");
    
    // Sluit modal
    const modal = document.getElementById("eventColumnConfigModal");
    if (modal) modal.classList.add("hidden");
  }

  // Reset naar standaard waarden
  function resetEventColumnConfig() {
    const columnIdMap = {
      time: 'colTime',
      level: 'colLevel',
      reason: 'colReason',
      tenant: 'colTenant',
      from: 'colFrom',
      rcpts: 'colRcpts',
      kb: 'colKb',
      remoteip: 'colRemoteIP',
      info: 'colInfo'
    };
    
    Object.keys(defaultEventColumns).forEach(col => {
      const checkbox = document.getElementById(columnIdMap[col]);
      if (checkbox) {
        checkbox.checked = defaultEventColumns[col];
      }
    });
    
    localStorage.removeItem("eventColumnConfig");
    applyEventColumnVisibility();
    toast("🔄 Event kolom zichtbaarheid gereset naar standaard!");
  }

  // Pas kolom zichtbaarheid toe op de tabel
  function applyEventColumnVisibility() {
    const config = localStorage.getItem("eventColumnConfig");
    let columnVisibility;
    
    if (config) {
      try {
        columnVisibility = JSON.parse(config);
      } catch (e) {
        columnVisibility = defaultEventColumns;
      }
    } else {
      columnVisibility = defaultEventColumns;
    }
    
    // Pas toe op header kolommen en body cellen
    const table = document.getElementById("eventsTable");
    if (!table) return;
    
    const headers = Array.from(table.querySelectorAll("thead th"));
    headers.forEach((header, index) => {
      const column = header.getAttribute("data-column");
      if (column && columnVisibility.hasOwnProperty(column)) {
        const isVisible = columnVisibility[column];
        header.style.display = isVisible ? "" : "none";
        
        // Pas ook toe op alle cellen in deze kolom
        const rows = table.querySelectorAll("tbody tr");
        rows.forEach(row => {
          const cells = row.querySelectorAll("td");
          if (cells[index]) {
            cells[index].style.display = isVisible ? "" : "none";
          }
        });
      }
    });
  }

})();


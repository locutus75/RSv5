@echo off
echo 🔧 RileeSurfis Windows Service Installer (NSSM)
echo ================================================
echo.

REM Controleer of NSSM beschikbaar is
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ NSSM is niet geïnstalleerd of niet beschikbaar in PATH
    echo.
    echo 📥 Download NSSM van: https://nssm.cc/download
    echo 📁 Plaats nssm.exe in een directory die in PATH staat
    echo.
    pause
    exit /b 1
)

echo ✅ NSSM gevonden
echo.

REM Controleer of we in de juiste directory zijn
if not exist "index.js" (
    echo ❌ index.js niet gevonden in huidige directory
    echo    Zorg ervoor dat je dit script uitvoert vanuit de project directory
    pause
    exit /b 1
)

REM Controleer of de service al bestaat
sc query "RileeSurfis SMTP Server" >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️ Service bestaat al! Verwijderen...
    nssm remove "RileeSurfis SMTP Server" confirm
    if %errorlevel% neq 0 (
        echo ❌ Kon bestaande service niet verwijderen
        pause
        exit /b 1
    )
    echo ✅ Bestaande service verwijderd
    echo.
)

echo 🔧 Service installeren met NSSM...
echo.

REM Installeer de service
nssm install "RileeSurfis SMTP Server" "C:\Program Files\nodejs\node.exe" "C:\Apps\RileeSurfis\index.js"
if %errorlevel% neq 0 (
    echo ❌ Fout bij installeren van service
    pause
    exit /b 1
)

echo ✅ Service geïnstalleerd
echo.

REM Configureer de service
echo 🔧 Service configureren...
nssm set "RileeSurfis SMTP Server" AppDirectory "C:\Apps\RileeSurfis"
nssm set "RileeSurfis SMTP Server" Description "RileeSurfis SMTP relay server met Graph API integratie"
nssm set "RileeSurfis SMTP Server" Start SERVICE_AUTO_START

REM Environment variables
nssm set "RileeSurfis SMTP Server" AppEnvironmentExtra "NODE_ENV=production"
nssm set "RileeSurfis SMTP Server" AppEnvironmentExtra "ADMIN_TOKEN=ka8jajs@9djj3lsjdklsdfulij238sdfh"
nssm set "RileeSurfis SMTP Server" AppEnvironmentExtra "PWD=C:\Apps\RileeSurfis"

echo ✅ Service geconfigureerd
echo.

REM Start de service
echo 🚀 Service starten...
nssm start "RileeSurfis SMTP Server"
if %errorlevel% neq 0 (
    echo ❌ Fout bij starten van service
    pause
    exit /b 1
)

echo ✅ Service succesvol gestart!
echo.
echo 📋 Volgende stappen:
echo    1. Open Windows Services (services.msc)
echo    2. Zoek naar "RileeSurfis SMTP Server"
echo    3. Controleer of de service draait
echo.
echo 🔧 Service beheren:
echo    nssm start "RileeSurfis SMTP Server"     # Start service
echo    nssm stop "RileeSurfis SMTP Server"      # Stop service
echo    nssm restart "RileeSurfis SMTP Server"   # Herstart service
echo    nssm status "RileeSurfis SMTP Server"    # Toon status
echo    nssm remove "RileeSurfis SMTP Server"    # Verwijder service
echo.
pause

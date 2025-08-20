@echo off
echo 🗑️ RileeSurfis Windows Service Uninstaller (NSSM)
echo =================================================
echo.

REM Controleer of NSSM beschikbaar is
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ NSSM is niet geïnstalleerd of niet beschikbaar in PATH
    pause
    exit /b 1
)

echo ✅ NSSM gevonden
echo.

REM Controleer of de service bestaat
sc query "RileeSurfis SMTP Server" >nul 2>&1
if %errorlevel% neq 0 (
    echo ℹ️ Service bestaat niet
    pause
    exit /b 0
)

echo ⚠️ Service gevonden, verwijderen...
echo.

REM Stop de service eerst
echo 🛑 Service stoppen...
nssm stop "RileeSurfis SMTP Server"
if %errorlevel% neq 0 (
    echo ⚠️ Kon service niet stoppen, doorgaan met verwijderen...
)

REM Verwijder de service
echo 🗑️ Service verwijderen...
nssm remove "RileeSurfis SMTP Server" confirm
if %errorlevel% neq 0 (
    echo ❌ Fout bij verwijderen van service
    pause
    exit /b 1
)

echo ✅ Service succesvol verwijderd!
echo.
pause

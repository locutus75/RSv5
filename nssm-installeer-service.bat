# Ga naar je project directory
cd "C:\Users\leutscher_e\Apps\RSv5"

# Installeer de service
.\nssm.exe install "RileeSurfis SMTP Server" "C:\Program Files\nodejs\node.exe" "C:\Users\leutscher_e\Apps\RSv5\index.js"

# Configureer de service
.\nssm.exe set "RileeSurfis SMTP Server" AppDirectory "C:\Users\leutscher_e\Apps\RSv5"
.\nssm.exe set "RileeSurfis SMTP Server" Description "RileeSurfis SMTP relay server met Graph API integratie"
.\nssm.exe set "RileeSurfis SMTP Server" Start SERVICE_AUTO_START

# Environment variables
.\nssm.exe set "RileeSurfis SMTP Server" AppEnvironmentExtra "NODE_ENV=production"
.\nssm.exe set "RileeSurfis SMTP Server" AppEnvironmentExtra "ADMIN_TOKEN=ka8jajs@9djj3lsjdklsdfulij238sdfh"
.\nssm.exe set "RileeSurfis SMTP Server" AppEnvironmentExtra "PWD=C:\Users\leutscher_e\Apps\RSv5"

# Start de service
.\nssm.exe start "RileeSurfis SMTP Server"
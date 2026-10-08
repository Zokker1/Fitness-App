@echo off
setlocal
cd /d "%~dp0.."
title Fitness app - paikallinen palvelin
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit(major>20 || (major===20 && minor>=19) ? 0 : 1)"
if errorlevel 1 goto missing_node
set "VITE_APP_ORIGIN=http://127.0.0.1:5180"
set "VITE_GOOGLE_CLIENT_ID=dev-placeholder-client-id"
if exist "node_modules\vite\bin\vite.js" goto installed
echo Asennetaan projektin riippuvuudet...
call npm ci
if errorlevel 1 goto failed
:installed
if "%~2"=="demo" (
  set "FITNESS_OPEN_URL=http://127.0.0.1:5180/?storage=muisti"
  echo DEMO: kirjaukset katoavat sivun uudelleenlatauksessa.
) else (
  set "FITNESS_OPEN_URL=http://127.0.0.1:5180/"
  echo Kirjaukset tallennetaan taman selaimen paikalliseen salattuun tietokantaan.
)
if "%~1"=="preview" goto preview
echo Dev-palvelin: http://127.0.0.1:5180/
echo Pysayta palvelin painamalla Ctrl+C tassa ikkunassa.
call npm run dev --workspace @lifeos/web -- --host 127.0.0.1 --port 5180 --strictPort --open "%FITNESS_OPEN_URL%"
if errorlevel 1 goto failed
exit /b 0
:preview
if exist "apps\lifeos-web\dist\index.html" goto preview_ready
echo Luodaan build...
call npm run build
if errorlevel 1 goto failed
:preview_ready
echo Buildin esikatselu: http://127.0.0.1:5180/
echo Pysayta palvelin painamalla Ctrl+C tassa ikkunassa.
call npm run preview --workspace @lifeos/web -- --host 127.0.0.1 --port 5180 --strictPort --open "%FITNESS_OPEN_URL%"
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo Node.js tai npm puuttuu tai Node-versio on liian vanha.
echo Asenna Node.js 22.19 tai uudempi ja avaa tama tiedosto uudelleen.
pause
exit /b 1
:failed
echo.
echo Kaynnistys epaonnistui. Tarkista ylla oleva virheilmoitus.
echo Jos portti 5180 on kaytossa, sulje aiempi Fitness app -palvelin.
pause
exit /b 1
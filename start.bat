@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

start "" http://localhost:3000
npm start
pause

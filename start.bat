@echo off
setlocal

set HEALTH_URL=http://localhost:4000/health
set TIMEOUT=60

if not exist .env (
  echo WARNING: .env not found -- copying from .env.example. Edit it before use.
  copy .env.example .env
)

echo Starting stack with podman-compose...
podman-compose up -d
if errorlevel 1 goto :fail

echo Waiting for %HEALTH_URL% (up to %TIMEOUT%s)...
set /a elapsed=0
:poll
timeout /t 2 /nobreak >nul
curl -sf %HEALTH_URL% >nul 2>&1
if not errorlevel 1 goto :healthy
set /a elapsed+=2
if %elapsed% geq %TIMEOUT% goto :timeout
goto :poll

:healthy
echo Stack is healthy.
echo Open: https://localhost
exit /b 0

:timeout
echo ERROR: /health did not respond within %TIMEOUT%s
exit /b 1

:fail
echo ERROR: podman-compose up failed
exit /b 1

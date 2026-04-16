@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "DEFAULT_WALLET_PATH=%APPDATA%\Electrum-LTC\wallets\orbitwallet"
set "ELECTRUM_BIN_PATH="

if defined ELECTRUM_BIN (
    set "ELECTRUM_BIN_PATH=%ELECTRUM_BIN%"
) else (
    call :set_electrum_bin
)

if defined WALLET_PATH (
    set "WALLET_FILE=%WALLET_PATH%"
) else (
    set "WALLET_FILE=%DEFAULT_WALLET_PATH%"
)

if defined LTC_RPC_USER (
    set "RPC_USER_VALUE=%LTC_RPC_USER%"
) else if defined RPC_USER (
    set "RPC_USER_VALUE=%RPC_USER%"
) else (
    set "RPC_USER_VALUE=orbitwallet"
)

if defined LTC_RPC_PASSWORD (
    set "RPC_PASSWORD_VALUE=%LTC_RPC_PASSWORD%"
) else if defined RPC_PASS (
    set "RPC_PASSWORD_VALUE=%RPC_PASS%"
) else (
    set "RPC_PASSWORD_VALUE=orbitpassword"
)

if defined LTC_RPC_PORT (
    set "RPC_PORT_VALUE=%LTC_RPC_PORT%"
) else (
    set "RPC_PORT_VALUE=7777"
)

echo ==========================================
echo  Electrum-LTC RPC Setup ^(Windows^)
echo ==========================================

if not exist "!ELECTRUM_BIN_PATH!" (
    echo Electrum-LTC binary not found: !ELECTRUM_BIN_PATH!
    echo Set ELECTRUM_BIN to the correct path before running this script.
    exit /b 1
)

if not exist "!WALLET_FILE!" (
    echo Wallet not found at: !WALLET_FILE!
    echo Set WALLET_PATH to the correct wallet file before running this script.
    exit /b 1
)

echo Stopping existing daemon if present...
"%ELECTRUM_BIN_PATH%" stop >nul 2>&1
taskkill /IM electrum-ltc.exe /F >nul 2>&1
taskkill /IM electrum-ltc-4.2.2.1.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo Applying RPC configuration...
"%ELECTRUM_BIN_PATH%" --offline setconfig rpcuser "%RPC_USER_VALUE%" >nul
if errorlevel 1 exit /b %errorlevel%
"%ELECTRUM_BIN_PATH%" --offline setconfig rpcpassword "%RPC_PASSWORD_VALUE%" >nul
if errorlevel 1 exit /b %errorlevel%
"%ELECTRUM_BIN_PATH%" --offline setconfig rpcport "%RPC_PORT_VALUE%" >nul
if errorlevel 1 exit /b %errorlevel%

echo Starting daemon...
start "" /min "%ELECTRUM_BIN_PATH%" -w "%WALLET_FILE%" daemon
timeout /t 5 /nobreak >nul

echo Verifying wallet is loaded...
"%ELECTRUM_BIN_PATH%" list_wallets

echo RPC should now be listening on 127.0.0.1:%RPC_PORT_VALUE%
exit /b 0

:set_electrum_bin
if exist "C:\electrum-ltc\electrum-ltc.exe" (
    set "ELECTRUM_BIN_PATH=C:\electrum-ltc\electrum-ltc.exe"
    goto :eof
)

if exist "C:\Program Files\Electrum-LTC\electrum-ltc.exe" (
    set "ELECTRUM_BIN_PATH=C:\Program Files\Electrum-LTC\electrum-ltc.exe"
    goto :eof
)

if exist "C:\Progra~2\Electrum-LTC\electrum-ltc-4.2.2.1.exe" (
    set "ELECTRUM_BIN_PATH=C:\Program Files (x86)\Electrum-LTC\electrum-ltc-4.2.2.1.exe"
    goto :eof
)

set "ELECTRUM_BIN_PATH=C:\electrum-ltc\electrum-ltc.exe"
goto :eof

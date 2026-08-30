# Pull Todero + public Todero Brain, install if needed, start (or open) localhost:3100.
$ErrorActionPreference = "Stop"

$Todero = "C:\Development\Todero"
$Brain = "C:\Development\Todero Brain"
$Local = Join-Path $Todero "local"
$Url = "http://localhost:3100"
$Port = 3100

function Fail([string]$Message) {
    Write-Host $Message
    exit 1
}

function Test-OnPath([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Listening {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400)
        $connected = $ok -and $client.Connected
        $client.Close()
        return $connected
    } catch {
        return $false
    }
}

if (-not (Test-OnPath "git")) { Fail "git is not installed or not on PATH." }
if (-not (Test-OnPath "node")) { Fail "node is not installed or not on PATH." }
if (-not (Test-OnPath "pnpm")) { Fail "pnpm is not installed or not on PATH." }

if (-not (Test-Path -LiteralPath $Todero)) { Fail "Todero checkout not found: $Todero" }
if (-not (Test-Path -LiteralPath $Brain)) { Fail "Todero Brain checkout not found: $Brain" }
if (-not (Test-Path -LiteralPath $Local)) { Fail "Todero local/ not found: $Local" }

Write-Host "Updating Todero..."
git -C $Todero pull
if ($LASTEXITCODE -ne 0) { Fail "git pull failed in $Todero" }

Write-Host "Updating Todero Brain..."
git -C $Brain pull
if ($LASTEXITCODE -ne 0) { Fail "git pull failed in $Brain" }

if (Test-Listening) {
    Write-Host "Already listening on $Port. Opening $Url"
    Start-Process $Url
    exit 0
}

$nodeModules = Join-Path $Local "node_modules"
$lockfile = Join-Path $Local "pnpm-lock.yaml"
$needInstall = -not (Test-Path -LiteralPath $nodeModules)
if (-not $needInstall -and (Test-Path -LiteralPath $lockfile)) {
    if ((Get-Item -LiteralPath $lockfile).LastWriteTimeUtc -gt (Get-Item -LiteralPath $nodeModules).LastWriteTimeUtc) {
        $needInstall = $true
    }
}

Set-Location -LiteralPath $Local

if ($needInstall) {
    Write-Host "Running pnpm install in $Local ..."
    pnpm install
    if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed in $Local" }
}

Write-Host "Starting Todero (pnpm dev). Opening $Url when $Port is ready..."
Start-Job -ScriptBlock {
    param($Port, $Url)
    for ($i = 0; $i -lt 90; $i++) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
            $ok = $iar.AsyncWaitHandle.WaitOne(500)
            if ($ok -and $client.Connected) {
                $client.Close()
                Start-Process $Url
                return
            }
            $client.Close()
        } catch {}
        Start-Sleep -Seconds 1
    }
} -ArgumentList $Port, $Url | Out-Null

pnpm dev
if ($LASTEXITCODE -ne 0) { Fail "pnpm dev failed in $Local" }

# Before dsh-gate starts in docker mode (start-gate.cmd docker): Docker engine up, DocShield image present.
#   powershell -NoProfile -ExecutionPolicy Bypass -File ensure-docker.ps1 [-Rebuild] [-Image docshield-dsh:dev]
# If Docker Desktop is not running it is started, after moving aside the socket files an unclean
# shutdown leaves behind (they make Docker Desktop crash at start with "... .sock ... cannot be accessed").
# Exit code 0 = ready; messages are ASCII because the calling cmd window is not UTF-8.
param([switch]$Rebuild, [string]$Image = 'docshield-dsh:dev')

$root = @('E:\Docker\DockerDesktop', "$env:ProgramFiles\Docker\Docker") |
  Where-Object { Test-Path (Join-Path $_ 'Docker Desktop.exe') } | Select-Object -First 1
if (-not $root) { Write-Host '[LOI] Khong tim thay Docker Desktop (E:\Docker\DockerDesktop hoac Program Files\Docker\Docker).'; exit 1 }
$docker = Join-Path $root 'resources\bin\docker.exe'

function Test-Engine {
  & $docker version --format '{{.Server.Version}}' 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

if (-not (Test-Engine)) {
  if (Get-Process -Name 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue) {
    Write-Host '  Docker Desktop dang khoi dong, cho engine...'
  } else {
    $stamp = Get-Date -Format yyyyMMddHHmmss
    foreach ($dir in "$env:LOCALAPPDATA\Docker\run", "$env:LOCALAPPDATA\docker-secrets-engine") {
      # Match by name only: those stale .sock entries cannot be opened, and -Filter skips them.
      if ((Test-Path -LiteralPath $dir) -and ((Get-ChildItem -LiteralPath $dir -Name -Force -ErrorAction SilentlyContinue) -like '*.sock*')) {
        Rename-Item -LiteralPath $dir -NewName ((Split-Path $dir -Leaf) + ".stale-$stamp")
        Write-Host "  Da don socket cu cua lan tat truoc: $dir"
      }
    }
    Write-Host '  Dang mo Docker Desktop...'
    Start-Process -FilePath (Join-Path $root 'Docker Desktop.exe')
  }
  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Test-Engine)) {
    if ((Get-Date) -gt $deadline) {
      Write-Host '[LOI] Docker chua san sang sau 3 phut. Mo cua so Docker Desktop xem loi;'
      Write-Host '      neu bao loi ".sock ... cannot be accessed": Quit Docker Desktop roi chay lai lenh nay.'
      exit 1
    }
    Start-Sleep -Seconds 3
  }
}
Write-Host "  Docker san sang (engine $(& $docker version --format '{{.Server.Version}}'))."

& $docker image inspect $Image 2>$null | Out-Null
if ($Rebuild -or $LASTEXITCODE -ne 0) {
  Write-Host "  Build image $Image (lan dau mat vai phut)..."
  Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host '[LOI] npm run build that bai.'; exit 1 }
    & $docker build -f container/Dockerfile -t $Image .
    if ($LASTEXITCODE -ne 0) { Write-Host '[LOI] docker build that bai.'; exit 1 }
  } finally {
    Pop-Location
  }
}
exit 0

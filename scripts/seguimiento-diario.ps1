# Seguimiento diario del piloto en producción (fase 8, docs/piloto-produccion.md).
#
# Corre `sii produccion seguimiento` (solo lectura: no envía documentos), agrega una
# línea por envío a data/piloto/bitacora.jsonl y deja la salida completa, con fecha y
# código de salida, en data/piloto/seguimiento.log. data/piloto/ no se versiona.
#
# Lo ejecuta la tarea programada "SII seguimiento piloto" (Programador de tareas de
# Windows). Se puede correr a mano: powershell -File scripts\seguimiento-diario.ps1
#
# Códigos de salida (los del comando): 0 todo aceptado o en proceso · 5 rechazo ·
# 6 envío incierto o registro ilegible · 4 red/HTTP · 3 configuración.
# Si el código no es 0, además deja una línea en data/piloto/ALERTAS.txt.

# Continue: con Stop, PowerShell 5.1 cortaria el script si el comando escribe en
# stderr (justo en los rechazos y errores que hay que registrar).
$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$piloto = Join-Path $raiz 'data\piloto'
$log = Join-Path $piloto 'seguimiento.log'
$alertas = Join-Path $piloto 'ALERTAS.txt'
New-Item -ItemType Directory -Force $piloto | Out-Null

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }

# Node escribe UTF-8; sin esto, bajo el Programador de tareas se decodifica como OEM.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $raiz
$inicio = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$salida = & $node --conditions=source apps/cli/src/main.ts produccion seguimiento `
  --bitacora data/piloto/bitacora.jsonl 2>&1 | ForEach-Object { "$_" }
$codigo = $LASTEXITCODE

$bloque = @("==== $inicio - codigo $codigo ====") + $salida + ''
Add-Content -Path $log -Value $bloque -Encoding utf8

if ($codigo -ne 0) {
  Add-Content -Path $alertas -Encoding utf8 `
    -Value "$inicio - codigo $codigo - revisar data/piloto/seguimiento.log (5 rechazo, 6 incierto, 4 red, 3 config)"
}
exit $codigo

# =====================================================================
#  Agendamiento automatico de citas - Migracion Colombia
#  No requiere instalar nada. Usa PowerShell, que ya viene con Windows.
# =====================================================================
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BASE = 'https://apps.migracioncolombia.gov.co/citas'
$UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $here 'config.txt'
$logPath = Join-Path $here 'registro.txt'

function Say([string]$m, [string]$color = 'Gray') {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Big([string]$m, [string]$color) {
  Write-Host ''
  Write-Host ('=' * 68) -ForegroundColor $color
  Write-Host ("  " + $m) -ForegroundColor $color
  Write-Host ('=' * 68) -ForegroundColor $color
  Write-Host ''
}

# ---------- tablas ----------
$SEDES = @{
  'MEDELLIN'=15; 'BOGOTA'=2; 'CALI'=8; 'BARRANQUILLA'=5; 'CARTAGENA'=9; 'BUCARAMANGA'=6
  'PEREIRA'=19; 'MANIZALES'=14; 'ARMENIA'=4; 'CUCUTA'=10; 'IBAGUE'=11; 'NEIVA'=17
  'PASTO'=18; 'POPAYAN'=20; 'MONTERIA'=16; 'SANTA MARTA'=25; 'VILLAVICENCIO'=29
  'TUNJA'=27; 'VALLEDUPAR'=28; 'YOPAL'=30; 'CHIA'=37; 'RIOHACHA'=23; 'SAN ANDRES'=24
  'MAICAO'=13; 'QUIBDO'=22; 'ARAUCA'=3; 'SINCELEJO'=26; 'LETICIA'=12
}
$TRAMITES = @{
  'PROCESO ADMINISTRATIVO'=28; 'SALVOCONDUCTO'=6; 'CEDULA DE EXTRANJERIA'=4
  'CERTIFICADO DE MOVIMIENTOS MIGRATORIOS'=5; 'ATENCION SIRE'=27; 'PEP TUTOR'=26
  'DUPLICADO DE PPT'=22; 'REEXPEDICION PPT'=21; 'REGISTRO MENOR A 7 ANOS'=2
}

# ---------- leer config ----------
if (-not (Test-Path $cfgPath)) { Big "FALTA EL ARCHIVO config.txt" 'Red'; Read-Host 'Enter para salir'; exit 1 }
$cfg = @{}
foreach ($l in (Get-Content $cfgPath -Encoding UTF8)) {
  $l = $l.Trim()
  if ($l -eq '' -or $l.StartsWith('#') -or -not $l.Contains('=')) { continue }
  $k, $v = $l.Split('=', 2)
  $cfg[$k.Trim().ToUpper()] = $v.Trim()
}
foreach ($req in 'CORREO','CONTRASENA','SEDE','TRAMITE') {
  if (-not $cfg.ContainsKey($req) -or $cfg[$req] -eq '') {
    Big ("Falta '$req' en config.txt") 'Red'; Read-Host 'Enter para salir'; exit 1
  }
}
$sedeName    = $cfg['SEDE'].ToUpper()
$tramiteName = $cfg['TRAMITE'].ToUpper()
if (-not $SEDES.ContainsKey($sedeName)) {
  Big ("Sede desconocida: $sedeName") 'Red'
  Write-Host ("Opciones: " + (($SEDES.Keys | Sort-Object) -join ', ')) -ForegroundColor Yellow
  Read-Host 'Enter para salir'; exit 1
}
if (-not $TRAMITES.ContainsKey($tramiteName)) {
  Big ("Tramite desconocido: $tramiteName") 'Red'
  Write-Host ("Opciones: " + (($TRAMITES.Keys | Sort-Object) -join ', ')) -ForegroundColor Yellow
  Read-Host 'Enter para salir'; exit 1
}
$sedeId    = $SEDES[$sedeName]
$tramiteId = $TRAMITES[$tramiteName]
$hasta     = if ($cfg.ContainsKey('PARAR_A_LAS') -and $cfg['PARAR_A_LAS']) { $cfg['PARAR_A_LAS'] } else { '17:12' }

Clear-Host
Big "AGENDAMIENTO AUTOMATICO - MIGRACION COLOMBIA" 'Cyan'
Write-Host ("  Titular : " + $cfg['CORREO'])           -ForegroundColor White
Write-Host ("  Tramite : $tramiteName  (id $tramiteId)") -ForegroundColor White
Write-Host ("  Sede    : $sedeName  (id $sedeId)")       -ForegroundColor White
Write-Host ("  Buscara hasta las $hasta")                -ForegroundColor White
Write-Host ''
Write-Host "  Los cupos salen de domingo a jueves cerca de las 5:00 p.m." -ForegroundColor Yellow
Write-Host "  Anoche salieron 43 segundos ANTES y se acabaron en 25 segundos." -ForegroundColor Yellow
Write-Host "  Deje esta ventana abierta. NO la cierre." -ForegroundColor Yellow
Write-Host ''

# ---------- helpers HTTP ----------
function ReadErrBody($err) {
  try {
    $s = $err.Exception.Response.GetResponseStream()
    $r = New-Object IO.StreamReader($s)
    $t = $r.ReadToEnd(); $r.Close()
    return ($t | ConvertFrom-Json)
  } catch { return $null }
}

# ---------- login ----------
$script:sess = $null
function Login {
  $body = @{ email = $cfg['CORREO']; password = $cfg['CONTRASENA'] } | ConvertTo-Json -Compress
  try {
    $null = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -Body $body `
              -ContentType 'application/json' -UserAgent $UA -SessionVariable s -TimeoutSec 25
    $script:sess = $s
    Say "Sesion iniciada correctamente." 'Green'
    return $true
  } catch {
    $j = ReadErrBody $_
    $msg = if ($j -and $j.error) { $j.error } else { $_.Exception.Message }
    Say ("NO SE PUDO INICIAR SESION: " + $msg) 'Red'
    return $false
  }
}
if (-not (Login)) {
  Big "Revise CORREO y CONTRASENA en config.txt" 'Red'
  Read-Host 'Enter para salir'; exit 1
}

# ---------- ya tiene cita? ----------
try {
  $mc = Invoke-RestMethod -Uri "$BASE/api/mis-citas" -WebSession $script:sess -UserAgent $UA -TimeoutSec 25
  $hoy = (Get-Date).ToString('yyyy-MM-dd')
  foreach ($c in $mc.data) {
    if ($c.estado -eq 'AGENDADA' -and $c.tramite.ToUpper().Contains($tramiteName) `
        -and ([string]$c.fecha_cita).Substring(0,10) -ge $hoy) {
      Big "YA EXISTE UNA CITA AGENDADA" 'Green'
      Write-Host ("  Radicado : " + $c.radicado)                          -ForegroundColor Green
      Write-Host ("  Fecha    : " + ([string]$c.fecha_cita).Substring(0,10) + "  " + $c.hora_inicio) -ForegroundColor Green
      Write-Host ("  Sede     : " + $c.sede + " - " + $c.direccion)        -ForegroundColor Green
      Write-Host ''
      Read-Host 'Enter para salir'; exit 0
    }
  }
} catch { Say "No se pudo consultar mis-citas (se continua igual)." 'DarkYellow' }

# ---------- bucle ----------
$stop = [datetime]::ParseExact((Get-Date -Format 'yyyy-MM-dd') + ' ' + $hasta, 'yyyy-MM-dd HH:mm', $null)
if ($stop -lt (Get-Date)) { $stop = $stop.AddDays(1) }
$n = 0; $lastLogin = Get-Date
Say ("Buscando cupos... (se detiene a las " + $stop.ToString('HH:mm') + ")") 'Cyan'

while ((Get-Date) -lt $stop) {
  $n++
  if (((Get-Date) - $lastLogin).TotalMinutes -gt 25) { if (Login) { $lastLogin = Get-Date } }

  $dias = @()
  try {
    $r = Invoke-RestMethod -Uri "$BASE/api/disponibilidad/dias?sede=$sedeId&tramite=$tramiteId" `
           -WebSession $script:sess -UserAgent $UA -TimeoutSec 8
    if ($r.data) { $dias = @($r.data) }
  } catch { }

  if ($dias.Count -eq 0) {
    if ($n % 15 -eq 0) { Write-Host ("  ... sin cupos  (intento $n)") -ForegroundColor DarkGray }
    Start-Sleep -Milliseconds 2000
    continue
  }

  Say ("HAY CUPOS: " + ($dias -join ', ')) 'Yellow'
  [Console]::Beep(880,150)

  foreach ($d in $dias) {
    $fecha = if ($d -is [string]) { $d.Substring(0,10) } else { ([string]$d.fecha).Substring(0,10) }
    if (-not $fecha) { continue }
    $slots = @()
    try {
      $r = Invoke-RestMethod -Uri "$BASE/api/disponibilidad/slots?sede=$sedeId&tramite=$tramiteId&fecha=$fecha" `
             -WebSession $script:sess -UserAgent $UA -TimeoutSec 8
      if ($r.data) { $slots = @($r.data) }
    } catch { continue }
    Say ("  $fecha -> " + $slots.Count + " horario(s)") 'Yellow'

    foreach ($sl in $slots) {
      $horaId = $sl.id_hora_fk
      if ($null -eq $horaId) { continue }
      $hora = if ($sl.hora_inicio) { $sl.hora_inicio } else { '?' }
      $body = @{ sedeId=$sedeId; tramiteId=$tramiteId; fecha=$fecha; horaId=$horaId } | ConvertTo-Json -Compress
      try {
        $res = Invoke-RestMethod -Uri "$BASE/api/citas" -Method Post -Body $body `
                 -ContentType 'application/json' -WebSession $script:sess -UserAgent $UA -TimeoutSec 15
        Big "*** CITA AGENDADA ***" 'Green'
        Write-Host ("  Fecha   : $fecha")   -ForegroundColor Green
        Write-Host ("  Hora    : $hora")    -ForegroundColor Green
        Write-Host ("  Sede    : $sedeName") -ForegroundColor Green
        Write-Host ("  Tramite : $tramiteName") -ForegroundColor Green
        try {
          $mc = Invoke-RestMethod -Uri "$BASE/api/mis-citas" -WebSession $script:sess -UserAgent $UA -TimeoutSec 20
          $c  = $mc.data | Where-Object { $_.estado -eq 'AGENDADA' } | Select-Object -First 1
          if ($c) {
            Write-Host ("  RADICADO: " + $c.radicado) -ForegroundColor Green
            Write-Host ("  Direccion: " + $c.direccion) -ForegroundColor Green
          }
        } catch { }
        Write-Host ''
        Write-Host "  LLEVE: pasaporte y ORIGINALES de todos los soportes." -ForegroundColor Cyan
        Write-Host "  El pago se hace en el CFSM el dia de la cita." -ForegroundColor Cyan
        Write-Host ''
        1..6 | ForEach-Object { [Console]::Beep(1200,180); Start-Sleep -Milliseconds 90 }
        Say "AGENDADA $fecha $hora" 'Green'
        Read-Host 'Enter para salir'; exit 0
      } catch {
        $j = ReadErrBody $_
        if ($j -and $j.code -eq 'CITA_ACTIVA') {
          Big "YA HAY UNA CITA ACTIVA PARA ESTE TRAMITE" 'Green'
          Write-Host "  No se puede agendar otra. Revise el correo del titular." -ForegroundColor Green
          Read-Host 'Enter para salir'; exit 0
        }
        $msg = if ($j -and $j.error) { $j.error } else { $_.Exception.Message }
        Say ("  fallo $hora -> $msg") 'DarkYellow'
      }
    }
  }
  Start-Sleep -Milliseconds 1200
}

Big "NO APARECIERON CUPOS HOY" 'Yellow'
Write-Host "  Intente manana. Abra este programa a las 4:55 p.m." -ForegroundColor Yellow
Write-Host "  Los cupos salen de domingo a jueves." -ForegroundColor Yellow
Write-Host ''
Read-Host 'Enter para salir'

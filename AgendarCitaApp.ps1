# =====================================================================
#  Agendador de Citas - Migracion Colombia   (aplicacion de escritorio)
#  No requiere instalar nada. Usa PowerShell + Windows Forms.
# =====================================================================
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$BASE = 'https://apps.migracioncolombia.gov.co/citas'
$UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $here 'registro.txt'
$cfgDir  = Join-Path $here 'clientes'
if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir | Out-Null }

$SEDES = [ordered]@{
  'MEDELLIN'=15;'BOGOTA D.C.'=2;'CALI'=8;'BARRANQUILLA'=5;'CARTAGENA'=9;'BUCARAMANGA'=6
  'PEREIRA'=19;'MANIZALES'=14;'ARMENIA'=4;'CUCUTA'=10;'IBAGUE'=11;'NEIVA'=17;'PASTO'=18
  'POPAYAN'=20;'MONTERIA'=16;'SANTA MARTA'=25;'VILLAVICENCIO'=29;'TUNJA'=27;'VALLEDUPAR'=28
  'YOPAL'=30;'CHIA'=37;'RIOHACHA'=23;'SAN ANDRES'=24;'MAICAO'=13;'QUIBDO'=22;'ARAUCA'=3
  'SINCELEJO'=26;'LETICIA'=12
}
$TRAMITES = [ordered]@{
  'PROCESO ADMINISTRATIVO - PERSONA NATURAL O JURIDICA'=28
  'SALVOCONDUCTO'=6
  'CEDULA DE EXTRANJERIA'=4
  'CERTIFICADO DE MOVIMIENTOS MIGRATORIOS'=5
  'ATENCION (SIRE)'=27
  'PEP TUTOR'=26
  'DUPLICADO DE PPT - PERDIDA/HURTO'=22
  'REEXPEDICION PPT - CORRECCION'=21
  'REGISTRO DE EXTRANJERO MENOR A 7 ANOS'=2
}

# ---------------- ventana ----------------
$f = New-Object Windows.Forms.Form
$f.Text = 'Agendador de Citas - Migracion Colombia'
$f.Size = New-Object Drawing.Size(760, 660)
$f.StartPosition = 'CenterScreen'
$f.BackColor = [Drawing.Color]::White
$f.FormBorderStyle = 'FixedSingle'
$f.MaximizeBox = $false

function Lbl($t,$x,$y,$w,$bold=$false,$size=9) {
  $l = New-Object Windows.Forms.Label
  $l.Text=$t; $l.Location=New-Object Drawing.Point($x,$y); $l.Size=New-Object Drawing.Size($w,20)
  $st = if($bold){'Bold'}else{'Regular'}
  $l.Font = New-Object Drawing.Font('Segoe UI',$size,[Drawing.FontStyle]::$st)
  $f.Controls.Add($l); return $l
}

# encabezado
$hdr = New-Object Windows.Forms.Panel
$hdr.Location=New-Object Drawing.Point(0,0); $hdr.Size=New-Object Drawing.Size(760,58)
$hdr.BackColor=[Drawing.Color]::FromArgb(10,36,99)
$f.Controls.Add($hdr)
$t1 = New-Object Windows.Forms.Label
$t1.Text='Agendador de Citas'; $t1.ForeColor=[Drawing.Color]::White
$t1.Location=New-Object Drawing.Point(18,8); $t1.Size=New-Object Drawing.Size(500,28)
$t1.Font=New-Object Drawing.Font('Segoe UI',15,[Drawing.FontStyle]::Bold)
$hdr.Controls.Add($t1)
$t2 = New-Object Windows.Forms.Label
$t2.Text='Migracion Colombia - reserva automatica'; $t2.ForeColor=[Drawing.Color]::FromArgb(190,205,235)
$t2.Location=New-Object Drawing.Point(20,36); $t2.Size=New-Object Drawing.Size(500,18)
$t2.Font=New-Object Drawing.Font('Segoe UI',9)
$hdr.Controls.Add($t2)

# cliente guardado
Lbl 'Cliente guardado' 20 72 160 $true | Out-Null
$cboCli = New-Object Windows.Forms.ComboBox
$cboCli.Location=New-Object Drawing.Point(20,94); $cboCli.Size=New-Object Drawing.Size(420,24)
$cboCli.DropDownStyle='DropDownList'; $cboCli.Font=New-Object Drawing.Font('Segoe UI',10)
$f.Controls.Add($cboCli)
$btnDel = New-Object Windows.Forms.Button
$btnDel.Text='Borrar'; $btnDel.Location=New-Object Drawing.Point(450,93); $btnDel.Size=New-Object Drawing.Size(80,26)
$f.Controls.Add($btnDel)

# credenciales
Lbl 'Correo del titular' 20 132 200 $true | Out-Null
$txtMail = New-Object Windows.Forms.TextBox
$txtMail.Location=New-Object Drawing.Point(20,154); $txtMail.Size=New-Object Drawing.Size(340,24)
$txtMail.Font=New-Object Drawing.Font('Segoe UI',10)
$f.Controls.Add($txtMail)

Lbl 'Contrasena' 380 132 200 $true | Out-Null
$txtPass = New-Object Windows.Forms.TextBox
$txtPass.Location=New-Object Drawing.Point(380,154); $txtPass.Size=New-Object Drawing.Size(340,24)
$txtPass.UseSystemPasswordChar=$true; $txtPass.Font=New-Object Drawing.Font('Segoe UI',10)
$f.Controls.Add($txtPass)

Lbl 'Tramite' 20 190 200 $true | Out-Null
$cboTram = New-Object Windows.Forms.ComboBox
$cboTram.Location=New-Object Drawing.Point(20,212); $cboTram.Size=New-Object Drawing.Size(700,24)
$cboTram.DropDownStyle='DropDownList'; $cboTram.Font=New-Object Drawing.Font('Segoe UI',10)
foreach($k in $TRAMITES.Keys){ [void]$cboTram.Items.Add($k) }
$cboTram.SelectedIndex=0
$f.Controls.Add($cboTram)

Lbl 'Sede' 20 248 200 $true | Out-Null
$cboSede = New-Object Windows.Forms.ComboBox
$cboSede.Location=New-Object Drawing.Point(20,270); $cboSede.Size=New-Object Drawing.Size(340,24)
$cboSede.DropDownStyle='DropDownList'; $cboSede.Font=New-Object Drawing.Font('Segoe UI',10)
foreach($k in $SEDES.Keys){ [void]$cboSede.Items.Add($k) }
$cboSede.SelectedIndex=0
$f.Controls.Add($cboSede)

Lbl 'Parar a las' 380 248 200 $true | Out-Null
$txtStop = New-Object Windows.Forms.TextBox
$txtStop.Location=New-Object Drawing.Point(380,270); $txtStop.Size=New-Object Drawing.Size(80,24)
$txtStop.Text='17:15'; $txtStop.Font=New-Object Drawing.Font('Segoe UI',10)
$f.Controls.Add($txtStop)
$lblStopHint = New-Object Windows.Forms.Label
$lblStopHint.Text='(hora de 24h; se detiene solo)'
$lblStopHint.Location=New-Object Drawing.Point(466,274); $lblStopHint.Size=New-Object Drawing.Size(260,20)
$lblStopHint.Font=New-Object Drawing.Font('Segoe UI',8); $lblStopHint.ForeColor=[Drawing.Color]::Gray
$f.Controls.Add($lblStopHint)

$chkSave = New-Object Windows.Forms.CheckBox
$chkSave.Text='Guardar este cliente en este equipo'
$chkSave.Location=New-Object Drawing.Point(20,300); $chkSave.Size=New-Object Drawing.Size(360,24)
$chkSave.Font=New-Object Drawing.Font('Segoe UI',9); $chkSave.Checked=$true
$f.Controls.Add($chkSave)

# aviso
$av = New-Object Windows.Forms.Label
$av.Text = "Los cupos salen de domingo a jueves cerca de las 5:00 p.m., y solo para el dia habil siguiente." + [Environment]::NewLine + "Abra el programa a las 4:55 p.m. y pulse BUSCAR Y AGENDAR. Deje la ventana abierta."
$av.Location=New-Object Drawing.Point(20,328); $av.Size=New-Object Drawing.Size(700,40)
$av.Font=New-Object Drawing.Font('Segoe UI',9); $av.ForeColor=[Drawing.Color]::FromArgb(150,80,0)
$f.Controls.Add($av)

# boton principal
$btnGo = New-Object Windows.Forms.Button
$btnGo.Text='BUSCAR Y AGENDAR'
$btnGo.Location=New-Object Drawing.Point(20,374); $btnGo.Size=New-Object Drawing.Size(480,46)
$btnGo.Font=New-Object Drawing.Font('Segoe UI',12,[Drawing.FontStyle]::Bold)
$btnGo.BackColor=[Drawing.Color]::FromArgb(16,124,16); $btnGo.ForeColor=[Drawing.Color]::White
$btnGo.FlatStyle='Flat'
$f.Controls.Add($btnGo)

$btnStop = New-Object Windows.Forms.Button
$btnStop.Text='DETENER'
$btnStop.Location=New-Object Drawing.Point(510,374); $btnStop.Size=New-Object Drawing.Size(210,46)
$btnStop.Font=New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold)
$btnStop.Enabled=$false; $btnStop.FlatStyle='Flat'
$f.Controls.Add($btnStop)

# estado
$status = New-Object Windows.Forms.Label
$status.Text='Listo.'
$status.Location=New-Object Drawing.Point(20,430); $status.Size=New-Object Drawing.Size(700,30)
$status.Font=New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold)
$f.Controls.Add($status)

$log = New-Object Windows.Forms.TextBox
$log.Location=New-Object Drawing.Point(20,466); $log.Size=New-Object Drawing.Size(700,130)
$log.Multiline=$true; $log.ScrollBars='Vertical'; $log.ReadOnly=$true
$log.Font=New-Object Drawing.Font('Consolas',9)
$log.BackColor=[Drawing.Color]::FromArgb(248,248,250)
$f.Controls.Add($log)

# ---------------- logica ----------------
$script:sess=$null; $script:tries=0; $script:running=$false; $script:stopAt=$null

function Log([string]$m){
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  $log.AppendText($line + [Environment]::NewLine)
  try { Add-Content -Path $logPath -Value $line -Encoding UTF8 } catch {}
}
function SetStatus([string]$m,[Drawing.Color]$c){ $status.Text=$m; $status.ForeColor=$c; $f.Refresh() }
function NoAccent([string]$s){
  if (-not $s) { return '' }
  $n = $s.Normalize([Text.NormalizationForm]::FormD)
  $out = New-Object Text.StringBuilder
  foreach ($ch in $n.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$out.Append($ch)
    }
  }
  return $out.ToString().ToUpper()
}
function ErrBody($e){ try{ $s=$e.Exception.Response.GetResponseStream(); $r=New-Object IO.StreamReader($s); $t=$r.ReadToEnd(); $r.Close(); return ($t|ConvertFrom-Json) }catch{ return $null } }

function LoadClients {
  $cboCli.Items.Clear(); [void]$cboCli.Items.Add('-- nuevo cliente --')
  Get-ChildItem $cfgDir -Filter *.cfg -ErrorAction SilentlyContinue | ForEach-Object { [void]$cboCli.Items.Add($_.BaseName) }
  $cboCli.SelectedIndex=0
}
LoadClients

$cboCli.Add_SelectedIndexChanged({
  if ($cboCli.SelectedIndex -le 0) { $txtMail.Text=''; $txtPass.Text=''; return }
  $p = Join-Path $cfgDir ($cboCli.SelectedItem + '.cfg')
  if (-not (Test-Path $p)) { return }
  try {
    $d = Get-Content $p -Encoding UTF8 | ConvertFrom-Json
    $txtMail.Text = $d.correo
    $sec = $d.pass | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $txtPass.Text = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if ($d.tramite) { $cboTram.SelectedItem = $d.tramite }
    if ($d.sede)    { $cboSede.SelectedItem = $d.sede }
    Log ("Cliente cargado: " + $cboCli.SelectedItem)
  } catch { Log 'No se pudo leer el cliente guardado (se guardo en otro equipo o con otro usuario de Windows).' }
})

$btnDel.Add_Click({
  if ($cboCli.SelectedIndex -le 0) { return }
  $p = Join-Path $cfgDir ($cboCli.SelectedItem + '.cfg')
  if ([Windows.Forms.MessageBox]::Show("Borrar " + $cboCli.SelectedItem + "?",'Confirmar','YesNo','Question') -eq 'Yes') {
    Remove-Item $p -ErrorAction SilentlyContinue; LoadClients; Log 'Cliente borrado.'
  }
})

function SaveClient {
  if (-not $chkSave.Checked) { return }
  $name = ($txtMail.Text -split '@')[0]
  $name = ($name -replace '[^A-Za-z0-9_.-]','_')
  if (-not $name) { return }
  $enc = (ConvertTo-SecureString $txtPass.Text -AsPlainText -Force | ConvertFrom-SecureString)
  $obj = [pscustomobject]@{ correo=$txtMail.Text; pass=$enc; tramite=$cboTram.SelectedItem; sede=$cboSede.SelectedItem }
  $obj | ConvertTo-Json | Set-Content (Join-Path $cfgDir ($name + '.cfg')) -Encoding UTF8
  LoadClients
  $cboCli.SelectedItem = $name
}

function DoLogin {
  $body = @{ email=$txtMail.Text; password=$txtPass.Text } | ConvertTo-Json -Compress
  try {
    $null = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -Body $body -ContentType 'application/json' `
              -UserAgent $UA -SessionVariable s -TimeoutSec 20
    $script:sess = $s; Log 'Sesion iniciada.'; return $true
  } catch {
    $j = ErrBody $_
    Log ('ERROR de ingreso: ' + $(if($j -and $j.error){$j.error}else{$_.Exception.Message}))
    return $false
  }
}

function Celebrate($fecha,$hora,$rad,$dir){
  $script:running=$false; $timer.Stop()
  $btnGo.Enabled=$true; $btnStop.Enabled=$false
  SetStatus 'CITA AGENDADA' ([Drawing.Color]::FromArgb(16,124,16))
  1..5 | ForEach-Object { [Console]::Beep(1200,180); Start-Sleep -Milliseconds 80 }
  $msg = "CITA AGENDADA`n`nFecha: $fecha`nHora: $hora`nSede: $($cboSede.SelectedItem)`nTramite: $($cboTram.SelectedItem)`nRadicado: $rad`n$dir`n`nLLEVE pasaporte y ORIGINALES de todos los soportes.`nEl pago se hace en el CFSM el dia de la cita."
  Log ("AGENDADA " + $fecha + ' ' + $hora + ' radicado ' + $rad)
  [Windows.Forms.MessageBox]::Show($msg,'EXITO','OK','Information') | Out-Null
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
  if (-not $script:running) { return }
  if ($script:stopAt -and (Get-Date) -gt $script:stopAt) {
    $script:running=$false; $timer.Stop(); $btnGo.Enabled=$true; $btnStop.Enabled=$false
    SetStatus 'Se detuvo: no aparecieron cupos hoy.' ([Drawing.Color]::FromArgb(200,120,0))
    Log 'Fin de la busqueda. No hubo cupos.'
    [Windows.Forms.MessageBox]::Show("No aparecieron cupos hoy.`n`nIntente manana. Abra el programa a las 4:55 p.m.`nLos cupos salen de domingo a jueves.",'Sin cupos','OK','Information')|Out-Null
    return
  }
  $script:tries++
  $sedeId = $SEDES[[string]$cboSede.SelectedItem]
  $tramId = $TRAMITES[[string]$cboTram.SelectedItem]
  $dias = @()
  try {
    $r = Invoke-RestMethod -Uri "$BASE/api/disponibilidad/dias?sede=$sedeId&tramite=$tramId" -WebSession $script:sess -UserAgent $UA -TimeoutSec 6
    if ($r.data) { $dias = @($r.data) }
  } catch { }
  if ($dias.Count -eq 0) {
    SetStatus ("Buscando cupos...  intento " + $script:tries) ([Drawing.Color]::FromArgb(90,90,90))
    if ($script:tries % 20 -eq 0) { Log ("sin cupos (intento " + $script:tries + ")") }
    return
  }
  Log ('HAY CUPOS: ' + ($dias -join ', ')); [Console]::Beep(880,150)
  SetStatus 'Cupos encontrados. Agendando...' ([Drawing.Color]::FromArgb(200,120,0))
  foreach ($d in $dias) {
    $fecha = if ($d -is [string]) { $d.Substring(0,10) } else { ([string]$d.fecha).Substring(0,10) }
    if (-not $fecha) { continue }
    $slots=@()
    try {
      $r = Invoke-RestMethod -Uri "$BASE/api/disponibilidad/slots?sede=$sedeId&tramite=$tramId&fecha=$fecha" -WebSession $script:sess -UserAgent $UA -TimeoutSec 6
      if ($r.data) { $slots=@($r.data) }
    } catch { continue }
    Log ("  $fecha -> " + $slots.Count + ' horario(s)')
    foreach ($sl in $slots) {
      $horaId = $sl.id_hora_fk; if ($null -eq $horaId) { continue }
      $hora = if($sl.hora_inicio){$sl.hora_inicio}else{'?'}
      $body = @{ sedeId=$sedeId; tramiteId=$tramId; fecha=$fecha; horaId=$horaId } | ConvertTo-Json -Compress
      try {
        $null = Invoke-RestMethod -Uri "$BASE/api/citas" -Method Post -Body $body -ContentType 'application/json' -WebSession $script:sess -UserAgent $UA -TimeoutSec 15
        $rad=''; $dir=''
        try {
          $mc = Invoke-RestMethod -Uri "$BASE/api/mis-citas" -WebSession $script:sess -UserAgent $UA -TimeoutSec 15
          $c = $mc.data | Where-Object { $_.estado -eq 'AGENDADA' } | Select-Object -First 1
          if ($c) { $rad=$c.radicado; $dir=$c.direccion }
        } catch {}
        Celebrate $fecha $hora $rad $dir
        return
      } catch {
        $j = ErrBody $_
        if ($j -and $j.code -eq 'CITA_ACTIVA') {
          $script:running=$false; $timer.Stop(); $btnGo.Enabled=$true; $btnStop.Enabled=$false
          SetStatus 'Ya existe una cita activa para este tramite' ([Drawing.Color]::FromArgb(16,124,16))
          [Windows.Forms.MessageBox]::Show("Este titular YA tiene una cita activa para este tramite.`nNo se puede agendar otra.",'Aviso','OK','Information')|Out-Null
          return
        }
        Log ('  fallo ' + $hora + ' -> ' + $(if($j -and $j.error){$j.error}else{$_.Exception.Message}))
      }
    }
  }
})

$btnGo.Add_Click({
  if (-not $txtMail.Text -or -not $txtPass.Text) {
    [Windows.Forms.MessageBox]::Show('Escriba el correo y la contrasena del titular.','Faltan datos','OK','Warning')|Out-Null; return
  }
  $btnGo.Enabled=$false
  SetStatus 'Iniciando sesion...' ([Drawing.Color]::FromArgb(90,90,90))
  if (-not (DoLogin)) {
    $btnGo.Enabled=$true
    SetStatus 'No se pudo iniciar sesion' ([Drawing.Color]::Firebrick)
    [Windows.Forms.MessageBox]::Show('Correo o contrasena incorrectos.','Error','OK','Error')|Out-Null; return
  }
  SaveClient
  $sedeId = $SEDES[[string]$cboSede.SelectedItem]; $tramId = $TRAMITES[[string]$cboTram.SelectedItem]
  try {
    $mc = Invoke-RestMethod -Uri "$BASE/api/mis-citas" -WebSession $script:sess -UserAgent $UA -TimeoutSec 15
    $hoy = (Get-Date).ToString('yyyy-MM-dd')
    $ya = $mc.data | Where-Object { $_.estado -eq 'AGENDADA' -and ([string]$_.fecha_cita).Substring(0,10) -ge $hoy -and (NoAccent $_.tramite) -eq (NoAccent ([string]$cboTram.SelectedItem)) } | Select-Object -First 1
    if ($ya) {
      $btnGo.Enabled=$true
      SetStatus 'Este titular ya tiene cita' ([Drawing.Color]::FromArgb(16,124,16))
      [Windows.Forms.MessageBox]::Show("Ya tiene cita.`n`nRadicado: $($ya.radicado)`nFecha: $(([string]$ya.fecha_cita).Substring(0,10)) $($ya.hora_inicio)`nSede: $($ya.sede)",'Ya agendada','OK','Information')|Out-Null
      return
    }
  } catch {}
  $script:stopAt = $null
  try {
    $hm = $txtStop.Text.Trim()
    if ($hm) {
      $d = [datetime]::ParseExact((Get-Date -Format 'yyyy-MM-dd') + ' ' + $hm, 'yyyy-MM-dd HH:mm', $null)
      if ($d -lt (Get-Date)) { $d = $d.AddDays(1) }
      $script:stopAt = $d
      Log ('Se detendra automaticamente a las ' + $d.ToString('HH:mm'))
    }
  } catch { Log 'Hora de parada invalida; se usara 17:15.'
            $script:stopAt = [datetime]::ParseExact((Get-Date -Format 'yyyy-MM-dd') + ' 17:15','yyyy-MM-dd HH:mm',$null) }
  $script:tries=0; $script:running=$true
  $btnStop.Enabled=$true
  Log ('Buscando: ' + $cboTram.SelectedItem + ' en ' + $cboSede.SelectedItem)
  SetStatus 'Buscando cupos...' ([Drawing.Color]::FromArgb(90,90,90))
  $timer.Start()
})

$btnStop.Add_Click({
  $script:running=$false; $timer.Stop()
  $btnGo.Enabled=$true; $btnStop.Enabled=$false
  SetStatus 'Detenido.' ([Drawing.Color]::FromArgb(90,90,90)); Log 'Detenido por el usuario.'
})

$f.Add_FormClosing({ $timer.Stop() })
Log 'Programa iniciado.'
[void]$f.ShowDialog()

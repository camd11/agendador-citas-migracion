/* Agendador de Citas - Migracion Colombia (version navegador)
 *
 * Se ejecuta DENTRO de la pagina oficial https://apps.migracioncolombia.gov.co/citas
 * con la sesion del titular ya iniciada. Desde noviembre de 2026 el portal exige
 * una verificacion de Cloudflare Turnstile en cada reserva. Una persona marca la
 * casilla "Verifique que es un ser humano"; este programa vigila los cupos y envia
 * la reserva en el instante en que aparecen, usando esa verificacion.
 */
(function () {
  'use strict';
  var VERSION = '2.3.0';
  var SITEKEY = '0x4AAAAAAF0_ravvCrdYLiwp';   // clave publica del portal (pagina /agendar)
  var ACTION = 'appointment_booking';         // la misma accion que usa el portal; el servidor la exige
  var BASE = '/citas';
  var N_WIDGETS = 3;          // tres verificaciones = tres intentos de reserva
  var TOKEN_LIFE_MS = 280000; // Cloudflare: el token vale 300 s; usamos 280 s
  var POLL_MS = 1000;
  var REQ_TIMEOUT_MS = 6000;
  var BOOK_TIMEOUT_MS = 25000;
  var DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  if (location.host !== 'apps.migracioncolombia.gov.co' || location.pathname.indexOf(BASE) !== 0) {
    alert('Este boton solo funciona en la pagina de citas de Migracion.\n\nSe abrira ahora. Inicie sesion con la cuenta del titular y pulse el boton Agendador otra vez.');
    location.href = 'https://apps.migracioncolombia.gov.co/citas/agendar';
    return;
  }
  if (window.__agendadorV2) {
    // Ya hay un panel abierto en esta pagina. Si es de una version anterior,
    // el panel viejo sigue activo: hay que recargar la pagina para usar la nueva.
    if (window.__agendadorV2.version !== VERSION) {
      alert('HAY UNA VERSION NUEVA DEL AGENDADOR (' + VERSION + ').\n\n' +
        'El panel abierto es la version ' + window.__agendadorV2.version + '.\n\n' +
        '1. Pulse la tecla F5 para recargar la pagina.\n' +
        '2. Si lo pide, inicie sesion otra vez.\n' +
        '3. Pulse el boton Agendador.\n\n' +
        'Arriba del panel debe decir "Agendador de Citas ' + VERSION + '".');
    }
    window.__agendadorV2.show(); return;
  }

  // ---------------- estado ----------------
  var st = {
    running: false, busy: false, busySince: 0, tries: 0, stopAt: null,
    tokens: [],          // {tok, t, wid}
    wstate: {},          // wid -> {state:'pendiente'|'lista'|'error', code, label}
    widgets: [],
    session: 'checking', // 'checking' | 'ok' | 'none'
    who: '',
    done: false, timer: null, lastNeedAlarm: 0, netFails: 0,
    sawSlotsAt: null, bookFails: 0, ttLoaded: false, avail: null  // avail: {sede, fechas} si hay cupos ahora
  };

  // ---------------- utilidades ----------------
  function $(id) { return document.getElementById(id); }
  function now() { return new Date(); }
  function hhmmss(d) { return d.toTimeString().slice(0, 8); }
  function localDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function noAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function log(m) {
    var line = '[' + hhmmss(now()) + '] ' + m;
    var el = $('ag2-log'); if (el) { el.value += line + '\n'; el.scrollTop = el.scrollHeight; }
    try { console.log('[agendador] ' + line); } catch (e) {}
  }
  function status(m, color) { var el = $('ag2-status'); if (el) { el.textContent = m; el.style.color = color || '#333'; } }
  // Caja de resultado: queda visible hasta que otra la reemplace o se cierre.
  function showMsg(kind, title, html) {
    var colors = { ok: ['#eaf6ea', '#107c10'], err: ['#fdecec', '#b00020'], warn: ['#fff4e0', '#b35c00'], info: ['#eef2fb', '#0a2463'] };
    var c = colors[kind] || colors.info;
    var el = $('ag2-msg');
    el.style.display = '';
    el.style.background = c[0]; el.style.borderColor = c[1];
    el.innerHTML = '<button class="mx" title="Cerrar">&times;</button><div class="mt" style="color:' + c[1] + '">' + esc(title) + '</div><div>' + html + '</div>';
    el.querySelector('.mx').onclick = function () { el.style.display = 'none'; };
    $('ag2-body').style.display = '';
    try { box.scrollTop = 0; } catch (e) {}
  }
  function beep(freq, ms, times) {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var t = ctx.currentTime;
      for (var i = 0; i < (times || 1); i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        g.gain.value = 0.25; o.start(t + i * (ms + 90) / 1000); o.stop(t + (i * (ms + 90) + ms) / 1000);
      }
    } catch (e) {}
  }
  function api(path, opts, timeoutMs) {
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, timeoutMs || REQ_TIMEOUT_MS);
    opts = opts || {};
    opts.signal = ctl.signal; opts.credentials = 'same-origin';
    return fetch(BASE + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, ok: r.ok, json: j };
      });
    }).finally(function () { clearTimeout(to); });
  }
  function errOf(r) {
    var j = (r && r.json) || {};
    return {
      code: j.code || (j.data && j.data.code) || '',
      text: j.error || (j.data && j.data.error) || ('HTTP ' + (r && r.status))
    };
  }
  function save() {
    try {
      localStorage.setItem('agendador_v2', JSON.stringify({
        tramite: $('ag2-tram').value, sede: $('ag2-sede').value, stop: $('ag2-stop').value
      }));
    } catch (e) {}
  }
  function loadSaved() { try { return JSON.parse(localStorage.getItem('agendador_v2') || '{}'); } catch (e) { return {}; } }
  function selText(id) { var s = $(id); return s && s.selectedOptions[0] ? s.selectedOptions[0].textContent : ''; }
  function stopTimeToday() {
    var m = /^(\d{1,2}):(\d{2})$/.exec(($('ag2-stop').value || '').trim()) || [null, '17', '15'];
    var d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d;
  }
  function releaseDay(d) { var w = d.getDay(); return w >= 0 && w <= 4; } // domingo a jueves
  function nextReleaseText(d) {
    var x = new Date(d); x.setDate(x.getDate() + 1);
    while (!releaseDay(x)) x.setDate(x.getDate() + 1);
    var diff = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    return diff === 1 ? 'manana (' + DIAS[x.getDay()] + ')' : 'el ' + DIAS[x.getDay()];
  }

  // ---------------- panel ----------------
  var css = '#ag2{position:fixed;top:10px;right:10px;width:440px;max-height:calc(100vh - 20px);overflow:auto;z-index:2147483647;background:#fff;border:2px solid #0a2463;' +
    'border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.35);font:14px Segoe UI,Arial,sans-serif;color:#222}' +
    '#ag2 h3{margin:0;padding:9px 14px;background:#0a2463;color:#fff;font-size:16px;display:flex;justify-content:space-between;align-items:center}' +
    '#ag2 .b{padding:10px 14px}#ag2 label{display:block;font-weight:600;margin:8px 0 3px}' +
    '#ag2 select,#ag2 input{width:100%;box-sizing:border-box;padding:5px;font-size:14px}' +
    '#ag2 .row{display:flex;gap:8px}#ag2 .row>*{flex:1}' +
    '#ag2 button{padding:10px;font-size:15px;font-weight:700;border:0;border-radius:6px;cursor:pointer}' +
    '#ag2 button:disabled{opacity:.5;cursor:default}' +
    '#ag2-go{background:#107c10;color:#fff}#ag2-stopbtn{background:#ccc;color:#222}' +
    '#ag2-next{font-size:15px;font-weight:700;padding:9px 11px;border-radius:7px;border:2px solid;margin-bottom:6px}' +
    '#ag2-msg{position:relative;border:2px solid;border-radius:7px;padding:9px 30px 9px 11px;margin:8px 0;font-size:14px}' +
    '#ag2-msg .mt{font-weight:800;font-size:16px;margin-bottom:4px}' +
    '#ag2-msg .mx{position:absolute;top:2px;right:4px;background:none;font-size:20px;padding:0 6px;color:#555}' +
    '#ag2-status{font-weight:700;margin:8px 0;min-height:20px}' +
    '#ag2-log{width:100%;height:100px;font:12px Consolas,monospace;background:#f6f6f8;box-sizing:border-box}' +
    '#ag2-ver{border:2px dashed #c60;border-radius:6px;padding:6px;margin-top:8px;background:#fff8ef}' +
    '#ag2-ver p{margin:0 0 6px;font-size:13px}#ag2-tokinfo{font-weight:700;margin-top:4px}' +
    '#ag2 .wl{font-size:12px;font-weight:700;margin:0 0 6px 2px}' +
    '#ag2 .x{background:none;color:#fff;font-size:18px;padding:0 4px}' +
    '#ag2-allres{margin-top:6px;border:1px solid #bbb;border-radius:6px;max-height:260px;overflow:auto;display:none;font-size:13px}' +
    '#ag2-allres table{border-collapse:collapse;width:100%}#ag2-allres td,#ag2-allres th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}' +
    '#ag2-allres th{background:#eef2fb;position:sticky;top:0}#ag2-allres tr.r{cursor:pointer}#ag2-allres tr.r:hover{background:#eaf6ea}' +
    '#ag2-allres .sel{background:#fff4c2}#ag2-allres .hd{padding:6px;font-weight:700}' +
    '@keyframes ag2blink{50%{opacity:.35}}#ag2 .blink{animation:ag2blink 1s step-start infinite}';
  var styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl);
  var saved = loadSaved();
  var box = document.createElement('div'); box.id = 'ag2';
  box.innerHTML =
    '<h3><span>Agendador de Citas ' + VERSION + '</span><button class="x" id="ag2-min" title="Minimizar">_</button></h3>' +
    '<div class="b" id="ag2-body">' +
    '<div id="ag2-next">Cargando...</div>' +
    '<div id="ag2-msg" style="display:none"></div>' +
    '<div id="ag2-who">Comprobando la sesion...</div>' +
    '<label>Tramite</label><select id="ag2-tram"><option>cargando...</option></select>' +
    '<div class="row"><div><label>Sede</label><select id="ag2-sede"><option>elija el tramite</option></select></div>' +
    '<div style="flex:0 0 110px"><label>Parar a las</label><input id="ag2-stop" value="' + esc(saved.stop || '17:15') + '"></div></div>' +
    '<div id="ag2-ver"><p><b>Verificacion de seguridad.</b> Para agendar: a las 4:58 p.m. marque las ' + N_WIDGETS +
    ' casillas <i>"Verifique que es un ser humano"</i>. Para la prueba basta una. Cada casilla vale 5 minutos y sirve para un intento.</p>' +
    '<div id="ag2-tt">Cargando la verificacion de Cloudflare...</div><div id="ag2-tokinfo"></div></div>' +
    '<div class="row" style="margin-top:10px"><button id="ag2-go">BUSCAR Y AGENDAR</button>' +
    '<button id="ag2-stopbtn" disabled style="flex:0 0 110px">DETENER</button></div>' +
    '<button id="ag2-test" style="width:100%;margin-top:6px;background:#e8eefc;color:#0a2463">PROBAR (no agenda nada)</button>' +
    '<button id="ag2-all" style="width:100%;margin-top:6px;background:#fff8e1;color:#5a3d00">VER CUPOS EN TODAS LAS SEDES</button>' +
    '<div id="ag2-allres"></div>' +
    '<div id="ag2-status">Listo.</div>' +
    '<textarea id="ag2-log" readonly></textarea>' +
    '<div class="row" style="margin-top:4px;align-items:center"><div style="font-size:12px;color:#666;flex:1">Deje esta pestana <b>visible y al frente</b>.</div>' +
    '<button id="ag2-copy" style="flex:0 0 150px;font-size:13px;padding:6px;background:#eee;color:#222">Copiar registro</button></div>' +
    '</div>';
  document.body.appendChild(box);
  $('ag2-min').onclick = function () { var b = $('ag2-body'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
  $('ag2-copy').onclick = function () {
    var txt = 'Agendador ' + VERSION + ' | ' + new Date().toString() + ' | ' + navigator.userAgent + '\n' +
      'Titular: ' + st.who + ' | Tramite: ' + selText('ag2-tram') + ' | Sede: ' + selText('ag2-sede') + '\n' + $('ag2-log').value;
    var done = function () { $('ag2-copy').textContent = 'Copiado ✓'; setTimeout(function () { $('ag2-copy').textContent = 'Copiar registro'; }, 3000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    else { fallbackCopy(txt); done(); }
  };
  function fallbackCopy(txt) {
    var t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(t);
  }

  // ---------------- "que hacer ahora" ----------------
  function guide() {
    var el = $('ag2-next'); if (!el) return;
    var d = now(), n = freshTokens().length, stopAt = stopTimeToday();
    var start = new Date(d); start.setHours(16, 50, 0, 0);
    var g;   // [color, texto, parpadeo]
    if (st.done) g = ['#107c10', 'CITA AGENDADA. Revise los datos abajo y anote el radicado.'];
    else if (st.session === 'none') g = ['#b00020', 'Inicie sesion en la pagina de Migracion con la cuenta del titular. Luego pulse el boton Agendador otra vez.', true];
    else if (st.session === 'checking') g = ['#555', 'Comprobando la sesion...'];
    else if (st.running && !n) g = ['#b00020', 'MARQUE LAS CASILLAS "Verifique que es un ser humano" AHORA.', true];
    else if (st.running) {
      var soon = st.tokens.reduce(function (m, x) { return Math.min(m, TOKEN_LIFE_MS - (Date.now() - x.t)); }, Infinity);
      g = ['#107c10', 'Todo listo: ' + n + ' de ' + N_WIDGETS + ' verificaciones. No toque nada y deje esta pagina al frente.' +
        (soon < 60000 ? ' Una verificacion vence en ' + mmss(soon) + '.' : '')];
    }
    else if (st.avail && st.avail.fechas.length) g = ['#107c10', 'HAY CUPOS AHORA en ' + st.avail.sede + ' para el ' + fechaTxt(st.avail.fechas[0]) +
      (st.avail.horas && st.avail.horas.length ? ' (' + st.avail.horas.join(', ') + ')' : '') +
      '. Marque una casilla, espere "\u2713 Lista" y pulse BUSCAR Y AGENDAR.', true];
    else if (!releaseDay(d)) g = ['#0a2463', 'Hoy es ' + DIAS[d.getDay()] + ': hoy no salen cupos (salen de domingo a jueves). Puede hacer la PRUEBA. Para agendar, vuelva ' + nextReleaseText(d) + ' a las 4:50 p.m.'];
    else if (d > stopAt) g = ['#b35c00', 'Los cupos de hoy ya salieron (cerca de las 5:00 p.m.). Puede hacer la PRUEBA. Para agendar, vuelva ' + nextReleaseText(d) + ' a las 4:50 p.m.'];
    else if (d < start) g = ['#0a2463', 'Ahora puede hacer la PRUEBA. Para agendar, vuelva hoy a las 4:50 p.m. (faltan ' + mmss(start - d).replace(/:\d+$/, '') + ' minutos).'];
    else g = ['#107c10', 'Es la hora: pulse BUSCAR Y AGENDAR y, a las 4:58, marque las ' + N_WIDGETS + ' casillas.', true];
    el.textContent = g[1];
    el.style.color = g[0]; el.style.borderColor = g[0];
    el.style.background = g[0] === '#b00020' ? '#fdecec' : g[0] === '#107c10' ? '#eaf6ea' : g[0] === '#b35c00' ? '#fff4e0' : '#eef2fb';
    el.className = g[2] ? 'blink' : '';
  }

  // ---------------- datos iniciales ----------------
  function loadSedes(tramId, selectName) {
    var sel = $('ag2-sede'); sel.innerHTML = '<option>cargando...</option>';
    return api('/api/sedes?tramite=' + encodeURIComponent(tramId)).then(function (r) {
      var list = (r.json && r.json.data) || [];
      sel.innerHTML = '';
      list.forEach(function (s) {
        var o = document.createElement('option'); o.value = s.id_cfsm; o.textContent = s.dependencia; sel.appendChild(o);
      });
      if (!list.length) { sel.innerHTML = '<option value="">(sin sedes para este tramite)</option>'; }
      var pick = function (want) {
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === String(want) || noAccent(sel.options[i].textContent) === noAccent(want)) { sel.selectedIndex = i; return true; }
        }
        return false;
      };
      if (!(selectName && pick(selectName))) pick('MEDELLIN');
    }).catch(function () {
      sel.innerHTML = '<option value="">error al cargar sedes</option>';
      showMsg('err', 'No se pudieron cargar las sedes', 'Revise la conexion a internet y pulse F5 para recargar la pagina. Luego pulse el boton Agendador otra vez.');
    });
  }
  function checkSession(quiet) {
    return api('/api/auth/me').then(function (r) {
      if (r.status === 401 || !r.ok) {
        var was = st.session;
        st.session = 'none';
        $('ag2-who').innerHTML = '<b style="color:#b00020">No hay sesion iniciada.</b>';
        if (was === 'ok') {
          log('La sesion del portal se cerro.');
          showMsg('err', 'La sesion se cerro', 'El portal cerro la sesion. Pulse F5, inicie sesion otra vez con la cuenta del titular y pulse el boton Agendador.');
          if (st.running) { stop('Detenido: la sesion se cerro.', '#b00020'); beep(400, 400, 3); }
        }
        return false;
      }
      var d = (r.json && r.json.data) || {};
      st.who = [d.primer_nombre, d.primer_apellido].filter(Boolean).join(' ');
      st.session = 'ok';
      $('ag2-who').innerHTML = 'Titular: <b>' + esc(st.who) + '</b> <span style="color:#107c10">(sesion activa)</span>';
      return true;
    }).catch(function () {
      if (!quiet) $('ag2-who').textContent = 'No se pudo comprobar la sesion (problema de conexion).';
      return null;
    });
  }
  checkSession();
  setInterval(function () { if (!st.busy) checkSession(true); }, 120000);
  api('/api/tramites').then(function (r) {
    var list = (r.json && r.json.data) || [];
    var sel = $('ag2-tram'); sel.innerHTML = '';
    list.forEach(function (t) {
      var o = document.createElement('option'); o.value = t.id_tipo_tramite; o.textContent = t.tramite; sel.appendChild(o);
    });
    if (saved.tramite) sel.value = String(saved.tramite);
    sel.onchange = function () { loadSedes(sel.value).then(save); };
    $('ag2-sede').onchange = save; $('ag2-stop').onchange = save;
    return loadSedes(sel.value, saved.sede);
  }).catch(function () {
    showMsg('err', 'No se pudieron cargar los tramites', 'Revise la conexion a internet y pulse F5 para recargar la pagina. Luego pulse el boton Agendador otra vez.');
  });

  // ---------------- Turnstile ----------------
  var TT_ERRORS = {
    '1': 'error interno de Cloudflare', '100': 'problema al iniciar la verificacion', '102': 'parametros invalidos',
    '103': 'parametros invalidos', '104': 'parametros invalidos', '106': 'parametros invalidos',
    '105': 'version de Cloudflare desactualizada', '110100': 'clave del sitio no valida', '110110': 'clave del sitio no valida',
    '110200': 'dominio no autorizado', '110420': 'accion no valida', '110500': 'navegador no compatible',
    '110510': 'navegador con comportamiento inusual', '200010': 'datos guardados del navegador invalidos',
    '200100': 'la hora del computador esta mal', '300': 'Cloudflare no pudo confirmar que es una persona',
    '600': 'Cloudflare no pudo confirmar que es una persona'
  };
  function ttErrorText(code) {
    var c = String(code || '');
    var k = TT_ERRORS[c] || TT_ERRORS[c.slice(0, 3)] || TT_ERRORS[c.charAt(0)] || 'error desconocido';
    return k + (c ? ' (codigo ' + c + ')' : '');
  }
  function freshTokens() {
    var t = Date.now();
    var before = st.tokens.length;
    st.tokens = st.tokens.filter(function (x) { return t - x.t < TOKEN_LIFE_MS; });
    if (st.tokens.length < before) {
      Object.keys(st.wstate).forEach(function (w) {
        if (st.wstate[w].state === 'lista' && !st.tokens.some(function (x) { return String(x.wid) === w; })) {
          st.wstate[w].state = 'pendiente';
          try { window.turnstile.reset(w); } catch (e) {}
        }
      });
    }
    return st.tokens;
  }
  function showTokens() {
    var n = freshTokens().length;
    var el = $('ag2-tokinfo'); if (!el) return;
    el.textContent = 'Verificaciones listas: ' + n + ' de ' + N_WIDGETS;
    el.style.color = n ? '#107c10' : '#b00020';
    Object.keys(st.wstate).forEach(function (w) {
      var s = st.wstate[w], lbl = s.label;
      if (!lbl) return;
      if (s.state === 'lista') {
        var x = st.tokens.filter(function (y) { return String(y.wid) === w; })[0];
        var left = x ? TOKEN_LIFE_MS - (Date.now() - x.t) : 0;
        lbl.textContent = '✓ Lista. Vence en ' + mmss(left) + '.';
        lbl.style.color = left < 60000 ? '#b35c00' : '#107c10';
      } else if (s.state === 'error') {
        lbl.textContent = '✗ Error: ' + ttErrorText(s.code) + '. Se reintenta sola; si sigue igual, pulse F5.';
        lbl.style.color = '#b00020';
      } else {
        lbl.textContent = 'Pendiente: marque esta casilla.';
        lbl.style.color = '#666';
      }
    });
  }
  function takeToken() {
    var list = freshTokens();
    if (!list.length) return null;
    list.sort(function (a, b) { return a.t - b.t; });   // primero la mas antigua
    var x = list.shift();
    st.tokens = list;
    if (st.wstate[x.wid]) st.wstate[x.wid].state = 'pendiente';
    try { window.turnstile.reset(x.wid); } catch (e) {}   // el token es de un solo uso
    showTokens();
    return x.tok;
  }
  function renderWidgets() {
    var host = $('ag2-tt'); host.innerHTML = '';
    for (var i = 0; i < N_WIDGETS; i++) {
      (function (num) {
        var d = document.createElement('div'); d.style.margin = '4px 0 0'; host.appendChild(d);
        var lbl = document.createElement('div'); lbl.className = 'wl'; host.appendChild(lbl);
        var wid = window.turnstile.render(d, {
          sitekey: SITEKEY, action: ACTION, language: 'es', theme: 'light', size: 'normal',
          'refresh-expired': 'manual',
          callback: function (tok) {
            st.tokens = st.tokens.filter(function (x) { return x.wid !== wid; });
            st.tokens.push({ tok: tok, t: Date.now(), wid: wid });
            st.wstate[wid].state = 'lista';
            showTokens(); log('Casilla ' + num + ': verificacion lista.');
          },
          'expired-callback': function () {
            st.tokens = st.tokens.filter(function (x) { return x.wid !== wid; });
            st.wstate[wid].state = 'pendiente';
            log('Casilla ' + num + ': la verificacion vencio; hay que marcarla otra vez.');
            showTokens();
            try { window.turnstile.reset(wid); } catch (e) {}
          },
          'error-callback': function (code) {
            st.wstate[wid].state = 'error'; st.wstate[wid].code = code;
            log('Casilla ' + num + ': Cloudflare dio un error: ' + ttErrorText(code) + '.');
            showTokens();
            setTimeout(function () { try { window.turnstile.reset(wid); } catch (e) {} }, 3000);
            return true;   // el error ya se maneja aqui
          },
          'unsupported-callback': function () {
            showMsg('err', 'Navegador no compatible', 'Cloudflare no funciona en este navegador. Use Google Chrome o Microsoft Edge actualizados, en un computador.');
          }
        });
        st.wstate[wid] = { state: 'pendiente', label: lbl };
        st.widgets.push(wid);
      })(i + 1);
    }
    st.ttLoaded = true;
    showTokens();
    setInterval(showTokens, 1000);
  }
  function loadTurnstile() {
    if (window.turnstile && window.turnstile.render) { renderWidgets(); return; }
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      var w = setInterval(function () { if (window.turnstile && window.turnstile.render) { clearInterval(w); renderWidgets(); } }, 100);
    };
    s.onerror = function () {
      log('ERROR: no se pudo cargar la verificacion de Cloudflare.');
      $('ag2-tt').textContent = 'No se pudo cargar la verificacion de Cloudflare.';
      showMsg('err', 'No cargo la verificacion de seguridad', 'Revise la conexion a internet. Si usa un bloqueador de anuncios, desactivelo en esta pagina. Luego pulse F5 y el boton Agendador otra vez.');
    };
    document.head.appendChild(s);
  }
  loadTurnstile();

  // ---------------- busqueda y reserva ----------------
  function stop(msg, color) {
    st.running = false; clearInterval(st.timer); st.timer = null;
    $('ag2-go').disabled = false; $('ag2-stopbtn').disabled = true; $('ag2-test').disabled = false;
    if (msg) status(msg, color);
    guide();
  }
  function success(fecha, hora, info) {
    st.done = true; stop('CITA AGENDADA', '#107c10');
    beep(1200, 180, 6);
    var rows = [['Fecha', fecha], ['Hora', hora || '?'], ['Sede', (info && info.sede) || selText('ag2-sede')],
      ['Tramite', selText('ag2-tram')], ['Radicado', info && info.radicado], ['Direccion', info && info.direccion]];
    showMsg('ok', 'CITA AGENDADA', rows.filter(function (x) { return x[1]; }).map(function (x) {
      return '<b>' + x[0] + ':</b> ' + esc(x[1]);
    }).join('<br>') + '<br><br>Tome una foto de esta pantalla o anote el radicado. Migracion envia un correo de confirmacion.<br>' +
      'Lleve el pasaporte y los ORIGINALES de todos los soportes.');
    log('AGENDADA ' + fecha + ' ' + (hora || '') + (info && info.radicado ? ' radicado ' + info.radicado : ''));
    setTimeout(function () { alert('CITA AGENDADA\n\nFecha: ' + fecha + '\nHora: ' + (hora || '?') + (info && info.radicado ? '\nRadicado: ' + info.radicado : '')); }, 50);
  }
  function findActive(tramName) {
    return api('/api/mis-citas', {}, 15000).then(function (r) {
      if (r.status === 401) throw new Error('sin sesion');
      var list = (r.json && r.json.data) || [];
      var hoy = localDate(new Date());
      return list.filter(function (c) {
        return c.estado === 'AGENDADA' && String(c.fecha_cita || '').slice(0, 10) >= hoy &&
          (!tramName || noAccent(c.tramite) === noAccent(tramName));
      })[0] || null;
    });
  }
  function book(sedeId, tramId, fecha, slot) {
    var tok = takeToken();
    var h = slot.hora_inicio || slot.id_hora_fk;
    if (!tok) { log('  ' + h + ': no hay verificacion lista para intentar.'); return Promise.resolve('NOTOKEN'); }
    log('  Intentando ' + fecha + ' ' + h + '...');
    var body = JSON.stringify({ sedeId: sedeId, tramiteId: tramId, fecha: fecha, horaId: slot.id_hora_fk, turnstileToken: tok });
    return api('/api/citas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }, BOOK_TIMEOUT_MS)
      .then(function (r) {
        if (r.ok && r.json && r.json.ok !== false) return 'OK';
        var e = errOf(r);
        if (r.status === 401) return 'AUTH';
        if (e.code === 'CITA_ACTIVA') return 'ACTIVA';
        st.bookFails++;
        var why = e.code === 'CAPTCHA_INVALID' ? 'el portal no acepto la verificacion; se usa otra' : e.text;
        log('  ' + h + ': no se pudo (' + why + (e.code && e.code !== 'CAPTCHA_INVALID' ? ', ' + e.code : '') + ').');
        return 'FAIL';
      }, function (err) {
        // Un tiempo agotado NO significa que no se agendo: se confirma con mis-citas.
        log('  ' + h + ': el portal no respondio a tiempo; se revisa en Mis citas...');
        return 'TIMEOUT';
      });
  }
  function attempt(sedeId, tramId, dias) {
    var tramName = selText('ag2-tram');
    var chain = Promise.resolve(null);
    dias.forEach(function (d) {
      var fecha = (typeof d === 'string' ? d : String(d.fecha || '')).slice(0, 10);
      if (!fecha) return;
      chain = chain.then(function (res) {
        if (res) return res;
        return api('/api/disponibilidad/slots?sede=' + sedeId + '&tramite=' + tramId + '&fecha=' + fecha).then(function (r) {
          var slots = (r.json && r.json.data) || (Array.isArray(r.json) ? r.json : []);
          log('  ' + fecha + ': ' + slots.length + ' horario(s) libre(s).');
          var inner = Promise.resolve(null);
          slots.forEach(function (sl) {
            if (sl.id_hora_fk == null) return;
            inner = inner.then(function (res2) {
              if (res2) return res2;
              return book(sedeId, tramId, fecha, sl).then(function (out) {
                if (out === 'OK') return findActive(tramName).catch(function () { return null; })
                  .then(function (info) { success(fecha, sl.hora_inicio, info); return 'DONE'; });
                if (out === 'ACTIVA' || out === 'TIMEOUT') return findActive(tramName).catch(function () { return null; }).then(function (c) {
                  if (c) { success(String(c.fecha_cita).slice(0, 10), c.hora_inicio, c); return 'DONE'; }
                  if (out === 'ACTIVA') {
                    stop('Este titular ya tiene una cita activa para este tramite.', '#107c10');
                    showMsg('warn', 'Ya tiene una cita activa', 'El portal dice que este titular YA tiene una cita activa para este tramite. No se puede agendar otra. Revise "Mis citas".');
                    return 'DONE';
                  }
                  return null;
                });
                if (out === 'AUTH') {
                  st.session = 'none';
                  stop('Detenido: la sesion se cerro.', '#b00020'); beep(400, 400, 3);
                  showMsg('err', 'La sesion se cerro', 'Pulse F5, inicie sesion otra vez y pulse el boton Agendador. Si todavia es la hora de los cupos, hagalo rapido.');
                  return 'DONE';
                }
                if (out === 'NOTOKEN') return 'NOTOKEN';
                return null;
              });
            });
          });
          return inner;
        }).catch(function () { return null; });
      });
    });
    return chain;
  }
  function endOfDay() {
    var msg = st.sawSlotsAt
      ? 'Aparecieron cupos a las ' + st.sawSlotsAt + ', pero se agotaron antes de poder agendar (' + st.bookFails + ' intento(s) fallido(s)).'
      : 'No aparecieron cupos para esta sede y este tramite hasta la hora de parada.';
    stop('Se detuvo: no se consiguio cupo hoy.', '#b35c00');
    log('Fin de la busqueda. ' + msg);
    showMsg('warn', 'No se consiguio cupo hoy', esc(msg) + '<br><br>Intente ' + nextReleaseText(now()) + ': inicie sesion a las 4:50 p.m., pulse BUSCAR Y AGENDAR a las 4:55 y marque las 3 casillas a las 4:58.');
  }
  function tick() {
    if (!st.running) return;
    guide();
    if (st.stopAt && now() > st.stopAt) { endOfDay(); return; }
    if (st.busy) {
      if (Date.now() - st.busySince > 45000) { log('Aviso: una consulta quedo colgada; se reinicia.'); st.busy = false; }
      else return;
    }
    // Alarma si no hay verificacion lista
    if (!freshTokens().length && Date.now() - st.lastNeedAlarm > 20000) {
      st.lastNeedAlarm = Date.now(); beep(660, 160, 2);
      status('Buscando, pero SIN verificacion: marque las casillas.', '#b00020');
    }
    st.busy = true; st.busySince = Date.now(); st.tries++;
    var sedeId = Number($('ag2-sede').value), tramId = Number($('ag2-tram').value);
    api('/api/disponibilidad/dias?sede=' + sedeId + '&tramite=' + tramId).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (st.netFails >= 5) log('La conexion volvio.');
      st.netFails = 0;
      var dias = (r.json && r.json.data) || [];
      if (!dias.length) {
        if (freshTokens().length) status('Buscando... sin cupos todavia (consulta ' + st.tries + ').', '#555');
        if (st.tries % 60 === 0) log('Sin cupos todavia (consulta ' + st.tries + ').');
        return;
      }
      if (!st.sawSlotsAt) st.sawSlotsAt = hhmmss(now());
      log('HAY CUPOS: ' + dias.map(function (d) { return typeof d === 'string' ? d.slice(0, 10) : d.fecha; }).join(', '));
      beep(880, 150, 1);
      status('HAY CUPOS. Agendando...', '#b35c00');
      return attempt(sedeId, tramId, dias).then(function (res) {
        if (res === 'NOTOKEN') { beep(660, 160, 3); status('HAY CUPOS: MARQUE LAS CASILLAS YA', '#b00020'); }
        else if (!res && st.running) status('Esos cupos se agotaron antes. Se sigue buscando...', '#b35c00');
      });
    }).catch(function (e) {
      st.netFails++;
      if (st.netFails === 5) log('Problema de conexion con el portal (' + (e && (e.message || e.name)) + '). Se sigue intentando.');
      if (st.netFails >= 5) status('Problema de conexion: reintentando...', '#b00020');
    }).finally(function () { st.busy = false; });
  }
  function availNow(sedeId, tramId) {
    return api('/api/disponibilidad/dias?sede=' + sedeId + '&tramite=' + tramId).then(function (r) {
      var dias = (r.json && r.json.data) || [];
      return dias.map(function (x) { return (typeof x === 'string' ? x : String(x.fecha || '')).slice(0, 10); }).filter(Boolean);
    });
  }
  // Mientras el panel esta abierto y no busca, revisa cada 20 s si hay cupos ahora mismo
  // (en sedes pequenas a veces quedan cupos libres durante la tarde y la noche).
  function refreshAvail() {
    if (st.running || st.done || st.session !== 'ok' || !$('ag2-sede').value || !$('ag2-tram').value) return;
    var sede = selText('ag2-sede');
    var sedeId = Number($('ag2-sede').value), tramId = Number($('ag2-tram').value);
    availNow(sedeId, tramId).then(function (f) {
      var had = st.avail && st.avail.fechas.length && st.avail.sede === sede;
      if (!f.length) { st.avail = { sede: sede, fechas: [] }; guide(); return; }
      return slotsOf(sedeId, tramId, f[0]).then(function (sl) {
        st.avail = { sede: sede, fechas: f, horas: sl.map(function (x) { return x.hora_inicio; }) };
        if (!had) { log('Hay cupos ahora en ' + sede + ' para el ' + f[0] + ': ' + st.avail.horas.join(', ') + '.'); beep(880, 150, 2); }
        guide();
      });
    }).catch(function () {});
  }
  setInterval(refreshAvail, 20000);
  setTimeout(refreshAvail, 2500);
  $('ag2-sede').addEventListener('change', function () { st.avail = null; setTimeout(refreshAvail, 300); });
  $('ag2-tram').addEventListener('change', function () { st.avail = null; setTimeout(refreshAvail, 1500); });

  $('ag2-go').onclick = function () {
    if (!$('ag2-sede').value || !$('ag2-tram').value) { showMsg('warn', 'Faltan datos', 'Elija el tramite y la sede.'); return; }
    if (st.session !== 'ok') { showMsg('err', 'No hay sesion', 'Inicie sesion en la pagina de Migracion con la cuenta del titular. Luego pulse el boton Agendador otra vez.'); return; }
    save();
    $('ag2-go').disabled = true;
    status('Revisando si hay cupos ahora...', '#555');
    availNow(Number($('ag2-sede').value), Number($('ag2-tram').value)).then(function (f) { return f; }, function () { return []; }).then(function (fechas) {
      $('ag2-go').disabled = false;
      var d = now(), stopAt = stopTimeToday();
      if (fechas.length) {
        // Hay cupos en este momento: se agenda ya, sin esperar a las 5:00 p.m.
        log('Hay cupos ahora (' + fechas.join(', ') + '): se intenta agendar ya.');
        startSearch(new Date(Date.now() + 15 * 60000), true);
        return;
      }
      if (!releaseDay(d)) {
        showMsg('warn', 'Ahora no hay cupos', 'En este momento no hay cupos en ' + esc(selText('ag2-sede')) + ' para este tramite. Hoy es ' + DIAS[d.getDay()] +
          ': hoy no salen cupos nuevos (salen de domingo a jueves, cerca de las 5:00 p.m.). Vuelva ' + nextReleaseText(d) + ' a las 4:50 p.m.<br><br>' +
          'Si el recuadro de arriba dice <b>HAY CUPOS AHORA</b>, pulse BUSCAR Y AGENDAR en ese momento.');
        return;
      }
      if (d > stopAt) {
        log('No se inicio: no hay cupos ahora y ya paso la hora de parada (' + $('ag2-stop').value + ').');
        showMsg('warn', 'Ahora no hay cupos', 'En este momento no hay cupos en ' + esc(selText('ag2-sede')) + ' para este tramite, y los cupos nuevos de hoy ya salieron (cerca de las 5:00 p.m.).<br><br>' +
          'Vuelva ' + nextReleaseText(d) + ':<br>&bull; 4:50 p.m.: inicie sesion<br>&bull; 4:55 p.m.: pulse BUSCAR Y AGENDAR<br>&bull; 4:58 p.m.: marque las 3 casillas<br><br>' +
          'Si el recuadro de arriba dice <b>HAY CUPOS AHORA</b>, pulse BUSCAR Y AGENDAR en ese momento.');
        return;
      }
      var early = new Date(d); early.setHours(16, 30, 0, 0);
      if (d < early && !confirm('Ahora no hay cupos. Los cupos nuevos salen cerca de las 5:00 p.m.\n\n' +
          'Lo mejor es pulsar BUSCAR Y AGENDAR a las 4:55 p.m.\n\nPulse Aceptar para buscar desde ya, o Cancelar para esperar.')) {
        return;
      }
      startSearch(stopAt, false);
    });
  };
  function startSearch(stopAt, nowMode) {
    $('ag2-go').disabled = true;
    status('Comprobando si ya tiene cita...', '#555');
    var tramName = selText('ag2-tram');
    findActive(tramName).then(function (c) {
      if (c) {
        $('ag2-go').disabled = false;
        status('Este titular ya tiene cita.', '#107c10');
        showMsg('ok', 'Ya tiene cita', '<b>Radicado:</b> ' + esc(c.radicado) + '<br><b>Fecha:</b> ' + esc(String(c.fecha_cita).slice(0, 10)) + ' ' + esc(c.hora_inicio || '') +
          '<br><b>Sede:</b> ' + esc(c.sede || '') + '<br><br>Cada persona solo puede tener una cita activa por tramite.');
        return;
      }
      st.avail = null; st.stopAt = stopAt; st.running = true; st.tries = 0; st.netFails = 0; st.sawSlotsAt = null; st.bookFails = 0;
      $('ag2-stopbtn').disabled = false; $('ag2-test').disabled = true;
      $('ag2-msg').style.display = 'none';
      log('Buscando: ' + tramName + ' en ' + selText('ag2-sede') + '. Se detiene sola a las ' + hhmmss(stopAt).slice(0, 5) + '.');
      if (nowMode && !freshTokens().length) showMsg('warn', 'Hay cupos ahora: falta la verificacion', 'Marque una casilla "Verifique que es un ser humano". En cuanto diga "\u2713 Lista", el programa agenda solo.');
      status('Buscando cupos...', '#555');
      st.timer = setInterval(tick, POLL_MS);
      tick();
    }, function (e) {
      $('ag2-go').disabled = false;
      status('No se pudo revisar "Mis citas".', '#b00020');
      if (e && e.message === 'sin sesion') { st.session = 'none'; showMsg('err', 'La sesion se cerro', 'Pulse F5, inicie sesion otra vez y pulse el boton Agendador.'); }
      else showMsg('err', 'Problema de conexion', 'No se pudo revisar "Mis citas". Revise la conexion a internet y pulse BUSCAR Y AGENDAR otra vez.');
    });
  }
  $('ag2-stopbtn').onclick = function () { stop('Detenido.', '#555'); log('Detenido por el usuario.'); };

  // ---------------- mantener la sesion ----------------
  // El portal cierra la sesion tras 15 minutos sin mover el raton ni usar el teclado.
  // Mientras este panel este abierto, se avisa al portal de actividad cada minuto.
  setInterval(function () {
    try { window.dispatchEvent(new Event('mousemove')); } catch (e) {}
  }, 60000);

  // ---------------- prueba ----------------
  // Envia UNA solicitud de reserva para un domingo lejano, sin cupos.
  // Ese dia nunca hay citas, asi que no se agenda nada. Solo comprueba que
  // el portal acepta la verificacion de Cloudflare que produce este panel.
  function nextEmptySunday(sedeId, tramId, k) {
    var d = new Date(); d.setDate(d.getDate() + 14 + ((7 - d.getDay()) % 7) + 7 * (k || 0));
    var f = localDate(d);
    return api('/api/disponibilidad/slots?sede=' + sedeId + '&tramite=' + tramId + '&fecha=' + f).then(function (r) {
      var slots = (r.json && r.json.data) || [];
      if (slots.length) { if ((k || 0) >= 3) throw new Error('hay cupos'); return nextEmptySunday(sedeId, tramId, (k || 0) + 1); }
      return f;
    });
  }
  $('ag2-test').onclick = function () {
    if (st.running) { showMsg('warn', 'Primero detenga la busqueda', 'Pulse DETENER antes de hacer la prueba.'); return; }
    if (st.session !== 'ok') { showMsg('err', 'No hay sesion', 'Inicie sesion en la pagina de Migracion y pulse el boton Agendador otra vez.'); return; }
    if (!freshTokens().length) {
      showMsg('warn', 'Falta la verificacion', 'Primero marque UNA casilla <i>"Verifique que es un ser humano"</i> y espere a que diga <b>"✓ Lista"</b>. Luego pulse PROBAR.');
      return;
    }
    var sedeId = Number($('ag2-sede').value), tramId = Number($('ag2-tram').value);
    if (!sedeId || !tramId) { showMsg('warn', 'Faltan datos', 'Elija el tramite y la sede.'); return; }
    $('ag2-test').disabled = true;
    status('Probando...', '#555');
    showMsg('info', 'Probando...', 'Espere unos segundos.');
    nextEmptySunday(sedeId, tramId).then(function (fecha) {
      var tok = takeToken();
      log('PRUEBA: solicitud para el domingo ' + fecha + ' (ese dia no hay citas).');
      var body = JSON.stringify({ sedeId: sedeId, tramiteId: tramId, fecha: fecha, horaId: 3, turnstileToken: tok });
      return api('/api/citas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }, BOOK_TIMEOUT_MS);
    }).then(function (r) {
      var e = errOf(r);
      var raw = e.text + (e.code ? ' (' + e.code + ')' : '') + ' [HTTP ' + r.status + ']';
      log('PRUEBA: respuesta del portal: ' + raw);
      if (r.status === 401) {
        st.session = 'none';
        status('Prueba no valida: no hay sesion.', '#b00020');
        showMsg('err', 'Prueba no valida: la sesion se cerro', 'Pulse F5, inicie sesion otra vez, pulse el boton Agendador y repita la prueba.');
      } else if (e.code === 'CAPTCHA_INVALID' || e.text === 'Required') {
        status('PRUEBA FALLIDA', '#b00020');
        showMsg('err', 'PRUEBA FALLIDA', 'El portal <b>no acepto</b> la verificacion de Cloudflare.<br>Respuesta del portal: <i>' + esc(raw) + '</i><br><br>' +
          'Pulse <b>Copiar registro</b> y envie el texto (o una foto de esta pantalla) a quien le envio este programa.');
      } else if (r.ok && (r.json || {}).ok !== false) {
        status('ATENCION: el portal acepto la solicitud', '#b35c00');
        showMsg('warn', 'ATENCION', 'El portal respondio como si hubiera agendado. Revise "Mis citas" y cancele cualquier cita de prueba. Avise a quien le envio este programa.');
      } else {
        status('PRUEBA CORRECTA', '#107c10');
        beep(1200, 150, 2);
        showMsg('ok', 'PRUEBA CORRECTA', 'El portal <b>acepto</b> la verificacion de Cloudflare. No se agendo nada.<br>' +
          '<span style="font-size:12px;color:#555">Respuesta del portal: ' + esc(raw) + '</span><br><br>El programa esta listo para el dia de la cita.');
      }
    }).catch(function (err) {
      var m = err && (err.name === 'AbortError' ? 'el portal no respondio a tiempo' : (err.message || err.name));
      status('La prueba no se pudo completar.', '#b00020');
      log('PRUEBA: error: ' + m);
      showMsg('err', 'La prueba no se pudo completar', 'Motivo: ' + esc(m) + '.<br>Revise la conexion a internet y pruebe otra vez en un minuto.');
    }).finally(function () { $('ag2-test').disabled = st.running; });
  };

  // ---------------- cupos en todas las sedes ----------------
  function scrollPanelTo(el) {
    try { box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 140; } catch (e) {}
  }
  function fechaTxt(f) {
    var d = new Date(f + 'T12:00:00');
    return isNaN(d) ? f : DIAS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  }
  function slotsOf(sedeId, tramId, fecha) {
    return api('/api/disponibilidad/slots?sede=' + sedeId + '&tramite=' + tramId + '&fecha=' + fecha).then(function (r) {
      return ((r.json && r.json.data) || []).filter(function (x) { return x.id_hora_fk != null; });
    });
  }
  function pool(items, n, fn) {
    var i = 0, out = new Array(items.length);
    function next() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(items[k], k)).then(function (v) { out[k] = v; }, function () { out[k] = null; }).then(next);
    }
    var runners = []; for (var j = 0; j < n; j++) runners.push(next());
    return Promise.all(runners).then(function () { return out; });
  }
  function scanAll() {
    var tramId = Number($('ag2-tram').value);
    var sedes = Array.prototype.slice.call($('ag2-sede').options).filter(function (o) { return o.value; })
      .map(function (o) { return { id: Number(o.value), name: o.textContent }; });
    var res = $('ag2-allres');
    if (!tramId || !sedes.length) { showMsg('warn', 'Faltan datos', 'Elija primero el tramite.'); return; }
    $('ag2-all').disabled = true;
    res.style.display = 'block';
    var done = 0;
    res.innerHTML = '<div class="hd">Revisando 0 de ' + sedes.length + ' sedes...</div>';
    scrollPanelTo(res);
    pool(sedes, 5, function (s) {
      return availNow(s.id, tramId).then(function (fechas) {
        return pool(fechas, 2, function (f) {
          return slotsOf(s.id, tramId, f).then(function (sl) { return { fecha: f, slots: sl }; });
        }).then(function (perDay) {
          done++; res.querySelector('.hd') && (res.querySelector('.hd').textContent = 'Revisando ' + done + ' de ' + sedes.length + ' sedes...');
          return { sede: s, dias: (perDay || []).filter(function (x) { return x && x.slots.length; }) };
        });
      }, function () { done++; return { sede: s, error: true }; });
    }).then(function (rows) {
      $('ag2-all').disabled = false;
      rows = rows.filter(Boolean);
      var withSlots = rows.filter(function (r) { return r.dias && r.dias.length; });
      var errors = rows.filter(function (r) { return r.error; }).length;
      var tram = selText('ag2-tram');
      var html = '<div class="hd">' + esc(tram) + ' &mdash; ' + withSlots.length + ' de ' + rows.length + ' sedes con cupos (a las ' + hhmmss(now()).slice(0, 5) + ')' +
        (errors ? ' &middot; ' + errors + ' sin respuesta' : '') + '. Toque una sede para elegirla.</div>';
      if (withSlots.length) {
        html += '<table><tr><th>Sede</th><th>Dia</th><th>Horarios libres</th></tr>';
        withSlots.forEach(function (r) {
          r.dias.forEach(function (d, i) {
            var total = d.slots.reduce(function (a, x) { return a + (Number(x.cupos) || 1); }, 0);
            html += '<tr class="r' + (String(r.sede.id) === $('ag2-sede').value ? ' sel' : '') + '" data-sede="' + r.sede.id + '">' +
              '<td><b>' + (i ? '' : esc(r.sede.name)) + '</b></td><td>' + esc(fechaTxt(d.fecha)) + '</td><td>' +
              esc(d.slots.map(function (x) { return x.hora_inicio; }).join(', ')) + ' <span style="color:#666">(' + total + ' cupo' + (total === 1 ? '' : 's') + ')</span></td></tr>';
          });
        });
        html += '</table>';
      } else {
        html += '<div style="padding:6px">En este momento ninguna sede tiene cupos para este tramite. Los cupos nuevos salen de domingo a jueves cerca de las 5:00 p.m.</div>';
      }
      res.innerHTML = html;
      scrollPanelTo(res);
      Array.prototype.forEach.call(res.querySelectorAll('tr.r'), function (tr) {
        tr.onclick = function () {
          var sel = $('ag2-sede'); sel.value = tr.getAttribute('data-sede'); sel.dispatchEvent(new Event('change')); save();
          Array.prototype.forEach.call(res.querySelectorAll('tr.r'), function (x) { x.classList.toggle('sel', x.getAttribute('data-sede') === sel.value); });
          showMsg('info', 'Sede elegida: ' + selText('ag2-sede'), 'Para agendar ahi: marque una casilla, espere "\u2713 Lista" y pulse <b>BUSCAR Y AGENDAR</b>.<br>' +
            'Recuerde: la cita es real y solo puede haber una cita activa por tramite.');
        };
      });
      log('Cupos en todas las sedes (' + tram + '): ' + (withSlots.length ? withSlots.map(function (r) { return r.sede.name; }).join(', ') : 'ninguna') + '.');
    });
  }
  $('ag2-all').onclick = scanAll;
  $('ag2-tram').addEventListener('change', function () { $('ag2-allres').style.display = 'none'; });

  window.__agendadorV2 = { show: function () { box.style.display = ''; $('ag2-body').style.display = ''; }, state: st, version: VERSION };
  guide();
  setInterval(function () { if (!st.running) guide(); }, 1000);
  log('Agendador ' + VERSION + ' listo.');
})();

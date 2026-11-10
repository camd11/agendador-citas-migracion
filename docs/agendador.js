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
  var VERSION = '2.0.2';
  var SITEKEY = '0x4AAAAAAF0_ravvCrdYLiwp';   // clave publica del portal (pagina /agendar)
  var ACTION = 'appointment_booking';         // la misma accion que usa el portal; el servidor la exige
  var BASE = '/citas';
  var N_WIDGETS = 3;          // tres verificaciones = tres intentos de reserva
  var TOKEN_LIFE_MS = 280000; // Cloudflare: el token vale 300 s; usamos 280 s
  var POLL_MS = 1000;
  var REQ_TIMEOUT_MS = 6000;
  var BOOK_TIMEOUT_MS = 25000;

  if (location.host !== 'apps.migracioncolombia.gov.co' || location.pathname.indexOf(BASE) !== 0) {
    alert('Abra primero https://apps.migracioncolombia.gov.co/citas/agendar, inicie sesion con la cuenta del titular y vuelva a pulsar el marcador.');
    location.href = 'https://apps.migracioncolombia.gov.co/citas/agendar';
    return;
  }
  if (window.__agendadorV2) { window.__agendadorV2.show(); return; }

  // ---------------- estado ----------------
  var st = {
    running: false, busy: false, busySince: 0, tries: 0, stopAt: null,
    tokens: [],          // {tok, t, wid}
    widgets: [],         // ids de turnstile
    done: false, timer: null, lastNeedAlarm: 0
  };

  // ---------------- utilidades ----------------
  function $(id) { return document.getElementById(id); }
  function now() { return new Date(); }
  function hhmmss(d) { return d.toTimeString().slice(0, 8); }
  function noAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  function log(m) {
    var line = '[' + hhmmss(now()) + '] ' + m;
    var el = $('ag2-log'); if (el) { el.value += line + '\n'; el.scrollTop = el.scrollHeight; }
    try { console.log('[agendador] ' + line); } catch (e) {}
  }
  function status(m, color) { var el = $('ag2-status'); if (el) { el.textContent = m; el.style.color = color || '#333'; } }
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
  function save() {
    try {
      localStorage.setItem('agendador_v2', JSON.stringify({
        tramite: $('ag2-tram').value, sede: $('ag2-sede').value, stop: $('ag2-stop').value
      }));
    } catch (e) {}
  }
  function loadSaved() { try { return JSON.parse(localStorage.getItem('agendador_v2') || '{}'); } catch (e) { return {}; } }

  // ---------------- panel ----------------
  var css = '#ag2{position:fixed;top:12px;right:12px;width:430px;z-index:2147483647;background:#fff;border:2px solid #0a2463;' +
    'border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.35);font:14px Segoe UI,Arial,sans-serif;color:#222}' +
    '#ag2 h3{margin:0;padding:10px 14px;background:#0a2463;color:#fff;font-size:16px;border-radius:7px 7px 0 0;display:flex;justify-content:space-between}' +
    '#ag2 .b{padding:10px 14px}#ag2 label{display:block;font-weight:600;margin:8px 0 3px}' +
    '#ag2 select,#ag2 input{width:100%;box-sizing:border-box;padding:5px;font-size:14px}' +
    '#ag2 .row{display:flex;gap:8px}#ag2 .row>*{flex:1}' +
    '#ag2 button{padding:10px;font-size:15px;font-weight:700;border:0;border-radius:6px;cursor:pointer}' +
    '#ag2-go{background:#107c10;color:#fff}#ag2-stopbtn{background:#ccc;color:#222}' +
    '#ag2-status{font-weight:700;margin:8px 0;min-height:20px}' +
    '#ag2-log{width:100%;height:110px;font:12px Consolas,monospace;background:#f6f6f8}' +
    '#ag2-ver{border:2px dashed #c60;border-radius:6px;padding:6px;margin-top:8px;background:#fff8ef}' +
    '#ag2-ver p{margin:0 0 6px;font-size:13px}#ag2-tokinfo{font-weight:700}' +
    '#ag2 .x{background:none;color:#fff;font-size:18px;padding:0 4px}';
  var styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl);
  var saved = loadSaved();
  var box = document.createElement('div'); box.id = 'ag2';
  box.innerHTML =
    '<h3><span>Agendador de Citas ' + VERSION + '</span><button class="x" id="ag2-min" title="Minimizar">_</button></h3>' +
    '<div class="b" id="ag2-body">' +
    '<div id="ag2-who">Comprobando la sesion...</div>' +
    '<label>Tramite</label><select id="ag2-tram"><option>cargando...</option></select>' +
    '<div class="row"><div><label>Sede</label><select id="ag2-sede"><option>elija el tramite</option></select></div>' +
    '<div style="flex:0 0 110px"><label>Parar a las</label><input id="ag2-stop" value="' + (saved.stop || '17:15') + '"></div></div>' +
    '<div id="ag2-ver"><p><b>Verificacion de seguridad.</b> A las 4:58 p.m. marque las ' + N_WIDGETS +
    ' casillas <i>"Verifique que es un ser humano"</i>. Cada casilla vale 5 minutos y sirve para un intento. ' +
    'Si suena una alarma doble, vuelva a marcarlas.</p><div id="ag2-tt"></div><div id="ag2-tokinfo">Verificaciones listas: 0</div></div>' +
    '<div class="row" style="margin-top:10px"><button id="ag2-go">BUSCAR Y AGENDAR</button>' +
    '<button id="ag2-stopbtn" disabled style="flex:0 0 110px">DETENER</button></div>' +
    '<button id="ag2-test" style="width:100%;margin-top:6px;background:#e8eefc;color:#0a2463">PROBAR (no agenda nada)</button>' +
    '<div id="ag2-status">Listo.</div>' +
    '<textarea id="ag2-log" readonly></textarea>' +
    '<div style="font-size:12px;color:#666;margin-top:4px">Deje esta pestana <b>visible y al frente</b>. Si la oculta, el navegador la vuelve lenta.</div>' +
    '</div>';
  document.body.appendChild(box);
  $('ag2-min').onclick = function () { var b = $('ag2-body'); b.style.display = b.style.display === 'none' ? '' : 'none'; };

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
      var want = selectName || 'MEDELLIN';
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === String(want) || noAccent(sel.options[i].textContent) === noAccent(want)) { sel.selectedIndex = i; break; }
      }
    }).catch(function () { sel.innerHTML = '<option value="">error al cargar sedes</option>'; });
  }
  api('/api/auth/me').then(function (r) {
    if (r.status === 401 || !r.ok) {
      $('ag2-who').innerHTML = '<b style="color:#b00">No hay sesion iniciada.</b> Inicie sesion con la cuenta del titular y pulse el marcador otra vez.';
      return;
    }
    var d = (r.json && r.json.data) || {};
    $('ag2-who').innerHTML = 'Titular: <b>' + [d.primer_nombre, d.primer_apellido].filter(Boolean).join(' ') + '</b>';
  }).catch(function () { $('ag2-who').textContent = 'No se pudo comprobar la sesion.'; });
  api('/api/tramites').then(function (r) {
    var list = (r.json && r.json.data) || [];
    var sel = $('ag2-tram'); sel.innerHTML = '';
    list.forEach(function (t) {
      var o = document.createElement('option'); o.value = t.id_tipo_tramite; o.textContent = t.tramite; sel.appendChild(o);
    });
    if (saved.tramite) sel.value = String(saved.tramite);
    sel.onchange = function () { loadSedes(sel.value); save(); };
    $('ag2-sede').onchange = save; $('ag2-stop').onchange = save;
    return loadSedes(sel.value, saved.sede);
  });

  // ---------------- Turnstile ----------------
  function freshTokens() {
    var t = Date.now();
    st.tokens = st.tokens.filter(function (x) { return t - x.t < TOKEN_LIFE_MS; });
    return st.tokens;
  }
  function showTokens() {
    var n = freshTokens().length;
    var el = $('ag2-tokinfo');
    el.textContent = 'Verificaciones listas: ' + n + ' de ' + N_WIDGETS;
    el.style.color = n ? '#107c10' : '#b00';
  }
  function takeToken() {
    var list = freshTokens();
    if (!list.length) return null;
    list.sort(function (a, b) { return a.t - b.t; });   // primero la mas antigua
    var x = list.shift();
    st.tokens = list;
    try { window.turnstile.reset(x.wid); } catch (e) {}   // el token es de un solo uso
    showTokens();
    return x.tok;
  }
  function renderWidgets() {
    var host = $('ag2-tt');
    for (var i = 0; i < N_WIDGETS; i++) {
      (function () {
        var d = document.createElement('div'); d.style.margin = '4px 0'; host.appendChild(d);
        var wid = window.turnstile.render(d, {
          sitekey: SITEKEY, action: ACTION, language: 'es', theme: 'light', size: 'normal',
          'refresh-expired': 'manual',
          callback: function (tok) {
            st.tokens = st.tokens.filter(function (x) { return x.wid !== wid; });
            st.tokens.push({ tok: tok, t: Date.now(), wid: wid });
            showTokens(); log('Verificacion lista (' + freshTokens().length + ').');
          },
          'expired-callback': function () {
            st.tokens = st.tokens.filter(function (x) { return x.wid !== wid; });
            showTokens();
            try { window.turnstile.reset(wid); } catch (e) {}
          },
          'error-callback': function () { log('Cloudflare dio un error en una casilla; se reinicia.'); try { window.turnstile.reset(wid); } catch (e) {} }
        });
        st.widgets.push(wid);
      })();
    }
    showTokens();
    setInterval(showTokens, 5000);
  }
  function loadTurnstile() {
    if (window.turnstile && window.turnstile.render) { renderWidgets(); return; }
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      var w = setInterval(function () { if (window.turnstile && window.turnstile.render) { clearInterval(w); renderWidgets(); } }, 100);
    };
    s.onerror = function () { log('ERROR: no se pudo cargar la verificacion de Cloudflare.'); };
    document.head.appendChild(s);
  }
  loadTurnstile();

  // ---------------- busqueda y reserva ----------------
  function stop(msg, color) {
    st.running = false; clearInterval(st.timer); st.timer = null;
    $('ag2-go').disabled = false; $('ag2-stopbtn').disabled = true;
    if (msg) status(msg, color);
  }
  function success(fecha, slot, info) {
    st.done = true; stop('CITA AGENDADA', '#107c10');
    beep(1200, 180, 6);
    var msg = 'CITA AGENDADA\n\nFecha: ' + fecha + '\nHora: ' + (slot.hora_inicio || '?') +
      '\nSede: ' + $('ag2-sede').selectedOptions[0].textContent +
      '\nTramite: ' + $('ag2-tram').selectedOptions[0].textContent +
      (info && info.radicado ? '\nRadicado: ' + info.radicado : '') +
      (info && info.direccion ? '\n' + info.direccion : '') +
      '\n\nLleve el pasaporte y los ORIGINALES de todos los soportes.';
    log('AGENDADA ' + fecha + ' ' + (slot.hora_inicio || '') + (info && info.radicado ? ' radicado ' + info.radicado : ''));
    setTimeout(function () { alert(msg); }, 50);
  }
  function findActive(tramName) {
    return api('/api/mis-citas', {}, 15000).then(function (r) {
      var list = (r.json && r.json.data) || [];
      var hoy = new Date().toISOString().slice(0, 10);
      return list.filter(function (c) {
        return c.estado === 'AGENDADA' && String(c.fecha_cita || '').slice(0, 10) >= hoy &&
          (!tramName || noAccent(c.tramite) === noAccent(tramName));
      })[0] || null;
    });
  }
  function book(sedeId, tramId, fecha, slot) {
    var tok = takeToken();
    if (!tok) { log('  sin verificacion lista para ' + (slot.hora_inicio || slot.id_hora_fk)); return Promise.resolve('NOTOKEN'); }
    var body = JSON.stringify({ sedeId: sedeId, tramiteId: tramId, fecha: fecha, horaId: slot.id_hora_fk, turnstileToken: tok });
    return api('/api/citas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }, BOOK_TIMEOUT_MS)
      .then(function (r) {
        if (r.ok && r.json && r.json.ok !== false) return 'OK';
        var j = r.json || {};
        var code = j.code || (j.data && j.data.code) || '';
        var err = j.error || (j.data && j.data.error) || ('HTTP ' + r.status);
        if (r.status === 401) return 'AUTH';
        if (code === 'CITA_ACTIVA') return 'ACTIVA';
        log('  fallo ' + (slot.hora_inicio || slot.id_hora_fk) + ' -> ' + err + (code ? ' (' + code + ')' : ''));
        return 'FAIL';
      }, function (e) {
        // Un tiempo agotado NO significa que no se agendo: se confirma con mis-citas.
        log('  sin respuesta al reservar (' + (e && e.name) + '); se confirma en Mis citas...');
        return 'TIMEOUT';
      });
  }
  function attempt(sedeId, tramId, dias) {
    var tramName = $('ag2-tram').selectedOptions[0].textContent;
    var chain = Promise.resolve(null);
    dias.forEach(function (d) {
      var fecha = (typeof d === 'string' ? d : String(d.fecha || '')).slice(0, 10);
      if (!fecha) return;
      chain = chain.then(function (res) {
        if (res) return res;
        return api('/api/disponibilidad/slots?sede=' + sedeId + '&tramite=' + tramId + '&fecha=' + fecha).then(function (r) {
          var slots = (r.json && r.json.data) || (Array.isArray(r.json) ? r.json : []);
          log('  ' + fecha + ' -> ' + slots.length + ' horario(s)');
          var inner = Promise.resolve(null);
          slots.forEach(function (sl) {
            if (sl.id_hora_fk == null) return;
            inner = inner.then(function (res2) {
              if (res2) return res2;
              return book(sedeId, tramId, fecha, sl).then(function (out) {
                if (out === 'OK') return findActive(tramName).catch(function () { return null; })
                  .then(function (info) { success(fecha, sl, info); return 'DONE'; });
                if (out === 'ACTIVA' || out === 'TIMEOUT') return findActive(tramName).catch(function () { return null; }).then(function (c) {
                  if (c) { success(String(c.fecha_cita).slice(0, 10), { hora_inicio: c.hora_inicio }, c); return 'DONE'; }
                  if (out === 'ACTIVA') { stop('Ya existe una cita activa para este tramite', '#107c10'); alert('Este titular YA tiene una cita activa para este tramite. No se puede agendar otra.'); return 'DONE'; }
                  return null;
                });
                if (out === 'AUTH') { stop('La sesion se cerro. Inicie sesion otra vez.', '#b00'); beep(400, 400, 3); return 'DONE'; }
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
  function tick() {
    if (!st.running) return;
    if (st.stopAt && now() > st.stopAt) {
      stop('Se detuvo: no se consiguio cupo hoy. Intente el proximo dia a las 4:50 p.m.', '#c60');
      log('Fin de la busqueda. No hubo cupos.');
      return;
    }
    if (st.busy) {
      if (Date.now() - st.busySince > 45000) { log('Aviso: una consulta quedo colgada; se reinicia.'); st.busy = false; }
      else return;
    }
    // Alarma si no hay verificacion lista
    if (!freshTokens().length && Date.now() - st.lastNeedAlarm > 20000) {
      st.lastNeedAlarm = Date.now(); beep(660, 160, 2);
      status('MARQUE LAS CASILLAS DE VERIFICACION', '#b00');
    }
    st.busy = true; st.busySince = Date.now(); st.tries++;
    var sedeId = Number($('ag2-sede').value), tramId = Number($('ag2-tram').value);
    api('/api/disponibilidad/dias?sede=' + sedeId + '&tramite=' + tramId).then(function (r) {
      var dias = (r.json && r.json.data) || [];
      if (!dias.length) {
        if (freshTokens().length) status('Sin cupos por ahora (intento ' + st.tries + '). Salen cerca de las 5:00 p.m.', '#555');
        if (st.tries % 60 === 0) log('sin cupos (intento ' + st.tries + ')');
        return;
      }
      log('HAY CUPOS: ' + dias.map(function (d) { return typeof d === 'string' ? d.slice(0, 10) : d.fecha; }).join(', '));
      beep(880, 150, 1);
      status('Cupos encontrados. Agendando...', '#c60');
      return attempt(sedeId, tramId, dias).then(function (res) {
        if (res === 'NOTOKEN') { beep(660, 160, 3); status('HAY CUPOS: MARQUE LAS CASILLAS YA', '#b00'); }
      });
    }).catch(function () { /* red lenta: se reintenta en el siguiente ciclo */ })
      .finally(function () { st.busy = false; });
  }
  $('ag2-go').onclick = function () {
    if (!$('ag2-sede').value || !$('ag2-tram').value) { alert('Elija el tramite y la sede.'); return; }
    save();
    $('ag2-go').disabled = true;
    status('Comprobando...', '#555');
    var tramName = $('ag2-tram').selectedOptions[0].textContent;
    findActive(tramName).then(function (c) {
      if (c) {
        $('ag2-go').disabled = false;
        status('Este titular ya tiene cita', '#107c10');
        alert('Ya tiene cita.\n\nRadicado: ' + c.radicado + '\nFecha: ' + String(c.fecha_cita).slice(0, 10) + ' ' + (c.hora_inicio || '') + '\nSede: ' + (c.sede || ''));
        return;
      }
      st.stopAt = null;
      var m = /^(\d{1,2}):(\d{2})$/.exec($('ag2-stop').value.trim());
      if (!m) m = [null, '17', '15'];
      var d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
      if (d < new Date()) {
        // Ya paso la hora de parada de hoy: los cupos de hoy ya salieron.
        $('ag2-go').disabled = false;
        status('Ya paso la hora de los cupos de hoy. Vuelva el proximo dia a las 4:50 p.m.', '#c60');
        log('No se inicio: ya son mas de las ' + m[1] + ':' + m[2] + '.');
        alert('YA PASO LA HORA DE LOS CUPOS DE HOY\n\n' +
          'Los cupos salen de domingo a jueves cerca de las 5:00 p.m. y en Medellin se acaban en menos de un minuto.\n\n' +
          'Vuelva el proximo dia de domingo a jueves:\n' +
          '  4:50 p.m.  inicie sesion\n  4:55 p.m.  pulse BUSCAR Y AGENDAR\n  4:58 p.m.  marque las 3 casillas');
        return;
      }
      var early = new Date(); early.setHours(16, 30, 0, 0);
      if (new Date() < early && !confirm('Todavia es temprano. Los cupos salen cerca de las 5:00 p.m.\n\n' +
          'Lo mejor es pulsar BUSCAR Y AGENDAR a las 4:55 p.m.\n\nPulse Aceptar para buscar desde ya, o Cancelar para esperar.')) {
        $('ag2-go').disabled = false; status('Listo. Pulse BUSCAR Y AGENDAR a las 4:55 p.m.', '#555'); return;
      }
      st.stopAt = d; log('Se detendra automaticamente a las ' + m[1] + ':' + m[2]);
      st.running = true; st.tries = 0;
      $('ag2-stopbtn').disabled = false;
      log('Buscando: ' + tramName + ' en ' + $('ag2-sede').selectedOptions[0].textContent);
      status('Buscando cupos...', '#555');
      st.timer = setInterval(tick, POLL_MS);
      tick();
    }, function () {
      $('ag2-go').disabled = false;
      status('No se pudo consultar Mis citas. Revise la sesion.', '#b00');
    });
  };
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
    var f = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return api('/api/disponibilidad/slots?sede=' + sedeId + '&tramite=' + tramId + '&fecha=' + f).then(function (r) {
      var slots = (r.json && r.json.data) || [];
      if (slots.length) { if ((k || 0) >= 3) throw new Error('hay cupos'); return nextEmptySunday(sedeId, tramId, (k || 0) + 1); }
      return f;
    });
  }
  $('ag2-test').onclick = function () {
    if (st.running) { alert('Pulse DETENER antes de hacer la prueba.'); return; }
    if (!freshTokens().length) { alert('Primero marque UNA casilla "Verifique que es un ser humano" y espere el chulo verde. Luego pulse PROBAR.'); return; }
    var sedeId = Number($('ag2-sede').value), tramId = Number($('ag2-tram').value);
    if (!sedeId || !tramId) { alert('Elija el tramite y la sede.'); return; }
    $('ag2-test').disabled = true;
    status('Probando...', '#555');
    nextEmptySunday(sedeId, tramId).then(function (fecha) {
      var tok = takeToken();
      log('PRUEBA: solicitud para el domingo ' + fecha + ' (ese dia no hay citas).');
      var body = JSON.stringify({ sedeId: sedeId, tramiteId: tramId, fecha: fecha, horaId: 3, turnstileToken: tok });
      return api('/api/citas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }, BOOK_TIMEOUT_MS);
    }).then(function (r) {
      var j = r.json || {};
      var code = j.code || (j.data && j.data.code) || '';
      var err = j.error || (j.data && j.data.error) || ('HTTP ' + r.status);
      log('PRUEBA: respuesta del portal: ' + err + (code ? ' (' + code + ')' : '') + ' [HTTP ' + r.status + ']');
      if (r.status === 401) {
        status('PRUEBA: no hay sesion. Inicie sesion otra vez.', '#b00');
        alert('PRUEBA NO VALIDA\n\nLa sesion del portal se cerro. Inicie sesion otra vez y repita la prueba.');
      } else if (code === 'CAPTCHA_INVALID' || err === 'Required') {
        status('PRUEBA FALLIDA: el portal rechazo la verificacion', '#b00');
        alert('PRUEBA FALLIDA\n\nEl portal NO acepto la verificacion de Cloudflare.\nRespuesta: ' + err + '\n\nAvise a quien le envio este programa y copie el registro de abajo.');
      } else if (r.ok && j.ok !== false) {
        status('ATENCION: el portal acepto la solicitud', '#c60');
        alert('ATENCION\n\nEl portal respondio como si hubiera agendado. Revise "Mis citas" y cancele cualquier cita de prueba.');
      } else {
        status('PRUEBA CORRECTA', '#107c10');
        beep(1200, 150, 2);
        alert('PRUEBA CORRECTA\n\nEl portal acepto la verificacion de Cloudflare.\nNo se agendo nada (respuesta: ' + err + ').\n\nEl programa esta listo para el dia de la cita.');
      }
    }).catch(function (e) {
      status('PRUEBA: no se pudo completar', '#b00');
      log('PRUEBA: error ' + (e && (e.message || e.name)));
      alert('No se pudo completar la prueba (' + (e && (e.message || e.name)) + '). Intente otra vez en un minuto.');
    }).finally(function () { $('ag2-test').disabled = false; });
  };

  window.__agendadorV2 = { show: function () { box.style.display = ''; $('ag2-body').style.display = ''; }, state: st, version: VERSION };
  log('Agendador ' + VERSION + ' listo.');
})();

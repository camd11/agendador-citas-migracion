# Agendador de Citas — Migración Colombia

Herramienta que reserva una cita en `apps.migracioncolombia.gov.co/citas` en cuanto se libera un cupo.

## ➜ Instrucciones: https://camd11.github.io/agendador-citas-migracion/

---

## Versión 2 (noviembre de 2026): ahora funciona en el navegador

En noviembre de 2026 el portal agregó **Cloudflare Turnstile** («Verifique que es un ser humano»)
a cada reserva. `POST /api/citas` ahora exige el campo `turnstileToken`:

| Solicitud | Respuesta |
|---|---|
| sin `turnstileToken` | `422 {"error":"Required","code":"VALIDATION_ERROR"}` |
| con un token falso | `400 {"code":"CAPTCHA_INVALID"}` |

El token solo lo produce un navegador real en el dominio del portal, después de que una persona
completa la verificación, y sirve para **un solo intento**. Por eso el programa de Windows
(versión 1, PowerShell) ya no puede agendar y se retiró.

La versión 2 es un **marcador** (bookmarklet) que carga `docs/agendador.js` dentro de la página oficial,
con la sesión del titular:

- muestra 3 casillas de Cloudflare; la persona las marca hacia las 4:58 p. m. (cada token vale 300 s);
- consulta `disponibilidad/dias` cada segundo y, cuando hay cupos, envía la reserva con un token;
- avisa con una alarma cuando no queda ningún token válido;
- mantiene viva la sesión: el portal la cierra tras 15 minutos sin actividad;
- confirma en `mis-citas` cualquier reserva que no respondió a tiempo;
- botón **PROBAR**: envía una solicitud para un domingo sin cupos, para comprobar que el portal acepta el token sin agendar nada.

## API del portal

```
POST /citas/api/auth/login            {email,password,website:""}       -> cookie mc_session (8 h)
POST /citas/api/auth/refresh
GET  /citas/api/tramites
GET  /citas/api/sedes                 ?tramite=
GET  /citas/api/disponibilidad/dias   ?sede=&tramite=                   -> {ok,data:[dias]}
GET  /citas/api/disponibilidad/slots  ?sede=&tramite=&fecha=YYYY-MM-DD  -> {ok,data:[{id_hora_fk,hora_inicio}]}
POST /citas/api/citas                 {sedeId,tramiteId,fecha,horaId,turnstileToken[,beneficiarioId]}
GET  /citas/api/mis-citas
```

Los cupos se liberan de domingo a jueves cerca de las 5:00 p. m. (medido: 16:59:17, 17:00:01, 17:00:23),
solo para el día hábil siguiente. Un titular solo puede tener una cita activa por trámite (`CITA_ACTIVA`).

## Uso responsable

Agendar una cita es **gratuito** y no requiere intermediarios. Esta herramienta automatiza la espera;
**no** da prioridad, no salta la fila, no crea cupos y no evita la verificación de seguridad:
una persona la completa. Úsela para su propia cita o la de una persona que usted representa.

No hay afiliación con Migración Colombia. Se entrega sin garantía.

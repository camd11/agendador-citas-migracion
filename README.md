# Agendador de Citas — Migración Colombia

Aplicación de escritorio para Windows que reserva una cita en
`apps.migracioncolombia.gov.co/citas` en cuanto se libera un cupo.

**No requiere instalar nada.** Usa PowerShell y Windows Forms, que ya vienen con Windows.

![sin dependencias](https://img.shields.io/badge/dependencias-ninguna-brightgreen)
![windows](https://img.shields.io/badge/Windows-10%2F11-blue)

---

## Por qué existe

Migración Colombia cambió su sistema de citas el **5 de abril de 2026**. Desde entonces:

- Los cupos se liberan **de domingo a jueves, cerca de las 5:00 p.m.**
- Cada liberación cubre **solo el día hábil siguiente**.
- Fuera de esa franja el sistema está vacío para **todas** las sedes.

El 26 de agosto de 2026 medimos una liberación real en Medellín:

| Hora | Evento |
|---|---|
| 16:59:17 | Aparecen los cupos — **43 segundos antes** de la hora anunciada |
| 16:59:17 | Había **4 cupos** para todo el día: 09:00, 10:00, 14:00, 15:00 |
| 16:59:40 | **Cero cupos.** Todo agotado |

La ventana real fue de **23 segundos**, y empezó antes de la hora publicada. Quien
sigue las instrucciones oficiales y entra a las 5:00 en punto llega tarde.

---

## Uso

1. Descargue el ZIP desde [Releases](../../releases) y descomprímalo.
2. Doble clic en **`Abrir Agendador.bat`**.
3. Escriba el correo y la contraseña del titular, elija trámite y sede.
4. Pulse **BUSCAR Y AGENDAR** a las **4:55 p.m.** y deje la ventana abierta.

Guía completa en español: **[LEEME.md](LEEME.md)**

---

## Cómo funciona

La API del portal es pública para consultar disponibilidad y requiere sesión para agendar:

```
POST /citas/api/auth/login            {email,password}                  -> cookie mc_session
GET  /citas/api/disponibilidad/dias   ?sede=&tramite=                   -> {ok,data:[dias]}
GET  /citas/api/disponibilidad/slots  ?sede=&tramite=&fecha=YYYY-MM-DD  -> {ok,data:[{id_hora_fk}]}
POST /citas/api/citas                 {sedeId,tramiteId,fecha,horaId}   -> {ok,data:{id_cita}}
GET  /citas/api/mis-citas                                               -> {ok,data:[citas]}
```

El programa consulta `dias` cada 2 segundos. Cuando la lista deja de estar vacía,
pide los horarios y envía el `POST` de reserva. Un titular solo puede tener **una
cita activa por trámite**; un segundo intento devuelve `code: CITA_ACTIVA`.

---

## Seguridad de las credenciales

Las contraseñas se guardan en `clientes\` cifradas con **DPAPI** de Windows. Solo
se pueden descifrar en ese equipo y con esa cuenta de Windows. La carpeta `clientes\`
y `config.txt` están en `.gitignore` y nunca deben subirse.

---

## Uso responsable

Agendar una cita es **gratuito** y no requiere intermediarios. Esta herramienta
automatiza la espera; **no** da prioridad, no salta la fila y no crea cupos.

Los cupos son escasos: cuatro por día y por sede para algunos trámites. Úsela para
su propia cita o la de una persona que usted representa. Ejecutarla en paralelo para
muchos titulares agota los mismos cupos más rápido y perjudica a quien la necesita.

No hay afiliación con Migración Colombia. Se entrega sin garantía.

---

## Licencia

MIT

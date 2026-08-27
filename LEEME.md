# Agendador de Citas — Migración Colombia

Programa para Windows que reserva una cita en cuanto se libera un cupo.
**No hay que instalar nada.** Usa PowerShell, que ya viene con Windows.

---

## 1. Cómo abrirlo

1. Descargue la carpeta y descomprímala en el Escritorio.
2. Doble clic en **`Abrir Agendador.bat`**.
3. Si Windows muestra un aviso azul de *SmartScreen*, pulse **Más información → Ejecutar de todas formas**.

Se abre una ventana con campos y un botón verde grande.

---

## 2. Cómo usarlo

| Paso | Qué hacer |
|---|---|
| 1 | Escriba el **correo** y la **contraseña** del titular (la cuenta de `apps.migracioncolombia.gov.co/citas`). |
| 2 | Elija el **trámite** y la **sede**. |
| 3 | Deje marcado *Guardar este cliente* si quiere que el programa lo recuerde. |
| 4 | Pulse **BUSCAR Y AGENDAR**. |
| 5 | **Deje la ventana abierta.** El programa consulta cada 2 segundos. |

Cuando encuentra un cupo lo reserva solo, suena un pitido y muestra el radicado.

---

## 3. La hora es lo más importante

Los cupos se liberan **de domingo a jueves cerca de las 5:00 p.m.**, y **solo para el día hábil siguiente**.

> **Abra el programa a las 4:55 p.m. y pulse el botón. No espere a las 5:00 en punto.**

El 26 de agosto de 2026 los cupos salieron a las **16:59:17**, es decir **43 segundos antes** de las 5:00. En Medellín hubo **4 cupos** para todo el día y se agotaron en **25 segundos**.

Fuera de esa franja el sistema está vacío. Que diga «no hay citas» a las 3 de la tarde es normal, no es una falla.

---

## 4. Un titular por vez

La cuenta de Migración está ligada al documento de una persona. **No se puede agendar para un cliente desde la cuenta de otro.**

- Use la lista **Cliente guardado** para cambiar de titular.
- Cada titular solo puede tener **una cita activa por trámite**. Si ya tiene una, el programa lo avisa y se detiene.

---

## 5. Dónde quedan guardadas las contraseñas

En la carpeta `clientes\`, cifradas con la protección de datos de Windows (DPAPI).

Eso significa que **solo se pueden leer en ese equipo y con esa cuenta de Windows**. Si copia la carpeta a otro computador, las contraseñas no se podrán abrir y habrá que escribirlas otra vez. Es lo correcto: no quedan en texto plano.

La carpeta `clientes\` **nunca** se sube a internet.

---

## 6. Si algo falla

| Problema | Qué hacer |
|---|---|
| La ventana no abre | Doble clic en `Abrir Agendador.bat`, tome una foto del texto y envíela. |
| «No se pudo iniciar sesión» | Revise el correo y la contraseña entrando primero en el navegador. |
| «Ya existe una cita activa» | Ese titular ya tiene cita. Revise su correo. |
| No aparece nada a las 5:00 | Los cupos se acabaron. Intente al día siguiente. |

Cada intento queda escrito en `registro.txt`, junto al programa.

---

## 7. Antes de ir a la cita

- Pasaporte del titular.
- **Originales** de todos los soportes.
- Tarjeta para pagar. El pago se hace en el CFSM el día de la cita.
- La cita agendada **debe cumplirse**. Si no va, pierde el cupo.

---

## Nota

Programar una cita es **gratuito** y no requiere intermediarios. Esta herramienta solo automatiza la espera; no da prioridad ni salta ninguna fila.

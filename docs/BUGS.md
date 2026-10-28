# Hallazgos de la exploración — BuggyBank

Exploración manual + llamadas a la API desde una sesión autenticada, 17/10/2026. Todas las operaciones de prueba llevan la nota `QA-explore`. El sandbox quedó restaurado (CHECKING 6,500 / SAVINGS 3,500, perfil original).

Severidad: **Crítica** = mueve dinero de forma incorrecta · **Alta** = rompe una regla de negocio · **Media** = datos o vistas inconsistentes · **Baja** = UX o contrato.

## Transferencias

| ID | Sev. | Hallazgo | Esperado | Obtenido | Caso |
|----|------|----------|----------|----------|------|
| BUG-01 | Crítica | **Se acepta una transferencia mayor al saldo (UI)** | Rechazo por fondos insuficientes | Con saldo 6,486.63 se transfirieron 6,486.64 → `200 OK transfer`; CHECKING quedó en `-$0.01` | TC-03 |
| BUG-24 | Crítica | **Las transferencias de importe entero ≥ 500 se aplican dos veces** | Un solo débito y un solo movimiento | Una sola petición `amount:6500` → `200 {"duplicated":true}`; CHECKING 6,500 → -6,500 y SAVINGS 3,500 → 16,500, y en el historial aparece un segundo movimiento con la nota `<nota> (duplicate)`. **Disparador (exploración manual 28/10/2026):** 499 no se duplica y 500 sí; 500, 999, 1.000, 3.000, 6.500, 13.000 y 19.500 se duplican; 100, 101, 300, 2,22, 13,37, 99,99, 3.500,50 y 6.500,01 no (los decimales no). Afecta también al saldo exacto (TC-04), pero la causa es el importe, no el saldo | TC-04 |
| BUG-02 | Crítica | **Doble submit duplica la transferencia** | Una intención = un movimiento | Dos clics simultáneos → dos `POST /api/transfers`, ambos `200` con `duplicated:false`, dos débitos de 2.22. (Un doble clic "humano" sí se filtró.) | TC-05 |
| BUG-03 | Alta | **El botón "deshabilitado" sigue funcionando** | Si el botón se ve deshabilitado, no ejecuta | Con monto > saldo el botón muestra `opacity-60 cursor-not-allowed` pero `disabled=false`; el clic ejecuta la transferencia (CH-008) | TR-12 |
| BUG-04 | Crítica | **La API acepta montos negativos** | `4xx`, sin efectos | `amount:-50` → `200`; el dinero fluye al revés (+50 en origen) | AP-01 |
| BUG-05 | Alta | **La API acepta monto 0** | `4xx`, sin movimiento | `200` y movimiento `COMPLETED` de $0 | AP-01 |
| BUG-06 | Alta | **La API acepta origen = destino** | `4xx`, sin movimiento | `200` y movimiento `COMPLETED` 00→00 | AP-01 |
| BUG-07 | Alta | **La API acepta 3 decimales y los persiste** | Rechazo o redondeo a centavos | `1.005` → saldos `6535.625` / `3464.375` | TR-09 |
| BUG-08 | Media | **Error de punto flotante en el saldo** | `-0.01` | `/api/dashboard` devolvió `-0.01000000000021828` | TC-03 |
| BUG-09 | Media | **Las transferencias nuevas siempre quedan `incoming`** | `outgoing` desde la cuenta origen (como en la semilla) | Las 11 transferencias de la exploración quedaron con `direction:"incoming"` | MV-03 |
| BUG-10 | Baja | **Mensaje de éxito viejo junto al error** | Solo el error actual | Tras un éxito, al ingresar `-50` se ve "Ingresa un monto mayor a 0" **y** "OK transfer" | TR-11 |

## Movimientos

| ID | Sev. | Hallazgo | Esperado | Obtenido | Caso |
|----|------|----------|----------|----------|------|
| BUG-11 | Alta | **Filtro de dirección invertido** | "Entrantes" muestra ingresos | "Entrantes" lista 5 filas, todas "Salida". Las transferencias nuevas no aparecen en ningún filtro (19 en total, 5 + 5 filtradas) | MV-03 |
| BUG-12 | Media | **Dirección + búsqueda devuelve filas que no cumplen la dirección** | Toda fila cumple ambos filtros | `incoming` + `te` → 2 filas `outgoing` (CH-005) | MV-04 |
| BUG-13 | Media | **Búsqueda sensible a mayúsculas** | `rent` = `RENT` | 1 vs 0 resultados (CH-011) | MV-05 |
| BUG-14 | Baja | **Formato de fecha mezclado** | Un formato homogéneo | `16 Oct 2026, 10:23 pm`, `14/10/26, 22:12`, `29 Sept 2026, 9:06 pm` (CH-006) | MV-02 |
| BUG-15 | Media | **El estado no se ve en la tabla** | Distinguir `FAILED/CANCELLED/REVERSED` | Se listan igual que operaciones efectivas (p. ej. la transferencia cancelada de $300 aparece como "Salida") | MV-06 |

## Pagos

| ID | Sev. | Hallazgo | Esperado | Obtenido | Caso |
|----|------|----------|----------|----------|------|
| BUG-16 | Alta | **Doble clic en "Procesar" salta un estado** | "El procesamiento avanza un único estado" (texto de la app) | Dos clics simultáneos en "Procesar a Pendiente" → `SCHEDULED → PENDING → COMPLETED`: cada clic genera una clave de idempotencia nueva (CH-016) | PG-06 |
| BUG-17 | Media | **Pago programado con fecha pasada** | Rechazo | `scheduledFor: 2020-01-01` → `201 SCHEDULED` | PG-04 |
| BUG-18 | A confirmar | **Pago mayor al saldo** | Rechazo o aviso | `amount: 999999` → `201` (podría ser válido si el saldo se valida al procesar) | PG-02 |
| BUG-19 | A confirmar | **Completar o revertir un pago no mueve saldo** | El pago completado debita la cuenta origen | El saldo de CHECKING no cambió en ningún estado | PG-09 |

Lo que **sí** funciona bien: transición inválida → `409 INVALID_PAYMENT_TRANSITION`; misma clave de idempotencia, incluso en paralelo → un solo cambio; monto 0/negativo o beneficiario vacío → `400`.

## Perfil

| ID | Sev. | Hallazgo | Esperado | Obtenido | Caso |
|----|------|----------|----------|----------|------|
| BUG-20 | Media | **Front y back con reglas distintas** | El back rechaza lo que el front bloquea | La UI bloquea un nombre de 1 letra; `PUT /api/profile` acepta nombre vacío, `"A"` y un teléfono de 60 dígitos (CH-007) | PF-02 |
| BUG-21 | Baja | **Cambio de email ignorado en silencio** | Error o cambio aplicado | `email:"no-es-email"` → `200 Saved profile` con el email anterior | PF-02 |

## Contrato de errores (CH-010)

| ID | Sev. | Hallazgo |
|----|------|----------|
| BUG-22 | Baja | Tres formas distintas de error: `/api/transfers` con `amount:"abc"` → **`500` con cuerpo vacío**; `/api/payments` → `400 {message}`; transiciones → `400/409 {code, message, ...}` |

## Login (CH-001)

| ID | Sev. | Hallazgo | Esperado | Obtenido | Caso |
|----|------|----------|----------|----------|------|
| BUG-23 | Baja | **Mensaje de error de login en otro idioma** | Mensaje en español, coherente con "Ingresa un email válido" | Con contraseña incorrecta el servidor responde `401 {"message":"Auth failed"}` (inglés); con datos incompletos `400 "Credenciales incompletas"` (español) | LG-02 |

## Mapa bug → test

| Bug | Test que lo detecta |
|-----|---------------------|
| BUG-01 | TC-03, AP-01e |
| BUG-02 | TC-05, AP-04 |
| BUG-24 | TC-04 |
| BUG-03 | TR-12 |
| BUG-04 / 05 / 06 / 07 | AP-01a / b / c / d · TR-09 |
| BUG-08 | TC-03 (`expectCleanBalances`) |
| BUG-09 / 11 | MV-03 |
| BUG-10 | sin test automatizado (pendiente: requiere un éxito previo en la misma pantalla) |
| BUG-12 | MV-04 |
| BUG-13 | MV-05 |
| BUG-14 | MV-02 |
| BUG-15 | MV-06 |
| BUG-16 | PG-06 |
| BUG-17 | PG-04 (fecha pasada) |
| BUG-18 | PG-02 (mayor al saldo) — pregunta abierta |
| BUG-19 | PG-09 — pregunta abierta |
| BUG-20 / 21 | PF-02 (API) / PF-04 |
| BUG-22 | AP-01f, AP-02 |
| BUG-23 | LG-02 (contraseña incorrecta) |

## Notas para el diseño de las pruebas

- **El orden de `accounts` en `/api/dashboard` no es estable**: buscar siempre por `type` o `accountNumber`, nunca por índice.
- La UI de pagos manda **cada transición dos veces con la misma clave** (reintento propio). Hay que contarlo al verificar llamadas de red.
- **QA Mode** solo muestra pistas pedagógicas; no cambia el comportamiento.
- No se pudo verificar `DB-01` (total = suma de cuentas) con un caso que lo rompa: todas las operaciones conservaron el total de 10,000.

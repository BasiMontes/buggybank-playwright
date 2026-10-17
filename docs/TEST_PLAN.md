# Plan de pruebas — BuggyBank

> Núcleo de la entrega: **Transferencias** (`@core`, 5 pruebas). Cobertura extendida del resto de la app con `@extended` y `@api`.
> Lo marcado **[Explorar]** requiere ejecutar operaciones reales en el sandbox antes de fijar el resultado esperado exacto.

## 1. Lo que encontré explorando la app

| Módulo | Ruta | Selectores | API observada |
|--------|------|-----------|---------------|
| Login | `/login` | por label/rol (pendiente revisar `data-testid`) | `POST /api/auth/login` |
| Dashboard | `/dashboard` | texto: total + cards por cuenta | `GET /api/dashboard` → `totalBalance`, `accounts[{id,type,accountNumber,currency,balance}]` |
| Transferencias | `/transfers` | `transfer-from`, `transfer-to`, `transfer-amount` (`type=number`, `step=0.01`), `transfer-note`, `transfer-submit` | `POST /api/transfers` `{fromAccountId, toAccountId, amount, note}` → `200 {"message":"OK transfer","duplicated":false}` |
| Movimientos | `/transactions` | filtro Dirección (`all/incoming/outgoing`), búsqueda por nota o cuenta, tabla | `GET /api/transactions?direction=&query=` → `id, createdAt, amount, note, status, direction, from/toAccountNumber, counterpartyName` |
| Pagos | `/payments`, `/payments/new`, `/payments/:id` | `payment-beneficiary`, `payment-source-account`, `payment-amount` (`min=0.01`), `payment-date`, `payment-reference`, `payment-submit`, `payment-process` | `GET /api/payments` |
| Perfil | `/profile` | `#fullName`, `#email`, `#phone`, `#language` (sin `data-testid`) | `GET/PUT /api/profile` `{id, fullName, email, phone, preferredLanguage}` |
| Pagos (transiciones) | `/payments/:id` | `payment-process` | `POST /api/payments/:id/transitions` `{action: PROCESS\|REVERSE, idempotencyKey}` |

Datos semilla: CHECKING `$6,500.00` + SAVINGS `$3,500.00` = `$10,000.00` (moneda `NZD`), 8 movimientos con estados `COMPLETED / PENDING / FAILED / REVERSED / CANCELLED` y 4 pagos (Programado, Pendiente, Completado, Revertido).

### Señales de bug ya visibles (sin ejecutar nada)

- **B-01 · Formato de fecha mezclado en Movimientos** (`16 Oct 2026, 10:23 pm` vs `14/10/26, 22:12`). Coincide con el desafío CH-006.
- **B-02 · El estado no se ve en Movimientos.** La API devuelve `FAILED`, `CANCELLED` y `REVERSED`, pero la tabla los muestra igual que una operación efectiva. Por ejemplo, la transferencia de $300 aparece como "Salida" aunque está cancelada. **[Confirmar si es intencional]**
- **B-03 · Saldos semilla vs historial:** los saldos no se pueden reconstruir a partir de los movimientos. Por eso confirma la decisión de usar **saldos relativos** en vez de recalcular desde el historial.

## 2. Decisiones de diseño

1. **Saldos relativos.** Cada prueba lee los saldos al empezar y compara contra eso. No depende de la semilla ni del orden de ejecución.
2. **Movimiento identificable.** Cada operación lleva una nota única (`QA-<id>`) y un monto poco común. Así se busca *ese* movimiento y no uno parecido.
3. **Doble oráculo, UI + API.** El resultado se verifica en pantalla (lo que ve el usuario) y en `/api/dashboard` y `/api/transactions` (la fuente de verdad). Si difieren, eso también es un bug (CH-003, CH-009).
4. **En los rechazos se verifica que no pasó nada:** saldos iguales y ningún movimiento nuevo con la nota de la prueba.
5. **Independencia:** cada test usa un contexto de navegador nuevo y su propio login. Los tests de Login van por UI; el resto entra por `POST /api/auth/login` desde un fixture, que es más rápido y no depende del formulario. La suite corre con `workers: 1` porque todos los tests comparten las mismas dos cuentas.
6. **Limpieza:** las pruebas que mueven mucho dinero (saldo exacto, límites) devuelven el monto al terminar. El sandbox se renueva cada 24 h, así que un residuo no rompe las pruebas siguientes.
7. **Rojo honesto:** un bug deja la prueba en rojo con el expected original y se documenta en `BUGS.md` (esperado / obtenido / evidencia del reporte de Playwright). No hay `test.fail()` para esconderlo.
8. **Tags:** `@core` (entrega), `@extended` (resto de UI), `@api` (contrato y reglas por API). `npm test` corre todo; `npm run test:core` corre solo la entrega.

## 3. Núcleo — Transferencias `@core`

| ID | Caso | Datos | Resultado esperado | Riesgo |
|----|------|-------|--------------------|--------|
| TC-01 | Transferencia válida | CHECKING → SAVINGS, `13.37`, nota única | Éxito; origen −13.37; destino +13.37; total sin cambio; movimiento `COMPLETED` con monto, nota y cuentas correctas (UI + API) | Dinero perdido o creado; movimiento no registrado |
| TC-02 | Monto inválido (negativo) | `-50` | Rechazo; saldos sin cambios; sin movimiento | Un negativo que invierte el sentido de la transferencia |
| TC-03 | Fondos insuficientes | saldo origen + `0.01` | Rechazo; saldos sin cambios; sin movimiento | Sobregiro |
| TC-04 | Borde: saldo exacto | monto = saldo origen | Aceptada; origen `0.00`; destino +monto. Teardown: devolver el monto | Límite mal implementado (`>` vs `>=`) |
| TC-05 | Borde: doble submit | doble clic en Transferir con la misma intención (CH-002) | Un solo débito, un solo crédito, un solo movimiento | Cobro duplicado |

**Resultado previsto tras la exploración** (ver `BUGS.md`): TC-01 verde · TC-02 verde en UI (el front bloquea; la API no → AP-01) · **TC-03 rojo (BUG-01)** · TC-04 verde · **TC-05 rojo (BUG-02)**. En TC-01 la verificación del movimiento **no** exige `direction` (BUG-09 se cubre en MV-03), para que un bug no tape a otro.

## 4. Cobertura extendida

### Transferencias `@extended`
| ID | Caso | Esperado |
|----|------|----------|
| TR-06 | Monto `0` | Rechazo, sin efectos |
| TR-07 | Monto mínimo `0.01` | Aceptada, ±0.01 exacto |
| TR-08 | Precisión: `0.10` × 3 | Variación exacta de 0.30 (sin errores de float) |
| TR-09 | 3 decimales (`10.005`) | Rechazo o redondeo consistente entre débito y crédito |
| TR-10 | Origen = destino | Rechazo, sin efectos |
| TR-11 | Monto vacío / no numérico | Botón bloqueado o rechazo; sin efectos |
| TR-12 | Botón "deshabilitado" con `force: true` (CH-008) | Si se ve deshabilitado, no debe ejecutar nada |
| TR-13 | Nota con HTML/script | Se muestra como texto, sin ejecutarse |
| TR-14 | Nota muy larga | Se trunca o se rechaza, pero no se rompe la tabla |
| TR-15 | Ida y vuelta A→B→A | Saldos finales iguales a los iniciales; 2 movimientos |

### Dashboard `@extended`
| DB-01 | Total = suma de las cards | |
| DB-02 | Total y cards UI = `/api/dashboard` | |
| DB-03 | Saldos coherentes después de una transferencia sin recargar (CH-009) | |

### Movimientos `@extended`
| MV-01 | Orden descendente por fecha, con y sin filtro (CH-004) |
| MV-02 | Formato de fecha homogéneo (CH-006) → esperado rojo por B-01 |
| MV-03 | Filtro "Entrantes" solo muestra `incoming`; ídem "Salientes" |
| MV-04 | Dirección + búsqueda combinadas: toda fila cumple ambos filtros (CH-005) |
| MV-05 | Búsqueda: casing, espacios y fragmento de cuenta devuelven el mismo conjunto (CH-011) |
| MV-06 | La tabla UI coincide con `/api/transactions` (cantidad, montos, estado visible → B-02) |

### Pagos `@extended`
| PG-01 | Crear pago válido → queda "Programado", aparece en listado y detalle con los mismos datos (CH-014) |
| PG-02 | Monto `0` / negativo / mayor al saldo → rechazo |
| PG-03 | Beneficiario vacío → rechazo |
| PG-04 | Fecha pasada / hoy / mañana: la fecha mostrada = la enviada (CH-015) |
| PG-05 | Procesar avanza **un** estado y el historial lo registra |
| PG-06 | Procesar dos veces la misma intención → un solo cambio (CH-016) |
| PG-07 | Ciclo completo hasta Revertido; acción inválida para el estado → rechazo (CH-017) |
| PG-08 | Filtro por estado: cada fila cumple el filtro |
| PG-09 | Efecto financiero del pago completado/revertido sobre el saldo **[Explorar]** |

### Perfil `@extended`
| PF-01 | Guardar un nombre único → persiste tras recarga y re-login, y coincide con la API (CH-013). Teardown: restaurar |
| PF-02 | Nombre vacío / casi vacío, teléfono excesivo: la regla del front = la del back (CH-007) |
| PF-03 | Cambio de idioma persiste |

### Login `@extended`
| LG-01 | Login válido → dashboard |
| LG-02 | Email inválido vs password incorrecta: mensajes coherentes y sin filtrar cuál campo falló (CH-001) |
| LG-03 | Rutas protegidas sin sesión → redirigen a `/login` |
| LG-04 | "Salir" invalida la sesión (volver atrás no muestra datos) |

### API `@api`
| AP-01 | Transferencia negativa / mayor al saldo / origen = destino **directo al endpoint** → mismo rechazo que la UI, sin efectos (CH-012) |
| AP-02 | Shape de error uniforme entre login, perfil y transferencias (CH-010) |
| AP-03 | Endpoints sin sesión → 401, sin datos |

**Total estimado:** 5 `@core` + ~40 `@extended`/`@api`.

## 5. Preparación del sandbox

1. Entrar a `/login`, ingresar el código del curso y elegir **Crear usuario temporal**.
2. Copiar email y contraseña al `.env` local (ignorado por Git). `.env.example`:
   ```
   BB_BASE_URL=https://buggybank-seven.vercel.app
   BB_EMAIL=
   BB_PASSWORD=
   ```
3. A las 24 h el sandbox vence: crear otro y actualizar el `.env`.

## 6. Exploración realizada

Completada el 17/10. Endpoints, contratos y 22 hallazgos documentados en `BUGS.md`. Los casos de las secciones 3 y 4 ya tienen su resultado previsto; los que deberían quedar en rojo están marcados con el `BUG-xx` correspondiente.

Decisiones que salen de la exploración:
- Las cuentas se identifican por `type`, nunca por posición (el orden de `/api/dashboard` cambia).
- Al contar llamadas de red en Pagos se descuenta el reintento propio de la UI (misma clave dos veces).
- QA Mode queda apagado en todas las pruebas.
- PG-09 y BUG-18 quedan como preguntas para la Charla: no está claro si es un bug o una decisión de diseño del sandbox.

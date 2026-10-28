# Suite extendida y de API: ejecución del 28/10/2026

Sandbox nuevo, `--grep "@extended|@api"`, 1 worker. **61 pruebas: 37 en verde y 24 en rojo (12,5 min).**
Cada rojo se ha clasificado leyendo el error y, cuando hacía falta, la traza. Estas pruebas las generó la IA;
la revisión consistió en decidir, para cada fallo, si era **de la app** o **de la prueba**.

| Clasificación | Pruebas | Qué se hizo |
|---|---|---|
| **Bug de la app** (ya documentado) | 17 | Se deja en rojo con su anotación |
| **Pregunta abierta** (no sabemos si es bug) | 2 | Se deja en rojo y se pregunta en la charla |
| **Fallo de la prueba** | 5 | Se corrige la prueba (abajo) |

## Bugs de la app (17)

| Prueba | Bug | Lo que se observó |
|---|---|---|
| AP-01a, AP-01b, AP-01c, AP-01d, AP-01e | BUG-04, 05, 06, 07, 01 | La API acepta con `200` monto negativo, cero, origen = destino, 3 decimales y monto mayor al saldo |
| AP-01f, AP-02 | BUG-22 | Monto no numérico: `500` con cuerpo vacío |
| AP-04 | BUG-02 | Dos POST idénticos en paralelo generan 2 movimientos |
| TR-09 | BUG-07 | El saldo queda en `6489.994999999999` |
| TR-12 | BUG-03 | El botón se ve deshabilitado pero no tiene `disabled` |
| PF-02, PF-04 | BUG-20, 21 | El backend acepta nombre vacío o de una letra y un teléfono de 60 dígitos; un email inválido responde `200` y no se guarda |
| PG-04 (fecha pasada) | BUG-17 | Se programa un pago con fecha de hace 30 días |
| MV-02, MV-03, MV-04, MV-05 | BUG-14, 11, 12, 13 | Formatos de fecha mezclados, filtro invertido (42 filas fuera de "Entrantes"), dirección + búsqueda y búsqueda sensible a mayúsculas |

## Preguntas abiertas (2)

| Prueba | Bug | Por qué no es concluyente |
|---|---|---|
| PG-02 | BUG-18 | Un pago mayor que el saldo se programa con `201`; puede ser válido si el saldo se comprueba al procesar |
| PG-09 | BUG-19 | Completar un pago no cambia el saldo; no sabemos si debería hacerlo |

## Fallos de la prueba (5) y su arreglo

| Prueba | Qué pasaba | Arreglo |
|---|---|---|
| LG-02 (email inválido) | La app **deshabilita** el botón con un email inválido; la prueba esperaba poder pulsarlo y ver un mensaje (`element is not enabled`) | Comprobar que el botón está deshabilitado y que no hay petición |
| LG-02 (contraseña incorrecta) | `getByText(/credenciales\|contraseña\|…/)` coincidía con las etiquetas del formulario (violación de modo estricto), antes de que llegara el error | Usar `getByRole('alert')` y comprobar que no dice "Auth failed" (BUG-23) |
| PG-04 (fecha en el listado) | El texto de la fila pega el número de cuenta y la fecha (`…0030 oct 2026`) y `\b` no separa dígitos; **la fecha era correcta** | Sustituir `\b` por `(?<!\d)` y `(?!\d)` |
| TR-16 | Sí salió **una sola** petición (la app filtró el doble clic), que tardó ~3 s; la prueba esperaba solo 5 s a que apareciera el movimiento | Subir la espera a 20 s |
| MV-06 | En la parte de montos, los movimientos con 3 decimales (creados por otras pruebas, BUG-07) se muestran redondeados (`1.01`) y `toCents(1.005)` da `1.00`. La parte de estados sí detecta **BUG-15** (la fila CANCELLED no muestra su estado) | Saltar las filas con más de 2 decimales; BUG-15 sigue en rojo |

## Segunda ejecución (28/10/2026): 38 en verde y 23 en rojo

Esperaba 40 y 21. Confirmó 3 de los 5 arreglos (LG-02 email, TR-16 y la parte de montos de MV-06) y dejó dos sorpresas:

| Prueba | Qué pasó | Qué se hizo |
|---|---|---|
| **PG-04 (fecha en el listado)** | Seguía en rojo: **mi arreglo estaba mal**. Con `(?<!\d)` no se separa `…-00` de `30 oct 2026`, porque el `0` anterior también es un dígito | Buscar la fecha en la celda (`td`) y no en el texto de toda la fila |
| **LG-02 (contraseña)** | El `role="alert"` que encontré es el anunciador de rutas de Next.js, siempre vacío. La captura muestra el error real: texto rojo **"Auth failed"** dentro del formulario | Esperar a la respuesta de `/api/auth/login` y comprobar que "Auth failed" no está en pantalla (BUG-23) |
| **PG-06** | Pasó en la primera ejecución y **falló en la segunda** (`COMPLETED` en vez de `PENDING`) | Es BUG-16, pero **intermitente**: depende de que los dos clics coincidan. Hay que medir cuántas veces aparece (`--repeat-each=5`) |

Con esto los rojos son: 17 bugs de la app + 2 preguntas abiertas + BUG-23 (LG-02) + BUG-15 (MV-06) + BUG-16 (PG-06) = **22**,
más PG-04 (fecha en el listado), que debería pasar a verde tras el arreglo: **39 en verde y 22 en rojo** esperados.

## Lo que esta revisión deja claro

- 19 de los 24 rojos son la app, no las pruebas. Eso valida la suite como detector, pero no su calidad: hay que mirar las **37 en verde** por si alguna pasa sin comprobar nada (TR-12, TR-14 y TR-13 son las candidatas).
- Las pruebas dependen del estado que dejan otras (MV-06 vio datos de AP-01d): para la entrega no importa, pero conviene aislarlas.

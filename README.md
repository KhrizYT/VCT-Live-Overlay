# VLR Overlay for VCT Matches · v5.3

> v5.3 corrige el modo LIVE del overlay (ya no se mezcla con STARTS IN), refuerza la detección de matches terminadas usando match/details + results, y mantiene el Studio público de una sola página sin rooms ni panel privado.

## Cambios principales de v5.3
- `/` abre directamente el Studio público.
- El usuario elige Automático o pega cualquier Match ID/URL de VLR.
- `/overlay?matchId=...&opacity=...&glow=...` funciona sin room ni clave.
- El preview y OBS consumen un endpoint público stateless.
- Las matches específicas consultan `/v2/match/details?match_id=...`, por lo que una match ya terminada puede mostrar su resultado real.
- El glow del evento intenta obtener el logo real del evento mediante VLR API y extraer su color dominante.
- Las URLs antiguas de rooms siguen existiendo solo por compatibilidad, pero la interfaz pública ya no las usa.

Esta versión conserva el comportamiento visual/live de v3.0.4, pero cambia la distribución:
**el usuario de OBS no instala nada**.

## Experiencia del usuario

1. Entra a la URL pública del servicio.
2. Pulsa **Crear overlay**.
3. Recibe un panel privado de administración.
4. Copia la URL `https://TU-DOMINIO/overlay/ROOM_ID`.
5. La pega como Browser Source en OBS.

Cada room tiene:

- selección de match independiente
- opacidad y glow independientes
- Browser Source independiente
- admin key secreta para modificarla
- actualización live compartida desde el mismo backend

El servidor consulta VLR una sola vez por intervalo y reparte el estado a todas las rooms.

## Ejecutar con Docker

```bash
docker compose up -d --build
```

Después abre:

```text
http://localhost:8787
```

## Desplegar en Railway

Railway detecta el `Dockerfile` automáticamente. Puedes subir esta carpeta a un repositorio y
crear un servicio desde ese repo, o usar Railway CLI con `railway up`.

Después genera un dominio público desde **Networking** y comparte ese dominio.

Recomendación: añade almacenamiento persistente para `/app/data` si quieres conservar rooms tras
redeploys. Sin disco persistente el overlay sigue funcionando, pero las rooms pueden perderse al
recrear el contenedor.

## Desplegar en Render

El proyecto incluye `render.yaml` y `Dockerfile`. Render puede construir directamente desde el
Dockerfile. Configura un Web Service Docker y usa `/health` como health check.

## Arquitectura

```text
                        SERVIDOR
                           │
                 VLR live score + metadata
                           │
                    cache global live
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Room A           Room B           Room C
       PRX/NS           GEN/T1           GC LATAM
          │                │                │
     Browser OBS      Browser OBS      Browser OBS
```

## URLs

- `/` — crear room
- `/admin/ROOM?key=SECRET` — panel privado
- `/overlay/ROOM` — Browser Source público
- `/health` — health check

## Seguridad básica

La URL de overlay es de solo lectura. Los cambios necesitan el `adminKey` que va en el enlace del
panel. No compartas el link de administración si no quieres que otra persona cambie la match o los
ajustes.

## Persistencia

Por defecto las rooms se guardan en `DATA_DIR/rooms.json`. Con Docker Compose se crea un volumen
`overlay_data`. En un proveedor cloud configura un volumen persistente si quieres conservarlas
entre redeploys.

## Nota sobre la fuente

Esta build sigue usando la capa VLR que ya funcionó en v3.0.4. Antes de convertirlo en un servicio
comercial público conviene revisar permisos/licencia de la fuente de datos o sustituir esa capa por
una fuente autorizada.


## v4.0.1 Railway hotfix

Railway deployment could crash with:

```text
Error: Cannot find module './providers/demo'
Require stack:
- /app/server.js
```

`demo.js` is now an optional development-only provider. The production server no longer
fails if that file is missing from a GitHub upload. Normal hosted mode continues using VLR.

Healthcheck:

```text
GET /health
```

returns version `4.0.1`.


## v4.0.2 hosted overlay fix

The hosted overlay page used `roomId` in:

```js
fetch(`/api/rooms/${roomId}/state`)
```

but `roomId` had never been declared in `overlay-compact.html`.

That caused a JavaScript `ReferenceError` before the first API request, leaving both the
Admin preview and the OBS Browser Source blank.

v4.0.2 now reads the room id from:

```text
/overlay/ROOM-ID
```

before connecting to the room state and SSE endpoint.

The Admin preview background was also changed from solid white to a dark checkerboard so
transparent Browser Source content is easier to verify.


## v4.1 · Hosted polish

### OBS recomendado

```text
Browser Source
Ancho: 500
Alto: 160
FPS: 30
```

El overlay ahora se centra horizontal y verticalmente dentro de cualquier Browser Source.
`500 × 160` es la medida recomendada porque deja espacio suficiente para el glow sin crear
una fuente innecesariamente grande.

### Panel de administración

v4.1 añade:

- Configuración OBS visible dentro del panel.
- Botón para copiar URL de OBS.
- Botón para copiar URL privada del Admin.
- Estado visual de VLR.
- Renombrar room.
- Regenerar la clave privada del Admin.
- Eliminar room.
- Preview real a `500 × 160`.
- URLs HTTPS correctas detrás de Railway/otros reverse proxies.

### Seguridad

La URL:

```text
/overlay/ROOM
```

puede compartirse.

La URL:

```text
/admin/ROOM?key=...
```

es privada. Si se filtra, usa **Regenerar clave privada**.


## v4.1.1 · Preview transparency fix

The white 500×160 rectangle visible in the Admin was the iframe's own browser canvas,
not part of the OBS overlay.

Admin preview now opens:

```text
/overlay/ROOM?preview=1
```

which draws a checkerboard inside the iframe to represent transparent pixels.

The actual OBS URL remains:

```text
/overlay/ROOM
```

with a transparent background.


## v4.1.2 · UI polish

No data-source or Railway logic changed.

Admin improvements:
- Slightly larger, easier-to-read UI.
- Match column no longer stretches to the height of the settings card when only one match exists.
- NEXT cards show `EMPIEZA EN` above the ETA.
- One prominent `COPIAR URL PARA OBS` action.
- OBS recommendation stays visible as `500 × 160 · 30 FPS`.
- Long URLs are visually shortened while copy actions still use the full URL.
- Rare room-management actions are collapsed by default.
- Preview label now reads `Así se verá en OBS · fondo transparente`.

Overlay improvement:
- NEXT countdown is ~15% larger and more legible.


# v4.2 · Pinned Match

v4.1.2 remains the frozen stable release. v4.2 adds a new per-room source mode.

## Automatic

Same behavior as v4.1.2:

- Show a selected/live match.
- If no match is live, show the nearest upcoming match.

## Match específica

Paste either:

```text
https://www.vlr.gg/731774/mibr-gc-vs-team-liquid-brazil-game-changers-2026-brazil-finals-ubf
```

or:

```text
731774
```

The room stores the VLR Match ID and follows only that match.

Lifecycle:

```text
UPCOMING  ->  NEXT + countdown
LIVE      ->  round/map scoreboard + existing animations
COMPLETED ->  FINAL
```

A pinned room never switches to another simultaneous live match.

### API

```text
POST /api/rooms/:roomId/pin
{ "input": "https://www.vlr.gg/731774/..." }

POST /api/rooms/:roomId/unpin
{}
```

Both require the room's Admin key.

### Data resolution

For pinned upcoming matches the provider tries:

1. VLR bridge upcoming feed (best ETA).
2. Self-hosted VLR `/api/matches/upcoming` fallback.
3. Exact self-hosted `/api/matches/:id` details.

Once the pinned match appears in the normal VLR live-score feed, that live object becomes
authoritative automatically, so round scores/maps/animations use the same proven path as v4.1.2.

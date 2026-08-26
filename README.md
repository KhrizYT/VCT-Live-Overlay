# VALORANT Live Overlay v4.0 · HOSTED

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

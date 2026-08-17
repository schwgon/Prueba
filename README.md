# MAUDAM - Prueba con GitHub Pages + Arg Autos

Esta versión está preparada para funcionar sin `server.js` y sin que una PC personal tenga que estar encendida.

## Estructura

```text
/
├── index.html
├── style.css
├── app.js
├── autos-data.json
├── scripts/
│   └── generar-autos-data.js
└── .github/
    └── workflows/
        └── actualizar-autos.yml
```

## Funcionamiento

### Usuarios

El navegador descarga:

- `index.html`
- `style.css`
- `app.js`
- `autos-data.json`

Después de cargar el JSON, marca/modelo/versión/año/precio se resuelven en el propio navegador.

No se consulta Arg Autos cada vez que un usuario cambia una selección.

### Actualización

GitHub Actions ejecuta:

```text
Arg Autos API
    ↓
brands
    ↓
models
    ↓
versions
    ↓
valuations?currency=ars
    ↓
filtrar años >= 2013
    ↓
autos-data.json
```

El workflow se puede ejecutar automáticamente una vez al mes o manualmente desde GitHub.

## IMPORTANTE

El `autos-data.json` incluido en este repositorio es solamente un conjunto pequeño de datos de prueba.

El workflow es el encargado de reemplazarlo por el catálogo real.

## API key

Esta versión intenta utilizar la API pública sin API key.

Si Arg Autos requiere una API key para completar el catálogo debido a límites de uso, no se debe poner la clave dentro de `index.html` ni `app.js`.

En ese caso, debe configurarse como GitHub Secret y utilizarse únicamente desde GitHub Actions.

## GitHub Pages

En el repositorio:

1. Ir a Settings.
2. Ir a Pages.
3. Elegir `Deploy from a branch`.
4. Seleccionar la rama principal y `/root`.
5. Guardar.

No se necesita ejecutar Node.js en el servidor de GitHub Pages.

## Prueba local

También se puede probar con:

```bash
python -m http.server 8000
```

y abrir:

```text
http://localhost:8000
```

No abrir `index.html` directamente con doble clic, porque el navegador puede bloquear la carga de `autos-data.json` por CORS/origen local.

// MAUDAM / ArgAutos - actualización completa y autónoma.
// Fases: catálogo -> valuaciones. Sin API key: ~3 requests/minuto.

const fs = require('fs');
const path = require('path');

const API = 'https://argautos.com/api/v1';
const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'catalogo-argautos.json');
const DATA = path.join(ROOT, 'autos-data.json');
const STATE = path.join(ROOT, 'estado-actualizacion.json');

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = CURRENT_YEAR - 13;
const MAX_YEAR = CURRENT_YEAR;

const REQUEST_INTERVAL_MS = Number(process.env.REQUEST_INTERVAL_MS || 21000);
const JOB_SECONDS = Number(process.env.JOB_SECONDS || 7500);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 20);
const HTTP_TIMEOUT_MS = 15000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

let lastRequestAt = 0;

async function apiGet(url) {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt && elapsed < REQUEST_INTERVAL_MS) {
    await sleep(REQUEST_INTERVAL_MS - elapsed);
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      console.log(`GET ${url}`);
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MAUDAM-ArgAutos-Updater/4.0'
        },
        signal: controller.signal
      });
      lastRequestAt = Date.now();

      if (response.status === 429) {
        const h = response.headers.get('retry-after');
        const seconds = Number(h);
        const waitMs = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : 60000;
        console.log(`429. Esperando ${Math.ceil(waitMs / 1000)}s.`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status >= 500 && attempt < 5) {
          const waitMs = Math.min(120000, 5000 * 2 ** (attempt - 1));
          await sleep(waitMs);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      return await response.json();
    } catch (e) {
      if (attempt >= 5) throw new Error(`${e.name === 'AbortError' ? 'Timeout' : e.message}`);
      const waitMs = Math.min(120000, 5000 * 2 ** (attempt - 1));
      console.log(`Error: ${e.message}. Reintentando en ${Math.ceil(waitMs / 1000)}s.`);
      await sleep(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function nextUrl(json) {
  const n = json?.links?.next;
  if (!n) return null;
  if (typeof n === 'string') return n;
  return n.url || n.href || null;
}

async function apiGetAll(url) {
  const out = [];
  let current = url;
  while (current) {
    const json = await apiGet(current);
    if (!Array.isArray(json?.data)) throw new Error(`Respuesta sin data[]: ${current}`);
    out.push(...json.data);
    current = nextUrl(json);
  }
  return out;
}

function freshCatalog() {
  return {
    version: 3,
    actualizado: nowIso(),
    fuente: 'Arg Autos',
    marcas: [],
    modelos: [],
    versiones: []
  };
}

function freshState() {
  return {
    version: 4,
    actualizado: nowIso(),
    fase: 'catalogo_marcas_modelos',
    marcaIndex: 0,
    modeloIndex: 0,
    siguienteIndice: 0,
    totalVersionesCatalogadas: 0,
    versionesProcesadas: 0,
    versionesConValuacion: 0,
    completo: false
  };
}

function loadState() {
  return readJson(STATE, null) || freshState();
}

function loadCatalog() {
  return readJson(CATALOG, null) || freshCatalog();
}

function saveState(state) {
  state.actualizado = nowIso();
  writeJsonAtomic(STATE, state);
}

function saveCatalog(catalog) {
  catalog.actualizado = nowIso();
  writeJsonAtomic(CATALOG, catalog);
}

function freshData(catalog) {
  return {
    version: 7,
    actualizado: nowIso(),
    fuente: 'Arg Autos',
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR,
    totalVersionesCatalogadas: catalog.versiones.length,
    versionesProcesadas: 0,
    versionesConValuacion: 0,
    completo: false,
    vehiculos: {}
  };
}

function loadData(catalog, state) {
  // Al comenzar un nuevo ciclo mensual, las valuaciones se reconstruyen.
  // Durante la fase catálogo se mantiene el archivo actual; al entrar en
  // valuaciones se crea el nuevo conjunto desde cero.
  if (state.fase === 'valuaciones' && state.versionesProcesadas === 0) {
    return freshData(catalog);
  }
  const current = readJson(DATA, null);
  if (!current || typeof current !== 'object' || !current.vehiculos) return freshData(catalog);
  return current;
}

function normalizeId(v) { return String(v?.id ?? v?.version_id ?? ''); }
function normalizeName(v) { return v?.nombre ?? v?.name ?? v?.version ?? v?.modelo ?? ''; }

async function processCatalog(deadline, state, catalog) {
  if (state.fase === 'catalogo_marcas_modelos') {
    if (!catalog.marcas.length) {
      catalog.marcas = await apiGetAll(`${API}/brands`);
      catalog.marcas = catalog.marcas.map(x => ({ id: normalizeId(x), nombre: normalizeName(x) })).filter(x => x.id && x.nombre);
      saveCatalog(catalog);
    }

    while (state.marcaIndex < catalog.marcas.length) {
      if (Date.now() >= deadline - 120000) return false;
      const brand = catalog.marcas[state.marcaIndex];
      const models = await apiGetAll(`${API}/brands/${encodeURIComponent(brand.id)}/models`);

      // Reemplazar modelos de esa marca para evitar duplicados.
      catalog.modelos = catalog.modelos.filter(m => String(m.marcaId) !== String(brand.id));
      for (const m of models) {
        const id = normalizeId(m);
        const nombre = normalizeName(m);
        if (id && nombre) catalog.modelos.push({ id, marcaId: String(brand.id), marca: brand.nombre, nombre });
      }

      state.marcaIndex++;
      saveCatalog(catalog);
      saveState(state);
      console.log(`MODELOS: marca ${state.marcaIndex}/${catalog.marcas.length}`);
    }

    state.fase = 'catalogo_versiones';
    state.modeloIndex = 0;
    saveState(state);
  }

  if (state.fase === 'catalogo_versiones') {
    while (state.modeloIndex < catalog.modelos.length) {
      if (Date.now() >= deadline - 120000) return false;
      const model = catalog.modelos[state.modeloIndex];
      const versions = await apiGetAll(`${API}/models/${encodeURIComponent(model.id)}/versions`);

      catalog.versiones = catalog.versiones.filter(v => String(v.modeloId) !== String(model.id));
      for (const v of versions) {
        const id = normalizeId(v);
        const nombre = normalizeName(v);
        if (!id || !nombre) continue;
        catalog.versiones.push({
          id,
          marcaId: String(model.marcaId),
          modeloId: String(model.id),
          marca: model.marca,
          modelo: model.nombre,
          version: nombre
        });
      }

      state.modeloIndex++;
      state.totalVersionesCatalogadas = catalog.versiones.length;
      saveCatalog(catalog);
      saveState(state);
      console.log(`VERSIONES: modelo ${state.modeloIndex}/${catalog.modelos.length} — total ${catalog.versiones.length}`);
    }

    catalog.marcas.sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));
    catalog.modelos.sort((a,b) => `${a.marca} ${a.nombre}`.localeCompare(`${b.marca} ${b.nombre}`, 'es'));
    catalog.versiones.sort((a,b) => `${a.marca} ${a.modelo} ${a.version}`.localeCompare(`${b.marca} ${b.modelo} ${b.version}`, 'es'));
    saveCatalog(catalog);

    state.fase = 'valuaciones';
    state.siguienteIndice = 0;
    state.totalVersionesCatalogadas = catalog.versiones.length;
    state.versionesProcesadas = 0;
    state.versionesConValuacion = 0;
    state.completo = false;
    saveState(state);
    return true;
  }

  return true;
}

function normalizePrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseUsdValuations(json, rate) {
  if (!Array.isArray(json?.data)) throw new Error('Respuesta de valuaciones sin data[]');
  const precios = {};
  for (const item of json.data) {
    const year = Number(item.year);
    const usd = normalizePrice(item.price);
    if (!Number.isInteger(year) || usd === null) continue;
    if (year !== 0 && (year < MIN_YEAR || year > MAX_YEAR)) continue;
    const p = { usd };
    if (rate > 0) {
      p.ars = Number((usd * rate).toFixed(2));
      p.cotizacion = rate;
    }
    precios[String(year)] = p;
  }
  return precios;
}

async function getCurrentRate() {
  // Una sola consulta ARS por lote obtiene la cotización oficial vigente.
  const json = await apiGet(`${API}/versions/1/valuations?currency=ars`);
  const rate = normalizePrice(json?.meta?.exchange_rate?.ars_per_usd);
  if (!rate) throw new Error('No se pudo obtener ars_per_usd de ArgAutos.');
  return rate;
}

async function processValuations(deadline, state, catalog, data) {
  if (state.siguienteIndice === 0 && state.versionesProcesadas === 0) {
    data = freshData(catalog);
    saveDataAndState(data, state);
  }

  const rate = await getCurrentRate();
  console.log(`Cotización oficial usada para este lote: ${rate}`);
  let sinceCheckpoint = 0;

  while (state.siguienteIndice < catalog.versiones.length) {
    if (Date.now() >= deadline - 120000) break;

    const v = catalog.versiones[state.siguienteIndice];
    console.log(`VERSIÓN ${state.siguienteIndice + 1}/${catalog.versiones.length}: ${v.marca} ${v.modelo} ${v.version} (ID ${v.id})`);

    // IMPORTANTE: USD es la moneda base de ArgAutos. No calculamos USD
    // desde ARS; tomamos directamente el price del endpoint USD.
    const json = await apiGet(`${API}/versions/${encodeURIComponent(v.id)}/valuations`);
    const precios = parseUsdValuations(json, rate);

    data.vehiculos[String(v.id)] = {
      id: String(v.id),
      marcaId: String(v.marcaId),
      modeloId: String(v.modeloId),
      marca: v.marca,
      modelo: v.modelo,
      version: v.version,
      precios
    };

    state.siguienteIndice++;
    state.versionesProcesadas++;
    if (Object.keys(precios).length) state.versionesConValuacion++;
    sinceCheckpoint++;

    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      saveDataAndState(data, state);
      sinceCheckpoint = 0;
      console.log(`CHECKPOINT ${state.siguienteIndice}/${catalog.versiones.length}`);
    }
  }

  saveDataAndState(data, state);
  if (state.siguienteIndice >= catalog.versiones.length) {
    state.completo = true;
    data.completo = true;
    saveDataAndState(data, state);
  }
}

function saveDataAndState(data, state) {
  data.actualizado = nowIso();
  data.minYear = MIN_YEAR;
  data.maxYear = MAX_YEAR;
  data.totalVersionesCatalogadas = state.totalVersionesCatalogadas;
  data.versionesProcesadas = state.versionesProcesadas;
  data.versionesConValuacion = state.versionesConValuacion;
  data.completo = state.completo;
  writeJsonAtomic(DATA, data);
  saveState(state);
}

async function main() {
  const deadline = Date.now() + JOB_SECONDS * 1000;
  let state = loadState();
  let catalog = loadCatalog();

  // Un ciclo completado inicia automáticamente un nuevo ciclo mensual.
  // También reinicia el catálogo para incorporar marcas/modelos/versiones
  // nuevas y conservar exactamente los nombres actuales de ArgAutos.
  if (state.completo) {
    state = freshState();
    catalog = freshCatalog();
    saveCatalog(catalog);
    saveState(state);
    console.log('Nuevo ciclo mensual: reconstruyendo catálogo y valuaciones.');
  }

  // Un estado inicial de catálogo siempre parte de cero y no reutiliza
  // el catálogo anterior, para no perder versiones nuevas o nombres cambiados.
  if (state.fase === 'catalogo_marcas_modelos' && state.marcaIndex === 0 && state.modeloIndex === 0) {
    catalog = freshCatalog();
    saveCatalog(catalog);
  }

  console.log(`=== ARG AUTOS | fase=${state.fase} ===`);
  console.log(`Ventana: 0 km + ${MIN_YEAR}-${MAX_YEAR}`);

  if (state.fase !== 'valuaciones') {
    await processCatalog(deadline, state, catalog);
  }

  if (state.fase === 'valuaciones' && Date.now() < deadline - 120000) {
    const data = loadData(catalog, state);
    await processValuations(deadline, state, catalog, data);
  }

  saveState(state);
  console.log(`FIN DE LOTE: fase=${state.fase}, progreso=${state.siguienteIndice}/${state.totalVersionesCatalogadas}, completo=${state.completo}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

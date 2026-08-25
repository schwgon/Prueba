const fs = require('fs');

const API = 'https://argautos.com/api/v1';
const JOB_SECONDS = Number(process.env.JOB_SECONDS || 9000); // 2h30
const RETRIES = Number(process.env.RETRIES || 6);

const MIN_YEAR_ABSOLUTE = 2013;
const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = Math.max(MIN_YEAR_ABSOLUTE, CURRENT_YEAR - 13);
const MAX_YEAR = CURRENT_YEAR;

const CATALOG = 'catalogo-argautos.json';
const DATA = 'autos-data.json';
const STATE = 'estado-actualizacion.json';

const deadline = Date.now() + JOB_SECONDS * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const timeOk = (extra = 15000) => Date.now() + extra < deadline;

function defaultState() {
  return {
    fase: 'catalogo',
    marcaIndex: 0,
    modeloIndex: 0,
    versionIndex: 0,
    siguienteIndice: 0,
    totalVersiones: 0,
    completado: false
  };
}

function retryWait(attempt, retryAfter = null) {
  if (retryAfter && Number.isFinite(Number(retryAfter))) {
    return Math.max(1, Number(retryAfter)) * 1000;
  }
  return Math.min(30 * (2 ** attempt), 960) * 1000;
}

async function request(url, attempt = 0) {
  if (!timeOk()) throw new Error('JOB_TIME_LIMIT');

  console.log('GET ' + url);

  let r;
  try {
    r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MAUDAM-GitHub-Actions/4.0'
      }
    });
  } catch (e) {
    if (attempt >= RETRIES) throw new Error(`NETWORK_ERROR: ${e.message}`);
    const wait = retryWait(attempt);
    if (!timeOk(wait + 15000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`Error de red. Reintentando en ${Math.round(wait / 1000)} segundos...`);
    await sleep(wait);
    return request(url, attempt + 1);
  }

  const text = await r.text();
  let d = null;
  try { d = JSON.parse(text); } catch {}

  if (r.status === 429) {
    if (attempt >= RETRIES) throw new Error('HTTP 429: demasiados reintentos');
    const retryAfter = d?.retry_after ?? r.headers.get('retry-after') ?? null;
    const wait = retryWait(attempt, retryAfter);
    if (!timeOk(wait + 15000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`Rate limit. Esperando ${Math.round(wait / 1000)} segundos...`);
    await sleep(wait);
    return request(url, attempt + 1);
  }

  if ([500, 502, 503, 504].includes(r.status)) {
    if (attempt >= RETRIES) throw new Error(`TEMPORARY_HTTP_${r.status}`);
    const wait = retryWait(attempt);
    if (!timeOk(wait + 15000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`HTTP ${r.status}. Reintentando en ${Math.round(wait / 1000)} segundos...`);
    await sleep(wait);
    return request(url, attempt + 1);
  }

  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 250)}`);
  if (d === null) throw new Error(`Respuesta no JSON HTTP ${r.status}: ${text.slice(0, 200)}`);

  await sleep(1000);
  return d;
}

async function paginated(url) {
  const out = [];
  let next = url;
  while (next) {
    const d = await request(next);
    if (Array.isArray(d.data)) out.push(...d.data);
    next = d.links?.next || null;
  }
  return out;
}

function num(...xs) {
  for (const x of xs) {
    if (x !== undefined && x !== null && x !== '') {
      const n = Number(String(x).replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function usd(v) {
  return num(v.price_usd, v.priceUSD, v.usd_price, v.usd_price_value, v.usd);
}

function ars(v) {
  return num(v.price_ars, v.priceARS, v.ars_price, v.ars_price_value, v.ars);
}

function fx(v, u, a) {
  return num(v.exchange_rate, v.exchangeRate, v.usd_ars_rate, v.fx_rate, v.rate)
    || (u && a ? a / u : null);
}

function ensureFiles() {
  const state = read(STATE, defaultState());
  const catalog = read(CATALOG, {
    version: 2,
    actualizado: null,
    marcas: [],
    modelos: [],
    versiones: [],
    completo: false
  });
  const data = read(DATA, {
    version: 4,
    fuente: 'Arg Autos',
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR,
    marcas: [],
    vehiculos: {},
    actualizado: null,
    estadisticas: {}
  });

  data.minYear = MIN_YEAR;
  data.maxYear = MAX_YEAR;

  return { state, catalog, data };
}

async function iniciarCatalogo(catalog, data) {
  if (!catalog.marcas.length) {
    const brands = (await request(`${API}/brands`)).data || [];
    catalog.marcas = brands
      .map(b => ({ id: String(b.id), nombre: b.name }))
      .filter(b => b.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    data.marcas = catalog.marcas.map(b => b.nombre);
    write(CATALOG, catalog);
    write(DATA, data);
    console.log(`Marcas obtenidas: ${catalog.marcas.length}`);
  }
}

async function construirCatalogo(state, catalog, data) {
  await iniciarCatalogo(catalog, data);

  while (state.marcaIndex < catalog.marcas.length) {
    const brand = catalog.marcas[state.marcaIndex];
    console.log(`MARCA ${brand.nombre}`);

    if (!catalog.modelos.some(m => m.marcaId === brand.id)) {
      if (!timeOk(15000)) throw new Error('JOB_TIME_LIMIT');
      const models = await paginated(`${API}/brands/${brand.id}/models`);
      for (const m of models) {
        catalog.modelos.push({
          id: String(m.id), marcaId: brand.id,
          marca: brand.nombre, nombre: m.name
        });
      }
      write(CATALOG, catalog);
      console.log(`Modelos acumulados: ${catalog.modelos.length}`);
    }

    const modelosMarca = catalog.modelos.filter(m => m.marcaId === brand.id);

    while (state.modeloIndex < modelosMarca.length) {
      const model = modelosMarca[state.modeloIndex];
      console.log(`MODELO ${model.nombre}`);

      if (!catalog.versiones.some(v => v.modeloId === model.id)) {
        const versions = await paginated(`${API}/models/${model.id}/versions`);
        for (const v of versions) {
          catalog.versiones.push({
            id: String(v.id),
            marcaId: brand.id,
            modeloId: model.id,
            marca: brand.nombre,
            modelo: model.nombre,
            version: v.name
          });
        }
        write(CATALOG, catalog);
        console.log(`Versiones acumuladas: ${catalog.versiones.length}`);
      }

      state.modeloIndex++;
      state.versionIndex = 0;
      write(STATE, state);

      if (!timeOk(15000)) throw new Error('JOB_TIME_LIMIT');
    }

    state.marcaIndex++;
    state.modeloIndex = 0;
    write(STATE, state);

    if (!timeOk(15000)) throw new Error('JOB_TIME_LIMIT');
  }

  catalog.completo = true;
  catalog.actualizado = new Date().toISOString();
  write(CATALOG, catalog);

  state.fase = 'valuaciones';
  state.siguienteIndice = 0;
  state.totalVersiones = catalog.versiones.length;
  state.completado = false;
  write(STATE, state);

  console.log(`CATÁLOGO COMPLETO: ${catalog.versiones.length} versiones`);
}

async function procesarUnaVersion(item, data) {
  const vals = await paginated(`${API}/versions/${item.id}/valuations?currency=ars`);
  const precios = {};

  for (const v of vals) {
    const year = Number(v.year);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) continue;

    const u = usd(v);
    const a = ars(v);
    const rate = fx(v, u, a);

    if (u !== null || a !== null) {
      precios[year] = {
        usd: u,
        tipoCambio: rate,
        ars: a,
        actualizado: new Date().toISOString()
      };
    }
  }

  if (Object.keys(precios).length) {
    data.vehiculos[item.id] = {
      marca: item.marca,
      modelo: item.modelo,
      version: item.version,
      precios
    };
  } else {
    delete data.vehiculos[item.id];
  }
}

async function procesarValuaciones(state, catalog, data) {
  let i = Number(state.siguienteIndice || 0);

  while (i < catalog.versiones.length) {
    if (!timeOk(30000)) break;

    const item = catalog.versiones[i];
    console.log(`VERSIÓN ${i + 1}/${catalog.versiones.length}: ${item.marca} ${item.modelo} ${item.version}`);

    try {
      await procesarUnaVersion(item, data);
      i++;

      state.siguienteIndice = i;
      state.totalVersiones = catalog.versiones.length;
      state.completado = false;

      data.minYear = MIN_YEAR;
      data.maxYear = MAX_YEAR;
      data.actualizado = new Date().toISOString();
      data.estadisticas = {
        marcas: catalog.marcas.length,
        modelos: catalog.modelos.length,
        versionesCatalogadas: catalog.versiones.length,
        versionesConValuacion: Object.keys(data.vehiculos).length,
        siguienteIndice: i,
        minYear: MIN_YEAR,
        maxYear: MAX_YEAR
      };

      write(DATA, data);
      write(STATE, state);
      console.log(`GUARDADO checkpoint ${i}/${catalog.versiones.length}`);
    } catch (e) {
      if (e.message === 'JOB_TIME_LIMIT') break;

      if (
        e.message.startsWith('TEMPORARY_HTTP_') ||
        e.message.startsWith('NETWORK_ERROR') ||
        e.message.startsWith('HTTP 429')
      ) {
        console.log(`Error recuperable en versión ${i + 1}: ${e.message}`);
        console.log('Se conserva el checkpoint anterior y el próximo job reintentará esta versión.');
        break;
      }

      throw e;
    }
  }

  state.siguienteIndice = i;
  state.totalVersiones = catalog.versiones.length;
  state.completado = i >= catalog.versiones.length;

  data.minYear = MIN_YEAR;
  data.maxYear = MAX_YEAR;
  data.actualizado = new Date().toISOString();
  data.estadisticas = {
    marcas: catalog.marcas.length,
    modelos: catalog.modelos.length,
    versionesCatalogadas: catalog.versiones.length,
    versionesConValuacion: Object.keys(data.vehiculos).length,
    siguienteIndice: i,
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR
  };

  write(DATA, data);
  write(STATE, state);

  console.log(`LOTE FINALIZADO. Siguiente índice: ${i}. Completo: ${state.completado}`);
}

async function main() {
  const { state, catalog, data } = ensureFiles();

  try {
    if (state.fase === 'catalogo' || !catalog.completo) {
      await construirCatalogo(state, catalog, data);
      if (!timeOk(30000)) return;
    }

    if (state.fase === 'valuaciones') {
      await procesarValuaciones(state, catalog, data);
    }
  } catch (e) {
    if (e.message === 'JOB_TIME_LIMIT') {
      console.log('Tiempo disponible agotado. Estado guardado; el próximo job continuará desde el checkpoint.');
      return;
    }
    throw e;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

const fs = require('fs');

const API = 'https://argautos.com/api/v1';
const MIN_YEAR = 2013;
const JOB_SECONDS = Number(process.env.JOB_SECONDS || 540);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);
const deadline = Date.now() + JOB_SECONDS * 1000;

const CATALOG = 'catalogo-argautos.json';
const DATA = 'autos-data.json';
const STATE = 'estado-actualizacion.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const timeOk = (extra = 10000) => Date.now() + extra < deadline;

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

async function request(url) {
  if (!timeOk()) throw new Error('JOB_TIME_LIMIT');
  console.log('GET ' + url);

  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MAUDAM-GitHub-Actions/3.0'
    }
  });

  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch { throw new Error(`Respuesta no JSON HTTP ${r.status}: ${text.slice(0, 200)}`); }

  if (r.status === 429) {
    const wait = Number(d.retry_after || r.headers.get('retry-after') || 60);
    // Si esperar haría que el job supere el límite, salimos de forma limpia.
    if (!timeOk((wait + 3) * 1000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`Rate limit. Esperando ${wait} segundos...`);
    await sleep(wait * 1000);
    return request(url);
  }

  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 250)}`);
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
function usd(v) { return num(v.price_usd, v.priceUSD, v.usd_price, v.usd_price_value, v.usd); }
function ars(v) { return num(v.price_ars, v.priceARS, v.ars_price, v.ars_price_value, v.ars); }
function fx(v, u, a) {
  return num(v.exchange_rate, v.exchangeRate, v.usd_ars_rate, v.fx_rate, v.rate) || (u && a ? a / u : null);
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
    version: 3,
    fuente: 'Arg Autos',
    minYear: MIN_YEAR,
    marcas: [],
    vehiculos: {},
    actualizado: null,
    estadisticas: {}
  });
  return { state, catalog, data };
}

async function iniciarCatalogo(state, catalog, data) {
  if (!catalog.marcas.length) {
    const brands = (await request(`${API}/brands`)).data || [];
    catalog.marcas = brands.map(b => ({ id: String(b.id), nombre: b.name }))
      .filter(b => b.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    data.marcas = catalog.marcas.map(b => b.nombre);
    write(CATALOG, catalog);
    write(DATA, data);
    console.log(`Marcas obtenidas: ${catalog.marcas.length}`);
  }
}

async function construirCatalogo(state, catalog, data) {
  await iniciarCatalogo(state, catalog, data);

  while (state.marcaIndex < catalog.marcas.length) {
    const brand = catalog.marcas[state.marcaIndex];
    console.log(`MARCA ${brand.nombre}`);

    // Guardamos la lista de modelos en catalogo para que no se vuelva a pedir.
    if (!catalog.modelos.some(m => m.marcaId === brand.id)) {
      if (!timeOk(15000)) throw new Error('JOB_TIME_LIMIT');
      const models = await paginated(`${API}/brands/${brand.id}/models`);
      for (const m of models) {
        catalog.modelos.push({
          id: String(m.id), marcaId: brand.id, marca: brand.nombre, nombre: m.name
        });
      }
      write(CATALOG, catalog);
      console.log(`Modelos acumulados: ${catalog.modelos.length}`);
    }

    const modelosMarca = catalog.modelos.filter(m => m.marcaId === brand.id);
    while (state.modeloIndex < modelosMarca.length) {
      const model = modelosMarca[state.modeloIndex];
      console.log(`MODELO ${model.nombre}`);

      const already = catalog.versiones.some(v => v.modeloId === model.id);
      if (!already) {
        const versions = await paginated(`${API}/models/${model.id}/versions`);
        for (const v of versions) {
          catalog.versiones.push({
            id: String(v.id), marcaId: brand.id, modeloId: model.id,
            marca: brand.nombre, modelo: model.nombre, version: v.name
          });
        }
        // CRÍTICO: guardar después de cada modelo terminado.
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
  write(STATE, state);
  console.log(`CATÁLOGO COMPLETO: ${catalog.versiones.length} versiones`);
}

async function procesarValuaciones(state, catalog, data) {
  let i = Number(state.siguienteIndice || 0);
  let count = 0;

  while (i < catalog.versiones.length && count < BATCH_SIZE) {
    if (!timeOk(15000)) break;
    const item = catalog.versiones[i];
    console.log(`VERSIÓN ${i + 1}/${catalog.versiones.length}: ${item.marca} ${item.modelo} ${item.version}`);

    try {
      const vals = await paginated(`${API}/versions/${item.id}/valuations?currency=ars`);
      const precios = {};

      for (const v of vals) {
        const year = Number(v.year);
        if (!Number.isInteger(year) || year < MIN_YEAR) continue;
        const u = usd(v), a = ars(v), rate = fx(v, u, a);
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
      }

      i++;
      count++;
      state.siguienteIndice = i;
      state.totalVersiones = catalog.versiones.length;
      write(DATA, data);
      write(STATE, state);
      console.log(`GUARDADO checkpoint ${i}/${catalog.versiones.length}`);
    } catch (e) {
      if (e.message === 'JOB_TIME_LIMIT') break;
      throw e;
    }
  }

  data.actualizado = new Date().toISOString();
  data.estadisticas = {
    marcas: catalog.marcas.length,
    modelos: catalog.modelos.length,
    versionesCatalogadas: catalog.versiones.length,
    versionesConValuacion: Object.keys(data.vehiculos).length,
    siguienteIndice: i
  };
  state.siguienteIndice = i;
  state.completado = i >= catalog.versiones.length;
  write(DATA, data);
  write(STATE, state);
  console.log(`LOTE FINALIZADO. Siguiente índice: ${i}. Completo: ${state.completado}`);
}

async function main() {
  let { state, catalog, data } = ensureFiles();

  try {
    if (state.fase === 'catalogo' || !catalog.completo) {
      await construirCatalogo(state, catalog, data);
      // Si el catálogo terminó cerca del límite, dejamos las valuaciones para el próximo job.
      if (!timeOk(15000)) return;
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

main().catch(e => { console.error(e); process.exit(1); });

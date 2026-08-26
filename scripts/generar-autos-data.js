const fs = require("fs");
const path = require("path");

const API = "https://argautos.com/api/v1";
const MIN_YEAR = 2013;
const MAX_YEAR = new Date().getFullYear();

// ArgAutos documenta 3 requests/minuto sin API key.
// Usamos 20s entre requests para mantenernos dentro del límite.
const REQUEST_INTERVAL_MS = Number(process.env.REQUEST_INTERVAL_MS || 20500);

// Cada ejecución procesa hasta este tiempo y deja checkpoint.
const JOB_SECONDS = Number(process.env.JOB_SECONDS || 9000);

// Archivos
const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(ROOT, "catalogo-argautos.json");
const DATA = path.join(ROOT, "autos-data.json");
const STATE = path.join(ROOT, "estado-actualizacion.json");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function nowIso() {
  return new Date().toISOString();
}

function loadCatalog() {
  const catalog = readJson(CATALOG, null);
  if (!catalog || !Array.isArray(catalog.versiones)) {
    throw new Error(`No se encontró un catálogo válido en ${CATALOG}`);
  }
  return catalog;
}

function freshData(catalog) {
  return {
    version: 5,
    actualizado: nowIso(),
    fuente: "Arg Autos",
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR,
    totalVersionesCatalogadas: catalog.versiones.length,
    versionesProcesadas: 0,
    versionesConValuacion: 0,
    completo: false,
    vehiculos: {}
  };
}

function loadData(catalog) {
  const current = readJson(DATA, null);
  if (!current || typeof current !== "object" || !current.vehiculos) {
    return freshData(catalog);
  }

  // Si el archivo viejo tiene el demo o un estado incompatible,
  // arrancamos valuaciones desde cero, pero conservamos el catálogo.
  const total = catalog.versiones.length;
  const compatible =
    current.totalVersionesCatalogadas === total &&
    current.version >= 5 &&
    current.vehiculos &&
    !current.vehiculos.demo;

  if (!compatible) {
    return freshData(catalog);
  }

  current.minYear = MIN_YEAR;
  current.maxYear = MAX_YEAR;
  current.totalVersionesCatalogadas = total;
  return current;
}

function loadState(catalog) {
  const total = catalog.versiones.length;
  const state = readJson(STATE, null);

  if (!state || state.totalVersionesCatalogadas !== total) {
    return {
      version: 2,
      actualizado: nowIso(),
      siguienteIndice: 0,
      totalVersionesCatalogadas: total,
      versionesProcesadas: 0,
      versionesConValuacion: 0,
      completo: false
    };
  }

  // El reset oficial usa 0. Si el estado pertenece a la ejecución vieja,
  // no confiamos en él.
  if (state.version < 2 || state.reinicioValuaciones !== true) {
    return {
      version: 2,
      actualizado: nowIso(),
      siguienteIndice: 0,
      totalVersionesCatalogadas: total,
      versionesProcesadas: 0,
      versionesConValuacion: 0,
      completo: false
    };
  }

  return state;
}

let lastRequestAt = 0;

async function apiGet(url) {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt && elapsed < REQUEST_INTERVAL_MS) {
    await sleep(REQUEST_INTERVAL_MS - elapsed);
  }

  let attempt = 0;

  while (true) {
    attempt++;
    const started = Date.now();

    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "MAUDAM-ArgAutos-Updater/1.0"
        }
      });

      lastRequestAt = Date.now();

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("retry-after");
        let waitMs = 60000;

        if (retryAfterHeader) {
          const seconds = Number(retryAfterHeader);
          if (Number.isFinite(seconds)) {
            waitMs = Math.max(1000, seconds * 1000);
          }
        }

        console.log(`429 Rate Limit. Esperando ${Math.ceil(waitMs / 1000)}s...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status >= 500 && attempt < 5) {
          const waitMs = Math.min(120000, 5000 * 2 ** (attempt - 1));
          console.log(`HTTP ${response.status}. Reintentando en ${Math.ceil(waitMs / 1000)}s...`);
          await sleep(waitMs);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
      }

      const json = await response.json();
      console.log(`GET ${url} -> ${response.status} (${Date.now() - started}ms)`);
      return json;
    } catch (error) {
      if (attempt >= 5) throw error;
      const waitMs = Math.min(120000, 5000 * 2 ** (attempt - 1));
      console.log(`Error de red: ${error.message}. Reintentando en ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
  }
}

function normalizePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeYear(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function makePriceRecord(priceArs, exchangeRate) {
  const ars = normalizePrice(priceArs);
  const rate = normalizePrice(exchangeRate);

  if (ars === null) return null;

  const record = {
    ars: ars
  };

  if (rate !== null && rate > 0) {
    record.usd = Number((ars / rate).toFixed(2));
    record.cotizacion = rate;
  }

  return record;
}

function parseValuations(json) {
  if (!json || !Array.isArray(json.data)) {
    throw new Error("Respuesta de valuaciones inválida: falta data[]");
  }

  const currency = String(json.meta?.currency || "").toUpperCase();
  const exchangeRate = json.meta?.exchange_rate?.ars_per_usd ?? null;

  const precios = {};

  for (const item of json.data) {
    const year = normalizeYear(item.year);
    if (year === null) continue;

    // ArgAutos usa year=0 para 0 km.
    if (year !== 0 && (year < MIN_YEAR || year > MAX_YEAR)) {
      continue;
    }

    const price = normalizePrice(item.price);
    if (price === null) continue;

    let record;

    if (currency === "ARS") {
      record = makePriceRecord(price, exchangeRate);
    } else if (currency === "USD") {
      const usd = price;
      const rate = normalizePrice(exchangeRate);
      record = { usd: usd };

      if (rate !== null && rate > 0) {
        record.ars = Number((usd * rate).toFixed(2));
        record.cotizacion = rate;
      }
    } else {
      // No guardamos una valuación cuyo currency no conocemos.
      continue;
    }

    if (record) {
      precios[String(year)] = record;
    }
  }

  return precios;
}

function vehicleKey(versionId) {
  return String(versionId);
}

function saveCheckpoint(state, data) {
  data.actualizado = nowIso();
  data.versionesProcesadas = state.versionesProcesadas;
  data.versionesConValuacion = state.versionesConValuacion;
  data.completo = state.completo;

  state.actualizado = data.actualizado;

  writeJsonAtomic(DATA, data);
  writeJsonAtomic(STATE, state);
}

async function main() {
  console.log("=== GENERANDO autos-data.json ===");
  console.log(`Rango: 0 km + ${MIN_YEAR}-${MAX_YEAR}`);
  console.log(`Intervalo mínimo entre requests: ${REQUEST_INTERVAL_MS} ms`);
  console.log(`Tiempo máximo del lote: ${JOB_SECONDS}s`);

  const catalog = loadCatalog();
  const versiones = catalog.versiones;
  const data = loadData(catalog);
  const state = loadState(catalog);

  // Si DATA quedó inconsistente con STATE, el checkpoint siempre manda
  // solamente cuando estamos en el formato nuevo.
  if (state.siguienteIndice < 0 || state.siguienteIndice > versiones.length) {
    throw new Error(`Checkpoint inválido: ${state.siguienteIndice}`);
  }

  const deadline = Date.now() + JOB_SECONDS * 1000;

  console.log(`Versiones: ${versiones.length}`);
  console.log(`Comenzando en índice: ${state.siguienteIndice}`);

  while (state.siguienteIndice < versiones.length) {
    if (Date.now() >= deadline) {
      console.log("Se alcanzó el límite de tiempo del lote.");
      break;
    }

    const index = state.siguienteIndice;
    const version = versiones[index];

    console.log(
      `\nVERSIÓN ${index + 1}/${versiones.length}: ` +
      `${version.marca} ${version.modelo} ${version.version} (ID ${version.id})`
    );

    const url = `${API}/versions/${encodeURIComponent(version.id)}/valuations?currency=ars`;

    let precios;
    try {
      const response = await apiGet(url);
      precios = parseValuations(response);
    } catch (error) {
      // NO avanzamos el checkpoint si la versión no pudo procesarse.
      console.error(`ERROR en versión ${version.id}: ${error.message}`);
      saveCheckpoint(state, data);
      throw error;
    }

    const key = vehicleKey(version.id);

    // Guardamos la versión incluso si no tiene valuaciones válidas,
    // para distinguir "procesada sin precio" de "no procesada".
    data.vehiculos[key] = {
      id: String(version.id),
      marcaId: String(version.marcaId),
      modeloId: String(version.modeloId),
      marca: version.marca,
      modelo: version.modelo,
      version: version.version,
      precios
    };

    if (Object.keys(precios).length > 0) {
      state.versionesConValuacion++;
    }

    state.siguienteIndice++;
    state.versionesProcesadas++;

    // Guardamos después de CADA versión. Si GitHub Actions se corta,
    // la última versión confirmada queda persistida.
    saveCheckpoint(state, data);

    console.log(
      `OK. Precios válidos: ${Object.keys(precios).length}. ` +
      `Progreso: ${state.siguienteIndice}/${versiones.length}`
    );
  }

  if (state.siguienteIndice >= versiones.length) {
    state.completo = true;
    data.completo = true;
    saveCheckpoint(state, data);
    console.log("\n=== CATÁLOGO DE VALUACIONES COMPLETADO ===");
  } else {
    console.log(
      `\n=== LOTE TERMINADO === ${state.siguienteIndice}/${versiones.length}`
    );
  }
}

main().catch(error => {
  console.error("\nFATAL:", error);
  process.exit(1);
});

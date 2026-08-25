const fs = require('fs');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const API_BASE = 'https://argautos.com/api/v1';
const JOB_TIMEOUT_MS = (process.env.JOB_SECONDS || 9000) * 1000; // 2h30 default
const MAX_RETRIES = Number(process.env.RETRIES || 6);

// Rate limiting: ArgAutos API pública permite 3 requests/minuto sin API key
// 60 segundos / 3 = 20 segundos entre requests (con margen de seguridad)
const MIN_REQUEST_INTERVAL_MS = 20000; // 20 segundos

// Años válidos: 0 km + años históricos 2013-2026
const YEAR_ZERO = '0'; // "0 km" - categoría especial
const MIN_YEAR = 2013;
const MAX_YEAR = new Date().getFullYear(); // 2026

// Archivos
const CATALOG_FILE = 'catalogo-argautos.json';
const DATA_FILE = 'autos-data.json';
const STATE_FILE = 'estado-actualizacion.json';

const deadline = Date.now() + JOB_TIMEOUT_MS;

// ============================================================================
// UTILIDADES
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (f, d) =>
  fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;

const write = (f, d) => {
  const json = JSON.stringify(d, null, 2);
  fs.writeFileSync(f, json, 'utf8');
};

const timeOk = (extra = 15000) => Date.now() + extra < deadline;

function defaultState() {
  return {
    fase: 'valuaciones',
    siguienteIndice: 0,
    totalVersiones: 0,
    completado: false,
    estadisticas: {
      versionesProcesadas: 0,
      versionesConValuacion: 0,
      versionesSinValuacion: 0,
      erroresSkipped: 0,
      ultimoError: null,
    },
    tiempoInicio: new Date().toISOString(),
    ultimaActualizacion: null,
  };
}

function retryWait(attempt, retryAfter = null) {
  if (retryAfter && Number.isFinite(Number(retryAfter))) {
    return Math.max(1, Number(retryAfter)) * 1000;
  }
  return Math.min(30 * Math.pow(2, attempt), 960) * 1000;
}

// ============================================================================
// HTTP REQUEST CON RATE LIMITING
// ============================================================================

let lastRequestTime = 0;

async function request(url, attempt = 0) {
  if (!timeOk()) throw new Error('JOB_TIME_LIMIT');

  // Respetar rate limit: 3 RPM = ~20 segundos entre requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
    console.log(`[Rate limit] Esperando ${Math.round(waitTime / 1000)}s...`);
    await sleep(waitTime);
  }

  lastRequestTime = Date.now();
  console.log(`GET ${url}`);

  let r;
  try {
    r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MAUDAM-GitHub-Actions/5.0',
      },
    });
  } catch (e) {
    if (attempt >= MAX_RETRIES) throw new Error(`NETWORK_ERROR: ${e.message}`);
    const wait = retryWait(attempt);
    if (!timeOk(wait + 15000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`Error de red. Reintentando en ${Math.round(wait / 1000)}s...`);
    await sleep(wait);
    return request(url, attempt + 1);
  }

  const text = await r.text();
  let d = null;
  try {
    d = JSON.parse(text);
  } catch {
    // Respuesta no es JSON válido
  }

  // Manejo de rate limit 429
  if (r.status === 429) {
    if (attempt >= MAX_RETRIES)
      throw new Error('HTTP 429: demasiados reintentos');
    const retryAfter =
      d?.retry_after ?? r.headers.get('retry-after') ?? null;
    const wait = retryWait(attempt, retryAfter);
    if (!timeOk(wait + 15000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`Rate limit (429). Esperando ${Math.round(wait / 1000)}s...`);
    await sleep(wait);
    return request(url, attempt + 1);
  }

  // Manejo de errores 5xx
  if ([500, 502, 503, 504].includes(r.status)) {
    if (attempt >= MAX_RETRIES) throw new Error(`HTTP_${r.status}`);
    const wait = retryWait(attempt);
    if (!timeOk(wait + 15000)) throw new Error('JOB_TIME_LIMIT');
    console.log(`HTTP ${r.status}. Reintentando en ${Math.round(wait / 1000)}s...`);
    await sleep(wait);
    return request(url, attempt + 1);
  }

  // Otro error HTTP
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 250)}`);

  // Respuesta no fue JSON
  if (d === null) throw new Error(`Respuesta no JSON HTTP ${r.status}`);

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

// ============================================================================
// PARSING DE PRECIOS
// ============================================================================

/**
 * Extrae un número de un valor que puede venir como string, number, etc.
 * Elimina caracteres no numéricos excepto punto (para decimales)
 */
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  const num = Number(str.replace(/[^\d.]/g, ''));
  if (Number.isFinite(num) && num > 0) return num;
  return null;
}

/**
 * Procesa una valuación individual
 * ArgAutos devuelve: { year, price, currency, exchange_rate }
 * currency puede ser "ARS" o "USD"
 * exchange_rate tiene: { source, type, ars_per_usd }
 */
function procesarValuacion(valuacion) {
  const year = valuacion.year;
  const price = parsePrice(valuacion.price);
  const currency = valuacion.currency?.toUpperCase() || 'USD';

  // Validar
  if (price === null) return null;

  // Year 0 = "0 km" (especial)
  // Años válidos: 0 o [2013, 2026]
  const isYearZero = year === 0;
  const isYearValid = year >= MIN_YEAR && year <= MAX_YEAR;

  if (!isYearZero && !isYearValid) {
    return null;
  }

  const yearKey = String(year);

  // Currency puede ser ARS o USD
  // Si es ARS, el price está ya convertido
  // Si es USD, podemos convertir usando exchange_rate
  let priceUSD, priceARS, exchangeRate;

  if (currency === 'ARS') {
    // Precio viene en ARS, extraer USD usando exchange rate
    priceARS = price;
    const exRate = valuacion.exchange_rate?.ars_per_usd;
    if (!exRate) {
      // Sin exchange rate, no podemos calcular USD
      exchangeRate = null;
      priceUSD = null;
    } else {
      exchangeRate = exRate;
      priceUSD = Math.round((price / exchangeRate) * 100) / 100;
    }
  } else if (currency === 'USD') {
    // Precio viene en USD
    priceUSD = price;
    const exRate = valuacion.exchange_rate?.ars_per_usd;
    if (exRate) {
      exchangeRate = exRate;
      priceARS = Math.round(price * exchangeRate * 100) / 100;
    } else {
      exchangeRate = null;
      priceARS = null;
    }
  } else {
    return null;
  }

  // Validar que tenemos al menos un precio
  if (priceUSD === null && priceARS === null) {
    return null;
  }

  return {
    yearKey,
    priceUSD,
    priceARS,
    exchangeRate,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// PROCESAR UNA VERSIÓN
// ============================================================================

async function procesarUnaVersion(versionItem, data, state) {
  const { id, marca, modelo, version } = versionItem;

  try {
    // Obtener valuaciones para esta versión
    // currency=ars para obtener precios en ARS con exchange rate
    const valuaciones = await paginated(
      `${API_BASE}/versions/${id}/valuations?currency=ars`
    );

    const preciosPorAno = {};
    let tiene0km = false;
    let tieneHistorico = false;

    // Procesar cada valuación
    for (const val of valuaciones) {
      const parsed = procesarValuacion(val);
      if (parsed === null) continue;

      preciosPorAno[parsed.yearKey] = {
        ars: parsed.priceARS,
        usd: parsed.priceUSD,
        tipoCambio: parsed.exchangeRate,
        actualizado: parsed.timestamp,
      };

      if (parsed.yearKey === YEAR_ZERO) {
        tiene0km = true;
      } else {
        tieneHistorico = true;
      }
    }

    // Si hay precios, guardar la versión
    if (Object.keys(preciosPorAno).length > 0) {
      data.vehiculos[id] = {
        marca,
        modelo,
        version,
        precios: preciosPorAno,
      };

      state.estadisticas.versionesConValuacion++;

      console.log(
        `  ✓ ${marca} ${modelo} ${version} → ${Object.keys(preciosPorAno).length} años`
      );

      return { success: true, hasData: true };
    } else {
      // Versión sin valuaciones
      state.estadisticas.versionesSinValuacion++;
      return { success: true, hasData: false };
    }
  } catch (e) {
    console.log(`  ✗ Error procesando versión ${id}: ${e.message}`);
    state.estadisticas.erroresSkipped++;
    state.estadisticas.ultimoError = e.message;
    return { success: false, hasData: false };
  }
}

// ============================================================================
// PROCESAR LOTE DE VALUACIONES
// ============================================================================

async function procesarValuaciones(state, catalog, data) {
  let i = Number(state.siguienteIndice || 0);
  const totalVersiones = catalog.versiones.length;

  console.log(`\nProcesando valuaciones: ${i} / ${totalVersiones}`);

  while (i < totalVersiones) {
    if (!timeOk(30000)) {
      console.log('Tiempo disponible agotado.');
      break;
    }

    const versionItem = catalog.versiones[i];
    const progress = `[${i + 1}/${totalVersiones}]`;

    try {
      const resultado = await procesarUnaVersion(versionItem, data, state);

      if (!resultado.success) {
        // Error recuperable, continuar
        i++;
      } else {
        // Actualizar checkpoint
        i++;
        state.siguienteIndice = i;
        state.estadisticas.versionesProcesadas++;

        // Guardar después de cada versión
        data.actualizado = new Date().toISOString();
        data.estadisticas = {
          marcas: catalog.marcas.length,
          modelos: catalog.modelos.length,
          versionesCatalogadas: totalVersiones,
          versionesConValuacion: state.estadisticas.versionesConValuacion,
          versionesSinValuacion: state.estadisticas.versionesSinValuacion,
          erroresSkipped: state.estadisticas.erroresSkipped,
        };

        write(DATA_FILE, data);
        write(STATE_FILE, state);

        if (i % 50 === 0 || i === totalVersiones) {
          const cobertura = (
            (state.estadisticas.versionesConValuacion / totalVersiones) *
            100
          ).toFixed(2);
          console.log(
            `${progress} Cobertura: ${cobertura}% (${state.estadisticas.versionesConValuacion}/${totalVersiones})`
          );
        }
      }
    } catch (e) {
      if (e.message === 'JOB_TIME_LIMIT') break;

      // Errores irrecuperables
      if (e.message.includes('Respuesta no JSON')) {
        console.log(`${progress} Respuesta corrupta, saltando versión`);
        i++;
        continue;
      }

      throw e;
    }
  }

  // Estado final
  state.siguienteIndice = i;
  state.completado = i >= totalVersiones;
  state.ultimaActualizacion = new Date().toISOString();

  data.actualizado = new Date().toISOString();
  data.estadisticas = {
    marcas: catalog.marcas.length,
    modelos: catalog.modelos.length,
    versionesCatalogadas: totalVersiones,
    versionesConValuacion: state.estadisticas.versionesConValuacion,
    versionesSinValuacion: state.estadisticas.versionesSinValuacion,
    erroresSkipped: state.estadisticas.erroresSkipped,
  };

  write(DATA_FILE, data);
  write(STATE_FILE, state);

  console.log(`\nLote finalizado:`);
  console.log(`  Procesadas: ${state.estadisticas.versionesProcesadas}`);
  console.log(`  Con valuación: ${state.estadisticas.versionesConValuacion}`);
  console.log(`  Sin valuación: ${state.estadisticas.versionesSinValuacion}`);
  console.log(`  Errores: ${state.estadisticas.erroresSkipped}`);
  console.log(`  Completado: ${state.completado}`);
}

// ============================================================================
// INICIALIZAR ARCHIVOS
// ============================================================================

function ensureFiles() {
  // Estado
  const state = read(STATE_FILE, defaultState());

  // Catálogo (preservar, no re-descargar)
  const catalog = read(CATALOG_FILE, {
    version: 2,
    actualizado: null,
    marcas: [],
    modelos: [],
    versiones: [],
    completo: false,
  });

  // Datos (estructura limpia)
  const data = read(DATA_FILE, {
    version: 3,
    actualizado: null,
    fuente: 'Arg Autos',
    minYear: YEAR_ZERO,
    maxYear: MAX_YEAR,
    marcas: [],
    vehiculos: {},
    estadisticas: {
      marcas: 0,
      modelos: 0,
      versionesCatalogadas: 0,
      versionesConValuacion: 0,
      versionesSinValuacion: 0,
      erroresSkipped: 0,
    },
  });

  // Asegurar que marcas estén en data
  if (!data.marcas || data.marcas.length === 0) {
    data.marcas = catalog.marcas
      .map((b) => b.nombre)
      .filter((n) => n)
      .sort((a, b) => a.localeCompare(b, 'es'));
  }

  return { state, catalog, data };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  try {
    console.log('MAUDAM - Generador de datos de vehículos v5.0');
    console.log(`Inicio: ${new Date().toISOString()}`);
    console.log(`Timeout: ${Math.round(JOB_TIMEOUT_MS / 1000 / 60)} minutos`);
    console.log(`Rate limit: 3 requests/minuto (${MIN_REQUEST_INTERVAL_MS / 1000}s entre requests)`);
    console.log('');

    const { state, catalog, data } = ensureFiles();

    // Validar que el catálogo está completo
    if (!catalog.completo || catalog.versiones.length === 0) {
      throw new Error('Catálogo incompleto o vacío. Ejecuta primero la fase de catálogo.');
    }

    console.log(`Catálogo cargado: ${catalog.versiones.length} versiones`);
    console.log(`Continuando desde índice: ${state.siguienteIndice}`);
    console.log('');

    // Procesar valuaciones
    await procesarValuaciones(state, catalog, data);

    console.log('');
    console.log(`Finalización: ${new Date().toISOString()}`);

    if (state.completado) {
      console.log('✅ GENERACIÓN COMPLETA');
    } else {
      console.log(`⏸️  Generación incompleta. Continuar desde índice ${state.siguienteIndice}`);
    }
  } catch (e) {
    console.error('❌ ERROR:', e.message);
    process.exit(1);
  }
}

main();

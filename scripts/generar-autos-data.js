const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const API = "https://argautos.com/api/v1";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = CURRENT_YEAR - 13;
const MAX_YEAR = CURRENT_YEAR;

const REQUEST_INTERVAL_MS = Number(
  process.env.REQUEST_INTERVAL_MS || 21000
);

const JOB_SECONDS = Number(
  process.env.JOB_SECONDS || 7500
);

const CHECKPOINT_EVERY = Number(
  process.env.CHECKPOINT_EVERY || 25
);

const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(ROOT, "catalogo-argautos.json");
const DATA = path.join(ROOT, "autos-data.json");
const STATE = path.join(ROOT, "estado-actualizacion.json");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(tmp, file);
}

function nowIso() {
  return new Date().toISOString();
}

function loadCatalog() {
  const catalog =
    readJson(CATALOG, null);

  if (
    !catalog ||
    !Array.isArray(catalog.versiones)
  ) {
    throw new Error(
      `Catálogo inválido: ${CATALOG}`
    );
  }

  return catalog;
}

function freshData(catalog) {
  return {
    version: 6,
    actualizado: nowIso(),
    fuente: "Arg Autos",
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR,
    totalVersionesCatalogadas:
      catalog.versiones.length,
    versionesProcesadas: 0,
    versionesConValuacion: 0,
    completo: false,
    vehiculos: {}
  };
}

function loadData(catalog) {
  const current =
    readJson(DATA, null);

  if (
    !current ||
    typeof current !== "object" ||
    !current.vehiculos
  ) {
    return freshData(catalog);
  }

  const total =
    catalog.versiones.length;

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
  current.totalVersionesCatalogadas =
    total;

  return current;
}

function loadState(catalog) {
  const total =
    catalog.versiones.length;

  const state =
    readJson(STATE, null);

  if (
    !state ||
    state.totalVersionesCatalogadas !== total
  ) {
    return {
      version: 3,
      actualizado: nowIso(),
      reinicioValuaciones: true,
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
  const elapsed =
    Date.now() - lastRequestAt;

  if (
    lastRequestAt &&
    elapsed < REQUEST_INTERVAL_MS
  ) {
    await sleep(
      REQUEST_INTERVAL_MS - elapsed
    );
  }

  let attempt = 0;

  while (true) {
    attempt++;

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        15000
      );

    try {
      const response =
        await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "MAUDAM-ArgAutos-Updater/3.0"
          },
          signal: controller.signal
        });

      clearTimeout(timeout);

      lastRequestAt =
        Date.now();

      if (response.status === 429) {
        const header =
          response.headers.get(
            "retry-after"
          );

        const wait =
          Number(header);

        const waitMs =
          Number.isFinite(wait)
            ? Math.max(
                1000,
                wait * 1000
              )
            : 60000;

        console.log(
          `429. Esperando ${Math.ceil(
            waitMs / 1000
          )}s.`
        );

        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const body =
          await response.text()
            .catch(() => "");

        if (
          response.status >= 500 &&
          attempt < 5
        ) {
          const waitMs =
            Math.min(
              120000,
              5000 *
                2 ** (attempt - 1)
            );

          await sleep(waitMs);
          continue;
        }

        throw new Error(
          `HTTP ${response.status}: ${
            body.slice(0, 300)
          }`
        );
      }

      return await response.json();

    } catch (error) {
      clearTimeout(timeout);

      if (attempt >= 5) {
        throw error;
      }

      const waitMs =
        Math.min(
          120000,
          5000 *
            2 ** (attempt - 1)
        );

      console.log(
        `Error: ${error.message}. ` +
        `Reintentando...`
      );

      await sleep(waitMs);
    }
  }
}

function normalizePrice(value) {
  const n = Number(value);

  return Number.isFinite(n) && n >= 0
    ? n
    : null;
}

function parseValuations(json) {
  if (
    !json ||
    !Array.isArray(json.data)
  ) {
    throw new Error(
      "Respuesta inválida: falta data[]"
    );
  }

  const currency =
    String(
      json.meta?.currency || ""
    ).toUpperCase();

  const rate =
    normalizePrice(
      json.meta?.exchange_rate
        ?.ars_per_usd
    );

  const precios = {};

  for (const item of json.data) {
    const year =
      Number(item.year);

    if (!Number.isInteger(year)) {
      continue;
    }

    if (
      year !== 0 &&
      (
        year < MIN_YEAR ||
        year > MAX_YEAR
      )
    ) {
      continue;
    }

    const price =
      normalizePrice(
        item.price
      );

    if (price === null) {
      continue;
    }

    if (currency === "ARS") {
      const record = {
        ars: price
      };

      if (rate && rate > 0) {
        record.usd =
          Number(
            (price / rate)
              .toFixed(2)
          );

        record.cotizacion =
          rate;
      }

      precios[
        String(year)
      ] = record;

    } else if (
      currency === "USD"
    ) {
      const record = {
        usd: price
      };

      if (rate && rate > 0) {
        record.ars =
          Number(
            (price * rate)
              .toFixed(2)
          );

        record.cotizacion =
          rate;
      }

      precios[
        String(year)
      ] = record;
    }
  }

  return precios;
}

function saveCheckpoint(
  state,
  data
) {
  const timestamp =
    nowIso();

  data.actualizado =
    timestamp;

  data.minYear =
    MIN_YEAR;

  data.maxYear =
    MAX_YEAR;

  data.versionesProcesadas =
    state.versionesProcesadas;

  data.versionesConValuacion =
    state.versionesConValuacion;

  data.completo =
    state.completo;

  state.actualizado =
    timestamp;

  writeJsonAtomic(
    DATA,
    data
  );

  writeJsonAtomic(
    STATE,
    state
  );
}

function publicarWeb() {
  execFileSync(
    process.execPath,
    [
      path.join(
        __dirname,
        "publicar-datos-web.js"
      )
    ],
    {
      cwd: ROOT,
      stdio: "inherit"
    }
  );
}

async function main() {
  console.log(
    "=== ACTUALIZACIÓN ARG AUTOS ==="
  );

  console.log(
    `Ventana: 0 km + ${MIN_YEAR}-${MAX_YEAR}`
  );

  const catalog =
    loadCatalog();

  const versiones =
    catalog.versiones;

  const data =
    loadData(catalog);

  const state =
    loadState(catalog);

  const deadline =
    Date.now() +
    JOB_SECONDS * 1000;

  let desdeCheckpoint = 0;

  console.log(
    `Progreso: ${
      state.siguienteIndice
    }/${versiones.length}`
  );

  while (
    state.siguienteIndice <
    versiones.length
  ) {
    if (
      Date.now() >=
      deadline - 120000
    ) {
      console.log(
        "Fin seguro del lote."
      );
      break;
    }

    const version =
      versiones[
        state.siguienteIndice
      ];

    console.log(
      `VERSIÓN ${
        state.siguienteIndice + 1
      }/${versiones.length}: ` +
      `${version.marca} ` +
      `${version.modelo} ` +
      `${version.version}`
    );

    const url =
      `${API}/versions/` +
      `${encodeURIComponent(version.id)}` +
      `/valuations?currency=ars`;

    const response =
      await apiGet(url);

    const precios =
      parseValuations(
        response
      );

    data.vehiculos[
      String(version.id)
    ] = {
      id: String(version.id),
      marcaId:
        String(version.marcaId),
      modeloId:
        String(version.modeloId),
      marca: version.marca,
      modelo: version.modelo,
      version: version.version,
      precios
    };

    if (
      Object.keys(precios).length
    ) {
      state.versionesConValuacion++;
    }

    state.siguienteIndice++;
    state.versionesProcesadas++;
    desdeCheckpoint++;

    if (
      desdeCheckpoint >=
      CHECKPOINT_EVERY
    ) {
      saveCheckpoint(
        state,
        data
      );

      desdeCheckpoint = 0;

      console.log(
        `Checkpoint: ${
          state.siguienteIndice
        }/${versiones.length}`
      );
    }
  }

  saveCheckpoint(
    state,
    data
  );

  // Generamos los 20 archivos públicos
  // en cada lote exitoso.
  publicarWeb();

  if (
    state.siguienteIndice >=
    versiones.length
  ) {
    state.completo = true;
    data.completo = true;

    saveCheckpoint(
      state,
      data
    );

    publicarWeb();

    console.log(
      "=== COMPLETO ==="
    );
  } else {
    console.log(
      `=== LOTE TERMINADO: ${
        state.siguienteIndice
      }/${versiones.length} ===`
    );
  }
}

main().catch(error => {
  console.error(
    "FATAL:",
    error
  );

  process.exit(1);
});

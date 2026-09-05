// MAUDAM - catálogo local de vehículos.
// Los datos públicos se cargan por bloques de marca para no descargar
// los 6.139 vehículos completos al entrar a la página.

const GASTOS_POR_PROVINCIA = {
  cordoba: 500000,
  santiago: 600000
};

const COEF = {
  12: 85.8,
  24: 42.9,
  36: 28.6,
  48: 21.45,
  60: 17.16
};

const COEF_UVA = {
  24: 55.06065,
  36: 41.35006,
  48: 34.64069,
  60: 30.72835
};

const TEL = "541234567890";

const marcaSelect = document.getElementById("marca");
const modeloSelect = document.getElementById("modelo");
const versionSelect = document.getElementById("version");
const anioVehiculo = document.getElementById("anioVehiculo");
const valorVehiculo = document.getElementById("precioEstimado");
const montoFinanciar = document.getElementById("montoFinanciar");
const mostrarMonto = document.getElementById("mostrarMonto");
const mostrarNeto = document.getElementById("mostrarNeto");
const mostrarGastos = document.getElementById("mostrarGastos");
const btnWhatsApp = document.getElementById("btnWhatsApp");
const cuotasDiv = document.getElementById("cuotas");
const infoVehiculo = document.getElementById("infoVehiculo");
const vehiculoNombre = document.getElementById("vehiculoNombre");
const estadoDatos = document.getElementById("estadoDatos");

let indice = null;
let datosMarca = null;
let precioActual = 0;
let vehiculoActual = null;

const anioActual = new Date().getFullYear();
const MIN_YEAR = anioActual - 13;

async function fetchJson(url) {
  const r = await fetch(`${url}?v=${Date.now()}`, {
    cache: "no-store"
  });

  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${url}`);
  }

  return r.json();
}

async function cargarDatosAutos() {
  try {
    estadoDatos.textContent = "Cargando catálogo de vehículos...";

    // Nuevo formato: índice pequeño.
    try {
      indice = await fetchJson("./data/indice.json");
    } catch {
      // Compatibilidad temporal con autos-data.json.
      const legacy = await fetchJson("./autos-data.json");
      indice = {
        version: 1,
        actualizado: legacy.actualizado,
        minYear: legacy.minYear,
        maxYear: legacy.maxYear,
        marcas: [...new Set(
          Object.values(legacy.vehiculos || {}).map(v => v.marca)
        )].sort(),
        vehiculos: legacy.vehiculos || {},
        legacy: true
      };
    }

    cargarMarcas();

    const cantidadMarcas = indice.marcas?.length || 0;
    const cantidadModelos = indice.modelos?.length ||
      (indice.legacy ? contarModelosLegacy() : 0);
    const cantidadVersiones = indice.versiones ||
      Object.keys(indice.vehiculos || {}).length ||
      6139;

    estadoDatos.classList.add("ok");
    estadoDatos.textContent =
      `Datos disponibles: ${cantidadMarcas} marcas, ` +
      `${cantidadModelos} modelos y ${cantidadVersiones} versiones.`;

  } catch (e) {
    console.error("Error cargando datos:", e);
    estadoDatos.classList.add("error");
    estadoDatos.textContent =
      "No se pudieron cargar los datos de vehículos.";
  }
}

function contarModelosLegacy() {
  return new Set(
    Object.values(indice.vehiculos || {})
      .map(v => `${v.marca}|||${v.modelo}`)
  ).size;
}

function limpiarSelect(select, texto) {
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = texto;
  select.appendChild(option);
}

function cargarMarcas() {
  limpiarSelect(
    marcaSelect,
    "Selecciona una marca..."
  );

  const marcas = indice.marcas || [];

  const nombres = marcas.map(m =>
    typeof m === "string" ? m : m.nombre
  );

  [...new Set(nombres)]
    .sort((a, b) => a.localeCompare(b, "es"))
    .forEach(nombre => {
      const o = document.createElement("option");
      o.value = nombre;
      o.textContent = nombre;
      marcaSelect.appendChild(o);
    });

  modeloSelect.disabled = true;
  versionSelect.disabled = true;
  anioVehiculo.disabled = true;
}

async function cargarMarca(marca) {
  if (!marca) return;

  if (indice.legacy) {
    datosMarca = {
      vehiculos: Object.values(indice.vehiculos)
        .filter(v => v.marca === marca)
    };
    return;
  }

  const info = (indice.marcas || [])
    .find(m => m.nombre === marca);

  if (!info) {
    throw new Error(`Marca no encontrada: ${marca}`);
  }

  datosMarca = await fetchJson(
    `./data/marcas/${info.archivo}`
  );
}

async function cargarModelos() {
  const marca = marcaSelect.value;

  limpiarSelect(
    modeloSelect,
    "Selecciona un modelo..."
  );

  limpiarSelect(
    versionSelect,
    "Selecciona una versión..."
  );

  limpiarSelect(
    anioVehiculo,
    "Selecciona un año..."
  );

  versionSelect.disabled = true;
  anioVehiculo.disabled = true;
  limpiarVehiculo();

  if (!marca) {
    modeloSelect.disabled = true;
    return;
  }

  try {
    estadoDatos.textContent =
      `Cargando modelos de ${marca}...`;

    await cargarMarca(marca);

    // IMPORTANTE:
    // El archivo puede contener varias marcas.
    // Solo usamos los vehículos de la marca seleccionada.
    const vehiculosMarca =
      (datosMarca.vehiculos || [])
        .filter(v =>
          String(v.marca).trim() ===
          String(marca).trim()
        );

    const modelos = [
      ...new Set(
        vehiculosMarca
          .map(v => v.modelo)
          .filter(Boolean)
      )
    ].sort((a, b) =>
      a.localeCompare(b, "es")
    );

    modelos.forEach(modelo => {
      const o =
        document.createElement("option");

      o.value = modelo;
      o.textContent = modelo;

      modeloSelect.appendChild(o);
    });

    modeloSelect.disabled =
      modelos.length === 0;

    estadoDatos.textContent =
      `Datos disponibles: ` +
      `${indice.marcas?.length || 0} marcas, ` +
      `${indice.modelos?.length || 0} modelos y ` +
      `${indice.versiones || 0} versiones.`;

  } catch (e) {
    console.error(
      "Error cargando modelos:",
      e
    );

    modeloSelect.disabled = true;

    estadoDatos.textContent =
      "No se pudieron cargar los modelos de la marca.";
  }
}

function cargarVersiones() {
  const marca = marcaSelect.value;
  const modelo = modeloSelect.value;

  limpiarSelect(
    versionSelect,
    "Selecciona una versión..."
  );

  limpiarSelect(
    anioVehiculo,
    "Selecciona un año..."
  );

  anioVehiculo.disabled = true;
  limpiarVehiculo();

  if (!marca || !modelo || !datosMarca) {
    versionSelect.disabled = true;
    return;
  }

  const versiones = (datosMarca.vehiculos || [])
    .filter(v =>
      v.marca === marca &&
      v.modelo === modelo
    )
    .sort((a, b) =>
      a.version.localeCompare(
        b.version,
        "es"
      )
    );

  versiones.forEach(v => {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.version;
    versionSelect.appendChild(o);
  });

  versionSelect.disabled =
    versiones.length === 0;
}

function cargarAnios() {
  const id = versionSelect.value;

  limpiarSelect(
    anioVehiculo,
    "Selecciona un año..."
  );

  limpiarVehiculo();

  if (!id || !datosMarca) {
    anioVehiculo.disabled = true;
    return;
  }

  const v = (datosMarca.vehiculos || [])
    .find(x => String(x.id) === String(id));

  if (!v) {
    anioVehiculo.disabled = true;
    return;
  }

  const anios = Object.keys(v.precios || {})
    .map(Number)
    .filter(y =>
      y === 0 ||
      (y >= MIN_YEAR && y <= anioActual)
    )
    .sort((a, b) => {
      if (a === 0) return -1;
      if (b === 0) return 1;
      return b - a;
    });

  anios.forEach(y => {
    const o = document.createElement("option");
    o.value = y;
    o.textContent = y === 0
      ? "0 km"
      : String(y);
    anioVehiculo.appendChild(o);
  });

  anioVehiculo.disabled =
    anios.length === 0;
}

function obtenerPrecio() {
  const id = versionSelect.value;
  const anio = anioVehiculo.value;

  limpiarVehiculo();

  if (!id || !anio || !datosMarca) {
    return;
  }

  const v = (datosMarca.vehiculos || [])
    .find(x => String(x.id) === String(id));

  const p =
    v?.precios?.[String(anio)];

  if (
    !p ||
    !Number.isFinite(Number(p.ars))
  ) {
    return;
  }

  precioActual =
    Number(p.ars);

  vehiculoActual = v;

  valorVehiculo.innerHTML =
    `$${precioActual.toLocaleString("es-AR")} ` +
    `<small>ARS</small>`;

  vehiculoNombre.textContent =
    `${v.marca} ${v.modelo} ${v.version} ` +
    `(${anio === "0" ? "0 km" : anio})`;

  const usd = Number(p.usd);
  const cotizacion =
    Number(p.cotizacion);

  const usdTexto =
    Number.isFinite(usd)
      ? `USD ${usd.toLocaleString("en-US")}`
      : "";

  const cotizacionTexto =
    Number.isFinite(cotizacion)
      ? ` × cotización $${cotizacion.toLocaleString("es-AR")}`
      : "";

  const actualizado =
    p.actualizado
      ? ` Actualizado: ${
          new Date(p.actualizado)
            .toLocaleDateString("es-AR")
        }.`
      : "";

  document.getElementById(
    "precioFuente"
  ).textContent =
    `${usdTexto}${cotizacionTexto} = ` +
    `$${precioActual.toLocaleString("es-AR")} ARS.` +
    actualizado;

  infoVehiculo.style.display =
    "block";

  calcularPrestamo();
}

function limpiarVehiculo() {
  precioActual = 0;
  vehiculoActual = null;

  infoVehiculo.style.display =
    "none";

  document.getElementById(
    "montoMaximoTradicional"
  ).textContent = "$0";

  document.getElementById(
    "montoMaximoUVA"
  ).textContent = "$0";

  document.getElementById(
    "textoPorcentajeTradicional"
  ).textContent = "";

  document.getElementById(
    "textoPorcentajeUVA"
  ).textContent = "";
}

function calcularPrestamo() {
  if (!precioActual) return;

  const y =
    Number(anioVehiculo.value);

  let pct = 0;
  let txt = "";

  // Se mantiene la lógica financiera existente.
  if (y === 0 || y >= 2025) {
    pct = 80;
    txt = "80% (0 a 1 año)";
  } else if (y >= 2021) {
    pct = 70;
    txt = "70% (2 a 5 años)";
  } else if (y >= 2016) {
    pct = 60;
    txt = "60% (6 a 10 años)";
  } else if (y >= MIN_YEAR) {
    pct = 50;
    txt = "50% (11 a 13 años)";
  }

  const max =
    Math.floor(
      precioActual * pct / 100 / 1000
    ) * 1000;

  document.getElementById(
    "montoMaximoTradicional"
  ).textContent =
    "$" +
    max.toLocaleString("es-AR");

  document.getElementById(
    "textoPorcentajeTradicional"
  ).textContent = txt;

  let up = 0;
  let ut = "";

  if (y === 0 || y >= 2023) {
    up = 60;
    ut = "60% (0 a 3 años)";
  } else if (y >= 2021) {
    up = 50;
    ut = "50% (4 a 5 años)";
  } else {
    ut = "No disponible para este año";
  }

  const umax = up
    ? Math.floor(
        precioActual * up / 100 / 1000
      ) * 1000
    : 0;

  const mue =
    document.getElementById(
      "montoMaximoUVA"
    );

  const ude =
    document.getElementById(
      "textoPorcentajeUVA"
    );

  if (!umax) {
    mue.innerHTML =
      "No disponible para este año.";

    mue.classList.add(
      "uva-no-disponible"
    );

    ude.textContent = "";
  } else {
    mue.textContent =
      "$" +
      umax.toLocaleString("es-AR");

    mue.classList.remove(
      "uva-no-disponible"
    );

    ude.textContent = ut;
  }

  montoFinanciar.value = max;

  calcularTodo();
  actualizarUVA(y);
}

function calcularTodo() {
  const monto =
    Number(montoFinanciar.value) || 0;

  const prov =
    document.getElementById(
      "provincia"
    );

  const g =
    GASTOS_POR_PROVINCIA[
      prov.value
    ] || 0;

  const neto =
    monto - g;

  mostrarMonto.textContent =
    "$" +
    monto.toLocaleString("es-AR");

  mostrarNeto.textContent =
    neto > 0
      ? "$" + neto.toLocaleString("es-AR")
      : "Monto insuficiente";

  mostrarGastos.textContent =
    "$" +
    g.toLocaleString("es-AR");

  cuotasDiv.innerHTML = "";

  window.textoWA =
    `*Simulación Crédito Prendario*%0A%0A` +
    `Provincia: ${
      prov.options[
        prov.selectedIndex
      ].text
    }%0A%0A` +
    `Monto solicitado: $${monto.toLocaleString("es-AR")}%0A` +
    `Gastos MAUDAM: $${g.toLocaleString("es-AR")}%0A` +
    `Neto a percibir: $${neto.toLocaleString("es-AR")}%0A%0A` +
    `*Cuotas tradicionales:*%0A`;

  if (
    vehiculoActual &&
    anioVehiculo.value
  ) {
    const p =
      vehiculoActual.precios[
        anioVehiculo.value
      ];

    window.textoWA =
      `*Vehículo:* ${
        vehiculoActual.marca
      } ${
        vehiculoActual.modelo
      } ${
        vehiculoActual.version
      }%0A` +
      `*Año:* ${
        anioVehiculo.value === "0"
          ? "0 km"
          : anioVehiculo.value
      }%0A` +
      `*Valuación USD:* ${
        Number(p.usd)
          .toLocaleString("en-US")
      }%0A` +
      `*Cotización:* $${
        Number(p.cotizacion)
          .toLocaleString("es-AR")
      }%0A` +
      `*Valuación ARS:* $${
        Number(p.ars)
          .toLocaleString("es-AR")
      }%0A%0A` +
      window.textoWA;
  }

  for (const m in COEF) {
    const c =
      Math.round(
        monto * COEF[m] / 1000
      );

    const t =
      c * Number(m);

    cuotasDiv.innerHTML +=
      `<div class="card card-cuota">` +
      `<div class="meses">${m} meses</div>` +
      `<div class="cuota">$${c.toLocaleString("es-AR")}</div>` +
      `<div class="total">Total: $${t.toLocaleString("es-AR")}</div>` +
      `<div class="coef">Coeficiente: ${COEF[m]}</div>` +
      `</div>`;

    window.textoWA +=
      `${m} meses → $${c.toLocaleString("es-AR")} ` +
      `| Total: $${t.toLocaleString("es-AR")}%0A`;
  }

  calcularUVA();
}

function calcularUVA() {
  const m =
    Number(montoFinanciar.value) || 0;

  for (const p in COEF_UVA) {
    const e =
      document.getElementById(
        "uva" + p
      );

    if (e) {
      e.textContent =
        "$" +
        Math.round(
          (m / 1000) *
          COEF_UVA[p]
        ).toLocaleString("es-AR");
    }
  }
}

function actualizarUVA(y) {
  const msg =
    document.getElementById(
      "uvaMensaje"
    );

  const cards =
    document.querySelectorAll(
      ".uva-card"
    );

  const sel =
    document.getElementById(
      "selectorPrestamo"
    );

  if (y === 0 || y >= 2021) {
    cards.forEach(c =>
      c.classList.remove(
        "inactiva"
      )
    );

    msg.style.display = "none";
    sel.style.display = "block";
  } else {
    cards.forEach(c =>
      c.classList.add(
        "inactiva"
      )
    );

    msg.style.display = "block";
    sel.style.display = "none";
  }
}

function enviarWhatsApp(n) {
  if (!window.textoWA) return;

  const t =
    document.querySelector(
      'input[name="tipoPrestamo"]:checked'
    )?.value ||
    "Tradicional";

  window.open(
    `https://wa.me/${n}?text=${
      window.textoWA.replace(
        /(\*Cuotas tradicionales:\*)/,
        `*Tipo de préstamo:* ${t}%0A%0A$1`
      )
    }`
  );
}

marcaSelect.addEventListener(
  "change",
  cargarModelos
);

modeloSelect.addEventListener(
  "change",
  cargarVersiones
);

versionSelect.addEventListener(
  "change",
  cargarAnios
);

anioVehiculo.addEventListener(
  "change",
  obtenerPrecio
);

montoFinanciar.addEventListener(
  "input",
  calcularTodo
);

document.getElementById(
  "provincia"
).addEventListener(
  "change",
  calcularTodo
);

btnWhatsApp.addEventListener(
  "click",
  () => enviarWhatsApp(TEL)
);

window.addEventListener(
  "load",
  () => {
    cargarDatosAutos();
    calcularTodo();
  }
);

// ============================================================
// MAUDAM - DATOS DE VEHICULOS SIN SERVIDOR
// Los datos se cargan desde autos-data.json.
// GitHub Pages solamente sirve archivos estáticos.
// ============================================================

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

let datosAutos = null;
let precioActual = 0;
let vehiculoActual = null;

// ------------------------------------------------------------
// CARGAR JSON UNA SOLA VEZ
// ------------------------------------------------------------
async function cargarDatosAutos() {
    try {
        estadoDatos.textContent = "Cargando catálogo de vehículos...";

        const respuesta = await fetch("./autos-data.json", {
            cache: "no-cache"
        });

        if (!respuesta.ok) {
            throw new Error(`HTTP ${respuesta.status}`);
        }

        datosAutos = await respuesta.json();

        if (!datosAutos.marcas || !datosAutos.vehiculos) {
            throw new Error("Formato de autos-data.json inválido");
        }

        cargarMarcas();

        const totalMarcas = datosAutos.marcas.length;
        const totalModelos = contarModelos();
        const totalVersiones = Object.keys(datosAutos.vehiculos).length;

        estadoDatos.classList.add("ok");
        estadoDatos.textContent =
            `Datos disponibles: ${totalMarcas} marcas, ${totalModelos} modelos y ${totalVersiones} versiones.`;

    } catch (error) {
        console.error("Error cargando autos-data.json:", error);
        estadoDatos.classList.add("error");
        estadoDatos.textContent =
            "No se pudieron cargar los datos de vehículos. Verificá que autos-data.json esté publicado en GitHub Pages.";
    }
}

// ------------------------------------------------------------
// ESTRUCTURA ESPERADA:
//
// {
//   "version": 1,
//   "actualizado": "...",
//   "marcas": ["Toyota", ...],
//   "vehiculos": {
//      "versionId": {
//          "marca": "Toyota",
//          "modelo": "Corolla",
//          "version": "2.0 XEI",
//          "precios": {
//              "2026": 123456,
//              "2025": 110000
//          }
//      }
//   }
// }
// ------------------------------------------------------------

function contarModelos() {
    const conjunto = new Set();

    Object.values(datosAutos.vehiculos).forEach(v => {
        conjunto.add(`${v.marca}|||${v.modelo}`);
    });

    return conjunto.size;
}

function limpiarSelect(select, texto) {
    select.innerHTML = `<option value="">${texto}</option>`;
}

function cargarMarcas() {
    limpiarSelect(marcaSelect, "Selecciona una marca...");

    datosAutos.marcas
        .slice()
        .sort((a, b) => a.localeCompare(b, "es"))
        .forEach(marca => {
            const option = document.createElement("option");
            option.value = marca;
            option.textContent = marca;
            marcaSelect.appendChild(option);
        });

    modeloSelect.disabled = true;
    versionSelect.disabled = true;
    anioVehiculo.disabled = true;
}

function cargarModelos() {
    const marca = marcaSelect.value;

    limpiarSelect(modeloSelect, "Selecciona un modelo...");
    limpiarSelect(versionSelect, "Selecciona una versión...");
    limpiarSelect(anioVehiculo, "Selecciona un año...");

    versionSelect.disabled = true;
    anioVehiculo.disabled = true;
    limpiarVehiculo();

    if (!marca) {
        modeloSelect.disabled = true;
        return;
    }

    const modelos = new Set();

    Object.values(datosAutos.vehiculos).forEach(v => {
        if (v.marca === marca) {
            modelos.add(v.modelo);
        }
    });

    [...modelos]
        .sort((a, b) => a.localeCompare(b, "es"))
        .forEach(modelo => {
            const option = document.createElement("option");
            option.value = modelo;
            option.textContent = modelo;
            modeloSelect.appendChild(option);
        });

    modeloSelect.disabled = modelos.size === 0;
}

function cargarVersiones() {
    const marca = marcaSelect.value;
    const modelo = modeloSelect.value;

    limpiarSelect(versionSelect, "Selecciona una versión...");
    limpiarSelect(anioVehiculo, "Selecciona un año...");
    anioVehiculo.disabled = true;
    limpiarVehiculo();

    if (!marca || !modelo) {
        versionSelect.disabled = true;
        return;
    }

    const versiones = Object.entries(datosAutos.vehiculos)
        .filter(([id, v]) => v.marca === marca && v.modelo === modelo)
        .map(([id, v]) => ({
            id,
            nombre: v.version
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    versiones.forEach(v => {
        const option = document.createElement("option");
        option.value = v.id;
        option.textContent = v.nombre;
        versionSelect.appendChild(option);
    });

    versionSelect.disabled = versiones.length === 0;
}

function cargarAnios() {
    const versionId = versionSelect.value;

    limpiarSelect(anioVehiculo, "Selecciona un año...");
    limpiarVehiculo();

    if (!versionId || !datosAutos.vehiculos[versionId]) {
        anioVehiculo.disabled = true;
        return;
    }

    const vehiculo = datosAutos.vehiculos[versionId];

    // Solo años >= 2013 y que realmente existan para ESTA versión.
    const anios = Object.keys(vehiculo.precios)
        .map(Number)
        .filter(anio => anio >= 2013)
        .sort((a, b) => b - a);

    anios.forEach(anio => {
        const option = document.createElement("option");
        option.value = String(anio);
        option.textContent = String(anio);
        anioVehiculo.appendChild(option);
    });

    anioVehiculo.disabled = anios.length === 0;
}

function obtenerPrecio() {
    const versionId = versionSelect.value;
    const anio = anioVehiculo.value;

    limpiarVehiculo();

    if (!versionId || !anio || !datosAutos.vehiculos[versionId]) {
        return;
    }

    const vehiculo = datosAutos.vehiculos[versionId];
    const precio = Number(vehiculo.precios[anio]);

    if (!Number.isFinite(precio) || precio <= 0) {
        return;
    }

    precioActual = precio;
    vehiculoActual = vehiculo;

    valorVehiculo.textContent = "$" + precio.toLocaleString("es-AR");

    vehiculoNombre.textContent =
        `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.version} (${anio})`;

    document.getElementById("precioFuente").textContent =
        `Valuación en pesos argentinos. Datos de Arg Autos.`;

    infoVehiculo.style.display = "block";

    calcularPrestamo();
}

function limpiarVehiculo() {
    precioActual = 0;
    vehiculoActual = null;
    infoVehiculo.style.display = "none";

    document.getElementById("montoMaximoTradicional").textContent = "$0";
    document.getElementById("montoMaximoUVA").textContent = "$0";
    document.getElementById("textoPorcentajeTradicional").textContent = "";
    document.getElementById("textoPorcentajeUVA").textContent = "";
}

// ------------------------------------------------------------
// CALCULADORA
// ------------------------------------------------------------

function calcularPrestamo() {
    if (precioActual === 0) return;

    const valor = precioActual;
    const anio = Number(anioVehiculo.value);

    let porc = 0;
    let txtT = "";

    if (anio >= 2025) {
        porc = 80;
        txtT = "80% (0 a 1 año)";
    } else if (anio >= 2021) {
        porc = 70;
        txtT = "70% (2 a 5 años)";
    } else if (anio >= 2016) {
        porc = 60;
        txtT = "60% (6 a 10 años)";
    } else if (anio >= 2013) {
        porc = 50;
        txtT = "50% (11 a 13 años)";
    } else {
        txtT = "No financiable";
    }

    const maxTrad = Math.floor(valor * porc / 100 / 1000) * 1000;

    document.getElementById("montoMaximoTradicional").textContent =
        "$" + maxTrad.toLocaleString("es-AR");

    document.getElementById("textoPorcentajeTradicional").textContent = txtT;

    let porcU = 0;
    let txtU = "";

    if (anio >= 2023) {
        porcU = 60;
        txtU = "60% (0 a 3 años)";
    } else if (anio >= 2021) {
        porcU = 50;
        txtU = "50% (4 a 5 años)";
    } else {
        txtU = "No disponible para este año";
    }

    const maxUVA = porcU
        ? Math.floor(valor * porcU / 100 / 1000) * 1000
        : 0;

    const montoUVAEl = document.getElementById("montoMaximoUVA");
    const detalleUVAEl = document.getElementById("textoPorcentajeUVA");

    if (maxUVA === 0) {
        montoUVAEl.innerHTML =
            `No disponible para este año.<br>
             Contamos con <strong>3 alternativas adicionales en Línea UVA</strong>.<br>
             Consultá a nuestro WhatsApp para conocer las opciones disponibles.`;

        montoUVAEl.classList.add("uva-no-disponible");
        detalleUVAEl.textContent = "";
    } else {
        montoUVAEl.textContent = "$" + maxUVA.toLocaleString("es-AR");
        montoUVAEl.classList.remove("uva-no-disponible");
        detalleUVAEl.textContent = txtU;
    }

    montoFinanciar.value = maxTrad;
    calcularTodo();
    actualizarUVA(anio);
}

function calcularTodo() {
    const monto = Number(montoFinanciar.value) || 0;
    const provincia = document.getElementById("provincia").value;
    const provinciaSelect = document.getElementById("provincia");
    const provinciaTexto =
        provinciaSelect.options[provinciaSelect.selectedIndex].text;
    const gastos = GASTOS_POR_PROVINCIA[provincia] || 0;
    const neto = monto - gastos;

    mostrarMonto.textContent =
        "$" + monto.toLocaleString("es-AR");

    mostrarNeto.textContent =
        neto > 0
            ? "$" + neto.toLocaleString("es-AR")
            : "Monto insuficiente";

    mostrarGastos.textContent =
        "$" + gastos.toLocaleString("es-AR");

    cuotasDiv.innerHTML = "";

    window.textoWA =
        `*Simulación Crédito Prendario*%0A%0A` +
        `Provincia: ${provinciaTexto}%0A%0A` +
        `Monto solicitado: $${monto.toLocaleString("es-AR")}%0A` +
        `Gastos MAUDAM: $${gastos.toLocaleString("es-AR")}%0A` +
        `Neto a percibir (Agencia): $${neto.toLocaleString("es-AR")}%0A%0A` +
        `*Cuotas tradicionales:*%0A`;

    if (vehiculoActual && anioVehiculo.value) {
        window.textoWA =
            `*Vehículo:* ${vehiculoActual.marca} ${vehiculoActual.modelo} ${vehiculoActual.version}%0A` +
            `*Año:* ${anioVehiculo.value}%0A` +
            `*Valuación:* $${precioActual.toLocaleString("es-AR")}%0A%0A` +
            window.textoWA;
    }

    for (const m in COEF) {
        const cuota = Math.round(monto * COEF[m] / 1000);
        const total = cuota * Number(m);

        cuotasDiv.innerHTML += `
            <div class="card card-cuota">
                <div class="meses">${m} meses</div>
                <div class="cuota">$${cuota.toLocaleString("es-AR")}</div>
                <div class="total">Total: $${total.toLocaleString("es-AR")}</div>
                <div class="coef">Coeficiente: ${COEF[m]}</div>
            </div>
        `;

        window.textoWA +=
            `${m} meses → $${cuota.toLocaleString("es-AR")} | Total: $${total.toLocaleString("es-AR")}%0A`;
    }

    if (Number(anioVehiculo.value) >= 2021) {
        window.textoWA += `%0A*Cuotas UVA (estimadas):*%0A`;

        for (const plazo in COEF_UVA) {
            const cuotaUVA =
                Math.round((monto / 1000) * COEF_UVA[plazo]);

            window.textoWA +=
                `${plazo} meses → $${cuotaUVA.toLocaleString("es-AR")}%0A`;
        }
    }

    window.textoWA += `%0AQuiero más información sobre este crédito.`;

    calcularUVA();
}

function calcularUVA() {
    const monto = Number(montoFinanciar.value) || 0;

    if (monto <= 0) return;

    for (const plazo in COEF_UVA) {
        const cuota = Math.round((monto / 1000) * COEF_UVA[plazo]);

        document.getElementById("uva" + plazo).textContent =
            "$" + cuota.toLocaleString("es-AR");
    }
}

function actualizarUVA(anio) {
    const msg = document.getElementById("uvaMensaje");
    const cards = document.querySelectorAll(".uva-card");
    const selector = document.getElementById("selectorPrestamo");

    if (anio >= 2021) {
        cards.forEach(card => card.classList.remove("inactiva"));
        msg.style.display = "none";
        selector.style.display = "block";
        calcularUVA();
    } else {
        cards.forEach(card => card.classList.add("inactiva"));
        msg.style.display = "block";
        selector.style.display = "none";

        for (const plazo in COEF_UVA) {
            const el = document.getElementById("uva" + plazo);
            if (el) el.textContent = "$0";
        }
    }
}

function enviarWhatsApp(numero) {
    if (!window.textoWA) return;

    const tipoPrestamo =
        document.querySelector('input[name="tipoPrestamo"]:checked')?.value ||
        "Tradicional";

    const textoFinal =
        window.textoWA.replace(
            /(\*Cuotas tradicionales:\*)/,
            `*Tipo de préstamo elegido:* ${tipoPrestamo}%0A%0A$1`
        );

    window.open(`https://wa.me/${numero}?text=${textoFinal}`);
}

function soloNumeros(input, max = 10) {
    input.value = input.value.replace(/\D/g, "").slice(0, max);
}

// ------------------------------------------------------------
// EVENTOS
// ------------------------------------------------------------

marcaSelect.addEventListener("change", cargarModelos);
modeloSelect.addEventListener("change", cargarVersiones);
versionSelect.addEventListener("change", cargarAnios);
anioVehiculo.addEventListener("change", obtenerPrecio);

montoFinanciar.addEventListener("input", () => {
    soloNumeros(montoFinanciar);
    calcularTodo();
});

document.getElementById("provincia").addEventListener("change", calcularTodo);

btnWhatsApp.addEventListener("click", () => enviarWhatsApp(TEL));

window.addEventListener("load", () => {
    cargarDatosAutos();
    calcularTodo();
});

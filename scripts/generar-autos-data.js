/*
 * ============================================================
 * GENERADOR DE autos-data.json PARA GITHUB ACTIONS
 * ============================================================
 *
 * No necesita ejecutarse en el navegador.
 *
 * Consulta:
 *   brands
 *   brands/{id}/models
 *   models/{id}/versions
 *   versions/{id}/valuations?currency=ars
 *
 * Guarda únicamente:
 *   - marcas
 *   - modelos
 *   - versiones
 *   - valuaciones desde 2013 inclusive
 *
 * IMPORTANTE:
 * Este script NO requiere API key para intentar la consulta.
 * Si Arg Autos exige una key o aplica un rate limit, el workflow
 * espera y reintenta. Para una actualización completa puede
 * tardar bastante, que es justamente lo que buscamos.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");

const API_BASE = "https://argautos.com/api/v1";
const OUTPUT = path.join(process.cwd(), "autos-data.json");

const MIN_YEAR = 2013;
const DELAY_MS = Number(process.env.DELAY_MS || 2500);
const MAX_RETRIES = 8;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestJSON(url, intento = 0) {
    console.log(`GET ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "MAUDAM-GitHub-Actions/1.0"
            }
        });

        const text = await response.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`Respuesta no JSON. HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        if (response.status === 429 || data.retry_after) {
            const retryAfter =
                Number(data.retry_after || response.headers.get("retry-after") || 10);

            const wait = Math.max(retryAfter * 1000, DELAY_MS);

            if (intento >= MAX_RETRIES) {
                throw new Error("Se alcanzó el máximo de reintentos por rate limit.");
            }

            console.log(`Rate limit. Esperando ${Math.ceil(wait / 1000)} segundos...`);
            await sleep(wait);
            return requestJSON(url, intento + 1);
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        }

        await sleep(DELAY_MS);
        return data;

    } catch (error) {
        if (intento >= MAX_RETRIES) throw error;

        const wait = Math.min(30000, 3000 * (intento + 1));
        console.log(`Error: ${error.message}`);
        console.log(`Reintentando en ${Math.ceil(wait / 1000)} segundos...`);

        await sleep(wait);
        return requestJSON(url, intento + 1);
    }
}

async function obtenerTodos(urlInicial) {
    const resultados = [];
    let url = urlInicial;

    while (url) {
        const respuesta = await requestJSON(url);

        if (Array.isArray(respuesta.data)) {
            resultados.push(...respuesta.data);
        }

        url = respuesta.links?.next || null;
    }

    return resultados;
}

function precioARSDeValuacion(v) {
    // La API documenta ?currency=ars, por lo que normalmente
    // buscamos primero campos de precio en ARS.
    const candidatos = [
        v.price_ars,
        v.priceARS,
        v.ars_price,
        v.price
    ];

    for (const valor of candidatos) {
        if (valor !== undefined && valor !== null && valor !== "") {
            const numero = Number(
                String(valor).replace(/[^\d.-]/g, "")
            );

            if (Number.isFinite(numero) && numero > 0) {
                return Math.round(numero);
            }
        }
    }

    return null;
}

async function main() {
    console.log("==============================================");
    console.log("GENERANDO autos-data.json");
    console.log("==============================================");

    const brandsResponse = await requestJSON(`${API_BASE}/brands`);

    if (!Array.isArray(brandsResponse.data) || brandsResponse.data.length === 0) {
        throw new Error("La API no devolvió marcas.");
    }

    const marcas = brandsResponse.data
        .map(b => b.name)
        .filter(Boolean);

    const vehiculos = {};

    console.log(`Marcas encontradas: ${marcas.length}`);

    let modelosTotal = 0;
    let versionesTotal = 0;

    for (const brand of brandsResponse.data) {
        console.log(`\nMARCA: ${brand.name}`);

        let modelos;

        try {
            modelos = await obtenerTodos(
                `${API_BASE}/brands/${brand.id}/models`
            );
        } catch (error) {
            console.error(`No se pudieron obtener modelos de ${brand.name}:`, error.message);
            continue;
        }

        modelosTotal += modelos.length;

        for (const modelo of modelos) {
            console.log(`  MODELO: ${modelo.name}`);

            let versiones;

            try {
                versiones = await obtenerTodos(
                    `${API_BASE}/models/${modelo.id}/versions`
                );
            } catch (error) {
                console.error(`  No se pudieron obtener versiones: ${error.message}`);
                continue;
            }

            versionesTotal += versiones.length;

            for (const version of versiones) {
                try {
                    const valuations = await obtenerTodos(
                        `${API_BASE}/versions/${version.id}/valuations?currency=ars`
                    );

                    const precios = {};

                    for (const valuation of valuations) {
                        const year = Number(valuation.year);

                        if (!Number.isInteger(year) || year < MIN_YEAR) {
                            continue;
                        }

                        const precio = precioARSDeValuacion(valuation);

                        if (precio !== null) {
                            precios[String(year)] = precio;
                        }
                    }

                    if (Object.keys(precios).length === 0) {
                        continue;
                    }

                    vehiculos[String(version.id)] = {
                        marca: brand.name,
                        modelo: modelo.name,
                        version: version.name,
                        precios
                    };

                } catch (error) {
                    console.error(
                        `    Error en versión ${version.name}: ${error.message}`
                    );
                }
            }
        }
    }

    const resultado = {
        version: 1,
        actualizado: new Date().toISOString(),
        fuente: "Arg Autos",
        minYear: MIN_YEAR,
        estadisticas: {
            marcas: marcas.length,
            modelos: modelosTotal,
            versionesConValuacion: Object.keys(vehiculos).length,
            versionesEncontradas: versionesTotal
        },
        marcas: [...new Set(marcas)].sort((a, b) => a.localeCompare(b, "es")),
        vehiculos
    };

    fs.writeFileSync(
        OUTPUT,
        JSON.stringify(resultado, null, 2),
        "utf8"
    );

    console.log("\n==============================================");
    console.log("ACTUALIZACIÓN TERMINADA");
    console.log(`Marcas: ${resultado.estadisticas.marcas}`);
    console.log(`Modelos: ${resultado.estadisticas.modelos}`);
    console.log(`Versiones encontradas: ${resultado.estadisticas.versionesEncontradas}`);
    console.log(`Versiones con valuación: ${resultado.estadisticas.versionesConValuacion}`);
    console.log(`Archivo: ${OUTPUT}`);
    console.log("==============================================");
}

main().catch(error => {
    console.error("\nERROR FATAL:");
    console.error(error);
    process.exit(1);
});

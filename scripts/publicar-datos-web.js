const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "autos-data.json");
const OUT = path.join(ROOT, "data");
const BRANDS_OUT = path.join(OUT, "marcas");

const SHARDS = 20;
const currentYear = new Date().getFullYear();
const minYear = currentYear - 13;
const maxYear = currentYear;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(value) + "\n",
    "utf8"
  );
}

const data = readJson(INPUT);

if (!data || !data.vehiculos) {
  throw new Error(
    "autos-data.json no contiene vehiculos."
  );
}

fs.mkdirSync(
  BRANDS_OUT,
  { recursive: true }
);

// Agrupar por marca.
const grupos = new Map();

for (const vehicle of Object.values(data.vehiculos)) {
  if (!grupos.has(vehicle.marca)) {
    grupos.set(vehicle.marca, []);
  }

  const limpio = {
    id: String(vehicle.id),
    marcaId: String(vehicle.marcaId),
    modeloId: String(vehicle.modeloId),
    marca: vehicle.marca,
    modelo: vehicle.modelo,
    version: vehicle.version,
    precios: {}
  };

  for (const [year, price] of Object.entries(
    vehicle.precios || {}
  )) {
    const y = Number(year);

    if (
      y === 0 ||
      (y >= minYear && y <= maxYear)
    ) {
      limpio.precios[String(y)] = price;
    }
  }

  grupos.get(vehicle.marca).push(limpio);
}

const marcas = [...grupos.keys()]
  .sort((a, b) =>
    a.localeCompare(b, "es")
  );

// Distribuir marcas en 20 archivos,
// manteniendo cada marca completa dentro de un shard.
const buckets = Array.from(
  { length: SHARDS },
  () => []
);

marcas.forEach((marca, index) => {
  buckets[
    Math.floor(
      index * SHARDS / marcas.length
    )
  ].push(marca);
});

const marcaIndex = [];

for (let i = 0; i < SHARDS; i++) {
  const nombres = buckets[i];

  const vehiculos = [];

  for (const marca of nombres) {
    vehiculos.push(
      ...grupos.get(marca)
    );
  }

  const archivo =
    `${String(i + 1).padStart(2, "0")}.json`;

  writeJson(
    path.join(
      BRANDS_OUT,
      archivo
    ),
    {
      version: 1,
      actualizado: new Date().toISOString(),
      minYear,
      maxYear,
      marcas: nombres,
      vehiculos
    }
  );

  for (const marca of nombres) {
    marcaIndex.push({
      nombre: marca,
      archivo
    });
  }
}

const modelos = new Set();

for (const vehicle of Object.values(data.vehiculos)) {
  modelos.add(
    `${vehicle.marca}|||${vehicle.modelo}`
  );
}

writeJson(
  path.join(OUT, "indice.json"),
  {
    version: 1,
    actualizado: new Date().toISOString(),
    minYear,
    maxYear,
    marcas: marcaIndex.sort(
      (a, b) =>
        a.nombre.localeCompare(
          b.nombre,
          "es"
        )
    ),
    modelos: [...modelos],
    versiones: Object.keys(
      data.vehiculos
    ).length
  }
);

console.log(
  `Publicados ${marcas.length} marcas ` +
  `en ${SHARDS} archivos.`
);

console.log(
  `Ventana: 0 km + ${minYear}-${maxYear}`
);

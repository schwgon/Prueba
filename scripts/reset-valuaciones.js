#!/usr/bin/env node

/**
 * SCRIPT DE RESET - Limpia valuaciones pero preserva catálogo
 * 
 * Propósito:
 * - Mantener catalogo-argautos.json intacto (69 marcas, 660 modelos, 6139 versiones)
 * - Limpiar autos-data.json (solo vehiculos.demo)
 * - Reset estado-actualizacion.json (índice = 0)
 * - Asegurar consistencia antes de ejecutar nuevo scraping
 * 
 * Uso:
 *   node reset-valuaciones.js
 */

const fs = require('fs');

function resetValuaciones() {
  console.log('🔄 RESET DE VALUACIONES - MAUDAM');
  console.log('=====================================\n');

  // Verificar que catalogo existe y está completo
  if (!fs.existsSync('catalogo-argautos.json')) {
    console.error('❌ Error: catalogo-argautos.json no encontrado');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync('catalogo-argautos.json', 'utf8'));
  console.log(`✓ Catálogo cargado:`);
  console.log(`  Marcas: ${catalog.marcas.length}`);
  console.log(`  Modelos: ${catalog.modelos.length}`);
  console.log(`  Versiones: ${catalog.versiones.length}\n`);

  if (
    catalog.marcas.length === 0 ||
    catalog.modelos.length === 0 ||
    catalog.versiones.length === 0
  ) {
    console.error('❌ Error: Catálogo incompleto');
    process.exit(1);
  }

  if (!catalog.completo) {
    console.error('❌ Error: Catálogo marcado como incompleto');
    process.exit(1);
  }

  // Crear nuevo autos-data.json limpio
  const autosData = {
    version: 3,
    actualizado: null,
    fuente: 'Arg Autos',
    minYear: '0',
    maxYear: new Date().getFullYear(),
    marcas: catalog.marcas
      .map((b) => b.nombre)
      .filter((n) => n)
      .sort((a, b) => a.localeCompare(b, 'es')),
    vehiculos: {
      // Mantener solo el demo
      demo: {
        marca: 'Toyota',
        modelo: 'Corolla',
        version: '2.0 XEI CVT',
        precios: {
          '0': {
            ars: null,
            usd: null,
            tipoCambio: null,
            actualizado: new Date().toISOString(),
          },
        },
      },
    },
    estadisticas: {
      marcas: catalog.marcas.length,
      modelos: catalog.modelos.length,
      versionesCatalogadas: catalog.versiones.length,
      versionesConValuacion: 0,
      versionesSinValuacion: 0,
      erroresSkipped: 0,
    },
  };

  // Crear nuevo estado-actualizacion.json
  const estado = {
    fase: 'valuaciones',
    siguienteIndice: 0,
    totalVersiones: catalog.versiones.length,
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

  // Guardar
  console.log('Guardando cambios...\n');

  fs.writeFileSync('autos-data.json', JSON.stringify(autosData, null, 2));
  console.log('✓ autos-data.json limpiado (solo demo)');

  fs.writeFileSync(
    'estado-actualizacion.json',
    JSON.stringify(estado, null, 2)
  );
  console.log('✓ estado-actualizacion.json reseteado (índice = 0)\n');

  // Resumen
  console.log('=====================================');
  console.log('✅ RESET COMPLETADO\n');
  console.log('Estado actual:');
  console.log(`  Catálogo: ${catalog.versiones.length} versiones ✓`);
  console.log(`  Valuaciones: 0 de ${catalog.versiones.length} (listas para scraping)`);
  console.log(`  Índice: 0 (comenzará desde la versión 0)`);
  console.log(`  Tiempo inicio: ${estado.tiempoInicio}\n`);
  console.log('Siguiente paso:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "Reset valuaciones para nuevo scraping"');
  console.log('  3. git push');
  console.log('  4. gh workflow run actualizar-autos.yml\n');
}

resetValuaciones();

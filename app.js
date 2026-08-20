// MAUDAM - catálogo local. El usuario nunca consulta Arg Autos directamente.
const GASTOS_POR_PROVINCIA={cordoba:500000,santiago:600000};
const COEF={12:85.8,24:42.9,36:28.6,48:21.45,60:17.16};
const COEF_UVA={24:55.06065,36:41.35006,48:34.64069,60:30.72835};
const TEL="541234567890";

const marcaSelect=document.getElementById("marca"),modeloSelect=document.getElementById("modelo"),
versionSelect=document.getElementById("version"),anioVehiculo=document.getElementById("anioVehiculo"),
valorVehiculo=document.getElementById("precioEstimado"),montoFinanciar=document.getElementById("montoFinanciar"),
mostrarMonto=document.getElementById("mostrarMonto"),mostrarNeto=document.getElementById("mostrarNeto"),
mostrarGastos=document.getElementById("mostrarGastos"),btnWhatsApp=document.getElementById("btnWhatsApp"),
cuotasDiv=document.getElementById("cuotas"),infoVehiculo=document.getElementById("infoVehiculo"),
vehiculoNombre=document.getElementById("vehiculoNombre"),estadoDatos=document.getElementById("estadoDatos");

let datosAutos=null,precioActual=0,vehiculoActual=null;

async function cargarDatosAutos(){
 try{
  estadoDatos.textContent="Cargando datos de vehículos...";
  const r=await fetch("./autos-data.json",{cache:"no-cache"});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  datosAutos=await r.json();
  if(!datosAutos.marcas||!datosAutos.vehiculos)throw Error("JSON inválido");
  cargarMarcas();
  estadoDatos.classList.add("ok");
  estadoDatos.textContent=`Datos disponibles: ${datosAutos.marcas.length} marcas, ${contarModelos()} modelos y ${Object.keys(datosAutos.vehiculos).length} versiones.`;
 }catch(e){console.error(e);estadoDatos.classList.add("error");estadoDatos.textContent="No se pudieron cargar los datos de vehículos.";}
}
function contarModelos(){return new Set(Object.values(datosAutos.vehiculos).map(v=>`${v.marca}|||${v.modelo}`)).size;}
function limpiarSelect(s,t){s.innerHTML=`<option value="">${t}</option>`;}
function cargarMarcas(){
 limpiarSelect(marcaSelect,"Selecciona una marca...");
 datosAutos.marcas.slice().sort((a,b)=>a.localeCompare(b,"es")).forEach(m=>{let o=document.createElement("option");o.value=m;o.textContent=m;marcaSelect.appendChild(o);});
 modeloSelect.disabled=versionSelect.disabled=anioVehiculo.disabled=true;
}
function cargarModelos(){
 const marca=marcaSelect.value;limpiarSelect(modeloSelect,"Selecciona un modelo...");limpiarSelect(versionSelect,"Selecciona una versión...");limpiarSelect(anioVehiculo,"Selecciona un año...");
 versionSelect.disabled=anioVehiculo.disabled=true;limpiarVehiculo();if(!marca){modeloSelect.disabled=true;return;}
 const modelos=new Set(Object.values(datosAutos.vehiculos).filter(v=>v.marca===marca).map(v=>v.modelo));
 [...modelos].sort((a,b)=>a.localeCompare(b,"es")).forEach(m=>{let o=document.createElement("option");o.value=m;o.textContent=m;modeloSelect.appendChild(o);});
 modeloSelect.disabled=modelos.size===0;
}
function cargarVersiones(){
 const marca=marcaSelect.value,modelo=modeloSelect.value;
 limpiarSelect(versionSelect,"Selecciona una versión...");limpiarSelect(anioVehiculo,"Selecciona un año...");anioVehiculo.disabled=true;limpiarVehiculo();
 if(!marca||!modelo){versionSelect.disabled=true;return;}
 const vs=Object.entries(datosAutos.vehiculos).filter(([id,v])=>v.marca===marca&&v.modelo===modelo).map(([id,v])=>({id,nombre:v.version})).sort((a,b)=>a.nombre.localeCompare(b.nombre,"es"));
 vs.forEach(v=>{let o=document.createElement("option");o.value=v.id;o.textContent=v.nombre;versionSelect.appendChild(o);});
 versionSelect.disabled=vs.length===0;
}
function cargarAnios(){
 const id=versionSelect.value;limpiarSelect(anioVehiculo,"Selecciona un año...");limpiarVehiculo();
 if(!id||!datosAutos.vehiculos[id]){anioVehiculo.disabled=true;return;}
 const anios=Object.keys(datosAutos.vehiculos[id].precios).map(Number).filter(y=>y>=2013).sort((a,b)=>b-a);
 anios.forEach(y=>{let o=document.createElement("option");o.value=y;o.textContent=y;anioVehiculo.appendChild(o);});
 anioVehiculo.disabled=anios.length===0;
}
function obtenerPrecio(){
 const id=versionSelect.value,anio=anioVehiculo.value;limpiarVehiculo();if(!id||!anio)return;
 const v=datosAutos.vehiculos[id],p=v?.precios?.[String(anio)];if(!p||!Number.isFinite(Number(p.ars)))return;
 precioActual=Number(p.ars);vehiculoActual=v;valorVehiculo.innerHTML=`$${precioActual.toLocaleString("es-AR")} <small>ARS</small>`;
 vehiculoNombre.textContent=`${v.marca} ${v.modelo} ${v.version} (${anio})`;
 const fecha=p.actualizado?new Date(p.actualizado).toLocaleDateString("es-AR"):"";
 document.getElementById("precioFuente").textContent=`USD ${Number(p.usd).toLocaleString("en-US")} × cotización $${Number(p.tipoCambio).toLocaleString("es-AR")} = $${precioActual.toLocaleString("es-AR")} ARS. Actualizado: ${fecha}.`;
 infoVehiculo.style.display="block";calcularPrestamo();
}
function limpiarVehiculo(){precioActual=0;vehiculoActual=null;infoVehiculo.style.display="none";document.getElementById("montoMaximoTradicional").textContent="$0";document.getElementById("montoMaximoUVA").textContent="$0";document.getElementById("textoPorcentajeTradicional").textContent="";document.getElementById("textoPorcentajeUVA").textContent="";}
function calcularPrestamo(){
 if(!precioActual)return;const y=Number(anioVehiculo.value);let pct=0,txt="";
 if(y>=2025){pct=80;txt="80% (0 a 1 año)"}else if(y>=2021){pct=70;txt="70% (2 a 5 años)"}else if(y>=2016){pct=60;txt="60% (6 a 10 años)"}else if(y>=2013){pct=50;txt="50% (11 a 13 años)"}
 const max=Math.floor(precioActual*pct/100/1000)*1000;document.getElementById("montoMaximoTradicional").textContent="$"+max.toLocaleString("es-AR");document.getElementById("textoPorcentajeTradicional").textContent=txt;
 let up=0,ut="";if(y>=2023){up=60;ut="60% (0 a 3 años)"}else if(y>=2021){up=50;ut="50% (4 a 5 años)"}else ut="No disponible para este año";
 const umax=up?Math.floor(precioActual*up/100/1000)*1000:0,mue=document.getElementById("montoMaximoUVA"),ude=document.getElementById("textoPorcentajeUVA");
 if(!umax){mue.innerHTML="No disponible para este año.";mue.classList.add("uva-no-disponible");ude.textContent=""}else{mue.textContent="$"+umax.toLocaleString("es-AR");mue.classList.remove("uva-no-disponible");ude.textContent=ut}
 montoFinanciar.value=max;calcularTodo();actualizarUVA(y);
}
function calcularTodo(){
 const monto=Number(montoFinanciar.value)||0,prov=document.getElementById("provincia"),g=GASTOS_POR_PROVINCIA[prov.value]||0,neto=monto-g;
 mostrarMonto.textContent="$"+monto.toLocaleString("es-AR");mostrarNeto.textContent=neto>0?"$"+neto.toLocaleString("es-AR"):"Monto insuficiente";mostrarGastos.textContent="$"+g.toLocaleString("es-AR");cuotasDiv.innerHTML="";
 window.textoWA=`*Simulación Crédito Prendario*%0A%0AProvincia: ${prov.options[prov.selectedIndex].text}%0A%0AMonto solicitado: $${monto.toLocaleString("es-AR")}%0AGastos MAUDAM: $${g.toLocaleString("es-AR")}%0ANeto a percibir: $${neto.toLocaleString("es-AR")}%0A%0A*Cuotas tradicionales:*%0A`;
 if(vehiculoActual&&anioVehiculo.value){const p=vehiculoActual.precios[anioVehiculo.value];window.textoWA=`*Vehículo:* ${vehiculoActual.marca} ${vehiculoActual.modelo} ${vehiculoActual.version}%0A*Año:* ${anioVehiculo.value}%0A*Valuación USD:* ${Number(p.usd).toLocaleString("en-US")}%0A*Cotización:* $${Number(p.tipoCambio).toLocaleString("es-AR")}%0A*Valuación ARS:* $${Number(p.ars).toLocaleString("es-AR")}%0A%0A`+window.textoWA;}
 for(const m in COEF){const c=Math.round(monto*COEF[m]/1000),t=c*Number(m);cuotasDiv.innerHTML+=`<div class="card card-cuota"><div class="meses">${m} meses</div><div class="cuota">$${c.toLocaleString("es-AR")}</div><div class="total">Total: $${t.toLocaleString("es-AR")}</div><div class="coef">Coeficiente: ${COEF[m]}</div></div>`;window.textoWA+=`${m} meses → $${c.toLocaleString("es-AR")} | Total: $${t.toLocaleString("es-AR")}%0A`;}
 calcularUVA();
}
function calcularUVA(){const m=Number(montoFinanciar.value)||0;for(const p in COEF_UVA){const e=document.getElementById("uva"+p);if(e)e.textContent="$"+Math.round((m/1000)*COEF_UVA[p]).toLocaleString("es-AR");}}
function actualizarUVA(y){const msg=document.getElementById("uvaMensaje"),cards=document.querySelectorAll(".uva-card"),sel=document.getElementById("selectorPrestamo");if(y>=2021){cards.forEach(c=>c.classList.remove("inactiva"));msg.style.display="none";sel.style.display="block"}else{cards.forEach(c=>c.classList.add("inactiva"));msg.style.display="block";sel.style.display="none";}}
function enviarWhatsApp(n){if(!window.textoWA)return;const t=document.querySelector('input[name="tipoPrestamo"]:checked')?.value||"Tradicional";window.open(`https://wa.me/${n}?text=${window.textoWA.replace(/(\*Cuotas tradicionales:\*)/,`*Tipo de préstamo:* ${t}%0A%0A$1`)}`);}
marcaSelect.addEventListener("change",cargarModelos);modeloSelect.addEventListener("change",cargarVersiones);versionSelect.addEventListener("change",cargarAnios);anioVehiculo.addEventListener("change",obtenerPrecio);montoFinanciar.addEventListener("input",calcularTodo);document.getElementById("provincia").addEventListener("change",calcularTodo);btnWhatsApp.addEventListener("click",()=>enviarWhatsApp(TEL));window.addEventListener("load",()=>{cargarDatosAutos();calcularTodo()});

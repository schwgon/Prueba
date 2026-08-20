const fs=require("fs");
const API="https://argautos.com/api/v1", MIN_YEAR=2013;
const BATCH_SIZE=Number(process.env.BATCH_SIZE||20), JOB_SECONDS=Number(process.env.JOB_SECONDS||540);
const CATALOG="catalogo-argautos.json", DATA="autos-data.json", STATE="estado-actualizacion.json";
const deadline=Date.now()+JOB_SECONDS*1000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const timeOk=(extra=10000)=>Date.now()+extra<deadline;
const read=(f,d)=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):d;
const write=(f,d)=>fs.writeFileSync(f,JSON.stringify(d,null,2));
async function req(url){
 if(!timeOk())throw Error("JOB_TIME_LIMIT");
 console.log("GET "+url);
 const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"MAUDAM-GitHub-Actions/2.0"}});
 const text=await r.text();let d;try{d=JSON.parse(text)}catch{throw Error("Respuesta no JSON HTTP "+r.status)}
 if(r.status===429){const wait=Number(d.retry_after||r.headers.get("retry-after")||60);if(!timeOk((wait+3)*1000))throw Error("JOB_TIME_LIMIT");console.log("Rate limit. Esperando "+wait+" segundos...");await sleep(wait*1000);return req(url)}
 if(!r.ok)throw Error("HTTP "+r.status+": "+text.slice(0,250));
 await sleep(1000);return d;
}
async function all(url){let a=[],next=url;while(next){const d=await req(next);if(Array.isArray(d.data))a.push(...d.data);next=d.links?.next||null}return a}
function num(...xs){for(const x of xs){if(x!==undefined&&x!==null&&x!==""){const n=Number(String(x).replace(/[^\d.-]/g,""));if(Number.isFinite(n)&&n>0)return n}}return null}
function usd(v){return num(v.price_usd,v.priceUSD,v.usd_price,v.usd_price_value,v.usd)}
function ars(v){return num(v.price_ars,v.priceARS,v.ars_price,v.ars_price_value,v.ars)}
function fx(v,u,a){return num(v.exchange_rate,v.exchangeRate,v.usd_ars_rate,v.fx_rate,v.rate)||(u&&a?a/u:null)}

async function buildCatalog(){
 if(fs.existsSync(CATALOG)){console.log("Catálogo existente; no se reconstruye.");return read(CATALOG,{})}
 console.log("Construyendo catálogo inicial...");
 const b=(await req(API+"/brands")).data||[], versions=[];
 for(const brand of b){
  console.log("MARCA "+brand.name);const models=await all(`${API}/brands/${brand.id}/models`);
  for(const model of models){
   console.log("MODELO "+model.name);const vs=await all(`${API}/models/${model.id}/versions`);
   for(const v of vs)versions.push({id:String(v.id),marca:brand.name,modelo:model.name,version:v.name});
  }
 }
 const c={version:1,actualizado:new Date().toISOString(),marcas:b.map(x=>x.name).filter(Boolean).sort((a,z)=>a.localeCompare(z,"es")),versiones};
 write(CATALOG,c);return c;
}
async function main(){
 const start=Number(process.env.START_INDEX||0),cat=await buildCatalog();
 const data=read(DATA,{version:2,fuente:"Arg Autos",minYear:MIN_YEAR,marcas:cat.marcas,vehiculos:{}});
 data.marcas=cat.marcas;let i=start,count=0;
 while(i<cat.versiones.length&&count<BATCH_SIZE){
  if(!timeOk(15000))break;const item=cat.versiones[i];
  try{
   const vals=await all(`${API}/versions/${item.id}/valuations?currency=ars`),precios={};
   for(const v of vals){const y=Number(v.year);if(!Number.isInteger(y)||y<MIN_YEAR)continue;const u=usd(v),a=ars(v),rate=fx(v,u,a);if(u!==null||a!==null)precios[y]={usd:u,tipoCambio:rate,ars:a,actualizado:new Date().toISOString()}}
   if(Object.keys(precios).length)data.vehiculos[item.id]={marca:item.marca,modelo:item.modelo,version:item.version,precios};
   console.log(`OK versión ${item.id}: ${Object.keys(precios).length} años`);i++;count++;
  }catch(e){if(e.message==="JOB_TIME_LIMIT"){console.log("Tiempo agotado; se reintentará esta versión.");break}throw e}
 }
 data.actualizado=new Date().toISOString();data.estadisticas={marcas:cat.marcas.length,modelos:new Set(cat.versiones.map(v=>v.marca+"|||"+v.modelo)).size,versionesCatalogadas:cat.versiones.length,versionesConValuacion:Object.keys(data.vehiculos).length,siguienteIndice:i};
 write(DATA,data);write(STATE,{actualizado:new Date().toISOString(),siguienteIndice:i,totalVersiones:cat.versiones.length,completado:i>=cat.versiones.length,procesadasEnEsteJob:count});
 console.log("Lote guardado. Siguiente índice: "+i);
}
main().catch(e=>{console.error(e);process.exit(1)});

const fs=require("fs"),path=require("path");
const BASE="https://argautos.com/api/v1",OUT="autos-data.json",STATE="autos-progress.json",MIN_YEAR=2013;
const DEADLINE=Date.now()+Number(process.env.BATCH_MINUTES||315)*60000,SAFETY=600000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function load(p,d){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return d}}
function save(p,d){fs.writeFileSync(p,JSON.stringify(d,null,2))}
async function get(url){let tries=0;for(;;){if(Date.now()+SAFETY>DEADLINE)throw Error("BATCH_DEADLINE");console.log("GET "+url);let r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"MAUDAM-GitHub-Actions/2.0"}}),t=await r.text(),d;try{d=JSON.parse(t)}catch{throw Error("Respuesta no JSON HTTP "+r.status)}if(r.status===429){let n=Number(d.retry_after??r.headers.get("retry-after")??60);console.log("Rate limit. Esperando "+n+" segundos...");await sleep(n*1000);if(++tries>20)throw Error("Demasiados rate limits consecutivos");continue}if(!r.ok)throw Error("HTTP "+r.status+" "+(d.message||""));return d}}
async function all(u){let a=[];while(u){let d=await get(u);if(Array.isArray(d.data))a.push(...d.data);u=d.links?.next||null}return a}
function price(x){for(const k of["price_ars","priceARS","ars_price","price"]){let n=Number(String(x?.[k]??"").replace(/[^\d.-]/g,""));if(Number.isFinite(n)&&n>0)return Math.round(n)}return null}
async function main(){let s=load(STATE,null),d=load(OUT,{version:2,fuente:"Arg Autos",minYear:MIN_YEAR,marcas:[],vehiculos:{},estadisticas:{}});
if(!s){let b=await get(BASE+"/brands");s={brands:b.data||[],bi:0,models:[],mi:0,versions:[],vi:0};d.marcas=s.brands.map(x=>x.name).filter(Boolean);d.estadisticas={marcas:d.marcas.length,modelos:0,versionesConValuacion:0};save(OUT,d);save(STATE,s)}
while(Date.now()+SAFETY<DEADLINE){if(s.bi>=s.brands.length){d.actualizado=new Date().toISOString();d.estadisticas.versionesConValuacion=Object.keys(d.vehiculos).length;save(OUT,d);fs.unlinkSync(STATE);console.log("CATÁLOGO COMPLETO");return}
let b=s.brands[s.bi];if(!s.models.length){console.log("MARCA "+b.name);s.models=await all(`${BASE}/brands/${b.id}/models`);s.mi=0;d.estadisticas.modelos=(d.estadisticas.modelos||0)+s.models.length;save(STATE,s);save(OUT,d)}
if(s.mi>=s.models.length){s.bi++;s.models=[];s.versions=[];s.mi=s.vi=0;save(STATE,s);continue}
let m=s.models[s.mi];if(!s.versions.length){console.log("MODELO "+m.name);s.versions=await all(`${BASE}/models/${m.id}/versions`);s.vi=0;save(STATE,s)}
if(s.vi>=s.versions.length){s.mi++;s.versions=[];s.vi=0;save(STATE,s);continue}
let v=s.versions[s.vi],vals=await all(`${BASE}/versions/${v.id}/valuations?currency=ars`),precios={};
for(const x of vals){let y=Number(x.year);if(y>=MIN_YEAR){let p=price(x);if(p!==null)precios[y]=p}}
if(Object.keys(precios).length)d.vehiculos[v.id]={marca:b.name,modelo:m.name,version:v.name,precios};
d.estadisticas.versionesConValuacion=Object.keys(d.vehiculos).length;s.vi++;save(STATE,s);save(OUT,d)}
save(STATE,s);save(OUT,d);console.log("LOTE TERMINADO; el próximo workflow continúa desde el progreso guardado")}
main().catch(e=>{if(e.message==="BATCH_DEADLINE"){console.log("Límite del lote alcanzado; progreso guardado");process.exit(0)}console.error(e);process.exit(1)})

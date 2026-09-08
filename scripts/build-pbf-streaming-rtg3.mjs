import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { classifyDrivableWay, onewaySemantics, ROUTABLE_HIGHWAYS } from './routingGraphPolicy.mjs';
import { RESTRICTION_TYPE, serializeRtg4, viaWayTypeByte, MAX_VIA_WAY_SLOTS_PER_EDGE, MAX_VIA_WAY_CHAINS, MAX_VIA_WAY_CHAIN_LINKS } from './rtg3Codec.mjs';
import { buildDirectedComponents, buildPortalV2, collectSeamEvidence } from './rtg4PortalComponents.mjs';
import { assertPreflight, runRtg3BuildPreflight } from './rtg3BuildPreflight.mjs';

const RUN=resolve(process.env.RTG3_RUN_DIR??'field-runs/pbf-streaming-rtg3-20260908');
const SOURCE=resolve(process.argv[2]??resolve(RUN,'raw/mersin-province.osm.pbf'));
/* Ulke olceginde SQLite yazma hizi baskindir; temp'i hizli bir yerel
   dosya sistemine almak build'i saatlerden dakikalara indirir. Cikti ve
   kanit RUN_DIR'de KALIR — kanit yeri degismez. */
const TEMP=resolve(process.env.RTG3_TEMP_DIR??resolve(RUN,'tmp')),OUTPUT=resolve(RUN,'regions'),DB_PATH=resolve(TEMP,'routing-build.sqlite');
const OSMIUM=process.env.OSMIUM??'osmium',TILE=.5,MEMORY_BUDGET_MIB=Number(process.env.RTG3_MEMORY_BUDGET_MIB??512);
const REGION_PREFIX=process.env.RTG3_REGION_PREFIX??'tr-33';
const ALLOWED=new Set(ROUTABLE_HIGHWAYS);
const CLASS={motorway:1,trunk:2,primary:3,secondary:4,tertiary:5,unclassified:6,residential:7,living_street:8,service:9,road:9};
const RESTRICTION=RESTRICTION_TYPE;
mkdirSync(TEMP,{recursive:true});mkdirSync(OUTPUT,{recursive:true});

/* Yarım graf bırakmamak için build BAŞLAMADAN önce araç zinciri doğrulanır.
   Disk beklentisi Mersin ölçümünden türetilmiş muhafazakâr katsayıdır
   (kaynak 9 899 746 B → tepe temp 155 619 720 B ≈ 15.7×; +çıktı ≈ 2.8×). */
const DISK_FACTOR=Number(process.env.RTG3_DISK_FACTOR??25);
/* P12 — YARIM BUILD GECERLI DATASET DEGILDIR. Isaret dosyasi bastan SILINIR;
   yalniz tum bolgeler + manifest yazildiktan SONRA konur. Manifest de en
   sonda yazildigi icin yarim kosu tuketiciye ASLA yayinlanmaz. */
const COMPLETE_MARKER=resolve(RUN,'build-complete.json');
rmSync(COMPLETE_MARKER,{force:true});
rmSync(resolve(RUN,'turkey-graph-manifest.json'),{force:true});
const preflight=await runRtg3BuildPreflight({sourcePath:SOURCE,tempDir:TEMP,outputDir:OUTPUT,memoryBudgetMiB:MEMORY_BUDGET_MIB,osmiumBin:OSMIUM,minFreeBytes:Math.round((statSync(SOURCE,{throwIfNoEntry:false})?.size??0)*DISK_FACTOR)});
/* ÖLÇÜLDÜ (Türkiye, 2026-09-08): bölge döngüsü her turda yüzlerce MB kısa
   ömürlü nesne üretiyor. V8 old-space varsayılan tavanı (~4 GB) altında GC
   ertelenir ve RSS KADEMELİ tırmanır: 153 bölge sonunda 518 MiB → 512 MiB
   ağaç bütçesi fail-closed düştü. Çözüm bütçeyi büyütmek DEĞİL, V8'e bütçeyle
   uyumlu bir tavan vermektir (`--max-old-space-size`), böylece GC erken
   toplar. Bu kontrol o gereksinimi araç zinciri sözleşmesinin parçası yapar —
   kabile bilgisi olarak bırakmaz. */
const heapLimitMiB=Math.round(getHeapStatistics().heap_size_limit/1048576);
const heapCeilingMiB=Math.max(128,Math.round(MEMORY_BUDGET_MIB*0.7));
preflight.checks.push({check:'v8-heap-limit',required:`<=${heapCeilingMiB} MiB`,measured:`${heapLimitMiB} MiB`,
  result:heapLimitMiB<=heapCeilingMiB?'PASS':'FAIL',
  /* `heap_size_limit` old-space + new-space toplamidir; onerilen deger o
     farki (olculen fark) dusen bir tavandir — yoksa oneri kendi kapisini
     gecemez. */
  detail:heapLimitMiB<=heapCeilingMiB?null:`NODE_OPTIONS=--max-old-space-size=${Math.max(96,heapCeilingMiB-(heapLimitMiB-Math.round(getHeapStatistics().total_available_size/1048576)>0?48:48))} ile calistirin (butce ${MEMORY_BUDGET_MIB} MiB, olculen V8 tavani ${heapLimitMiB} MiB)`});
preflight.ok=preflight.checks.every(c=>c.result==='PASS');
writeFileSync(resolve(RUN,'build-preflight.json'),JSON.stringify(preflight,null,2));
assertPreflight(preflight);

const started=performance.now(),telemetry=[],peaks={nodeRss:0,childRss:0,processTreeRss:0,tempDisk:0};let activeChildPid=null;
const SPILL=name=>resolve(TEMP,name);
const tempBytes=()=>{let n=0;for(const p of [DB_PATH,`${DB_PATH}-wal`,`${DB_PATH}-shm`,SPILL('pass1.opl'),SPILL('pass2.opl')])try{n+=statSync(p).size}catch{}return n};
function procRss(pid){if(process.platform!=='linux'||!pid)return 0;try{const m=readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmRSS:\s+(\d+)\s+kB$/m);return m?Number(m[1])*1024:0}catch{return 0}}
/* Zirveler HER ornekte guncellenir; kutuge yalniz ADLANDIRILMIS asamalar
   yazilir. Ulke olceginde 50 ms'lik ornekler on binlerce kayda cikar:
   bellekte de benchmark.json'da da sinirsiz buyur ve `Math.max(...dizi)`
   yigini tasirir. Olcum kaybi YOK — butce kapisi her ornekte calisir. */
function sample(stage){
  const nodeRss=process.memoryUsage().rss,childRss=procRss(activeChildPid),processTreeRss=nodeRss+childRss,tempDisk=tempBytes();
  if(nodeRss>peaks.nodeRss)peaks.nodeRss=nodeRss;
  if(childRss>peaks.childRss)peaks.childRss=childRss;
  if(processTreeRss>peaks.processTreeRss)peaks.processTreeRss=processTreeRss;
  if(tempDisk>peaks.tempDisk)peaks.tempDisk=tempDisk;
  if(stage!=='periodic')telemetry.push({stage,atMs:performance.now()-started,nodeRss,childRss,processTreeRss,tempDisk});
  if(processTreeRss>MEMORY_BUDGET_MIB*1024*1024)throw new Error(`RTG3_MEMORY_BUDGET_EXCEEDED:${stage}`);
}
const timer=setInterval(()=>sample('periodic'),50);
/* Kaynak SHA'si TEK KEZ ve AKISLA hesaplanir. Onceki hali her bolge icin
   `readFileSync(SOURCE)` cagiriyordu: 14 bolgede fark edilmiyordu, ulke
   olceginde 645 MB'i yuzlerce kez okuyup RAM'e almak demekti (hem bellek
   butcesini hem build suresini tek basina patlatir). */
async function shaStream(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
const decode=s=>s.replace(/%([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/%([^0-9A-Fa-f]|$)/g,'$1');
const tags=s=>Object.fromEntries((s??'').split(',').filter(Boolean).map(x=>{const i=x.indexOf('=');return[decode(i<0?x:x.slice(0,i)),decode(i<0?'':x.slice(i+1))]}));
const field=(line,key)=>line.match(new RegExp(`(?:^| )${key}([^ ]*)`))?.[1]??'';
/**
 * osmium AKISI DOSYAYA DÜŞÜRÜLÜR, sonra okunur — boru DEĞİL.
 *
 * ÖLÇÜLDÜ (Türkiye 645 MB, 2026-09-08): boruyla `tags-filter` tüketici
 * yavaşladıkça blokta şişiyor ve tepe RSS **546 MiB**'ye çıkıyor → 512 MiB
 * ağaç bütçesi 14. saniyede fail-closed düşüyor. Aynı komut dosyaya yazarken
 * **216 MiB**, düğüm akışı **27 MiB**. Üstelik çocuk süreç Node ayrıştırmaya
 * BAŞLAMADAN bitiyor → süreç ağacı tepesi max(), TOPLAM değil.
 *
 * Bedeli disktir (Türkiye: 648 MB + 7,1 GB geçici OPL) ve bilinçlidir; dosya
 * aşama biter bitmez SİLİNİR. Bütçe YÜKSELTİLMEDİ.
 */
async function runLines(args,onLine,stage,spillName){
  /* `add_metadata=false`: sürüm/zaman damgası/kullanıcı/changeset alanları
     OKUNMUYOR; yazmak yalnız disk ve ayrıştırma maliyeti. Ölçüldü (Mersin):
     124 808 974 B → 64 049 519 B (%48,7 azalma). Graf çıktısı DEĞİŞMEZ. */
  const spill=SPILL(spillName);
  const child=spawn(OSMIUM,[...args,'-o',spill,'--overwrite'],{stdio:['ignore','ignore','pipe']});
  activeChildPid=child.pid??null;
  let stderr='';child.stderr.on('data',b=>stderr+=b);
  const [code]=await once(child,'close');
  activeChildPid=null;
  if(code)throw new Error(`${OSMIUM} ${args[0]} (${code}): ${stderr}`);
  sample(`${stage}-extract`);
  for await(const line of createInterface({input:createReadStream(spill,{highWaterMark:1<<20}),crlfDelay:Infinity}))onLine(line);
  sample(stage);
  rmSync(spill,{force:true});
}

const db=new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA temp_store=FILE;PRAGMA cache_size=-32768;CREATE TABLE IF NOT EXISTS build_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const readMeta=k=>db.prepare('SELECT value FROM build_meta WHERE key=?').get(k)?.value??null;
const writeMeta=(k,v)=>db.prepare('INSERT INTO build_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(v));
const sourceHash=await shaStream(SOURCE);
/* Yalniz AYNI kaynaktan uretilmis ve INDEKSE KADAR tamamlanmis bir DB
   yeniden kullanilir; aksi halde bastan kurulur. Bayat DB sessizce kabul
   EDILMEZ (yanlis grafi dogru sanmak, eksik graftan kotudur). */
const reusable=process.env.RTG3_REUSE_DB==='1'&&readMeta('source_sha256')===sourceHash&&readMeta('stage')==='partition-index-complete';
let selectedWays=0,deniedWays=0,restrictionRelations=0,requiredCoordinates=0;
if(reusable){
  selectedWays=Number(readMeta('selected_ways'));deniedWays=Number(readMeta('denied_ways'));
  restrictionRelations=Number(readMeta('restriction_relations'));requiredCoordinates=Number(readMeta('required_coordinates'));
  sample('reuse-existing-index');
}else{
db.exec(`DROP TABLE IF EXISTS ways;DROP TABLE IF EXISTS way_nodes;DROP TABLE IF EXISTS required_nodes;DROP TABLE IF EXISTS nodes;DROP TABLE IF EXISTS restrictions;DROP TABLE IF EXISTS region_ways;DROP TABLE IF EXISTS region_nodes;
CREATE TABLE ways(id INTEGER PRIMARY KEY,tags TEXT NOT NULL,access_role INTEGER NOT NULL);
CREATE TABLE way_nodes(way_id INTEGER NOT NULL,ord INTEGER NOT NULL,node_id INTEGER NOT NULL,PRIMARY KEY(way_id,ord));CREATE INDEX way_nodes_node ON way_nodes(node_id);
CREATE TABLE required_nodes(id INTEGER PRIMARY KEY);CREATE TABLE nodes(id INTEGER PRIMARY KEY,lat REAL NOT NULL,lon REAL NOT NULL);
CREATE TABLE restrictions(id INTEGER PRIMARY KEY,type TEXT,conditional INTEGER NOT NULL,except_tag TEXT,from_way INTEGER,to_way INTEGER,via_node INTEGER,via_ways TEXT,member_state TEXT NOT NULL);
CREATE TABLE region_ways(region_id TEXT NOT NULL,way_id INTEGER NOT NULL,PRIMARY KEY(region_id,way_id));CREATE TABLE region_nodes(region_id TEXT NOT NULL,node_id INTEGER NOT NULL,PRIMARY KEY(region_id,node_id));`);
const insertWay=db.prepare('INSERT INTO ways VALUES(?,?,?)');
const insertWayNode=db.prepare('INSERT INTO way_nodes VALUES(?,?,?)');
const insertRequired=db.prepare('INSERT OR IGNORE INTO required_nodes VALUES(?)');
const insertRestriction=db.prepare('INSERT INTO restrictions VALUES(?,?,?,?,?,?,?,?,?)');
db.exec('BEGIN');
await runLines(['tags-filter','-R',SOURCE,'w/highway','r/type=restriction','-f','opl,add_metadata=false'],line=>{
  if(line[0]==='w'){
    const wayTags=tags(field(line,'T')),decision=classifyDrivableWay(wayTags,ALLOWED);if(!decision){deniedWays++;return}
    const id=Number(line.slice(1,line.indexOf(' '))),nodeIds=field(line,'N').split(',').filter(Boolean).map(x=>Number(x.slice(1)));if(nodeIds.length<2)return;
    insertWay.run(id,JSON.stringify(wayTags),decision.role==='DESTINATION_ACCESS_ONLY'?2:1);
    nodeIds.forEach((nodeId,ord)=>{insertWayNode.run(id,ord,nodeId);insertRequired.run(nodeId)});selectedWays++;
  }else if(line[0]==='r'){
    restrictionRelations++;const id=Number(line.slice(1,line.indexOf(' '))),relationTags=tags(field(line,'T'));
    const members=field(line,'M').split(',').filter(Boolean).map(x=>{const[ref,role='']=x.split('@');return{type:ref[0],ref:Number(ref.slice(1)),role:decode(role)}});
    const from=members.filter(m=>m.type==='w'&&m.role==='from'),to=members.filter(m=>m.type==='w'&&m.role==='to'),viaNode=members.filter(m=>m.type==='n'&&m.role==='via'),viaWay=members.filter(m=>m.type==='w'&&m.role==='via');
    /* Gerçek OSM semantiği: via ya TEK düğüm ya da SIRALI bir/birkaç yoldur.
       İkisi birden veya hiçbiri = kaynak hatası; uydurulmaz. */
    const memberState=from.length===1&&to.length===1&&((viaNode.length===1&&viaWay.length===0)||(viaNode.length===0&&viaWay.length>=1))?'VALID':'MALFORMED_SOURCE';
    insertRestriction.run(id,relationTags.restriction??null,relationTags['restriction:conditional']?1:0,relationTags.except??null,from[0]?.ref??null,to[0]?.ref??null,viaNode[0]?.ref??null,viaWay.length?JSON.stringify(viaWay.map(m=>m.ref)):null,memberState);
  }
},'pass1-complete','pass1.opl');db.exec('COMMIT');

const required=db.prepare('SELECT 1 FROM required_nodes WHERE id=?'),insertNode=db.prepare('INSERT INTO nodes VALUES(?,?,?)');
db.exec('BEGIN');
await runLines(['cat',SOURCE,'-t','node','-f','opl,add_metadata=false'],line=>{const id=Number(line.slice(1,line.indexOf(' ')));if(!required.get(id))return;const lon=Number(field(line,'x')),lat=Number(field(line,'y'));if(Number.isFinite(lat)&&Number.isFinite(lon)){insertNode.run(id,lat,lon);requiredCoordinates++}},'pass2-complete','pass2.opl');
db.exec('COMMIT');
db.exec(`INSERT OR IGNORE INTO region_ways SELECT printf('${REGION_PREFIX}-%d-%d',CAST(n.lon/${TILE} AS INTEGER),CAST(n.lat/${TILE} AS INTEGER)),wn.way_id FROM way_nodes wn JOIN nodes n ON n.id=wn.node_id;CREATE INDEX region_ways_region ON region_ways(region_id);INSERT OR IGNORE INTO region_nodes SELECT rw.region_id,wn.node_id FROM region_ways rw JOIN way_nodes wn ON wn.way_id=rw.way_id;CREATE INDEX region_nodes_node ON region_nodes(node_id);ANALYZE;`);
sample('partition-index-complete');
writeMeta('source_sha256',sourceHash);writeMeta('selected_ways',selectedWays);writeMeta('denied_ways',deniedWays);
writeMeta('restriction_relations',restrictionRelations);writeMeta('required_coordinates',requiredCoordinates);writeMeta('stage','partition-index-complete');
}

const regionIds=[...db.prepare('SELECT DISTINCT region_id FROM region_ways ORDER BY region_id').iterate()].map(r=>r.region_id);
const hav=(a,b)=>{const p=Math.PI/180,d1=(b[0]-a[0])*p,d2=(b[1]-a[1])*p,q=Math.sin(d1/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin(d2/2)**2;return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))};
const wayRows=db.prepare('SELECT w.id,w.tags,w.access_role FROM region_ways rw JOIN ways w ON w.id=rw.way_id WHERE rw.region_id=? ORDER BY w.id');
const wayNodes=db.prepare('SELECT wn.node_id,n.lat,n.lon FROM way_nodes wn JOIN nodes n ON n.id=wn.node_id WHERE wn.way_id=? ORDER BY wn.ord');
const restrictionRows=db.prepare('SELECT r.* FROM restrictions r JOIN region_ways a ON a.way_id=r.from_way AND a.region_id=? JOIN region_ways b ON b.way_id=r.to_way AND b.region_id=? ORDER BY r.id');
const regions=[],componentRegions=[],allSeamEvidence=[],restrictionEvidence=[],viaWayEvidence=[];
for(const regionId of regionIds){
  const used=new Map(),coords=[],nodeIds=[],edges=[],edgeByWay=new Map(),classCount={};
  const indexNode=(id,lat,lon)=>{let index=used.get(id);if(index===undefined){index=coords.length;used.set(id,index);coords.push([lat,lon]);nodeIds.push(id)}return index};
  for(const way of wayRows.iterate(regionId)){
    const wayTags=JSON.parse(way.tags),raw=wayTags.highway,base=raw.endsWith('_link')?raw.slice(0,-5):raw,direction=onewaySemantics(wayTags.oneway,raw,wayTags.junction);
    const structure=(wayTags.bridge&&wayTags.bridge!=='no'?1:0)|(wayTags.tunnel&&wayTags.tunnel!=='no'?2:0),layer=Math.max(-128,Math.min(127,parseInt(wayTags.layer??'0',10)||0)),nodes=[...wayNodes.iterate(way.id)];
    for(let i=1;i<nodes.length;i++){let from=indexNode(nodes[i-1].node_id,nodes[i-1].lat,nodes[i-1].lon),to=indexNode(nodes[i].node_id,nodes[i].lat,nodes[i].lon);if(from===to)continue;if(direction.reversed)[from,to]=[to,from];const ordinal=edges.length;edges.push({from,to,cost:Math.max(1,Math.round(hav(coords[from],coords[to]))),wayId:way.id,cls:CLASS[base]??9,accessRole:way.access_role,direction:direction.oneway?1:0,structure,layer});const list=edgeByWay.get(way.id)??[];list.push(ordinal);edgeByWay.set(way.id,list);classCount[base]=(classCount[base]??0)+1}
  }

  /* ── Via-way çözümü ────────────────────────────────────────────────────
     Bir `from way → via way(lar) → to way` kısıtı tek kavşak kaydına
     SIKIŞTIRILAMAZ. Kenar dizisi çıkarılır ve zincir halkaları olarak
     yazılır; çözülemeyen topoloji UYDURULMAZ, sınıflandırılır. */
  const wayNodeIndexSeq=(wayId)=>{const seq=[];for(const row of wayNodes.iterate(wayId)){const idx=used.get(row.node_id);if(idx===undefined)return null;if(!seq.length||seq[seq.length-1]!==idx)seq.push(idx)}return seq.length>=2?seq:null};
  const walkVia=(wayId,entryNode)=>{
    const seq=wayNodeIndexSeq(wayId);if(!seq)return null;
    let nodes=null;
    if(seq[0]===entryNode)nodes=seq;else if(seq[seq.length-1]===entryNode)nodes=[...seq].reverse();else return null;
    const ords=edgeByWay.get(wayId);if(!ords)return null;
    const edgeSeq=[];
    for(let i=1;i<nodes.length;i++){const a=nodes[i-1],b=nodes[i];
      const found=ords.find(o=>{const e=edges[o];return (e.from===a&&e.to===b)||(e.direction===0&&e.from===b&&e.to===a)});
      if(found===undefined)return null;   // tek yön ters yönde: dizi sürülemez
      edgeSeq.push(found)}
    return {edgeSeq,nodes};
  };

  const restrictions=[];
  const stats={valid:0,supported:0,supportedViaWay:0,unsupported:0,malformed:0,unresolved:0,conditional:0,vehicleSpecific:0,viaWayObserved:0,viaWayCapacity:0,unsupportedType:0};
  const slotUse=new Map();let nextChainId=1;
  for(const relation of [...restrictionRows.iterate(regionId,regionId)]){
    if(relation.member_state!=='VALID'){stats.malformed++;continue}stats.valid++;
    if(relation.conditional){stats.conditional++;stats.unsupported++;continue}
    if(relation.except_tag){stats.vehicleSpecific++;stats.unsupported++;continue}
    const type=RESTRICTION[relation.type];if(!type){stats.unsupportedType++;stats.unsupported++;continue}
    const viaWays=relation.via_ways?JSON.parse(relation.via_ways):null;
    if(viaWays&&viaWays.length){
      stats.viaWayObserved++;
      const fromSeq=wayNodeIndexSeq(relation.from_way),firstSeq=wayNodeIndexSeq(viaWays[0]);
      if(!fromSeq||!firstSeq){stats.unresolved++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNRESOLVED_TOPOLOGY',detail:'from/via yol geometrisi bölgede yok'});continue}
      const fromSet=new Set(fromSeq),entryCandidates=[...new Set([firstSeq[0],firstSeq[firstSeq.length-1]])].filter(n=>fromSet.has(n));
      if(entryCandidates.length!==1){stats.unresolved++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNRESOLVED_TOPOLOGY',detail:`via giriş düğümü belirsiz (${entryCandidates.length})`});continue}
      const entry=entryCandidates[0];let cursor=entry,viaEdges=[],junctions=[entry],broken=null;
      for(const wayId of viaWays){const walk=walkVia(wayId,cursor);if(!walk){broken=wayId;break}viaEdges.push(...walk.edgeSeq);junctions.push(...walk.nodes.slice(1));cursor=walk.nodes[walk.nodes.length-1]}
      if(broken!==null){stats.unresolved++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNRESOLVED_TOPOLOGY',detail:`via yol ${broken} uçtan bağlanmıyor veya tek yön ters`});continue}
      const exitNode=cursor,toSeq=wayNodeIndexSeq(relation.to_way);
      if(!toSeq||!toSeq.includes(exitNode)){stats.unresolved++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNRESOLVED_TOPOLOGY',detail:'to yolu via çıkış düğümüne değmiyor'});continue}
      const fromEdges=(edgeByWay.get(relation.from_way)??[]).filter(o=>{const e=edges[o];return e.to===entry||(e.direction===0&&e.from===entry)});
      const toEdges=(edgeByWay.get(relation.to_way)??[]).filter(o=>{const e=edges[o];return e.from===exitNode||(e.direction===0&&e.to===exitNode)});
      if(!fromEdges.length||!toEdges.length||!viaEdges.length){stats.unresolved++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNRESOLVED_TOPOLOGY',detail:'from/to kenarı kavşakta yönlü olarak yok'});continue}
      const linkCount=viaEdges.length+1;
      if(linkCount>MAX_VIA_WAY_CHAIN_LINKS){stats.unsupported++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNSUPPORTED_CAPACITY',detail:`zincir ${linkCount} halka`});continue}
      const planned=[];
      for(const fromEdge of fromEdges)for(const toEdge of toEdges){
        const links=[];
        links.push({fromEdge,toEdge:viaEdges[0],viaNode:junctions[0]});
        for(let j=1;j<viaEdges.length;j++)links.push({fromEdge:viaEdges[j-1],toEdge:viaEdges[j],viaNode:junctions[j]});
        links.push({fromEdge:viaEdges[viaEdges.length-1],toEdge,viaNode:junctions[viaEdges.length]});
        planned.push(links);
      }
      const projected=new Map(slotUse);let overflow=false;
      for(const links of planned)for(const link of links){const n=(projected.get(link.fromEdge)??0)+1;if(n>MAX_VIA_WAY_SLOTS_PER_EDGE){overflow=true;break}projected.set(link.fromEdge,n)}
      if(overflow||nextChainId+planned.length-1>MAX_VIA_WAY_CHAINS){stats.unsupported++;stats.viaWayCapacity++;viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'UNSUPPORTED_CAPACITY',detail:`kenar yuva tavanı ${MAX_VIA_WAY_SLOTS_PER_EDGE}`});continue}
      const chainIds=[];
      for(const links of planned){const chainId=nextChainId++;chainIds.push(chainId);
        links.forEach((link,seq)=>{restrictions.push({fromEdge:link.fromEdge,toEdge:link.toEdge,viaNode:link.viaNode,type:viaWayTypeByte(type,seq===links.length-1),chainSeq:seq,chainId,relationId:relation.id});slotUse.set(link.fromEdge,(slotUse.get(link.fromEdge)??0)+1)})}
      stats.supported++;stats.supportedViaWay++;
      viaWayEvidence.push({relationId:relation.id,regionId,restrictionType:relation.type,viaWays,outcome:'SUPPORTED_VIA_WAY',chainIds,chainLinks:linkCount,viaEdgeCount:viaEdges.length,fromEdges,toEdges,entryNodeId:nodeIds[entry],exitNodeId:nodeIds[exitNode]});
      continue;
    }
    const via=used.get(relation.via_node),incoming=(edgeByWay.get(relation.from_way)??[]).filter(i=>edges[i].to===via||(!edges[i].direction&&edges[i].from===via)),outgoing=(edgeByWay.get(relation.to_way)??[]).filter(i=>edges[i].from===via||(!edges[i].direction&&edges[i].to===via));
    if(via===undefined||!incoming.length||!outgoing.length){stats.unresolved++;continue}
    for(const fromEdge of incoming)for(const toEdge of outgoing){restrictions.push({fromEdge,toEdge,viaNode:via,type,relationId:relation.id});restrictionEvidence.push({relationId:relation.id,restrictionType:relation.type,regionId,fromWay:relation.from_way,toWay:relation.to_way,viaNodeId:relation.via_node,fromEdge,toEdge})}
    stats.supported++;
  }
  const graph={coords,nodeIds,edges,restrictions},binary=serializeRtg4(graph),file=`${regionId}.rtg4`;writeFileSync(resolve(OUTPUT,file),binary);
  const components=buildDirectedComponents({regionId,nodeIds,edges});
  const componentFile=`${regionId}.components.json`;
  const componentArtifact={schemaVersion:components.schemaVersion,regionId,componentIds:components.componentIds,representativeNodeIds:components.representativeNodeIds,links:components.links};
  const componentBytes=Buffer.from(JSON.stringify(componentArtifact));
  writeFileSync(resolve(OUTPUT,componentFile),componentBytes);
  /* Node sırası RTG4 node ordinal sırasıyla birebirdir. Bu kompakt sidecar
     origin/destination stable node'un component'ini graph unload edilse bile
     tahminsiz bulmayı sağlar; tüm node kimliklerini JSON'da tekrar etmez. */
  const componentIndexFile=`${regionId}.component-index.bin`;
  const componentIndexBytes=Buffer.from(components.componentIndex.buffer,components.componentIndex.byteOffset,components.componentIndex.byteLength);
  writeFileSync(resolve(OUTPUT,componentIndexFile),componentIndexBytes);
  const seamEvidence=collectSeamEvidence({regionId,regionPrefix:REGION_PREFIX,tileSize:TILE,coords,nodeIds,edges,componentIndex:components.componentIndex,componentIds:components.componentIds});
  componentRegions.push({regionId,componentIds:[...new Set(seamEvidence.flatMap(item=>[item.localSourceComponentId,item.localDestinationComponentId]))]});
  allSeamEvidence.push(...seamEvidence);
  const portalComponentIds=componentRegions[componentRegions.length-1].componentIds.sort();
  const parts=regionId.split('-'),x=Number(parts[parts.length-2]),y=Number(parts[parts.length-1]);regions.push({regionId,bbox:[x*TILE,y*TILE,(x+1)*TILE,(y+1)*TILE],graphFile:`regions/${file}`,sha256:createHash('sha256').update(binary).digest('hex'),byteSize:binary.length,nodeCount:nodeIds.length,edgeCount:edges.length,neighbors:[],sourceHash,components:{schemaVersion:1,file:`regions/${componentFile}`,sha256:createHash('sha256').update(componentBytes).digest('hex'),byteSize:componentBytes.length,indexFile:`regions/${componentIndexFile}`,indexSha256:createHash('sha256').update(componentIndexBytes).digest('hex'),indexByteSize:componentIndexBytes.length,indexEncoding:'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX',count:components.componentIds.length,directedLinkCount:components.links.length,portalComponentIds},classCount,restrictions:{source:restrictionRelations,...stats,records:restrictions.length,viaWayChains:nextChainId-1},structure:{bridge:edges.filter(e=>e.structure&1).length,tunnel:edges.filter(e=>e.structure&2).length,layer:edges.filter(e=>e.layer).length},destinationOnly:edges.filter(e=>e.accessRole===2).length,oneway:edges.filter(e=>e.direction===1).length});sample(`region:${regionId}`)
}

const legacyNeighborPairs=[...db.prepare('SELECT DISTINCT a.region_id AS a,b.region_id AS b FROM region_nodes a JOIN region_nodes b ON a.node_id=b.node_id WHERE a.region_id<b.region_id ORDER BY a.region_id,b.region_id').iterate()].map(row=>[row.a,row.b]);
const portalResult=buildPortalV2({regions:componentRegions,legacyNeighborPairs,seamEvidence:allSeamEvidence});
for(const portal of portalResult.portals)portal.sourceHash=sourceHash;
const neighborSets=new Map(regions.map(region=>[region.regionId,new Set()]));
for(const portal of portalResult.portals)if(portal.accessRole===1){neighborSets.get(portal.sourceRegionId)?.add(portal.destinationRegionId);neighborSets.get(portal.destinationRegionId)?.add(portal.sourceRegionId)}
for(const region of regions)region.neighbors=[...neighborSets.get(region.regionId)].sort();
const auditCounts={ROUTABLE:0,NON_ROUTABLE:0,INVALID:0,AMBIGUOUS:0};
for(const link of portalResult.links)auditCounts[link.classification]++;
if(portalResult.links.length!==legacyNeighborPairs.length)throw new Error('RTG4_PORTAL_AUDIT_INCOMPLETE');
const manifest={schemaVersion:2,datasetId:`osm-${REGION_PREFIX}-${sourceHash.slice(0,12)}`,country:'TR',source:process.env.RTG3_SOURCE_LABEL??'OpenStreetMap / Geofabrik Turkey extract; Mersin relation 223131',sourceTimestamp:process.env.RTG3_SOURCE_TIMESTAMP??'2026-09-06T19:53:37Z',buildTimestamp:new Date().toISOString(),policyVersion:'2b4f5de8',graphFormat:'RTG4',portalSchemaVersion:2,portals:portalResult.portals,neighborAudit:{total:portalResult.links.length,...auditCounts,links:portalResult.links},regions:regions.map(({classCount,restrictions,structure,destinationOnly,oneway,...region})=>region)};
writeFileSync(resolve(RUN,'turkey-graph-manifest.json'),JSON.stringify(manifest,null,2));
const supportedIds=new Set(restrictionEvidence.map(r=>r.relationId)),viaWaySupportedIds=new Set(viaWayEvidence.filter(r=>r.outcome==='SUPPORTED_VIA_WAY').map(r=>r.relationId));
const restrictionStats={observed:0,valid:0,supported:0,supportedViaNode:0,supportedViaWay:0,unsupported:0,malformed:0,unresolved:0,conditional:0,vehicleSpecific:0,viaWay:0,unsupportedType:0},hasWay=db.prepare('SELECT 1 FROM ways WHERE id=?');
for(const relation of db.prepare('SELECT * FROM restrictions ORDER BY id').iterate()){
  restrictionStats.observed++;
  if(relation.member_state!=='VALID'){restrictionStats.malformed++;continue}
  restrictionStats.valid++;
  if(relation.conditional){restrictionStats.conditional++;restrictionStats.unsupported++;continue}
  if(relation.except_tag){restrictionStats.vehicleSpecific++;restrictionStats.unsupported++;continue}
  if(!RESTRICTION[relation.type]){restrictionStats.unsupportedType++;restrictionStats.unsupported++;continue}
  if(!hasWay.get(relation.from_way)||!hasWay.get(relation.to_way)){restrictionStats.unresolved++;continue}
  if(relation.via_ways){restrictionStats.viaWay++;
    if(viaWaySupportedIds.has(relation.id)){restrictionStats.supported++;restrictionStats.supportedViaWay++}
    else{const evidence=viaWayEvidence.find(e=>e.relationId===relation.id);if(evidence?.outcome==='UNSUPPORTED_CAPACITY')restrictionStats.unsupported++;else restrictionStats.unresolved++}
    continue}
  if(supportedIds.has(relation.id)){restrictionStats.supported++;restrictionStats.supportedViaNode++}else restrictionStats.unresolved++;
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');sample('complete');clearInterval(timer);
const summary={source:{file:relative(RUN,SOURCE),bytes:statSync(SOURCE).size,sha256:sourceHash,provider:'Geofabrik/OpenStreetMap',coverage:process.env.RTG3_SOURCE_LABEL??'Mersin province relation 223131'},preflight,parser:'osmium-tool + node:sqlite',strategy:'SQLite-indexed two-pass PBF stream; sequential deterministic 0.5 degree RTG4 partitions + region-local SCC + directed Portal v2 audit',memoryBudgetMiB:MEMORY_BUDGET_MIB,selectedWays,deniedWays,requiredCoordinates,restrictionRelations,restrictionStats,regions,totalNodes:regions.reduce((n,r)=>n+r.nodeCount,0),totalEdges:regions.reduce((n,r)=>n+r.edgeCount,0),totalBytes:regions.reduce((n,r)=>n+r.byteSize,0),componentMetadataBytes:regions.reduce((n,r)=>n+r.components.byteSize,0),totalComponents:regions.reduce((n,r)=>n+r.components.count,0),totalDirectedComponentLinks:regions.reduce((n,r)=>n+r.components.directedLinkCount,0),portalRecords:portalResult.portals.length,portalAudit:{total:portalResult.links.length,...auditCounts},tempBytes:tempBytes(),peakTempBytes:peaks.tempDisk,buildMs:performance.now()-started,peakNodeRssBytes:peaks.nodeRss,peakChildRssBytes:peaks.childRss,peakProcessTreeRssBytes:peaks.processTreeRss,telemetry,restrictionEvidence:restrictionEvidence.slice(0,50),viaWayEvidence};
db.close();
writeFileSync(resolve(RUN,'benchmark.json'),JSON.stringify(summary,null,2));
/* TAMAMLANMA ISARETI — en son adim. Bu dosya yoksa kosu YARIMDIR ve o
   region kumesi gecerli bir dataset SAYILMAZ. */
writeFileSync(COMPLETE_MARKER,JSON.stringify({completedAt:new Date().toISOString(),sourceSha256:sourceHash,regions:regions.length,totalBytes:summary.totalBytes,manifest:'turkey-graph-manifest.json',memoryBudgetMiB:MEMORY_BUDGET_MIB,peakProcessTreeRssBytes:peaks.processTreeRss},null,2));
console.log(JSON.stringify(summary,null,2));

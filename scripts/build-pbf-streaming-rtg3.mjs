import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { classifyDrivableWay, onewaySemantics, ROUTABLE_HIGHWAYS } from './routingGraphPolicy.mjs';

const RUN=resolve('field-runs/pbf-streaming-rtg3-20260908');
const SOURCE=resolve(process.argv[2]??resolve(RUN,'raw/mersin-province.osm.pbf'));
const TEMP=resolve(RUN,'tmp'),OUTPUT=resolve(RUN,'regions'),DB_PATH=resolve(TEMP,'routing-build.sqlite');
const OSMIUM=process.env.OSMIUM??'osmium',TILE=.5,MEMORY_BUDGET_MIB=Number(process.env.RTG3_MEMORY_BUDGET_MIB??512);
const ALLOWED=new Set(ROUTABLE_HIGHWAYS);
const CLASS={motorway:1,trunk:2,primary:3,secondary:4,tertiary:5,unclassified:6,residential:7,living_street:8,service:9,road:9};
const RESTRICTION={no_left_turn:1,no_right_turn:2,no_straight_on:3,no_u_turn:4,only_left_turn:5,only_right_turn:6,only_straight_on:7};
mkdirSync(TEMP,{recursive:true});mkdirSync(OUTPUT,{recursive:true});

const started=performance.now(),telemetry=[];let activeChildPid=null;
const tempBytes=()=>{let n=0;for(const p of [DB_PATH,`${DB_PATH}-wal`,`${DB_PATH}-shm`])try{n+=statSync(p).size}catch{}return n};
function procRss(pid){if(process.platform!=='linux'||!pid)return 0;try{const m=readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmRSS:\s+(\d+)\s+kB$/m);return m?Number(m[1])*1024:0}catch{return 0}}
function sample(stage){const nodeRss=process.memoryUsage().rss,childRss=procRss(activeChildPid),processTreeRss=nodeRss+childRss;telemetry.push({stage,atMs:performance.now()-started,nodeRss,childRss,processTreeRss,tempDisk:tempBytes()});if(processTreeRss>MEMORY_BUDGET_MIB*1024*1024)throw new Error(`RTG3_MEMORY_BUDGET_EXCEEDED:${stage}`)}
const timer=setInterval(()=>sample('periodic'),50);
const shaFile=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const decode=s=>s.replace(/%([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/%([^0-9A-Fa-f]|$)/g,'$1');
const tags=s=>Object.fromEntries((s??'').split(',').filter(Boolean).map(x=>{const i=x.indexOf('=');return[decode(i<0?x:x.slice(0,i)),decode(i<0?'':x.slice(i+1))]}));
const field=(line,key)=>line.match(new RegExp(`(?:^| )${key}([^ ]*)`))?.[1]??'';
async function runLines(args,onLine,stage){const child=spawn(OSMIUM,args,{stdio:['ignore','pipe','pipe']});activeChildPid=child.pid??null;const closed=once(child,'close');let stderr='';child.stderr.on('data',b=>stderr+=b);for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity}))onLine(line);const[code]=await closed;activeChildPid=null;if(code)throw new Error(`${OSMIUM} ${args[0]} (${code}): ${stderr}`);sample(stage)}

const db=new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA temp_store=FILE;PRAGMA cache_size=-32768;
DROP TABLE IF EXISTS ways;DROP TABLE IF EXISTS way_nodes;DROP TABLE IF EXISTS required_nodes;DROP TABLE IF EXISTS nodes;DROP TABLE IF EXISTS restrictions;DROP TABLE IF EXISTS region_ways;DROP TABLE IF EXISTS region_nodes;
CREATE TABLE ways(id INTEGER PRIMARY KEY,tags TEXT NOT NULL,access_role INTEGER NOT NULL);
CREATE TABLE way_nodes(way_id INTEGER NOT NULL,ord INTEGER NOT NULL,node_id INTEGER NOT NULL,PRIMARY KEY(way_id,ord));CREATE INDEX way_nodes_node ON way_nodes(node_id);
CREATE TABLE required_nodes(id INTEGER PRIMARY KEY);CREATE TABLE nodes(id INTEGER PRIMARY KEY,lat REAL NOT NULL,lon REAL NOT NULL);
CREATE TABLE restrictions(id INTEGER PRIMARY KEY,type TEXT,conditional INTEGER NOT NULL,except_tag TEXT,from_way INTEGER,to_way INTEGER,via_node INTEGER,via_way INTEGER,member_state TEXT NOT NULL);
CREATE TABLE region_ways(region_id TEXT NOT NULL,way_id INTEGER NOT NULL,PRIMARY KEY(region_id,way_id));CREATE TABLE region_nodes(region_id TEXT NOT NULL,node_id INTEGER NOT NULL,PRIMARY KEY(region_id,node_id));`);
const insertWay=db.prepare('INSERT INTO ways VALUES(?,?,?)');
const insertWayNode=db.prepare('INSERT INTO way_nodes VALUES(?,?,?)');
const insertRequired=db.prepare('INSERT OR IGNORE INTO required_nodes VALUES(?)');
const insertRestriction=db.prepare('INSERT INTO restrictions VALUES(?,?,?,?,?,?,?,?,?)');
let selectedWays=0,deniedWays=0,restrictionRelations=0;
db.exec('BEGIN');
await runLines(['tags-filter','-R',SOURCE,'w/highway','r/type=restriction','-f','opl','-o','-'],line=>{
  if(line[0]==='w'){
    const wayTags=tags(field(line,'T')),decision=classifyDrivableWay(wayTags,ALLOWED);if(!decision){deniedWays++;return}
    const id=Number(line.slice(1,line.indexOf(' '))),nodeIds=field(line,'N').split(',').filter(Boolean).map(x=>Number(x.slice(1)));if(nodeIds.length<2)return;
    insertWay.run(id,JSON.stringify(wayTags),decision.role==='DESTINATION_ACCESS_ONLY'?2:1);
    nodeIds.forEach((nodeId,ord)=>{insertWayNode.run(id,ord,nodeId);insertRequired.run(nodeId)});selectedWays++;
  }else if(line[0]==='r'){
    restrictionRelations++;const id=Number(line.slice(1,line.indexOf(' '))),relationTags=tags(field(line,'T'));
    const members=field(line,'M').split(',').filter(Boolean).map(x=>{const[ref,role='']=x.split('@');return{type:ref[0],ref:Number(ref.slice(1)),role:decode(role)}});
    const from=members.filter(m=>m.type==='w'&&m.role==='from'),to=members.filter(m=>m.type==='w'&&m.role==='to'),viaNode=members.filter(m=>m.type==='n'&&m.role==='via'),viaWay=members.filter(m=>m.type==='w'&&m.role==='via');
    const memberState=from.length===1&&to.length===1&&(viaNode.length===1||viaWay.length===1)?'VALID':'MALFORMED_SOURCE';
    insertRestriction.run(id,relationTags.restriction??null,relationTags['restriction:conditional']?1:0,relationTags.except??null,from[0]?.ref??null,to[0]?.ref??null,viaNode[0]?.ref??null,viaWay[0]?.ref??null,memberState);
  }
},'pass1-complete');db.exec('COMMIT');

const required=db.prepare('SELECT 1 FROM required_nodes WHERE id=?'),insertNode=db.prepare('INSERT INTO nodes VALUES(?,?,?)');let requiredCoordinates=0;
db.exec('BEGIN');
await runLines(['cat',SOURCE,'-t','node','-f','opl','-o','-'],line=>{const id=Number(line.slice(1,line.indexOf(' ')));if(!required.get(id))return;const lon=Number(field(line,'x')),lat=Number(field(line,'y'));if(Number.isFinite(lat)&&Number.isFinite(lon)){insertNode.run(id,lat,lon);requiredCoordinates++}},'pass2-complete');
db.exec('COMMIT');
db.exec(`INSERT OR IGNORE INTO region_ways SELECT printf('tr-33-%d-%d',CAST(n.lon/${TILE} AS INTEGER),CAST(n.lat/${TILE} AS INTEGER)),wn.way_id FROM way_nodes wn JOIN nodes n ON n.id=wn.node_id;CREATE INDEX region_ways_region ON region_ways(region_id);INSERT OR IGNORE INTO region_nodes SELECT rw.region_id,wn.node_id FROM region_ways rw JOIN way_nodes wn ON wn.way_id=rw.way_id;CREATE INDEX region_nodes_node ON region_nodes(node_id);ANALYZE;`);
sample('partition-index-complete');

const regionIds=[...db.prepare('SELECT DISTINCT region_id FROM region_ways ORDER BY region_id').iterate()].map(r=>r.region_id);
const hav=(a,b)=>{const p=Math.PI/180,d1=(b[0]-a[0])*p,d2=(b[1]-a[1])*p,q=Math.sin(d1/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin(d2/2)**2;return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))};
function serialize(g){const buffer=Buffer.alloc(16+g.coords.length*16+g.edges.length*28+g.restrictions.length*16);buffer.writeUInt32LE(0x33475452,0);buffer.writeUInt32LE(g.coords.length,4);buffer.writeUInt32LE(g.edges.length,8);buffer.writeUInt32LE(g.restrictions.length,12);let offset=16;g.coords.forEach((point,index)=>{buffer.writeFloatLE(point[0],offset);buffer.writeFloatLE(point[1],offset+4);buffer.writeBigUInt64LE(BigInt(g.nodeIds[index]),offset+8);offset+=16});for(const edge of g.edges){buffer.writeUInt32LE(edge.from,offset);buffer.writeUInt32LE(edge.to,offset+4);buffer.writeUInt32LE(edge.cost,offset+8);buffer.writeBigUInt64LE(BigInt(edge.wayId),offset+12);buffer[offset+20]=edge.cls;buffer[offset+21]=edge.accessRole;buffer[offset+22]=edge.direction;buffer[offset+23]=edge.structure;buffer.writeInt8(edge.layer,offset+24);offset+=28}for(const restriction of g.restrictions){buffer.writeUInt32LE(restriction.fromEdge,offset);buffer.writeUInt32LE(restriction.toEdge,offset+4);buffer.writeUInt32LE(restriction.viaNode,offset+8);buffer[offset+12]=restriction.type;offset+=16}return buffer}
const wayRows=db.prepare('SELECT w.id,w.tags,w.access_role FROM region_ways rw JOIN ways w ON w.id=rw.way_id WHERE rw.region_id=? ORDER BY w.id');
const wayNodes=db.prepare('SELECT wn.node_id,n.lat,n.lon FROM way_nodes wn JOIN nodes n ON n.id=wn.node_id WHERE wn.way_id=? ORDER BY wn.ord');
const restrictionRows=db.prepare('SELECT r.* FROM restrictions r JOIN region_ways a ON a.way_id=r.from_way AND a.region_id=? JOIN region_ways b ON b.way_id=r.to_way AND b.region_id=? ORDER BY r.id');
const regions=[],restrictionEvidence=[];
for(const regionId of regionIds){
  const used=new Map(),coords=[],nodeIds=[],edges=[],edgeByWay=new Map(),classCount={};
  const indexNode=(id,lat,lon)=>{let index=used.get(id);if(index===undefined){index=coords.length;used.set(id,index);coords.push([lat,lon]);nodeIds.push(id)}return index};
  for(const way of wayRows.iterate(regionId)){
    const wayTags=JSON.parse(way.tags),raw=wayTags.highway,base=raw.endsWith('_link')?raw.slice(0,-5):raw,direction=onewaySemantics(wayTags.oneway,raw,wayTags.junction);
    const structure=(wayTags.bridge&&wayTags.bridge!=='no'?1:0)|(wayTags.tunnel&&wayTags.tunnel!=='no'?2:0),layer=Math.max(-128,Math.min(127,parseInt(wayTags.layer??'0',10)||0)),nodes=[...wayNodes.iterate(way.id)];
    for(let i=1;i<nodes.length;i++){let from=indexNode(nodes[i-1].node_id,nodes[i-1].lat,nodes[i-1].lon),to=indexNode(nodes[i].node_id,nodes[i].lat,nodes[i].lon);if(from===to)continue;if(direction.reversed)[from,to]=[to,from];const ordinal=edges.length;edges.push({from,to,cost:Math.max(1,Math.round(hav(coords[from],coords[to]))),wayId:way.id,cls:CLASS[base]??9,accessRole:way.access_role,direction:direction.oneway?1:0,structure,layer});const list=edgeByWay.get(way.id)??[];list.push(ordinal);edgeByWay.set(way.id,list);classCount[base]=(classCount[base]??0)+1}
  }
  const restrictions=[];let valid=0,supported=0,unsupported=0,malformed=0,unresolved=0,conditional=0,vehicleSpecific=0;
  for(const relation of restrictionRows.iterate(regionId,regionId)){
    if(relation.member_state!=='VALID'){malformed++;continue}valid++;
    if(relation.conditional){conditional++;unsupported++;continue}if(relation.except_tag){vehicleSpecific++;unsupported++;continue}if(relation.via_way){unsupported++;continue}
    const type=RESTRICTION[relation.type];if(!type){unsupported++;continue}
    const via=used.get(relation.via_node),incoming=(edgeByWay.get(relation.from_way)??[]).filter(i=>edges[i].to===via||(!edges[i].direction&&edges[i].from===via)),outgoing=(edgeByWay.get(relation.to_way)??[]).filter(i=>edges[i].from===via||(!edges[i].direction&&edges[i].to===via));
    if(via===undefined||!incoming.length||!outgoing.length){unresolved++;continue}
    for(const fromEdge of incoming)for(const toEdge of outgoing){restrictions.push({fromEdge,toEdge,viaNode:via,type});supported++;restrictionEvidence.push({relationId:relation.id,restrictionType:relation.type,regionId,fromWay:relation.from_way,toWay:relation.to_way,viaNodeId:relation.via_node,fromEdge,toEdge})}
  }
  const graph={coords,nodeIds,edges,restrictions},binary=serialize(graph),file=`${regionId}.rtg3`;writeFileSync(resolve(OUTPUT,file),binary);
  const [, ,x,y]=regionId.split('-').map(Number);regions.push({regionId,bbox:[x*TILE,y*TILE,(x+1)*TILE,(y+1)*TILE],graphFile:`regions/${file}`,sha256:createHash('sha256').update(binary).digest('hex'),byteSize:binary.length,nodeCount:nodeIds.length,edgeCount:edges.length,neighbors:[],sourceHash:shaFile(SOURCE),classCount,restrictions:{source:restrictionRelations,valid,supported,unsupported,malformed,unresolved,conditional,vehicleSpecific},structure:{bridge:edges.filter(e=>e.structure&1).length,tunnel:edges.filter(e=>e.structure&2).length,layer:edges.filter(e=>e.layer).length},destinationOnly:edges.filter(e=>e.accessRole===2).length,oneway:edges.filter(e=>e.direction===1).length});sample(`region:${regionId}`)
}

const neighborSets=new Map(regions.map(region=>[region.regionId,new Set()]));
for(const portal of db.prepare('SELECT DISTINCT a.region_id AS a,b.region_id AS b FROM region_nodes a JOIN region_nodes b ON a.node_id=b.node_id WHERE a.region_id<b.region_id').iterate()){neighborSets.get(portal.a)?.add(portal.b);neighborSets.get(portal.b)?.add(portal.a)}
for(const region of regions)region.neighbors=[...neighborSets.get(region.regionId)].sort();
const sourceHash=shaFile(SOURCE),manifest={schemaVersion:1,datasetId:`osm-tr-33-${sourceHash.slice(0,12)}`,country:'TR',source:'OpenStreetMap / Geofabrik Turkey extract; Mersin relation 223131',sourceTimestamp:'2026-09-06T19:53:37Z',buildTimestamp:new Date().toISOString(),policyVersion:'2b4f5de8',graphFormat:'RTG3',regions:regions.map(({classCount,restrictions,structure,destinationOnly,oneway,...region})=>region)};
writeFileSync(resolve(RUN,'turkey-graph-manifest.json'),JSON.stringify(manifest,null,2));
const supportedIds=new Set(restrictionEvidence.map(r=>r.relationId)),restrictionStats={observed:0,valid:0,supported:0,unsupported:0,malformed:0,unresolved:0,conditional:0,vehicleSpecific:0,viaWay:0},hasWay=db.prepare('SELECT 1 FROM ways WHERE id=?');
for(const relation of db.prepare('SELECT * FROM restrictions ORDER BY id').iterate()){restrictionStats.observed++;if(relation.member_state!=='VALID'){restrictionStats.malformed++;continue}restrictionStats.valid++;if(relation.conditional){restrictionStats.conditional++;restrictionStats.unsupported++;continue}if(relation.except_tag){restrictionStats.vehicleSpecific++;restrictionStats.unsupported++;continue}if(relation.via_way){restrictionStats.viaWay++;restrictionStats.unsupported++;continue}if(!RESTRICTION[relation.type]){restrictionStats.unsupported++;continue}if(!hasWay.get(relation.from_way)||!hasWay.get(relation.to_way)){restrictionStats.unresolved++;continue}if(supportedIds.has(relation.id))restrictionStats.supported++;else restrictionStats.unresolved++}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');sample('complete');clearInterval(timer);
const summary={source:{file:relative(RUN,SOURCE),bytes:statSync(SOURCE).size,sha256:sourceHash,provider:'Geofabrik/OpenStreetMap',coverage:'Mersin province relation 223131'},parser:'osmium-tool + node:sqlite',strategy:'SQLite-indexed two-pass PBF stream; sequential deterministic 0.5 degree RTG3 partitions',memoryBudgetMiB:MEMORY_BUDGET_MIB,selectedWays,deniedWays,requiredCoordinates,restrictionRelations,restrictionStats,regions,totalNodes:regions.reduce((n,r)=>n+r.nodeCount,0),totalEdges:regions.reduce((n,r)=>n+r.edgeCount,0),totalBytes:regions.reduce((n,r)=>n+r.byteSize,0),tempBytes:tempBytes(),peakTempBytes:Math.max(...telemetry.map(x=>x.tempDisk)),buildMs:performance.now()-started,peakNodeRssBytes:Math.max(...telemetry.map(x=>x.nodeRss)),peakProcessTreeRssBytes:Math.max(...telemetry.map(x=>x.processTreeRss)),telemetry,restrictionEvidence:restrictionEvidence.slice(0,50)};
db.close();
writeFileSync(resolve(RUN,'benchmark.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));

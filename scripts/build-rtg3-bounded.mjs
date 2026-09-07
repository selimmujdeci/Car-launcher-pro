import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { classifyDrivableWay } from './routingGraphPolicy.mjs';

const OUT = resolve('field-runs/routing-graph-v3-20260907');
const RAW = resolve(OUT, 'raw');
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AOIS = {
  tarsus: [34.85985, 36.9157, 34.86435, 36.9193],
  mersin: [34.6304, 36.8093, 34.6374, 36.8149],
  erdemli: [34.29, 36.6318, 34.298, 36.6382],
};
const OLD = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const NEW = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road']);
const CLASS = { motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5, unclassified: 6, residential: 7, living_street: 8, service: 9, road: 9 };
const RESTRICTION = { no_left_turn: 1, no_right_turn: 2, no_straight_on: 3, no_u_turn: 4, only_left_turn: 5, only_right_turn: 6, only_straight_on: 7 };
const RTG3_MAGIC = 0x33475452, NODE_STRIDE = 16, EDGE_STRIDE = 28, RESTRICTION_STRIDE = 16;

const sha = (b) => createHash('sha256').update(b).digest('hex');
const hav = (a, b) => { const r=6371000,p=Math.PI/180,d1=(b[0]-a[0])*p,d2=(b[1]-a[1])*p; const q=Math.sin(d1/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin(d2/2)**2; return r*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)); };

async function source(name, bbox) {
  mkdirSync(RAW, { recursive: true });
  const path = resolve(RAW, `${name}-overpass.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const [w,s,e,n] = bbox;
  const q = `[out:json][timeout:60];(way["highway"](${s},${w},${n},${e});relation["type"="restriction"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  let text = null, status = null;
  for (const endpoint of OVERPASS) {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CarOSPro-RTG3-bounded/1.0' }, body: `data=${encodeURIComponent(q)}` });
    status = res.status;
    if (res.ok) { text = await res.text(); break; }
  }
  if (text === null) throw new Error(`${name}: Overpass HTTP ${status}`);
  writeFileSync(path, text);
  return JSON.parse(text);
}

function build(data, allowed) {
  const nodes = new Map(), ways = [], relations = [];
  for (const el of data.elements ?? []) {
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) nodes.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way') ways.push(el);
    else if (el.type === 'relation' && el.tags?.type === 'restriction') relations.push(el);
  }
  const used = new Map(), coords = [], edges = [], classCount = {};
  const idx = (id) => { if (used.has(id)) return used.get(id); const p=nodes.get(id); if(!p)return null; const i=coords.length; used.set(id,i); coords.push(p); return i; };
  for (const way of ways) {
    const decision = classifyDrivableWay(way.tags ?? {}, allowed);
    if (!decision) continue;
    const highway = way.tags.highway.endsWith('_link') ? way.tags.highway.slice(0,-5) : way.tags.highway;
    const cls = CLASS[highway] ?? (way.tags.highway.endsWith('_link') ? 2 : 0);
    const o = String(way.tags.oneway ?? '').toLowerCase();
    const reversed = o === '-1' || o === 'reverse';
    const direction = o === 'yes'||o==='true'||o==='1'||reversed||highway==='motorway'||way.tags.highway.endsWith('_link')||way.tags.junction==='roundabout' ? 1 : 0;
    const accessRole = decision.role === 'DESTINATION_ACCESS_ONLY' ? 2 : 1;
    const structure = (way.tags.bridge && way.tags.bridge !== 'no' ? 1 : 0) | (way.tags.tunnel && way.tags.tunnel !== 'no' ? 2 : 0);
    const layer = Math.max(-128, Math.min(127, Number.parseInt(way.tags.layer ?? '0',10)||0));
    for (let i=1;i<(way.nodes?.length??0);i++) {
      let a=idx(way.nodes[i-1]), b=idx(way.nodes[i]); if(a===null||b===null||a===b)continue;
      if(reversed){const t=a;a=b;b=t;}
      const cost=Math.max(1,Math.round(hav(coords[a],coords[b])));
      edges.push({from:a,to:b,cost,wayId:way.id,cls,accessRole,direction,structure,layer});
      classCount[highway]=(classCount[highway]??0)+1;
    }
  }
  const restrictions=[]; let unsupported=0,malformed=0;
  for(const rel of relations){const type=RESTRICTION[rel.tags?.restriction];if(!type){unsupported++;continue;} const from=rel.members?.find(m=>m.role==='from'&&m.type==='way')?.ref; const to=rel.members?.find(m=>m.role==='to'&&m.type==='way')?.ref; const viaId=rel.members?.find(m=>m.role==='via'&&m.type==='node')?.ref; const via=used.get(viaId); if(from==null||to==null||via==null){malformed++;continue;} const ins=edges.map((e,i)=>({e,i})).filter(x=>x.e.wayId===from&&(x.e.to===via||x.e.direction===0&&x.e.from===via)); const outs=edges.map((e,i)=>({e,i})).filter(x=>x.e.wayId===to&&(x.e.from===via||x.e.direction===0&&x.e.to===via)); if(!ins.length||!outs.length){malformed++;continue;} for(const a of ins)for(const b of outs)restrictions.push({fromEdge:a.i,toEdge:b.i,viaNode:via,type});}
  return {coords,edges,restrictions,classCount,restrictionStats:{source:relations.length,supported:restrictions.length,unsupported,malformed}};
}

function serialize(g){const size=16+g.coords.length*NODE_STRIDE+g.edges.length*EDGE_STRIDE+g.restrictions.length*RESTRICTION_STRIDE;const b=Buffer.alloc(size);let o=0;b.writeUInt32LE(RTG3_MAGIC,o);o+=4;b.writeUInt32LE(g.coords.length,o);o+=4;b.writeUInt32LE(g.edges.length,o);o+=4;b.writeUInt32LE(g.restrictions.length,o);o+=4;for(const p of g.coords){b.writeFloatLE(p[0],o);b.writeFloatLE(p[1],o+4);o+=NODE_STRIDE;}for(const e of g.edges){b.writeUInt32LE(e.from,o);b.writeUInt32LE(e.to,o+4);b.writeUInt32LE(e.cost,o+8);b.writeBigUInt64LE(BigInt(e.wayId),o+12);b[o+20]=e.cls;b[o+21]=e.accessRole;b[o+22]=e.direction;b[o+23]=e.structure;b.writeInt8(e.layer,o+24);o+=EDGE_STRIDE;}for(const r of g.restrictions){b.writeUInt32LE(r.fromEdge,o);b.writeUInt32LE(r.toEdge,o+4);b.writeUInt32LE(r.viaNode,o+8);b[o+12]=r.type;o+=RESTRICTION_STRIDE;}return b;}
const percentile=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))]??null;};
function loadMetrics(b){const times=[];for(let k=0;k<100;k++){const t=performance.now(),v=new DataView(b.buffer,b.byteOffset,b.byteLength),n=v.getUint32(4,true),e=v.getUint32(8,true),r=v.getUint32(12,true);let checksum=0,o=16+n*NODE_STRIDE;for(let i=0;i<e;i++){checksum^=v.getUint32(o,true);o+=EDGE_STRIDE;}for(let i=0;i<r;i++){checksum^=v.getUint32(o,true);o+=RESTRICTION_STRIDE;}if(o!==b.length||checksum<0)throw new Error('RTG3 load doğrulaması düştü');times.push(performance.now()-t);}return{p50Ms:percentile(times,.5),p95Ms:percentile(times,.95)};}

function topology(g){const adj=Array.from({length:g.coords.length},()=>[]), degree=new Uint32Array(g.coords.length);let selfLoops=0,zero=0,duplicate=0;const seen=new Set();for(let i=0;i<g.edges.length;i++){const e=g.edges[i];if(e.from===e.to)selfLoops++;if(e.cost<=0)zero++;const k=`${e.from}:${e.to}:${e.wayId}`;if(seen.has(k))duplicate++;seen.add(k);adj[e.from].push(e.to);degree[e.from]++;degree[e.to]++;if(e.direction===0)adj[e.to].push(e.from);}const seenN=new Uint8Array(g.coords.length),sizes=[];for(let s=0;s<g.coords.length;s++){if(seenN[s])continue;let q=[s],z=0;seenN[s]=1;while(q.length){const u=q.pop();z++;for(const v of adj[u])if(!seenN[v]){seenN[v]=1;q.push(v);}}sizes.push(z);}sizes.sort((a,b)=>b-a);return{components:sizes.length,largestComponentPct:g.coords.length?100*(sizes[0]??0)/g.coords.length:0,deadEnds:[...degree].filter(x=>x===1).length,selfLoops,zeroLength:zero,duplicateEdges:duplicate,invalidReferences:g.edges.filter(e=>e.from>=g.coords.length||e.to>=g.coords.length).length,oneway:g.edges.filter(e=>e.direction===1).length,destinationOnly:g.edges.filter(e=>e.accessRole===2).length,bridges:g.edges.filter(e=>e.structure&1).length,tunnels:g.edges.filter(e=>e.structure&2).length,layered:g.edges.filter(e=>e.layer!==0).length};}

function nearest(g,p){let bi=-1,bd=Infinity;for(let i=0;i<g.coords.length;i++){const d=hav(p,g.coords[i]);if(d<bd){bd=d;bi=i;}}return{idx:bi,error:bd};}
function route(g,start,goal){if(start<0||goal<0)return null;const adj=Array.from({length:g.coords.length},()=>[]);g.edges.forEach((e,i)=>{adj[e.from].push({to:e.to,e:i});if(e.direction===0)adj[e.to].push({to:e.from,e:i});});const only=new Set([5,6,7]),no=new Set([1,2,3,4]);const byPair=new Map(g.restrictions.map(r=>[`${r.fromEdge}:${r.toEdge}`,r.type]));const q=[[0,start,-1]],dist=new Map([[`${start}:-1`,0]]),prev=new Map(),t0=performance.now();let expanded=0,last=null;while(q.length){q.sort((a,b)=>a[0]-b[0]);const [d,u,pe]=q.shift();const key=`${u}:${pe}`;if(d!==dist.get(key))continue;if(u===goal){last=key;break;}expanded++;for(const x of adj[u]){const typ=byPair.get(`${pe}:${x.e}`);if(no.has(typ))continue;if(pe>=0&&g.restrictions.some(r=>r.fromEdge===pe&&only.has(r.type))&&!only.has(typ))continue;const edge=g.edges[x.e];if(edge.accessRole===2&&x.to!==goal)continue;const nd=d+edge.cost+(edge.accessRole===2?edge.cost*20:0);const nk=`${x.to}:${x.e}`;if(nd<(dist.get(nk)??Infinity)){dist.set(nk,nd);prev.set(nk,key);q.push([nd,x.to,x.e]);}}}return last?{distance:dist.get(last),latencyMs:performance.now()-t0,expanded}:null;}

function corpus(oldG,newG){const candidates=newG.edges.filter(e=>e.cls>=5&&e.accessRole===1).sort((a,b)=>b.cost-a.cost).slice(0,7);return candidates.map((e,i)=>{const target=newG.coords[e.to],origin=newG.coords[e.from],on=nearest(oldG,origin),od=nearest(oldG,target),nn=nearest(newG,origin),nd=nearest(newG,target);const oldRuns=[],newRuns=[];for(let j=0;j<50;j++){const a=route(oldG,on.idx,od.idx),b=route(newG,nn.idx,nd.idx);if(a)oldRuns.push(a);if(b)newRuns.push(b);}const ro=oldRuns[0]??null,rn=newRuns[0]??null;return{scenario:`REAL_LOCAL_${i+1}`,sourceWayId:e.wayId,oldEndpointErrorM:Number.isFinite(od.error)?od.error:null,newEndpointErrorM:Number.isFinite(nd.error)?nd.error:null,oldRouteM:ro?.distance??null,newRouteM:rn?.distance??null,oldLatencyP50Ms:percentile(oldRuns.map(x=>x.latencyMs),.5),oldLatencyP95Ms:percentile(oldRuns.map(x=>x.latencyMs),.95),newLatencyP50Ms:percentile(newRuns.map(x=>x.latencyMs),.5),newLatencyP95Ms:percentile(newRuns.map(x=>x.latencyMs),.95),oldExpanded:ro?.expanded??null,newExpanded:rn?.expanded??null};});}

mkdirSync(OUT,{recursive:true});const summary={generatedAt:new Date().toISOString(),source:'OpenStreetMap via official Overpass API',policyVersion:'2b4f5de8',format:{magic:'RTG3',nodeStride:NODE_STRIDE,edgeStride:EDGE_STRIDE,restrictionStride:RESTRICTION_STRIDE},aois:{}};
for(const [name,bbox] of Object.entries(AOIS)){const t=performance.now(),data=await source(name,bbox),raw=readFileSync(resolve(RAW,`${name}-overpass.json`));const oldG=build(data,OLD),newG=build(data,NEW),oldB=serialize(oldG),newB=serialize(newG);writeFileSync(resolve(OUT,`${name}-old.rtg3`),oldB);writeFileSync(resolve(OUT,`${name}-full.rtg3`),newB);const p0=performance.now();build(data,NEW);const parseBuildMs=performance.now()-p0;summary.aois[name]={bbox,sourceSha256:sha(raw),sourceElements:data.elements?.length??0,sourceTimestamp:data.osm3s?.timestamp_osm_base??null,old:{nodes:oldG.coords.length,edges:oldG.edges.length,bytes:oldB.length,load:loadMetrics(oldB),topology:topology(oldG)},full:{nodes:newG.coords.length,edges:newG.edges.length,bytes:newB.length,load:loadMetrics(newB),classCount:newG.classCount,restrictions:newG.restrictionStats,topology:topology(newG),buildMs:parseBuildMs},routes:corpus(oldG,newG),elapsedMs:performance.now()-t};}
writeFileSync(resolve(OUT,'benchmark.json'),JSON.stringify(summary,null,2));writeFileSync(resolve(OUT,'provenance.json'),JSON.stringify({source:summary.source,retrievedAt:summary.generatedAt,aois:Object.fromEntries(Object.entries(summary.aois).map(([k,v])=>[k,{bbox:v.bbox,sha256:v.sourceSha256,osmTimestamp:v.sourceTimestamp}])),buildCommand:'node scripts/build-rtg3-bounded.mjs',policyVersion:summary.policyVersion},null,2));
console.log(JSON.stringify(summary,null,2));

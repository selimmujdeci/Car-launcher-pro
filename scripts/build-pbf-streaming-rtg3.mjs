import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { classifyDrivableWay, onewaySemantics, ROUTABLE_HIGHWAYS } from './routingGraphPolicy.mjs';

const root=resolve('field-runs/pbf-streaming-rtg3-20260908');
const source=resolve(process.argv[2]??resolve(root,'raw/mersin-province.osm.pbf'));
const tmp=resolve(root,'tmp'), out=resolve(root,'regions'); mkdirSync(tmp,{recursive:true});mkdirSync(out,{recursive:true});
const OSMIUM=process.env.OSMIUM??'osmium', TILE=.5;
const allowed=new Set(ROUTABLE_HIGHWAYS), classes={motorway:1,trunk:2,primary:3,secondary:4,tertiary:5,unclassified:6,residential:7,living_street:8,service:9,road:9};
const restrictionTypes={no_left_turn:1,no_right_turn:2,no_straight_on:3,no_u_turn:4,only_left_turn:5,only_right_turn:6,only_straight_on:7};
const rss=[];const sampler=setInterval(()=>rss.push(process.memoryUsage().rss),25);rss.push(process.memoryUsage().rss);const started=performance.now();
const shaFile=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor((s.length-1)*p)]??null};
const decode=s=>s.replace(/%([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/%([^0-9A-Fa-f]|$)/g,'$1');
const tags=s=>Object.fromEntries((s??'').split(',').filter(Boolean).map(x=>{const i=x.indexOf('=');return[decode(i<0?x:x.slice(0,i)),decode(i<0?'':x.slice(i+1))]}));
const field=(line,key)=>{const m=line.match(new RegExp(`(?:^| )${key}([^ ]*)`));return m?.[1]??''};
const runLines=async(args,onLine)=>{const cp=spawn(OSMIUM,args,{stdio:['ignore','pipe','pipe']});const closed=once(cp,'close');let err='';cp.stderr.on('data',b=>err+=b);for await(const line of createInterface({input:cp.stdout,crlfDelay:Infinity}))await onLine(line);const [code]=await closed;if(code)throw new Error(`${OSMIUM} ${args[0]} (${code}): ${err}`)};
const writeLine=async(stream,line)=>{if(!stream.write(line+'\n'))await once(stream,'drain')};

const waysFile=resolve(tmp,'selected-ways.ndjson'),relsFile=resolve(tmp,'restrictions.ndjson'),idsFile=resolve(tmp,'required-node-ids.txt'),nodesFile=resolve(tmp,'required-nodes.ndjson');
const ws=createWriteStream(waysFile),rs=createWriteStream(relsFile),is=createWriteStream(idsFile);let selected=0,denied=0,relationSource=0;
await runLines(['tags-filter','-R',source,'w/highway','r/type=restriction','-f','opl','-o','-'],async line=>{
  if(line[0]==='w'){
    const t=tags(field(line,'T')),decision=classifyDrivableWay(t,allowed);if(!decision){denied++;return;}
    const nodeIds=field(line,'N').split(',').filter(Boolean).map(x=>Number(x.slice(1)));if(nodeIds.length<2)return;
    await writeLine(ws,JSON.stringify({id:Number(line.slice(1,line.indexOf(' '))),tags:t,nodeIds,role:decision.role}));for(const id of nodeIds)await writeLine(is,`n${id}`);selected++;
  } else if(line[0]==='r'){
    relationSource++;const t=tags(field(line,'T')),members=field(line,'M').split(',').filter(Boolean).map(x=>{const [ref,role='']=x.split('@');return{type:{n:'node',w:'way',r:'relation'}[ref[0]],ref:Number(ref.slice(1)),role:decode(role)}});await writeLine(rs,JSON.stringify({id:Number(line.slice(1,line.indexOf(' '))),tags:t,members}));
  }
});ws.end();rs.end();is.end();await Promise.all([once(ws,'finish'),once(rs,'finish'),once(is,'finish')]);

const ns=createWriteStream(nodesFile);let requiredNodes=0;
await runLines(['getid',source,'-i',idsFile,'-f','opl','-o','-'],async line=>{if(line[0]!=='n')return;const x=Number(field(line,'x')),y=Number(field(line,'y'));if(Number.isFinite(x)&&Number.isFinite(y)){await writeLine(ns,JSON.stringify({id:Number(line.slice(1,line.indexOf(' '))),lat:y,lon:x}));requiredNodes++;}});ns.end();await once(ns,'finish');

const nodeMap=new Map();for await(const line of createInterface({input:createReadStream(nodesFile)})){const n=JSON.parse(line);nodeMap.set(n.id,[n.lat,n.lon]);}
const tileId=(lat,lon)=>`tr-33-${Math.floor(lon/TILE)}-${Math.floor(lat/TILE)}`;
const buckets=new Map();const bucket=id=>{if(!buckets.has(id))buckets.set(id,{ways:[],nodes:new Set()});return buckets.get(id)};
for await(const line of createInterface({input:createReadStream(waysFile)})){const w=JSON.parse(line),ids=new Set(w.nodeIds.map(id=>nodeMap.get(id)).filter(Boolean).map(p=>tileId(p[0],p[1])));for(const id of ids){const b=bucket(id);b.ways.push(w);w.nodeIds.forEach(n=>b.nodes.add(n));}}
const relations=readFileSync(relsFile,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const hav=(a,b)=>{const p=Math.PI/180,d1=(b[0]-a[0])*p,d2=(b[1]-a[1])*p,q=Math.sin(d1/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin(d2/2)**2;return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))};
function build(b){const used=new Map(),coords=[],nodeIds=[],edges=[],classCount={};const idx=id=>{if(used.has(id))return used.get(id);const p=nodeMap.get(id);if(!p)return null;const i=coords.length;used.set(id,i);coords.push(p);nodeIds.push(id);return i};for(const w of b.ways){const raw=w.tags.highway,base=raw.endsWith('_link')?raw.slice(0,-5):raw,d=onewaySemantics(w.tags.oneway,raw,w.tags.junction),accessRole=w.role==='DESTINATION_ACCESS_ONLY'?2:1,structure=(w.tags.bridge&&w.tags.bridge!=='no'?1:0)|(w.tags.tunnel&&w.tags.tunnel!=='no'?2:0),layer=Math.max(-128,Math.min(127,parseInt(w.tags.layer??'0',10)||0));for(let i=1;i<w.nodeIds.length;i++){let a=idx(w.nodeIds[i-1]),z=idx(w.nodeIds[i]);if(a==null||z==null||a===z)continue;if(d.reversed)[a,z]=[z,a];edges.push({from:a,to:z,cost:Math.max(1,Math.round(hav(coords[a],coords[z]))),wayId:w.id,cls:classes[base]??9,accessRole,direction:d.oneway?1:0,structure,layer});classCount[base]=(classCount[base]??0)+1;}}
 const restrictions=[];let unsupported=0,malformed=0;for(const r of relations){const type=restrictionTypes[r.tags.restriction];if(!type){unsupported++;continue}const fw=r.members.find(m=>m.role==='from'&&m.type==='way')?.ref,tw=r.members.find(m=>m.role==='to'&&m.type==='way')?.ref,via=used.get(r.members.find(m=>m.role==='via'&&m.type==='node')?.ref);if(fw==null||tw==null||via==null){malformed++;continue}const ins=edges.map((e,i)=>[e,i]).filter(([e])=>e.wayId===fw&&(e.to===via||!e.direction&&e.from===via)),outs=edges.map((e,i)=>[e,i]).filter(([e])=>e.wayId===tw&&(e.from===via||!e.direction&&e.to===via));if(!ins.length||!outs.length){malformed++;continue}for(const a of ins)for(const z of outs)restrictions.push({fromEdge:a[1],toEdge:z[1],viaNode:via,type});}return{coords,nodeIds,edges,restrictions,classCount,restrictionStats:{source:relationSource,supported:restrictions.length,unsupported,malformed}}}
function serialize(g){const b=Buffer.alloc(16+g.coords.length*16+g.edges.length*28+g.restrictions.length*16);b.writeUInt32LE(0x33475452,0);b.writeUInt32LE(g.coords.length,4);b.writeUInt32LE(g.edges.length,8);b.writeUInt32LE(g.restrictions.length,12);let o=16;g.coords.forEach((p,i)=>{b.writeFloatLE(p[0],o);b.writeFloatLE(p[1],o+4);b.writeBigUInt64LE(BigInt(g.nodeIds[i]),o+8);o+=16});for(const e of g.edges){b.writeUInt32LE(e.from,o);b.writeUInt32LE(e.to,o+4);b.writeUInt32LE(e.cost,o+8);b.writeBigUInt64LE(BigInt(e.wayId),o+12);b[o+20]=e.cls;b[o+21]=e.accessRole;b[o+22]=e.direction;b[o+23]=e.structure;b.writeInt8(e.layer,o+24);o+=28}for(const r of g.restrictions){b.writeUInt32LE(r.fromEdge,o);b.writeUInt32LE(r.toEdge,o+4);b.writeUInt32LE(r.viaNode,o+8);b[o+12]=r.type;o+=16}return b}
const regionNodeIds=new Map(),regions=[];for(const [id,b] of [...buckets].sort(([a],[z])=>a.localeCompare(z))){const g=build(b),bin=serialize(g),file=`${id}.rtg3`,path=resolve(out,file);writeFileSync(path,bin);regionNodeIds.set(id,g.nodeIds);const [, ,x,y]=id.split('-').map(Number);regions.push({regionId:id,bbox:[x*TILE,y*TILE,(x+1)*TILE,(y+1)*TILE],graphFile:`regions/${file}`,sha256:createHash('sha256').update(bin).digest('hex'),byteSize:bin.length,nodeCount:g.coords.length,edgeCount:g.edges.length,neighbors:[],sourceHash:shaFile(source),classCount:g.classCount,restrictions:g.restrictionStats,structure:{bridge:g.edges.filter(e=>e.structure&1).length,tunnel:g.edges.filter(e=>e.structure&2).length,layer:g.edges.filter(e=>e.layer).length},destinationOnly:g.edges.filter(e=>e.accessRole===2).length,oneway:g.edges.filter(e=>e.direction===1).length});}
const owners=new Map();for(const [regionId,ids]of regionNodeIds)for(const id of ids){const list=owners.get(id)??[];list.push(regionId);owners.set(id,list)}const neighborSets=new Map(regions.map(r=>[r.regionId,new Set()]));for(const list of owners.values())if(list.length>1)for(const a of list)for(const z of list)if(a!==z)neighborSets.get(a).add(z);for(const r of regions)r.neighbors=[...neighborSets.get(r.regionId)].sort();
const manifest={schemaVersion:1,datasetId:`osm-tr-33-${shaFile(source).slice(0,12)}`,country:'TR',source:'OpenStreetMap / Geofabrik Turkey extract; Mersin relation 223131',sourceTimestamp:'2026-09-06T19:53:37Z',buildTimestamp:new Date().toISOString(),policyVersion:'2b4f5de8',graphFormat:'RTG3',regions:regions.map(({classCount,restrictions,structure,destinationOnly,oneway,...r})=>r)};writeFileSync(resolve(root,'turkey-graph-manifest.json'),JSON.stringify(manifest,null,2));
clearInterval(sampler);rss.push(process.memoryUsage().rss);const tempBytes=[waysFile,relsFile,idsFile,nodesFile].reduce((n,p)=>n+statSync(p).size,0),summary={source:{file:relative(root,source),bytes:statSync(source).size,sha256:shaFile(source),provider:'Geofabrik/OpenStreetMap',coverage:'Mersin province relation 223131'},parser:`osmium-tool ${OSMIUM}`,strategy:'PBF stream pass 1 ways/restrictions + disk ID ledger; PBF pass 2 required nodes; bounded 0.5 degree partitions',selectedWays:selected,deniedWays:denied,requiredNodes,relationSource,regions,totalNodes:regions.reduce((n,r)=>n+r.nodeCount,0),totalEdges:regions.reduce((n,r)=>n+r.edgeCount,0),totalBytes:regions.reduce((n,r)=>n+r.byteSize,0),tempBytes,buildMs:performance.now()-started,peakRssBytes:Math.max(...rss),rssSamples:rss.length};writeFileSync(resolve(root,'benchmark.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));

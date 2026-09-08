import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { edgeAccessRole, parseRoutingGraph, turnIsAllowed, type RoutingGraphView } from '../src/platform/navigation/map/graph/rtg2Reader';
import { acquireRegionalRoutingGraph, releaseRoutingGraph, _resetGraphResidencyForTest } from '../src/platform/navigation/map/graph/graphResidencyRuntime';
import { validateTurkeyGraphManifest, type TurkeyGraphManifest } from '../src/platform/navigation/map/graph/turkeyGraphManifest';

const root=resolve('field-runs/pbf-streaming-rtg3-20260908');
const manifest=validateTurkeyGraphManifest(JSON.parse(readFileSync(resolve(root,'turkey-graph-manifest.json'),'utf8')))!;
if(!manifest)throw new Error('Manifest geçersiz');
const buffers=new Map(manifest.regions.map(r=>[r.graphFile,readFileSync(resolve(root,r.graphFile))]));
globalThis.fetch=(async(input:RequestInfo|URL)=>{const key=String(input).replace(/^.*\/regions\//,'regions/'),data=buffers.get(key);return data?new Response(data):new Response(null,{status:404});}) as typeof fetch;

type Posted={type:string;requestId?:string;geometry?:[number,number][];distanceM?:number;durationS?:number;reason?:string};
const posted:Posted[]=[];
const workerSelf={navigator:{deviceMemory:8},postMessage:(message:Posted)=>posted.push(message),close:()=>{},onmessage:null as ((event:MessageEvent)=>void)|null};
Object.assign(globalThis,{self:workerSelf});
await import('../src/platform/navigation/NavigationCompute.worker');

const rawView=(regionId:string)=>{const region=manifest.regions.find(r=>r.regionId===regionId)!,buffer=buffers.get(region.graphFile)!;const parsed=parseRoutingGraph(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer);if(!parsed.view)throw new Error(regionId);return parsed.view};
const inside=(region:TurkeyGraphManifest['regions'][number],lat:number,lon:number)=>lon>region.bbox[0]+.01&&lon<region.bbox[2]-.01&&lat>region.bbox[1]+.01&&lat<region.bbox[3]-.01;
const point=(regionId:string,local:boolean)=>{const region=manifest.regions.find(r=>r.regionId===regionId)!,view=rawView(regionId);for(let i=0;i<view.edgeCount;i++){if(local&&view.edgeRoadClassV3[i]<6)continue;const n=view.edgeFrom[i];if(inside(region,view.nodeLat[n],view.nodeLon[n]))return[view.nodeLat[n],view.nodeLon[n]] as const;}for(let i=0;i<view.edgeCount;i++){if(local&&view.edgeRoadClassV3[i]<6)continue;const n=view.edgeFrom[i];return[view.nodeLat[n],view.nodeLon[n]] as const;}throw new Error(`${regionId}: yol noktası yok`)};
const chains:string[][]=[];for(const a of manifest.regions)for(const b of a.neighbors)for(const c of manifest.regions.find(r=>r.regionId===b)?.neighbors??[])if(c!==a.regionId)chains.push([a.regionId,b,c]);
const chain=chains[0];if(!chain)throw new Error(`Üç region zinciri yok: ${manifest.regions.map(r=>`${r.regionId}:${r.neighbors.length}`).join(',')}`);

async function install(ids:string[]):Promise<RoutingGraphView>{_resetGraphResidencyForTest();const view=await acquireRegionalRoutingGraph(manifest,ids,'/fixture');if(!view)throw new Error(`Residency düştü: ${ids}`);const requestId=`install-${ids.join('-')}`;workerSelf.onmessage!({data:{type:'INSTALL_REGIONAL_GRAPH',requestId,graphView:view}} as MessageEvent);if(!posted.splice(0).some(m=>m.type==='GRAPH_INSTALLED'&&m.requestId===requestId))throw new Error('Worker install düştü');return view}
async function route(name:string,ids:string[],from:readonly[number,number],to:readonly[number,number]){const view=await install(ids),requestId=`route-${name}`,start=performance.now();workerSelf.onmessage!({data:{type:'COMPUTE_ROUTE',requestId,fromLat:from[0],fromLon:from[1],toLat:to[0],toLon:to[1]}} as MessageEvent);for(let i=0;i<500&&!posted.some(m=>m.requestId===requestId);i++)await new Promise(r=>setTimeout(r,2));const result=posted.splice(0).find(m=>m.requestId===requestId);releaseRoutingGraph();if(result?.type!=='ROUTE_RESULT'||!result.geometry||!result.distanceM)throw new Error(`${name}: ${result?.reason??'rota yok'}`);const endpoint=result.geometry.at(-1)!,endpointError=Math.hypot((endpoint[1]-to[0])*111_000,(endpoint[0]-to[1])*90_000),nodeByCoordinate=new Map<string,number>(),edgeByPair=new Map<string,number>();for(let i=0;i<view.nodeCount;i++)nodeByCoordinate.set(`${view.nodeLat[i]},${view.nodeLon[i]}`,i);for(let i=0;i<view.edgeCount;i++){edgeByPair.set(`${view.edgeFrom[i]}:${view.edgeTo[i]}`,i);if(view.edgeDirection[i]===0)edgeByPair.set(`${view.edgeTo[i]}:${view.edgeFrom[i]}`,i)}let previousEdge=-1,accessLegal=true,onewayLegal=true,restrictionLegal=true;for(let i=1;i<result.geometry.length;i++){const a=nodeByCoordinate.get(`${result.geometry[i-1][1]},${result.geometry[i-1][0]}`),b=nodeByCoordinate.get(`${result.geometry[i][1]},${result.geometry[i][0]}`);if(a===undefined||b===undefined){onewayLegal=false;continue}const edge=edgeByPair.get(`${a}:${b}`)??-1;if(edge<0){onewayLegal=false;continue}if(edgeAccessRole(view,edge)!==1&&!(i===result.geometry.length-1&&edgeAccessRole(view,edge)===2))accessLegal=false;if(!turnIsAllowed(view,previousEdge,edge,a))restrictionLegal=false;previousEdge=edge}return{name,regions:ids,origin:from,destination:to,distanceM:result.distanceM,solveMs:performance.now()-start,endpointErrorM:endpointError,accessLegal,onewayLegal,restrictionLegal,nodeCount:view.nodeCount,edgeCount:view.edgeCount}}

const two=chain.slice(0,2),routes=[];
routes.push(await route('cross-region-arterial-to-residential',two,point(two[0],false),point(two[1],true)));
routes.push(await route('cross-region-residential-to-residential',two,point(two[0],true),point(two[1],true)));
routes.push(await route('three-region-local-to-arterial',chain,point(chain[0],true),point(chain[2],false)));

const buildEvidence=JSON.parse(readFileSync(resolve(root,'benchmark.json'),'utf8')) as {restrictionEvidence:Array<{relationId:number;restrictionType:string;regionId:string;viaNodeId:number;fromEdge:number;toEdge:number}>};
const actual=buildEvidence.restrictionEvidence.find(item=>item.restrictionType.startsWith('no_'));
if(!actual)throw new Error('Gerçek no_* restriction evidence yok');
const restrictionView=rawView(actual.regionId),via=[...restrictionView.nodeSourceId].findIndex(id=>id===BigInt(actual.viaNodeId));
const from=restrictionView.edgeFrom[actual.fromEdge]===via?restrictionView.edgeTo[actual.fromEdge]:restrictionView.edgeFrom[actual.fromEdge];
const to=restrictionView.edgeFrom[actual.toEdge]===via?restrictionView.edgeTo[actual.toEdge]:restrictionView.edgeFrom[actual.toEdge];
let restrictionRoute:null|Awaited<ReturnType<typeof route>>=null,restrictionRouteError:null|string=null;
try{restrictionRoute=await route('real-no-restriction-enforcement',[actual.regionId],[restrictionView.nodeLat[from],restrictionView.nodeLon[from]],[restrictionView.nodeLat[to],restrictionView.nodeLon[to]]);routes.push(restrictionRoute)}catch(error){restrictionRouteError=error instanceof Error?error.message:String(error)}
const realRestriction={...actual,rtg3DirectTurnAllowed:turnIsAllowed(restrictionView,actual.fromEdge,actual.toEdge,via),canonicalRouteFound:restrictionRoute!==null,canonicalRouteLegal:restrictionRoute?.restrictionLegal??true,canonicalOutcome:restrictionRoute?'LEGAL_ALTERNATE_ROUTE':'FORBIDDEN_DIRECT_TURN_NO_ALTERNATE',detail:restrictionRouteError};

const failures=[];
const originalFetch=globalThis.fetch;
async function expectFail(name:string,value:unknown,ids:string[]){_resetGraphResidencyForTest();const view=await acquireRegionalRoutingGraph(value,ids,'/fixture');failures.push({name,rejected:view===null});releaseRoutingGraph()}
const brokenNeighbor=structuredClone(manifest) as TurkeyGraphManifest;(brokenNeighbor.regions[0].neighbors as string[]).push('missing');await expectFail('manifest-missing-neighbor',brokenNeighbor,[chain[0]]);
const shaMismatch=structuredClone(manifest) as TurkeyGraphManifest;(shaMismatch.regions.find(r=>r.regionId===chain[0]) as {sha256:string}).sha256='0'.repeat(64);await expectFail('sha-mismatch',shaMismatch,[chain[0]]);
globalThis.fetch=(async()=>new Response(new Uint8Array([1,2,3]))) as typeof fetch;await expectFail('corrupt-truncated-rtg3',manifest,[chain[0]]);globalThis.fetch=originalFetch;
await expectFail('missing-required-region',manifest,['tr-33-missing']);
await expectFail('unsupported-manifest-version',{...manifest,schemaVersion:2},[chain[0]]);
const evidence={generatedAt:new Date().toISOString(),chain,routes,failures,realRestriction,restrictionRecordCount:routes.length?Number((await install(chain)).restrictionCount):0};releaseRoutingGraph();writeFileSync(resolve(root,'hardening-validation.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));

/** Same-region OSM baseline + Overture source-family ölçümü. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const regions = [
  { id: 'TARSUS', bbox: [34.85985, 36.9157, 34.86435, 36.9193],
    overture: '../mapdata-ml-accuracy-20260907/../../src/__tests__/fixtures/mapdataTarsusNear.json', fixture: true },
  { id: 'MERSIN', bbox: [34.6304, 36.8093, 34.6374, 36.8149],
    overture: '../mapdata-ml-accuracy-20260907/region2/fixture-r2.json', fixture: true },
  { id: 'ERDEMLI', bbox: [34.29, 36.6318, 34.298, 36.6382],
    overture: '../mapdata-ml-accuracy-20260907/region3/overture-buildings-r3.json', fixture: false },
];

const OSM_ENDPOINT = 'https://api.openstreetmap.org/api/0.6/map';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const OVERTURE_RELEASE = '2026-08-19.0';

const decode = (v) => v.replaceAll('&quot;', '"').replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const attr = (text, name) => new RegExp(`${name}="([^"]*)"`).exec(text)?.[1] ?? null;
const isOsm = (b) => (b.sources ?? []).some((s) => /openstreetmap/i.test(s.dataset ?? '') && s.record_id);
const isMl = (b) => (b.sources ?? []).length > 0
  && (b.sources ?? []).every((s) => /\b(ml|machine learning|open buildings)\b/i.test(s.dataset ?? ''));
function loadOverture(region) {
  const raw = JSON.parse(readFileSync(new URL(region.overture, import.meta.url), 'utf8'));
  const rows = region.fixture ? raw.overtureBuildings : raw.map((r) => ({
    ...r, sources: JSON.parse(r.sources_json), geometry: JSON.parse(r.geojson),
  }));
  return rows;
}
function parseOsm(xml) {
  const nodes = new Map();
  for (const m of xml.matchAll(/<node\b([^>]*)\/?>(?:<\/node>)?/g)) {
    const id=attr(m[1],'id'),lat=Number(attr(m[1],'lat')),lon=Number(attr(m[1],'lon'));
    if(id&&Number.isFinite(lat)&&Number.isFinite(lon))nodes.set(id,[lon,lat]);
  }
  const ways=[];
  for(const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)){
    const tags={};for(const t of m[2].matchAll(/<tag\b([^>]*)\/>/g)){const k=attr(t[1],'k'),v=attr(t[1],'v');if(k&&v!==null)tags[decode(k)]=decode(v);}
    if(!tags.building)continue;
    const refs=[...m[2].matchAll(/<nd\b([^>]*)\/>/g)].map(n=>attr(n[1],'ref')).filter(Boolean);
    const ring=refs.map(r=>nodes.get(r)).filter(Boolean);
    if(ring.length>=4&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1])ways.push({id:`way/${attr(m[1],'id')}`,timestamp:attr(m[1],'timestamp'),ring,tags});
  }
  const relations=[];
  for(const m of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)){
    const tags={};for(const t of m[2].matchAll(/<tag\b([^>]*)\/>/g)){const k=attr(t[1],'k'),v=attr(t[1],'v');if(k&&v!==null)tags[decode(k)]=decode(v);}
    if(tags.building)relations.push({id:`relation/${attr(m[1],'id')}`,timestamp:attr(m[1],'timestamp'),tags});
  }
  return {ways,relations};
}
function sourceFamily(b){if(isOsm(b))return 'OSM_DERIVED';if(isMl(b))return 'ML_DERIVED';return (b.sources??[]).map(s=>s.dataset??'UNKNOWN').sort().join('+')||'UNKNOWN';}
function grouped(values){const out={};for(const v of values)out[v]=(out[v]??0)+1;return out;}
const polygons=(g)=>g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
const allPoints=(g)=>polygons(g).flat(2);
const frame=(lat)=>({x:111195*Math.cos(lat*Math.PI/180),y:111195});
function ringStats(r,f,origin){let a2=0,cx=0,cy=0;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=(r[i][0]-origin[0])*f.x,yi=(r[i][1]-origin[1])*f.y,xj=(r[j][0]-origin[0])*f.x,yj=(r[j][1]-origin[1])*f.y,cross=xj*yi-xi*yj;a2+=cross;cx+=(xj+xi)*cross;cy+=(yj+yi)*cross;}return Math.abs(a2)<1e-12?null:{area:Math.abs(a2)/2,cx:cx/(3*a2),cy:cy/(3*a2)};}
function geometryStats(g){const ps=allPoints(g);if(!ps.length)return null;const origin=ps[0],f=frame(origin[1]);let area=0,cx=0,cy=0;for(const poly of polygons(g)){for(let i=0;i<poly.length;i++){const s=ringStats(poly[i],f,origin);if(!s)continue;const weight=(i===0?1:-1)*s.area;area+=weight;cx+=s.cx*weight;cy+=s.cy*weight;}}return area>0?{area,centroid:[origin[0]+cx/area/f.x,origin[1]+cy/area/f.y]}:null;}
function area(g){return geometryStats(g)?.area??null;}
function center(g){return geometryStats(g)?.centroid??null;}
function distance(a,b){const f=frame((a[1]+b[1])/2);return Math.hypot((a[0]-b[0])*f.x,(a[1]-b[1])*f.y);}
function pointIn(p,r){let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])v=!v;return v;}
function inside(p,g){return polygons(g).some(poly=>poly.length>0&&pointIn(p,poly[0])&&!poly.slice(1).some(r=>pointIn(p,r)));}
function iou(a,b){const ps=[...allPoints(a),...allPoints(b)],box=[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];let inter=0,union=0;for(let y=0;y<100;y++)for(let x=0;x<100;x++){const p=[box[0]+(x+.5)/100*(box[2]-box[0]),box[1]+(y+.5)/100*(box[3]-box[1])],ia=inside(p,a),ib=inside(p,b);if(ia||ib)union++;if(ia&&ib)inter++;}return union?inter/union:null;}
function median(values){const s=values.filter(v=>v!==null&&Number.isFinite(v)).sort((a,b)=>a-b);if(!s.length)return null;const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}

mkdirSync(new URL('./derived/', import.meta.url), { recursive: true });
const output={
  measuredAt:'2026-09-07',
  method:{
    scope:'three fixed ML-rescue AOIs; upstream OSM compared with local Overture fixtures',
    iou:'deterministic 100x100 raster approximation; only source-id-matched OSM records',
    grossShapeMismatch:'areaRatio < 0.5 OR centroid > 5m OR approximate IoU < 0.8',
    falsePositive:'UNKNOWN without independent ground truth',
    missingBuilding:'UNKNOWN without independent ground truth',
  },
  sources:{
    osm:{
      endpoint:OSM_ENDPOINT, intent:'MEASUREMENT_ONLY', license:'ODbL-1.0',
      attribution:OSM_ATTRIBUTION,
      productionAccess:'Use planet/extract/Overpass for read-only bulk work; map API is not an ingestion adapter.',
    },
    overture:{
      release:OVERTURE_RELEASE,
      access:'bounded repository fixtures extracted from the official Overture Buildings release',
      license:'record-level ODbL-1.0 in the measured building fixtures',
      attribution:'© Overture Maps Foundation · © OpenStreetMap contributors where OSM-derived',
    },
  },
  regions:[],
};
for(const region of regions){
  const url=`${OSM_ENDPOINT}?bbox=${region.bbox.join(',')}`;
  const response=await fetch(url,{headers:{'User-Agent':'CarOS-Pro-MapData-Benchmark/1.0'}});
  if(!response.ok)throw new Error(`${region.id}: OSM ${response.status}`);
  const xml=await response.text(),parsedOsm=parseOsm(xml),osm=parsedOsm.ways,osmRelations=parsedOsm.relations,ov=loadOverture(region);
  const geometryPayloadSha256=createHash('sha256')
    .update(JSON.stringify({ways:osm,relations:osmRelations})).digest('hex');
  const normalized={
    region:region.id,bbox:region.bbox,retrievedAt:new Date().toISOString(),
    source:{id:'OSM',endpoint:OSM_ENDPOINT,intent:'MEASUREMENT_ONLY',license:'ODbL-1.0',
      attribution:OSM_ATTRIBUTION},
    geometryPayloadSha256,
    ways:osm,relations:osmRelations,
  };
  writeFileSync(new URL(`./derived/osm-${region.id.toLowerCase()}.json`,import.meta.url),JSON.stringify(normalized,null,2));
  const ovOsm=ov.filter(isOsm),ovMl=ov.filter(isMl),ovOther=ov.filter(b=>!isOsm(b)&&!isMl(b));
  const liveIds=new Set([...osm,...osmRelations].map(o=>o.id));
  const ovIdList=ovOsm.flatMap(b=>(b.sources??[]).map(s=>{const m=/^([wr])(\d+)@/.exec(s.record_id??'');return m?`${m[1]==='w'?'way':'relation'}/${m[2]}`:null;}).filter(Boolean));
  const ovIds=new Set(ovIdList);
  const idAgreement=[...ovIds].filter(id=>liveIds.has(id)).length;
  const liveById=new Map(osm.map(w=>[w.id,{type:'Polygon',coordinates:[w.ring]}]));
  const matched=ovOsm.map(b=>{const id=(b.sources??[]).map(s=>{const m=/^w(\d+)@/.exec(s.record_id??'');return m?`way/${m[1]}`:null;}).find(Boolean),g=id?liveById.get(id):null;return g?{o:b.geometry,g}:null;}).filter(Boolean);
  const matchedMetrics=matched.map(x=>({areaRatio:Math.min(area(x.o),area(x.g))/Math.max(area(x.o),area(x.g)),centroidM:distance(center(x.o),center(x.g)),iouApprox:iou(x.o,x.g)}));
  const allOsmTimestamps=[...osm,...osmRelations].map(o=>o.timestamp).filter(Boolean).sort();
  output.regions.push({id:region.id,bbox:region.bbox,osm:{closedBuildingWays:osm.length,buildingRelations:osmRelations.length,footprintObjects:osm.length+osmRelations.length,medianClosedWayAreaM2:median(osm.map(w=>area({type:'Polygon',coordinates:[w.ring]}))),latestObservedRecordTimestamp:allOsmTimestamps.at(-1)??null,geometryPayloadSha256},overture:{total:ov.length,sourceFamilies:grouped(ov.map(sourceFamily)),osmDerived:ovOsm.length,mlDerived:ovMl.length,otherFamilies:ovOther.length,medianAreaM2:{osmDerived:median(ovOsm.map(b=>area(b.geometry))),mlDerived:median(ovMl.map(b=>area(b.geometry))),otherFamilies:median(ovOther.map(b=>area(b.geometry)))},osmIdAgreement:idAgreement,osmBaselineIdentityOverlapRate:liveIds.size?idAgreement/liveIds.size:null,osmIdDuplicateRateWithinOverture:ovIdList.length?(ovIdList.length-ovIds.size)/ovIdList.length:null,osmGeometryAgreement:{n:matched.length,medianAreaRatio:median(matchedMetrics.map(x=>x.areaRatio)),minAreaRatio:matchedMetrics.length?Math.min(...matchedMetrics.map(x=>x.areaRatio)):null,medianCentroidM:median(matchedMetrics.map(x=>x.centroidM)),maxCentroidM:matchedMetrics.length?Math.max(...matchedMetrics.map(x=>x.centroidM)):null,medianIouApprox:median(matchedMetrics.map(x=>x.iouApprox)),minIouApprox:matchedMetrics.length?Math.min(...matchedMetrics.map(x=>x.iouApprox)):null,grossShapeMismatch:matchedMetrics.filter(x=>x.areaRatio<0.5||x.centroidM>5||x.iouApprox<0.8).length}},verifiedAlternative:{count:ovOther.length,uniqueIncremental:ovOther.length===0?0:null,verification:ovOther.length===0?'NO_RECORDS':'UNKNOWN_REQUIRES_SPATIAL_AND_LICENSE_REVIEW'}});
}
writeFileSync(new URL('./shootout.json',import.meta.url),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));

import { readFileSync, writeFileSync } from 'node:fs';

const isOsm = (b) => (b.sources ?? []).some((s) => /openstreetmap/i.test(s.dataset ?? '') && s.record_id);
const rings = (g) => g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates.flat() : [];
const frame = (lat) => ({ x: 111195 * Math.cos(lat * Math.PI / 180), y: 111195 });
function area(g) { const rs=rings(g); if(!rs.length)return null; const f=frame(rs[0][0][1]); let t=0; for(const r of rs){let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]*f.x)*(r[i][1]*f.y)-(r[i][0]*f.x)*(r[j][1]*f.y);t+=Math.abs(a)/2;}return t||null; }
function centroid(g){const r=rings(g)[0];if(!r)return null;let sx=0,sy=0;for(const p of r){sx+=p[0];sy+=p[1];}return [sx/r.length,sy/r.length];}
function dist(a,b){const f=frame((a[1]+b[1])/2);return Math.hypot((a[0]-b[0])*f.x,(a[1]-b[1])*f.y);}
function pin(p,r){let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])v=!v;return v;}
function inside(p,g){const rs=rings(g);return rs.length>0&&pin(p,rs[0])&&!rs.slice(1).some(r=>pin(p,r));}
function bbox(g){const ps=rings(g).flat();return [Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];}
// Deterministik 120x120 raster IoU; exact poligon kesişimi iddiası değildir.
function iou(a,b){const ba=bbox(a),bb=bbox(b),u=[Math.min(ba[0],bb[0]),Math.min(ba[1],bb[1]),Math.max(ba[2],bb[2]),Math.max(ba[3],bb[3])];let inter=0,uni=0;for(let y=0;y<120;y++)for(let x=0;x<120;x++){const p=[u[0]+(x+.5)/120*(u[2]-u[0]),u[1]+(y+.5)/120*(u[3]-u[1])],ia=inside(p,a),ib=inside(p,b);if(ia||ib)uni++;if(ia&&ib)inter++;}return uni?inter/uni:null;}
function scale(g,k){const c=centroid(g);return {type:g.type,coordinates:g.coordinates.map(r=>Array.isArray(r[0][0])?r.map(q=>q.map(p=>[c[0]+(p[0]-c[0])*k,c[1]+(p[1]-c[1])*k])):r.map(p=>[c[0]+(p[0]-c[0])*k,c[1]+(p[1]-c[1])*k]))};}
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null};
function fixture(path, raw=false){const x=JSON.parse(readFileSync(path,'utf8'));if(!raw)return x.overtureBuildings;return x.map(r=>({...r,sources:JSON.parse(r.sources_json),geometry:JSON.parse(r.geojson)}));}
const regions=[
 {id:'TARSUS',morphology:'düşük yoğunluklu bahçeli/müstakil',b:fixture('../../src/__tests__/fixtures/mapdataTarsusNear.json')},
 {id:'MERSIN',morphology:'yoğun apartman',b:fixture('region2/fixture-r2.json')},
 {id:'ERDEMLI',morphology:'düşük yoğunluklu banliyö',b:fixture('region3/overture-buildings-r3.json',true)},
];
function pairs(b){const ml=b.filter(x=>!isOsm(x)),osm=b.filter(isOsm);return ml.map(m=>{const cm=centroid(m.geometry);const candidates=osm.map(o=>({o,d:dist(cm,centroid(o.geometry))})).sort((a,b)=>a.d-b.d);const n=candidates[0];return n&&n.d<=20?{m,o:n.o,d:n.d}:null}).filter(Boolean);}
function summarize(values){return {n:values.length,median:med(values),mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};}
const result={method:{pairing:'nearest OSM-derived centroid <=20m',iou:'deterministic 120x120 raster approximation',correction:'centroid-preserving uniform scale; benchmark only'},regions:[]};
for(const r of regions){const ml=r.b.filter(x=>!isOsm(x)),osm=r.b.filter(isOsm),p=pairs(r.b);const rawRat=p.map(x=>area(x.m.geometry)/area(x.o.geometry));const ratioMedian=med(rawRat),fitted=ratioMedian?Math.sqrt(1/ratioMedian):null;const rawIou=p.map(x=>iou(x.m.geometry,x.o.geometry));const rescuedIou=fitted?p.map(x=>iou(scale(x.m.geometry,fitted),x.o.geometry)):[];result.regions.push({id:r.id,morphology:r.morphology,counts:{total:r.b.length,ml:ml.length,osm:osm.length,paired:p.length,multiPolygon:r.b.filter(x=>x.geometry.type==='MultiPolygon').length},raw:{mlAreaM2:summarize(ml.map(x=>area(x.geometry))),osmAreaM2:summarize(osm.map(x=>area(x.geometry))),pairedAreaRatioMlOverOsm:summarize(rawRat),centroidDisplacementM:summarize(p.map(x=>x.d)),iouApprox:summarize(rawIou)},rescue:{fittedLinearScale:fitted,areaMultiplier:fitted?fitted*fitted:null,iouApprox:summarize(rescuedIou),worsenedIou:p.filter((x,i)=>rescuedIou[i]<rawIou[i]).length},falsePositive:'UNKNOWN',missingBuilding:'UNKNOWN'});}
writeFileSync('rescue-benchmark.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

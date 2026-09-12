import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRoutingGraph } from '../platform/navigation/map/graph/rtg2Reader';
import { selectRegionalRouteCorridor, validateTurkeyGraphManifest } from '../platform/navigation/map/graph/turkeyGraphManifest';
import { _resetGraphResidencyForTest, acquireRegionalRoutingGraph, getGraphResidencySnapshot } from '../platform/navigation/map/graph/graphResidencyRuntime';

const root=resolve('field-runs/pbf-streaming-rtg3-20260908');
const manifest=validateTurkeyGraphManifest(JSON.parse(readFileSync(resolve(root,'turkey-graph-manifest.json'),'utf8')))!;
const buffer=(file:string)=>{const value=readFileSync(resolve(root,file));return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength) as ArrayBuffer};

afterEach(()=>{vi.unstubAllGlobals();_resetGraphResidencyForTest()});

describe('RTG3 province hardening',()=>{
  it('keeps exact graph parity while resolving real restrictions',()=>{
    const benchmark=JSON.parse(readFileSync(resolve(root,'benchmark.json'),'utf8'));
    expect(benchmark.totalNodes).toBe(600821);
    expect(benchmark.totalEdges).toBe(629201);
    expect(benchmark.regions).toHaveLength(14);
    expect(benchmark.restrictionStats.supported).toBeGreaterThan(0);
    expect(benchmark.restrictionStats.malformed).toBeLessThan(benchmark.restrictionStats.observed);
    const restrictionCount=manifest.regions.reduce((sum,region)=>sum+(parseRoutingGraph(buffer(region.graphFile)).view?.restrictionCount??0),0);
    expect(restrictionCount).toBeGreaterThan(0);
  });

  it('selects a real three-region manifest corridor',()=>{
    const ids=['tr-33-65-72','tr-33-66-72','tr-33-66-73'];
    const first=manifest.regions.find(region=>region.regionId===ids[0])!,last=manifest.regions.find(region=>region.regionId===ids[2])!;
    const point=(region:typeof first)=>[(region.bbox[1]+region.bbox[3])/2,(region.bbox[0]+region.bbox[2])/2] as const;
    expect(selectRegionalRouteCorridor(manifest,point(first),point(last),3)?.requiredRegionIds).toEqual(ids);
    expect(selectRegionalRouteCorridor(manifest,point(first),point(last),2)).toBeNull();
  });

  it('rejects a disconnected requested region set before publishing partial truth',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(readFileSync(resolve(root,String(url).replace(/^.*\/regions\//,'regions/'))))));
    const disconnected=['tr-33-65-72','tr-33-70-74'];
    expect(await acquireRegionalRoutingGraph(manifest,disconnected,'/fixture')).toBeNull();
    expect(getGraphResidencySnapshot().state).toBe('MISSING');
  });

  it('via-node kısıt temelini korur ve via-way desteğini gerçek veriyle kanıtlar',()=>{
    const benchmark=JSON.parse(readFileSync(resolve(root,'benchmark.json'),'utf8'));
    const stats=benchmark.restrictionStats;
    /* REGRESYON KAPISI: via-way desteği via-node çözümünü AZALTAMAZ. */
    expect(stats.supportedViaNode,'via-node temeli düştü').toBeGreaterThanOrEqual(110);
    expect(stats.supported).toBe(stats.supportedViaNode+stats.supportedViaWay);
    expect(stats.supported+stats.unsupported+stats.unresolved).toBe(stats.valid);
    expect(stats.observed).toBe(stats.valid+stats.malformed);
    /* Araç-özel (`except`) ilişki ASLA jenerik kısıta YÜKSELTİLMEZ. */
    expect(stats.vehicleSpecific).toBeGreaterThan(0);
    expect(stats.supportedViaWay+stats.vehicleSpecific).toBeLessThanOrEqual(stats.valid);
    /* Her via-way ilişkisi AÇIKÇA sınıflandırılmış olmalı — sessiz düşürme yok. */
    const outcomes=new Set(['SUPPORTED_VIA_WAY','UNRESOLVED_TOPOLOGY','UNSUPPORTED_CAPACITY']);
    expect(benchmark.viaWayEvidence.length).toBe(stats.viaWay);
    for(const evidence of benchmark.viaWayEvidence)expect(outcomes,JSON.stringify(evidence)).toContain(evidence.outcome);
    /* Bayt paritesi: yalnız via-way kayıtları eklendi (2 zincir × 2 halka × 16 B). */
    expect(benchmark.totalBytes).toBe(27232796+stats.supportedViaWay*2*16);
  });

  it('gerçek via-way kısıtı kanonik A* içinde uçtan uca uygulanır',()=>{
    const validation=JSON.parse(readFileSync(resolve(root,'hardening-validation.json'),'utf8'));
    expect(validation.viaWayCases.length,'gerçek via-way kanıtı yok').toBeGreaterThan(0);
    for(const item of validation.viaWayCases){
      expect(item.automatonEnforced,`${item.relationId} otomat uygulamadı`).toBe(true);
      /* Zincire GİRİLMEDEN alakasız yol bloklanmamalı (aşırı kısıt YASAK). */
      expect(item.unrelatedEntryAllowed,`${item.relationId} alakasız geçişi blokladı`).toBe(true);
      expect(item.intermediateAlternativesFree,`${item.relationId} ara kavşağı blokladı`).toBe(true);
      expect(item.workerAutomatonViolation,`${item.relationId} rota otomatı ihlal etti`).toBe(false);
    }
    expect(validation.viaNodeEvidence.outcome).toBe('FORBIDDEN_DIRECT_TURN');
    expect(validation.failures.every((f:{rejected:boolean})=>f.rejected)).toBe(true);
    /* Rota sonucu paritesi: via-way desteği mevcut rotaları DEĞİŞTİRMEDİ. */
    expect(validation.routesBefore).not.toBeNull();
    validation.routes.forEach((route:{distanceM:number},index:number)=>{
      expect(route.distanceM).toBe(validation.routesBefore[index].distanceM);
    });
  });

  it('uses SQLite state and preserves the single worker A* authority',()=>{
    const builder=readFileSync(resolve('scripts/build-pbf-streaming-rtg3.mjs'),'utf8');
    expect(builder).toContain("from 'node:sqlite'");
    expect(builder).toContain("['cat',SOURCE,'-t','node'");
    expect(builder).not.toContain("['getid'");
    /* Preflight builder'a AİT: eksik araç zinciriyle build BAŞLAMAZ. */
    expect(builder).toContain('assertPreflight(preflight)');
    const worker=readFileSync(resolve('src/platform/navigation/NavigationCompute.worker.ts'),'utf8');
    expect(worker.match(/function _aStar/g)).toHaveLength(1);
    expect(worker).toContain('INSTALL_REGIONAL_GRAPH');
    expect(readFileSync(resolve('src/platform/offlineRoutingService.ts'),'utf8')).toContain('computeRegionalOfflineRoute');
  });

  it('does not replace the production RTG2 artefact',()=>{
    const production=readFileSync(resolve('public/maps/routing-graph.bin'));
    expect(production.byteLength).toBe(7651542);
    expect(createHash('sha256').update(production).digest('hex')).toBe('e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { RTG4_MAGIC, parseRoutingGraph } from '../platform/navigation/map/graph/rtg2Reader';
import {
  _resetRegionalDataForTest, acquireRegionalPackages, getRegionalDataSnapshot,
  readInstalledRegionalArtifact, validateDistributionManifest, verifyRegionalPackagesLocal,
  discoverRegionalDistribution, configureRegionalStoragePolicy, pinRegionalDataset,
  _restartRegionalDataRuntimeForTest, _setRegionalDataStorageAdapterForTest,
  cleanupUnpinnedOldGenerations, getRegionalDistributionSnapshotSync,
  type RegionalDataStorageAdapter,
} from '../platform/navigation/map/graph/regionalDataDistribution';

type StorageOp = 'readBytes' | 'writeBytes' | 'readText' | 'writeText' | 'remove' | 'rename' | 'list' | 'mkdir';
class FaultStorage implements RegionalDataStorageAdapter {
  readonly data = new Map<string, ArrayBuffer | string>();
  fail: ((operation: StorageOp, path: string, to?: string) => boolean) | null = null;
  private check(operation: StorageOp, path: string, to?: string) {
    if (this.fail?.(operation, path, to)) throw new Error(`INJECTED_${operation}`);
  }
  async readBytes(path: string) { this.check('readBytes', path); const v = this.data.get(path); return v instanceof ArrayBuffer ? v.slice(0) : null; }
  async writeBytes(path: string, bytes: ArrayBuffer) { this.check('writeBytes', path); this.data.set(path, bytes.slice(0)); }
  async readText(path: string) { this.check('readText', path); const v = this.data.get(path); return typeof v === 'string' ? v : null; }
  async writeText(path: string, value: string) { this.check('writeText', path); this.data.set(path, value); }
  async remove(path: string) { this.check('remove', path); this.data.delete(path); }
  async rename(from: string, to: string) { this.check('rename', from, to); const v = this.data.get(from); if (v === undefined) throw new Error('MISSING'); this.data.set(to, v); this.data.delete(from); }
  async list(path: string) {
    this.check('list', path); const prefix = `${path}/`, names = new Set<string>();
    for (const key of this.data.keys()) if (key.startsWith(prefix)) { const name = key.slice(prefix.length).split('/')[0]; if (name) names.add(name); }
    return [...names].sort();
  }
  async mkdir(path: string) { this.check('mkdir', path); }
}

function graphBytes(): ArrayBuffer {
  const b = new ArrayBuffer(16 + 2 * 16 + 28), v = new DataView(b); let o = 0;
  v.setUint32(o, RTG4_MAGIC, true); o += 4; v.setUint32(o, 2, true); o += 4;
  v.setUint32(o, 1, true); o += 4; v.setUint32(o, 0, true); o += 4;
  for (let i = 0; i < 2; i++) { v.setFloat32(o, 36, true); v.setFloat32(o + 4, 34 + i / 100, true); v.setBigUint64(o + 8, BigInt(i + 1), true); o += 16; }
  v.setUint32(o, 0, true); v.setUint32(o + 4, 1, true); v.setUint32(o + 8, 1000, true);
  v.setBigUint64(o + 12, 10n, true); v.setUint8(o + 20, 3); v.setUint8(o + 21, 1);
  return b;
}
async function sha(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function fixture() {
  const bytes = graphBytes(), graphSha = await sha(bytes), hex = '1'.repeat(64);
  expect(parseRoutingGraph(bytes).outcome).toBe('OK');
  const graphManifest = {
    schemaVersion: 2 as const, datasetId: 'tr-test', country: 'TR' as const, source: 'fixture',
    sourceTimestamp: '2026-09-08', buildTimestamp: '2026-09-08', policyVersion: 'p1',
    graphFormat: 'RTG4' as const, portalSchemaVersion: 2 as const, portals: [],
    neighborAudit: { total: 0, ROUTABLE: 0, NON_ROUTABLE: 0, INVALID: 0, AMBIGUOUS: 0, links: [] },
    regions: [{ regionId: 'tr-36-34', bbox: [33, 35, 35, 37] as const, graphFile: 'regions/a.rtg4',
      sha256: graphSha, byteSize: bytes.byteLength, nodeCount: 2, edgeCount: 1, neighbors: [], sourceHash: hex,
      components: { schemaVersion: 1 as const, file: 'a.json', sha256: hex, byteSize: 1, indexFile: 'a.bin',
        indexSha256: hex, indexByteSize: 8, indexEncoding: 'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX' as const,
        count: 1, directedLinkCount: 0, portalComponentIds: [] } }],
  };
  const distribution = { schemaVersion: 1 as const, datasetId: 'tr-test', datasetVersion: '2026-09-A', policyVersion: 'p1',
    graphManifestSha256: await sha(new TextEncoder().encode(JSON.stringify(graphManifest)).buffer), graphManifest,
    regions: [{ regionId: 'tr-36-34', generation: 'g1', graphUrl: 'https://maps.test/a.rtg4' }] };
  return { bytes, graphManifest, distribution };
}

async function fixtureWithAlt() {
  const base = await fixture(), alt = new ArrayBuffer(24 + 2 * 8 * 2 * 2), h = new DataView(alt);
  h.setUint32(0, 0x414c5431, true); h.setUint32(4, 1, true); h.setUint32(8, 8, true);
  h.setUint32(12, 50, true); h.setUint32(16, 2, true); h.setUint32(20, 65535, true);
  const altSha = await sha(alt), landmarkSetId = 'landmarks-v1';
  const graphManifest = { ...base.graphManifest,
    altLandmarkSet: { schemaVersion: 1 as const, landmarkSetId, landmarkCount: 8, scaleM: 50,
      unreachableBucket: 65535, metric: 'ONEWAY_ONLY_BASE_COST_M' as const,
      selection: 'BACKBONE_CONSTRAINED_FARTHEST_POINT_REACHABILITY_VERIFIED' as const,
      buildTimestamp: '2026-09-09', landmarks: Array.from({ length: 8 }, (_, index) => ({ index, nodeId: String(index + 1), lat: 36, lon: 34 })) },
    regions: [{ ...base.graphManifest.regions[0], alt: { schemaVersion: 1 as const, file: 'regions/a.alt',
      sha256: altSha, byteSize: alt.byteLength, landmarkSetId, landmarkCount: 8, scaleM: 50,
      unreachableBucket: 65535, nodeCount: 2, encoding: 'UINT16_LE_PER_NODE_LANDMARK_PAIR' as const } }],
  };
  const distribution = { ...base.distribution, graphManifest,
    graphManifestSha256: await sha(new TextEncoder().encode(JSON.stringify(graphManifest)).buffer),
    regions: [{ ...base.distribution.regions[0], altUrl: 'https://maps.test/a.alt' }] };
  return { ...base, alt, graphManifest, distribution };
}

function applyStorage(storage: FaultStorage, distribution: unknown) {
  _setRegionalDataStorageAdapterForTest(storage);
  storage.data.set('navigation/regional-routing/distribution-manifest.json', JSON.stringify(distribution));
}

describe('RTG4 bölgesel veri dağıtımı', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => _resetRegionalDataForTest());
  afterEach(() => { globalThis.fetch = originalFetch; _resetRegionalDataForTest(); });

  it('manifest kimliğini ve güvenli URL/path sözleşmesini doğrular', async () => {
    const f = await fixture(); expect(await validateDistributionManifest(f.distribution)).not.toBeNull();
    expect(await validateDistributionManifest({ ...f.distribution, graphManifestSha256: '0'.repeat(64) })).toBeNull();
    expect(await validateDistributionManifest({ ...f.distribution, regions: [{ ...f.distribution.regions[0], regionId: '../x' }] })).toBeNull();
  });

  it('indirir, doğrular, registry yayınlar ve residency için kurulu baytı verir', async () => {
    const f = await fixture(); globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(false);
    await expect(acquireRegionalPackages(f.distribution, ['tr-36-34'])).resolves.toEqual({ ok: true, downloaded: ['tr-36-34'] });
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    expect((await readInstalledRegionalArtifact(f.graphManifest.regions[0], 'graph'))?.byteLength).toBe(f.bytes.byteLength);
    expect(await getRegionalDataSnapshot()).toMatchObject({ installedRegions: 1, installedGraphBytes: f.bytes.byteLength, installedAltBytes: 0 });
  });

  it('SHA bozuk indirmeyi READY yapmaz', async () => {
    const f = await fixture(), corrupt = f.bytes.slice(0); new Uint8Array(corrupt)[20] ^= 1;
    globalThis.fetch = (async () => new Response(corrupt)) as typeof fetch;
    await expect(acquireRegionalPackages(f.distribution, ['tr-36-34'])).resolves.toEqual({ ok: false, reason: 'DATA_CORRUPT' });
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(false);
    expect((await getRegionalDataSnapshot()).installedRegions).toBe(0);
  });

  it('trusted discovery local HTTP seam üzerinden 5xx retry sonrası manifesti bulur', async () => {
    const f = await fixture(); let calls = 0, body = '';
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/manifest')) {
        calls++; if (calls === 1) { res.statusCode = 503; res.end(); return; }
        res.setHeader('content-length', Buffer.byteLength(body)); res.end(body); return;
      }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('server');
      const url = `http://127.0.0.1:${address.port}/manifest`;
      body = JSON.stringify({ ...f.distribution, regions: [{ ...f.distribution.regions[0], graphUrl: `http://127.0.0.1:${address.port}/a.rtg4` }] });
      const manifest = await discoverRegionalDistribution({ manifestUrl: url, channel: 'stable',
        expectedDatasetId: f.distribution.datasetId, expectedGraphManifestSha256: f.distribution.graphManifestSha256 });
      expect(manifest?.datasetVersion).toBe('2026-09-A'); expect(calls).toBe(2);
      expect(await getRegionalDataSnapshot()).toMatchObject({ manifestStatus: 'READY', downloadRetries: 1 });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('pin aktifken dataset referansı tutulur ve storage görünümünde pinned bytes raporlanır', async () => {
    const f = await fixture(); globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    configureRegionalStoragePolicy({ totalBudgetBytes: 1024, minimumReserveBytes: 128 });
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    const pin = await pinRegionalDataset(f.graphManifest, ['tr-36-34']); expect(pin).not.toBeNull();
    expect((await getRegionalDataSnapshot()).pinnedBytes).toBe(f.bytes.byteLength);
    pin?.release(); expect((await getRegionalDataSnapshot()).pinnedBytes).toBe(0);
  });

  it('tek paket kullanılabilir bütçeyi aşıyorsa açık storage hatası verir', async () => {
    const f = await fixture(); configureRegionalStoragePolicy({ totalBudgetBytes: 100, minimumReserveBytes: 50 });
    await expect(acquireRegionalPackages(f.distribution, ['tr-36-34'])).resolves.toEqual({ ok: false, reason: 'INSUFFICIENT_STORAGE' });
  });

  it('registry silinince complete marker ve artefaktları yeniden doğrulayıp registry kurar', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g1/complete.json')).toBe(true);
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    expect(await getRegionalDataSnapshot()).toMatchObject({ registryRecoveryStatus: 'FILESYSTEM_REBUILD', recoveredGenerations: 1 });
  });

  it('bozuk registry yerine yalnız doğrulanmış complete generation kullanır', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    storage.data.set('navigation/regional-routing/installed-regions.json', '{bozuk');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    expect((await getRegionalDataSnapshot()).registryRecoveryStatus).toBe('FILESYSTEM_REBUILD');
  });

  it.each([
    ['graph staging write', 'writeBytes', 'graph.partial'],
    ['ALT staging write', 'writeBytes', 'alt.partial'],
    ['graph publish rename', 'rename', 'graph.partial'],
    ['ALT publish rename', 'rename', 'alt.partial'],
    ['completion marker write', 'writeText', 'complete.json.next'],
  ] as const)('%s arızasında generation READY olmaz', async (_label, operation, needle) => {
    const f = await fixtureWithAlt(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async (input) => new Response(String(input).endsWith('.alt') ? f.alt : f.bytes)) as typeof fetch;
    storage.fail = (op, path) => op === operation && path.includes(needle);
    await expect(acquireRegionalPackages(f.distribution, ['tr-36-34'])).resolves.toEqual({ ok: false, reason: 'STORAGE_FAILED' });
    expect(storage.data.has('navigation/regional-routing/installed-regions.json')).toBe(false);
    storage.fail = null; _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(false);
  });

  it.each([
    ['registry next write', 'writeText'],
    ['registry publish rename', 'rename'],
  ] as const)('%s arızası sonrası complete generation rebuild ile kurtarılır', async (_label, operation) => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    storage.fail = (op, path, to) => op === operation &&
      (operation === 'writeText' ? path.endsWith('installed-regions.json.next') : to?.endsWith('installed-regions.json') === true);
    await expect(acquireRegionalPackages(f.distribution, ['tr-36-34'])).resolves.toEqual({ ok: false, reason: 'STORAGE_FAILED' });
    storage.fail = null; storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
  });

  it('registry .next dosyasını restart sonrası atomik recovery kaynağı olarak kullanır', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    const registry = storage.data.get('navigation/regional-routing/installed-regions.json')!;
    storage.data.set('navigation/regional-routing/installed-regions.json.next', registry);
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    expect((await getRegionalDataSnapshot()).registryRecoveryStatus).toBe('NEXT_RECOVERY');
  });

  it('valid eski ve corrupt yeni generation içinden yalnız valid olanı rebuild eder', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    const graph = storage.data.get('navigation/regional-routing/regions/tr-36-34/g1/graph.rtg4') as ArrayBuffer;
    const corrupt = graph.slice(0); new Uint8Array(corrupt)[20] ^= 1;
    storage.data.set('navigation/regional-routing/regions/tr-36-34/g2/graph.rtg4', corrupt);
    const marker = JSON.parse(String(storage.data.get('navigation/regional-routing/regions/tr-36-34/g1/complete.json')));
    storage.data.set('navigation/regional-routing/regions/tr-36-34/g2/complete.json',
      JSON.stringify({ ...marker, generation: 'g2', completedAt: '2099-01-01T00:00:00.000Z' }));
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    expect(await getRegionalDataSnapshot()).toMatchObject({ recoveredGenerations: 1, rejectedGenerations: 1 });
  });

  it('marker bulunmayan published graph generation dosyasını orphan sayar ve READY yapmaz', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    storage.data.set('navigation/regional-routing/regions/tr-36-34/orphan/graph.rtg4', f.bytes);
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(false);
    /* Senkron projeksiyon ILK rebuild'in sayacini tasir; orphan artik ayni
       turda toplandigi icin yeniden tarama 0 gorurdu. */
    expect(getRegionalDistributionSnapshotSync())
      .toMatchObject({ installedRegions: 0, orphanGenerations: 1 });
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/orphan/graph.rtg4')).toBe(false);
  });

  /* -- P7 DISK FULL --------------------------------------------------------
     Degismez: hicbir kismi generation READY olmaz VE onceden kurulu gecerli
     generation kullanilabilir kalir. Disk dolu = yazma arizasi enjeksiyonu. */
  it.each([
    ['graph staging', 'writeBytes', 'graph.partial'],
    ['ALT staging', 'writeBytes', 'alt.partial'],
    ['completion marker', 'writeText', 'complete.json.next'],
    ['registry yayini', 'writeText', 'installed-regions.json.next'],
  ] as const)('disk dolu (%s) mevcut gecerli generation bozmaz', async (_label, operation, needle) => {
    const f = await fixtureWithAlt(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async (input) => new Response(String(input).endsWith('.alt') ? f.alt : f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const update = { ...f.distribution, datasetVersion: '2026-10-B',
      regions: [{ ...f.distribution.regions[0], generation: 'g2' }] };
    storage.fail = (op, path) => op === operation && path.includes(needle) && !path.includes('/g1/');
    await expect(acquireRegionalPackages(update, ['tr-36-34']))
      .resolves.toEqual({ ok: false, reason: 'STORAGE_FAILED' });
    storage.fail = null;
    /* Registry yayin arizasi generation TAMAMLANDIKTAN sonra olur: marker kalir
       ve generation sonradan dogrulanmis rebuild ile kurtarilabilir. Daha erken
       her arizada ise marker hic yazilmaz. */
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g2/complete.json'))
      .toBe(needle === 'installed-regions.json.next');
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
  });

  it('basarisiz indirme staging partial birakmaz ve stagingBytes sizdirmaz', async () => {
    const f = await fixtureWithAlt(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async (input) => new Response(String(input).endsWith('.alt') ? f.alt : f.bytes)) as typeof fetch;
    storage.fail = (op, path) => op === 'writeBytes' && path.includes('alt.partial');
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(false);
    storage.fail = null;
    expect([...storage.data.keys()].filter((key) => key.includes('.partial'))).toEqual([]);
    expect((await getRegionalDataSnapshot()).stagingBytes).toBe(0);
  });

  /* -- P8 CRASH BOUNDARY MATRIX --------------------------------------------
     Her sinir: yazma tamamlandiktan SONRA surec olur (restart), sonra kurulum
     durumu okunur. READY yalniz completion marker + registry hatti tamamsa. */
  const boundary = async (upTo: 'graphPartial' | 'graphPublished' | 'altPublished' | 'completed') => {
    const f = await fixtureWithAlt(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async (input) => new Response(String(input).endsWith('.alt') ? f.alt : f.bytes)) as typeof fetch;
    if (upTo === 'graphPartial') {
      /* Indirme yarida: yalniz staging partial diskte kalmis gibi. */
      storage.data.set('navigation/regional-routing/staging/tr-36-34-g1-graph.partial', f.bytes.slice(0, 8));
    } else if (upTo === 'completed') {
      expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    } else if (upTo === 'graphPublished') {
      /* Graph publish edildi; ALT yayina alinamadan guc kesildi. */
      storage.fail = (op, path) => op === 'rename' && path.includes('alt.partial');
      expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(false);
      storage.fail = null;
    } else {
      /* Graph + ALT yayinda; completion marker yazilamadan guc kesildi. */
      storage.fail = (op, path) => op === 'writeText' && path.includes('complete.json.next');
      expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(false);
      storage.fail = null;
    }
    _restartRegionalDataRuntimeForTest();
    const ready = await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34']);
    /* Senkron projeksiyon ILK rebuild'in sayaclarini tasir; yeniden okuma
       temizlenmis diski tarayacagi icin olcumu bozardi. */
    return { ready, snapshot: getRegionalDistributionSnapshotSync(), storage, f };
  };

  it('sinir: yalniz staging partial -> READY yok, partial toplanir', async () => {
    const { ready, storage } = await boundary('graphPartial');
    expect(ready).toBe(false);
    expect([...storage.data.keys()].filter((key) => key.includes('.partial'))).toEqual([]);
  });

  it('sinir: graph yayinda ama ALT yok -> READY yok', async () => {
    const { ready, snapshot } = await boundary('graphPublished');
    expect(ready).toBe(false);
    expect(snapshot.installedRegions).toBe(0);
  });

  it('sinir: graph+ALT yayinda ama marker yok -> orphan, READY yok', async () => {
    const { ready, snapshot } = await boundary('altPublished');
    expect(ready).toBe(false);
    expect(snapshot.installedRegions).toBe(0);
    expect(snapshot.orphanGenerations).toBe(1);
  });

  it('sinir: marker + registry tam -> restart sonrasi READY', async () => {
    const { ready, snapshot } = await boundary('completed');
    expect(ready).toBe(true);
    expect(snapshot.registryRecoveryStatus).toBe('NORMAL');
  });

  /* -- P9 GRAPH/ALT ATOMIKLIGI --------------------------------------------- */
  it('ALT beyan eden generation ALT dosyasi bozukken READY olmaz', async () => {
    const f = await fixtureWithAlt(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async (input) => new Response(String(input).endsWith('.alt') ? f.alt : f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    const alt = storage.data.get('navigation/regional-routing/regions/tr-36-34/g1/alt.bin') as ArrayBuffer;
    const corrupt = alt.slice(0); new Uint8Array(corrupt)[30] ^= 0xff;
    storage.data.set('navigation/regional-routing/regions/tr-36-34/g1/alt.bin', corrupt);
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    /* Graph saglam olsa bile ALT beyanli generation sessizce graph-only'ye
       DUSURULMEZ: yanlis ALT ile eslesme riski kabul edilmez. */
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(false);
    expect(getRegionalDistributionSnapshotSync())
      .toMatchObject({ recoveredGenerations: 0, rejectedGenerations: 1 });
  });

  it('yeni graph eski ALT ile eslestirilmez (generation siniri korunur)', async () => {
    const f = await fixtureWithAlt(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async (input) => new Response(String(input).endsWith('.alt') ? f.alt : f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    /* g2 dizinine yalniz graph kopyalanir; ALT g1'de kalir. */
    storage.data.set('navigation/regional-routing/regions/tr-36-34/g2/graph.rtg4',
      storage.data.get('navigation/regional-routing/regions/tr-36-34/g1/graph.rtg4')!);
    const marker = JSON.parse(String(storage.data.get('navigation/regional-routing/regions/tr-36-34/g1/complete.json')));
    storage.data.set('navigation/regional-routing/regions/tr-36-34/g2/complete.json',
      JSON.stringify({ ...marker, generation: 'g2', completedAt: '2099-01-01T00:00:00.000Z' }));
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(f.graphManifest, ['tr-36-34'])).toBe(true);
    /* g2 ALT dosyasi olmadigi icin reddedilir; g1 kurtarilir - capraz eslesme YOK.
       Reddedilen generation SILINMEZ: yalniz READY sayilmaz. */
    expect(getRegionalDistributionSnapshotSync())
      .toMatchObject({ recoveredGenerations: 1, rejectedGenerations: 1 });
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g2/graph.rtg4')).toBe(true);
  });

  /* -- P11 EVICTION <-> RECOVERY ETKILESIMI -------------------------------- */
  it('rebuild ayni bolgenin tum dogrulanmis generationlarini korur', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const update = { ...f.distribution, regions: [{ ...f.distribution.regions[0], generation: 'g2' }] };
    storage.data.set('navigation/regional-routing/distribution-manifest.json', JSON.stringify(update));
    expect((await acquireRegionalPackages(update, ['tr-36-34'])).ok).toBe(true);
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    /* Iki generation da kurtarilmali: aksi halde eski generation dosyalari
       registry disinda kalir ve cleanup onlari bir daha temizleyemez. */
    expect(await verifyRegionalPackagesLocal(update.graphManifest, ['tr-36-34'])).toBe(true);
    expect((await getRegionalDataSnapshot()).installedRegions).toBe(2);
    expect(await cleanupUnpinnedOldGenerations()).toBe(1);
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g1/graph.rtg4')).toBe(false);
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g2/graph.rtg4')).toBe(true);
  });

  it('cleanup ortasinda kesinti sonrasi rebuild son iyi kopyayi silmez', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const update = { ...f.distribution, regions: [{ ...f.distribution.regions[0], generation: 'g2' }] };
    storage.data.set('navigation/regional-routing/distribution-manifest.json', JSON.stringify(update));
    expect((await acquireRegionalPackages(update, ['tr-36-34'])).ok).toBe(true);
    /* Cleanup g1 markerini sildi, registry yayinina yetisemeden guc kesildi. */
    storage.data.delete('navigation/regional-routing/regions/tr-36-34/g1/complete.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json');
    storage.data.delete('navigation/regional-routing/installed-regions.json.next');
    _restartRegionalDataRuntimeForTest();
    expect(await verifyRegionalPackagesLocal(update.graphManifest, ['tr-36-34'])).toBe(true);
    expect(getRegionalDistributionSnapshotSync())
      .toMatchObject({ installedRegions: 1, orphanGenerations: 1 });
    /* Yarim kalan g1 toplanir; g2 (son iyi kopya) korunur. */
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g1/graph.rtg4')).toBe(false);
    expect(storage.data.has('navigation/regional-routing/regions/tr-36-34/g2/graph.rtg4')).toBe(true);
  });

  it('pinli generation eviction adayi olmaz, butce asimi acik hata verir', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    const pin = await pinRegionalDataset(f.graphManifest, ['tr-36-34']);
    expect(pin).not.toBeNull();
    /* Butce yalniz tek pakete yeter; pinli olan korunur -> yeni kurulum reddedilir. */
    configureRegionalStoragePolicy({ totalBudgetBytes: f.bytes.byteLength + 8, minimumReserveBytes: 4 });
    const graphManifest = { ...f.graphManifest,
      regions: [{ ...f.graphManifest.regions[0], regionId: 'tr-06-06' }] };
    const other = { ...f.distribution, datasetVersion: '2026-10-B', graphManifest,
      graphManifestSha256: await sha(new TextEncoder().encode(JSON.stringify(graphManifest)).buffer),
      regions: [{ ...f.distribution.regions[0], regionId: 'tr-06-06', generation: 'g1' }] };
    await expect(acquireRegionalPackages(other, ['tr-06-06']))
      .resolves.toEqual({ ok: false, reason: 'INSUFFICIENT_STORAGE' });
    expect((await getRegionalDataSnapshot()).pinnedBytes).toBe(f.bytes.byteLength);
    pin?.release();
  });

  it('aktif rota eski generation pinini korur; release sonrası cleanup yalnız eskiyi kaldırır', async () => {
    const f = await fixture(), storage = new FaultStorage(); applyStorage(storage, f.distribution);
    globalThis.fetch = (async () => new Response(f.bytes)) as typeof fetch;
    expect((await acquireRegionalPackages(f.distribution, ['tr-36-34'])).ok).toBe(true);
    const pin = await pinRegionalDataset(f.graphManifest, ['tr-36-34']);
    expect(pin?.generations).toEqual(['g1']);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const update = { ...f.distribution, datasetVersion: '2026-10-B',
      regions: [{ ...f.distribution.regions[0], generation: 'g2' }] };
    expect((await acquireRegionalPackages(update, ['tr-36-34'])).ok).toBe(true);
    expect(await cleanupUnpinnedOldGenerations()).toBe(0);
    expect((await getRegionalDataSnapshot()).installedRegions).toBe(2);
    pin?.release();
    expect(await cleanupUnpinnedOldGenerations()).toBe(1);
    expect((await getRegionalDataSnapshot()).installedRegions).toBe(1);
  });
});

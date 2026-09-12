import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { parseRoutingGraph } from './rtg2Reader';
import type { TurkeyGraphManifest, TurkeyGraphRegion } from './turkeyGraphManifest';
import { validateTurkeyGraphManifest } from './turkeyGraphManifest';

const ROOT = 'navigation/regional-routing';
const REGISTRY = `${ROOT}/installed-regions.json`;
const CACHED_MANIFEST = `${ROOT}/distribution-manifest.json`;
const COMPLETION_FILE = 'complete.json';
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ALT_MAGIC = 0x414c5431;
// Gerçek Türkiye graph manifesti bölge sınır/portal dizilerini de taşır (~26 MiB).
// Limit yine sabittir; bozuk/sınırsız yanıt belleği tüketemez.
const MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [0, 250, 750] as const;

export type RegionalDataState = 'AVAILABLE_LOCAL' | 'DOWNLOAD_REQUIRED' | 'DOWNLOADING' |
  'READY' | 'FAILED' | 'STALE' | 'CORRUPT';
export type RegionalDataFailure = 'REGIONAL_DATA_NOT_INSTALLED' |
  'DISTRIBUTION_MANIFEST_INVALID' | 'DOWNLOAD_FAILED' | 'DATA_CORRUPT' |
  'STORAGE_FAILED' | 'INSUFFICIENT_STORAGE';

export interface RegionalPackageRecord {
  readonly regionId: string;
  readonly generation: string;
  readonly graphUrl: string;
  readonly altUrl?: string;
}
export interface RegionalDistributionManifest {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly policyVersion: string;
  readonly graphManifestSha256: string;
  readonly graphManifest: TurkeyGraphManifest;
  readonly regions: readonly RegionalPackageRecord[];
}
export interface InstalledRegionRecord {
  readonly regionId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly policyVersion: string;
  readonly generation: string;
  readonly graphManifestSha256: string;
  readonly graphSha256: string;
  readonly altSha256: string | null;
  readonly graphBytes: number;
  readonly altBytes: number;
  readonly installedAt: string;
  readonly lastVerifiedAt: string;
  readonly lastUsedAt: string | null;
  readonly state: 'READY';
}
interface RegistryFile { readonly schemaVersion: 1; readonly regions: readonly InstalledRegionRecord[] }

interface GenerationCompletion {
  readonly schemaVersion: 1;
  readonly regionId: string;
  readonly generation: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly policyVersion: string;
  readonly graphManifestSha256: string;
  readonly graphFormat: 'RTG3' | 'RTG4';
  readonly graphSha256: string;
  readonly graphBytes: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly altPresent: boolean;
  readonly altSha256: string | null;
  readonly altBytes: number;
  readonly landmarkSetId: string | null;
  readonly landmarkCount: number | null;
  readonly altScaleM: number | null;
  readonly altUnreachableBucket: number | null;
  readonly completedAt: string;
}

export interface RegionalDistributionConfig {
  readonly manifestUrl: string;
  readonly channel: string;
  readonly expectedDatasetId: string;
  readonly expectedGraphManifestSha256: string;
}
export interface RegionalStoragePolicy {
  readonly totalBudgetBytes: number;
  readonly minimumReserveBytes: number;
}
export interface RegionalDistributionSnapshot {
  readonly manifestStatus: 'UNCONFIGURED' | 'DISCOVERING' | 'READY' | 'FAILED';
  readonly datasetId: string | null;
  readonly datasetVersion: string | null;
  readonly installedRegions: number;
  readonly installedGraphBytes: number;
  readonly installedAltBytes: number;
  readonly diskBudgetBytes: number | null;
  readonly pinnedBytes: number;
  readonly evictableBytes: number;
  readonly activeDownloads: number;
  readonly downloadRetries: number;
  readonly stagingBytes: number;
  readonly lastDownloadFailure: RegionalDataFailure | null;
  readonly lastIntegrityFailure: string | null;
  readonly registryRecoveryStatus: 'NORMAL' | 'NEXT_RECOVERY' | 'FILESYSTEM_REBUILD' | 'EMPTY' | 'FAILED';
  readonly recoveredGenerations: number;
  readonly rejectedGenerations: number;
  readonly orphanGenerations: number;
  readonly lastRebuildFailure: string | null;
  readonly lastPublishFailure: string | null;
}

let storagePolicy: RegionalStoragePolicy | null = null;
const pins = new Map<string, number>();
let manifestStatus: RegionalDistributionSnapshot['manifestStatus'] = 'UNCONFIGURED';
let observedDatasetId: string | null = null, observedDatasetVersion: string | null = null;
let activeDownloads = 0, downloadRetries = 0, stagingBytes = 0;
let lastDownloadFailure: RegionalDataFailure | null = null, lastIntegrityFailure: string | null = null;
let registryRecoveryStatus: RegionalDistributionSnapshot['registryRecoveryStatus'] = 'EMPTY';
let recoveredGenerations = 0, rejectedGenerations = 0, orphanGenerations = 0;
let lastRebuildFailure: string | null = null, lastPublishFailure: string | null = null;
let registryCache: RegistryFile = { schemaVersion: 1, regions: [] };

export interface RegionalDataStorageAdapter {
  readBytes(path: string): Promise<ArrayBuffer | null>;
  writeBytes(path: string, bytes: ArrayBuffer): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, value: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  list(path: string): Promise<readonly string[]>;
  mkdir(path: string): Promise<void>;
}

const volatile = new Map<string, ArrayBuffer | string>();
let injectedStorage: RegionalDataStorageAdapter | null = null;
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let result = '';
  for (let i = 0; i < bytes.length; i += 0x8000) result += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(result);
}
function fromBase64(value: string): ArrayBuffer {
  const raw = atob(value); const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
async function readBytes(path: string): Promise<ArrayBuffer | null> {
  if (injectedStorage) return injectedStorage.readBytes(path);
  if (!Capacitor.isNativePlatform()) { const v = volatile.get(path); return v instanceof ArrayBuffer ? v.slice(0) : null; }
  try { const r = await Filesystem.readFile({ path, directory: Directory.Data }); return fromBase64(String(r.data)); } catch { return null; }
}
async function writeBytes(path: string, bytes: ArrayBuffer): Promise<void> {
  if (injectedStorage) return injectedStorage.writeBytes(path, bytes);
  if (!Capacitor.isNativePlatform()) { volatile.set(path, bytes.slice(0)); return; }
  await Filesystem.writeFile({ path, data: toBase64(bytes), directory: Directory.Data, recursive: true });
}
async function readText(path: string): Promise<string | null> {
  if (injectedStorage) return injectedStorage.readText(path);
  if (!Capacitor.isNativePlatform()) { const v = volatile.get(path); return typeof v === 'string' ? v : null; }
  try { const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 }); return String(r.data); } catch { return null; }
}
async function writeText(path: string, value: string): Promise<void> {
  if (injectedStorage) return injectedStorage.writeText(path, value);
  if (!Capacitor.isNativePlatform()) { volatile.set(path, value); return; }
  await Filesystem.writeFile({ path, data: value, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
}
async function remove(path: string): Promise<void> {
  if (injectedStorage) return injectedStorage.remove(path);
  if (!Capacitor.isNativePlatform()) { volatile.delete(path); return; }
  await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
}
async function rename(from: string, to: string): Promise<void> {
  if (injectedStorage) return injectedStorage.rename(from, to);
  if (!Capacitor.isNativePlatform()) { const v = volatile.get(from); if (v === undefined) throw new Error('STAGING_MISSING'); volatile.set(to, v); volatile.delete(from); return; }
  await Filesystem.rename({ from, to, directory: Directory.Data, toDirectory: Directory.Data });
}
async function list(path: string): Promise<readonly string[]> {
  if (injectedStorage) return injectedStorage.list(path);
  if (!Capacitor.isNativePlatform()) {
    const prefix = `${path}/`; const names = new Set<string>();
    for (const key of volatile.keys()) if (key.startsWith(prefix)) {
      const name = key.slice(prefix.length).split('/')[0]; if (name) names.add(name);
    }
    return [...names].sort();
  }
  try { return (await Filesystem.readdir({ path, directory: Directory.Data })).files.map((entry) => entry.name).sort(); }
  catch { return []; }
}
async function mkdir(path: string): Promise<void> {
  if (injectedStorage) return injectedStorage.mkdir(path);
  if (!Capacitor.isNativePlatform()) return;
  await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true }).catch(() => undefined);
}

const finalPath = (id: string, generation: string, alt: boolean) =>
  `${ROOT}/regions/${id}/${generation}/${alt ? 'alt.bin' : 'graph.rtg4'}`;
const stagePath = (id: string, generation: string, alt: boolean) =>
  `${ROOT}/staging/${id}-${generation}-${alt ? 'alt' : 'graph'}.partial`;
const generationPath = (id: string, generation: string) => `${ROOT}/regions/${id}/${generation}`;
const completionPath = (id: string, generation: string) => `${generationPath(id, generation)}/${COMPLETION_FILE}`;
async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseRegistry(value: string | null): RegistryFile | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RegistryFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.regions)) return null;
    for (const item of parsed.regions) {
      if (!SAFE_ID.test(item.regionId) || !SAFE_ID.test(item.generation) || !item.datasetId ||
          !item.datasetVersion || !item.policyVersion || !HEX64.test(item.graphManifestSha256) ||
          !HEX64.test(item.graphSha256) || (item.altSha256 !== null && !HEX64.test(item.altSha256)) ||
          !Number.isSafeInteger(item.graphBytes) || item.graphBytes <= 0 || !Number.isSafeInteger(item.altBytes) ||
          item.altBytes < 0 || item.state !== 'READY') return null;
    }
    return parsed as RegistryFile;
  } catch { return null; }
}

function parseCompletion(value: string | null): GenerationCompletion | null {
  if (!value) return null;
  try {
    const c = JSON.parse(value) as Partial<GenerationCompletion>;
    if (c.schemaVersion !== 1 || !SAFE_ID.test(c.regionId ?? '') || !SAFE_ID.test(c.generation ?? '') ||
        !c.datasetId || !c.datasetVersion || !c.policyVersion || !HEX64.test(c.graphManifestSha256 ?? '') ||
        (c.graphFormat !== 'RTG3' && c.graphFormat !== 'RTG4') || !HEX64.test(c.graphSha256 ?? '') ||
        !Number.isSafeInteger(c.graphBytes) || (c.graphBytes ?? 0) <= 0 || !Number.isSafeInteger(c.nodeCount) ||
        (c.nodeCount ?? 0) <= 0 || !Number.isSafeInteger(c.edgeCount) || (c.edgeCount ?? 0) <= 0 ||
        typeof c.altPresent !== 'boolean' || !Number.isSafeInteger(c.altBytes) || (c.altBytes ?? -1) < 0 ||
        !c.completedAt) return null;
    if (c.altPresent && (!HEX64.test(c.altSha256 ?? '') || !c.landmarkSetId ||
        !Number.isSafeInteger(c.landmarkCount) || (c.landmarkCount ?? 0) <= 0 ||
        !Number.isSafeInteger(c.altScaleM) || (c.altScaleM ?? 0) <= 0 ||
        !Number.isSafeInteger(c.altUnreachableBucket) || (c.altUnreachableBucket ?? 0) <= 0)) return null;
    if (!c.altPresent && (c.altSha256 !== null || c.altBytes !== 0 || c.landmarkSetId !== null ||
        c.landmarkCount !== null || c.altScaleM !== null || c.altUnreachableBucket !== null)) return null;
    return c as GenerationCompletion;
  } catch { return null; }
}

async function recoveryManifest(): Promise<RegionalDistributionManifest | null> {
  const cached = await readText(CACHED_MANIFEST); if (!cached) return null;
  try {
    const parsed = await validateDistributionManifest(JSON.parse(cached));
    const config = readRegionalDistributionConfig();
    if (!parsed || (config && (parsed.datasetId !== config.expectedDatasetId ||
        parsed.graphManifestSha256 !== config.expectedGraphManifestSha256))) return null;
    return parsed;
  } catch { return null; }
}

/** Completion marker'ı OLMAYAN generation artefaktlarını ve sahipsiz staging
 *  partial'larını toplar — bunlar yarım kalmış yazımın deterministik artığıdır ve
 *  hiçbir kayıt tarafından referanslanmaz. Kimlik uyuşmazlığı veya yeniden
 *  doğrulama reddi SİLME sebebi değildir (geçici I/O hatası son iyi kopyayı yok
 *  edemez); onlar yalnızca reddedilmiş sayılır. */
async function discardUnreferenced(
  value: RegistryFile, discardable: readonly { regionId: string; generation: string; alt: boolean }[],
): Promise<void> {
  const kept = new Set(value.regions.map((item) => `${item.regionId}/${item.generation}`));
  for (const item of discardable) {
    if (kept.has(`${item.regionId}/${item.generation}`)) continue;
    await remove(completionPath(item.regionId, item.generation));
    await remove(`${completionPath(item.regionId, item.generation)}.next`);
    await remove(finalPath(item.regionId, item.generation, false));
    if (item.alt) await remove(finalPath(item.regionId, item.generation, true));
  }
  /* Aktif indirme varken staging CANLI bir işin sahibidir; asla toplanmaz. */
  if (activeDownloads > 0) return;
  for (const name of await list(`${ROOT}/staging`)) {
    if (name.endsWith('.partial')) await remove(`${ROOT}/staging/${name}`);
  }
  stagingBytes = 0;
}

async function rebuildRegistryFromFilesystem(): Promise<RegistryFile> {
  recoveredGenerations = 0; rejectedGenerations = 0; orphanGenerations = 0; lastRebuildFailure = null;
  const manifest = await recoveryManifest();
  if (!manifest) { registryRecoveryStatus = 'EMPTY'; return { schemaVersion: 1, regions: [] }; }
  const recovered: InstalledRegionRecord[] = [];
  const discardable: { regionId: string; generation: string; alt: boolean }[] = [];
  try {
    for (const regionId of await list(`${ROOT}/regions`)) {
      if (!SAFE_ID.test(regionId)) { rejectedGenerations++; continue; }
      for (const generation of await list(`${ROOT}/regions/${regionId}`)) {
        if (!SAFE_ID.test(generation)) { rejectedGenerations++; continue; }
        const completion = parseCompletion(await readText(completionPath(regionId, generation)));
        if (!completion) {
          orphanGenerations++; discardable.push({ regionId, generation, alt: true }); continue;
        }
        const region = manifest.graphManifest.regions.find((item) => item.regionId === regionId);
        const pkg = manifest.regions.find((item) => item.regionId === regionId);
        if (!region || !pkg || completion.regionId !== regionId || completion.generation !== generation ||
            completion.datasetId !== manifest.datasetId || completion.datasetVersion !== manifest.datasetVersion ||
            completion.policyVersion !== manifest.policyVersion ||
            completion.graphManifestSha256 !== manifest.graphManifestSha256 ||
            completion.graphFormat !== manifest.graphManifest.graphFormat || completion.graphSha256 !== region.sha256 ||
            completion.graphBytes !== region.byteSize || completion.nodeCount !== region.nodeCount ||
            completion.edgeCount !== region.edgeCount || completion.altPresent !== !!region.alt ||
            completion.altSha256 !== (region.alt?.sha256 ?? null) || completion.altBytes !== (region.alt?.byteSize ?? 0) ||
            completion.landmarkSetId !== (region.alt?.landmarkSetId ?? null) ||
            completion.landmarkCount !== (region.alt?.landmarkCount ?? null) ||
            completion.altScaleM !== (region.alt?.scaleM ?? null) ||
            completion.altUnreachableBucket !== (region.alt?.unreachableBucket ?? null)) {
          rejectedGenerations++; continue;
        }
        const record: InstalledRegionRecord = {
          regionId, datasetId: completion.datasetId, datasetVersion: completion.datasetVersion,
          policyVersion: completion.policyVersion, generation, graphManifestSha256: completion.graphManifestSha256,
          graphSha256: completion.graphSha256, altSha256: completion.altSha256,
          graphBytes: completion.graphBytes, altBytes: completion.altBytes, installedAt: completion.completedAt,
          lastVerifiedAt: new Date().toISOString(), lastUsedAt: null, state: 'READY',
        };
        /* Yeniden dogrulama reddi SILME sebebi DEGILDIR: gecici bir okuma
           hatasi son iyi kopyayi yok edemez. Yalnizca READY sayilmaz. */
        if (!await installedValid(region, record, completion.graphFormat)) { rejectedGenerations++; continue; }
        recovered.push(record);
      }
    }
    /* Normal akış aynı bölge için birden çok generation TAŞIR (güncelleme sırasında
       eski + yeni). Rebuild tek generation'a indirgerse eski generation registry'den
       düşer ve `cleanupUnpinnedOldGenerations` onu bir daha ASLA temizleyemez.
       Bu yüzden doğrulanmış generation'ların TAMAMI kurtarılır; hangi generation'ın
       kullanılacağı runtime'da `newestInstalled` ile deterministik seçilir. */
    const value: RegistryFile = { schemaVersion: 1, regions: recovered.sort((a, b) =>
      a.regionId.localeCompare(b.regionId) || b.installedAt.localeCompare(a.installedAt) ||
      b.generation.localeCompare(a.generation)) };
    recoveredGenerations = value.regions.length; registryRecoveryStatus = value.regions.length ? 'FILESYSTEM_REBUILD' : 'EMPTY';
    registryCache = value;
    if (value.regions.length) try { await publishRegistry(value); }
    catch (error) { lastPublishFailure = String(error); }
    /* Kurtarma tamamlandıktan SONRA çöp toplama: READY olmayan generation
       dosyaları ve staging partial'ları hiçbir kayıt tarafından referanslanmaz;
       temizlenmezlerse kalıcı disk sızıntısıdır. Aktif indirme varken staging'e
       DOKUNULMAZ (o partial canlı bir işin sahibi olabilir). */
    await discardUnreferenced(value, discardable);
    return value;
  } catch (error) {
    lastRebuildFailure = String(error); registryRecoveryStatus = 'FAILED';
    return { schemaVersion: 1, regions: [] };
  }
}
async function registry(): Promise<RegistryFile> {
  /* Güç kesilmesi registry replace'in iki rename adımı arasına denk gelirse
     tamamlanmış `.next` kayıt recovery kaynağıdır; staging yine READY değildir. */
  const primary = parseRegistry(await readText(REGISTRY));
  if (primary) {
    if (registryRecoveryStatus === 'EMPTY') registryRecoveryStatus = 'NORMAL';
    registryCache = primary; return primary;
  }
  const next = parseRegistry(await readText(`${REGISTRY}.next`));
  if (next) {
    registryRecoveryStatus = 'NEXT_RECOVERY'; registryCache = next;
    try { await publishRegistry(next); } catch (error) { lastPublishFailure = String(error); }
    return next;
  }
  return rebuildRegistryFromFilesystem();
}
async function publishRegistry(value: RegistryFile): Promise<void> {
  const next = `${REGISTRY}.next`;
  try { await writeText(next, JSON.stringify(value)); }
  catch (error) { lastPublishFailure = `REGISTRY_NEXT_WRITE:${String(error)}`; throw error; }
  /* Registry yalnız artefaktların tamamı yayınlandıktan sonra görünür olur.
     Eski registry rename başarısızlığına kadar korunur; boot recovery .next'i READY saymaz. */
  try { await remove(REGISTRY); await rename(next, REGISTRY); registryCache = value; }
  catch (error) { lastPublishFailure = `REGISTRY_PUBLISH:${String(error)}`; throw error; }
}

export async function validateDistributionManifest(
  value: unknown,
  trust?: Readonly<{ expectedDatasetId: string; expectedGraphManifestSha256: string; manifestOrigin: string }>,
): Promise<RegionalDistributionManifest | null> {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<RegionalDistributionManifest>;
  const graph = validateTurkeyGraphManifest(m.graphManifest);
  if (m.schemaVersion !== 1 || !m.datasetId || !m.datasetVersion || !m.policyVersion || !graph ||
      graph.datasetId !== m.datasetId || graph.policyVersion !== m.policyVersion ||
      !HEX64.test(m.graphManifestSha256 ?? '') || !Array.isArray(m.regions)) return null;
  if (trust && (m.datasetId !== trust.expectedDatasetId ||
      m.graphManifestSha256 !== trust.expectedGraphManifestSha256)) return null;
  if (await digest(new TextEncoder().encode(JSON.stringify(m.graphManifest)).buffer) !== m.graphManifestSha256) return null;
  const seen = new Set<string>();
  for (const pkg of m.regions) {
    if (!SAFE_ID.test(pkg.regionId) || !SAFE_ID.test(pkg.generation) || seen.has(pkg.regionId) ||
        !graph.regions.some((r) => r.regionId === pkg.regionId)) return null;
    try {
      const graphUrl = new URL(pkg.graphUrl, globalThis.location?.origin ?? 'https://local.invalid');
      const loopback = graphUrl.protocol === 'http:' &&
        (graphUrl.hostname === '127.0.0.1' || graphUrl.hostname === 'localhost');
      if (graphUrl.protocol !== 'https:' && graphUrl.origin !== globalThis.location?.origin &&
          graphUrl.origin !== trust?.manifestOrigin && !loopback) return null;
      if (trust && graphUrl.origin !== trust.manifestOrigin) return null;
      if (pkg.altUrl && new URL(pkg.altUrl, graphUrl).origin !== graphUrl.origin) return null;
    } catch { return null; }
    seen.add(pkg.regionId);
  }
  return m as RegionalDistributionManifest;
}

export function readRegionalDistributionConfig(): RegionalDistributionConfig | null {
  const manifestUrl = String(import.meta.env['VITE_REGIONAL_MAP_MANIFEST_URL'] ?? '').trim();
  const channel = String(import.meta.env['VITE_REGIONAL_MAP_DATASET_CHANNEL'] ?? '').trim();
  const expectedDatasetId = String(import.meta.env['VITE_REGIONAL_MAP_DATASET_ID'] ?? '').trim();
  const expectedGraphManifestSha256 = String(import.meta.env['VITE_REGIONAL_MAP_GRAPH_MANIFEST_SHA256'] ?? '').trim();
  if (!manifestUrl || !channel || !expectedDatasetId || !HEX64.test(expectedGraphManifestSha256)) return null;
  try {
    const url = new URL(manifestUrl);
    if (!import.meta.env.DEV && url.protocol !== 'https:') return null;
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  } catch { return null; }
  return { manifestUrl, channel, expectedDatasetId, expectedGraphManifestSha256 };
}

function abortAfter(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', onAbort); } };
}

async function fetchBounded(url: string, signal: AbortSignal | undefined, maxBytes: number): Promise<ArrayBuffer> {
  let finalError: unknown = new Error('RETRY_EXHAUSTED');
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) throw signal.reason;
    if (RETRY_DELAYS_MS[attempt] > 0) {
      downloadRetries++; await new Promise<void>((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', aborted); resolve(); };
        const timer = setTimeout(finish, RETRY_DELAYS_MS[attempt]);
        const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal?.reason); };
        signal?.addEventListener('abort', aborted, { once: true });
      });
    }
    const bounded = abortAfter(signal, DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: bounded.signal });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!response.ok) {
        finalError = new Error(`HTTP_${response.status}`);
        if (!retryable) throw finalError;
        continue;
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
      return bytes;
    } catch (error) {
      finalError = error;
      if (signal?.aborted || String(error).includes('HTTP_4') || String(error).includes('RESPONSE_TOO_LARGE')) throw error;
    } finally { bounded.dispose(); }
  }
  throw finalError;
}

export async function discoverRegionalDistribution(
  config: RegionalDistributionConfig | null = readRegionalDistributionConfig(), signal?: AbortSignal,
): Promise<RegionalDistributionManifest | null> {
  if (!config) { manifestStatus = 'UNCONFIGURED'; return null; }
  manifestStatus = 'DISCOVERING';
  try {
    const url = new URL(config.manifestUrl);
    url.searchParams.set('channel', config.channel);
    const bytes = await fetchBounded(url.href, signal, MANIFEST_MAX_BYTES);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const manifest = await validateDistributionManifest(parsed, {
      expectedDatasetId: config.expectedDatasetId,
      expectedGraphManifestSha256: config.expectedGraphManifestSha256,
      manifestOrigin: url.origin,
    });
    if (!manifest) { lastIntegrityFailure = 'DISTRIBUTION_MANIFEST_TRUST_MISMATCH'; manifestStatus = 'FAILED'; return null; }
    await writeText(`${CACHED_MANIFEST}.next`, JSON.stringify(manifest));
    await remove(CACHED_MANIFEST); await rename(`${CACHED_MANIFEST}.next`, CACHED_MANIFEST);
    observedDatasetId = manifest.datasetId; observedDatasetVersion = manifest.datasetVersion; manifestStatus = 'READY';
    return manifest;
  } catch {
    lastDownloadFailure = 'DOWNLOAD_FAILED';
    const cached = await readText(CACHED_MANIFEST);
    if (cached) try {
      const url = new URL(config.manifestUrl);
      const manifest = await validateDistributionManifest(JSON.parse(cached), {
        expectedDatasetId: config.expectedDatasetId,
        expectedGraphManifestSha256: config.expectedGraphManifestSha256,
        manifestOrigin: url.origin,
      });
      if (manifest) {
        observedDatasetId = manifest.datasetId; observedDatasetVersion = manifest.datasetVersion;
        manifestStatus = 'READY'; return manifest;
      }
    } catch { /* güvenilir cache değil */ }
    manifestStatus = 'FAILED'; return null;
  }
}
function graphValid(bytes: ArrayBuffer, region: TurkeyGraphRegion, format: 'RTG3' | 'RTG4'): boolean {
  if (bytes.byteLength !== region.byteSize) return false;
  const parsed = parseRoutingGraph(bytes);
  return parsed.outcome === 'OK' && parsed.view?.version === (format === 'RTG4' ? 4 : 3) &&
    parsed.view.nodeCount === region.nodeCount && parsed.view.edgeCount === region.edgeCount;
}
function altValid(bytes: ArrayBuffer, region: TurkeyGraphRegion): boolean {
  if (!region.alt || bytes.byteLength !== region.alt.byteSize || bytes.byteLength < 24) return false;
  const h = new Uint32Array(bytes.slice(0, 24));
  return h[0] === ALT_MAGIC && h[1] === region.alt.schemaVersion && h[2] === region.alt.landmarkCount &&
    h[3] === region.alt.scaleM && h[4] === region.nodeCount && h[5] === region.alt.unreachableBucket;
}
async function installedValid(region: TurkeyGraphRegion, item: InstalledRegionRecord, format: 'RTG3' | 'RTG4'): Promise<boolean> {
  const graph = await readBytes(finalPath(region.regionId, item.generation, false));
  if (!graph || await digest(graph) !== item.graphSha256 || !graphValid(graph, region, format)) return false;
  if (!region.alt) return item.altSha256 === null;
  const alt = await readBytes(finalPath(region.regionId, item.generation, true));
  return !!alt && item.altSha256 === region.alt.sha256 && await digest(alt) === item.altSha256 && altValid(alt, region);
}
function newestInstalled(
  records: readonly InstalledRegionRecord[], predicate: (item: InstalledRegionRecord) => boolean,
): InstalledRegionRecord | undefined {
  return records.filter(predicate).sort((a, b) => b.installedAt.localeCompare(a.installedAt) ||
    b.generation.localeCompare(a.generation))[0];
}

export async function verifyRegionalPackagesLocal(
  graphManifestValue: unknown, regionIds: readonly string[],
): Promise<boolean> {
  const graphManifest = validateTurkeyGraphManifest(graphManifestValue);
  if (!graphManifest) return false;
  const graphManifestSha256 = await digest(new TextEncoder().encode(JSON.stringify(graphManifest)).buffer);
  const current = await registry();
  for (const id of regionIds) {
    const region = graphManifest.regions.find((r) => r.regionId === id);
    const item = newestInstalled(current.regions, (r) => r.regionId === id && r.datasetId === graphManifest.datasetId &&
      r.policyVersion === graphManifest.policyVersion && r.graphManifestSha256 === graphManifestSha256 && r.graphSha256 === region?.sha256 &&
      r.altSha256 === (region?.alt?.sha256 ?? null));
    if (!region || !item || !await installedValid(region, item, graphManifest.graphFormat)) return false;
  }
  return true;
}

export async function acquireRegionalPackages(manifestValue: unknown, regionIds: readonly string[], signal?: AbortSignal):
Promise<{ ok: true; downloaded: readonly string[] } | { ok: false; reason: RegionalDataFailure }> {
  const manifest = await validateDistributionManifest(manifestValue);
  if (!manifest) return { ok: false, reason: 'DISTRIBUTION_MANIFEST_INVALID' };
  const current = await registry(); const next = [...current.regions]; const completed: string[] = [];
  for (const id of regionIds) {
      const pkg = manifest.regions.find((p) => p.regionId === id);
    const region = manifest.graphManifest.regions.find((r) => r.regionId === id);
    if (!pkg || !region) return { ok: false, reason: 'REGIONAL_DATA_NOT_INSTALLED' };
    const old = next.find((r) => r.regionId === id && r.datasetId === manifest.datasetId &&
      r.datasetVersion === manifest.datasetVersion && r.generation === pkg.generation &&
      r.graphManifestSha256 === manifest.graphManifestSha256);
    if (old && await installedValid(region, old, manifest.graphManifest.graphFormat)) continue;
    if (!await ensureStorageCapacity(next, region.byteSize + (region.alt?.byteSize ?? 0), regionIds)) {
      lastDownloadFailure = 'INSUFFICIENT_STORAGE'; return { ok: false, reason: 'INSUFFICIENT_STORAGE' };
    }
    let phase: 'DOWNLOAD' | 'STORAGE' = 'DOWNLOAD';
    const stagingBytesBefore = stagingBytes;
    try {
      activeDownloads++;
      const graph = await fetchBounded(pkg.graphUrl, signal, region.byteSize);
      if (await digest(graph) !== region.sha256 || !graphValid(graph, region, manifest.graphManifest.graphFormat)) {
        lastIntegrityFailure = `GRAPH_INVALID:${id}`; return { ok: false, reason: 'DATA_CORRUPT' };
      }
      const alt = region.alt && pkg.altUrl ? await fetchBounded(pkg.altUrl, signal, region.alt.byteSize) : null;
      if (region.alt && !alt) { lastIntegrityFailure = `ALT_MISSING:${id}`; return { ok: false, reason: 'DATA_CORRUPT' }; }
      if (region.alt && alt && await digest(alt) !== region.alt.sha256) {
        lastIntegrityFailure = `ALT_SHA_MISMATCH:${id}`; return { ok: false, reason: 'DATA_CORRUPT' };
      }
      if (region.alt && alt && !altValid(alt, region)) {
        const h = [...new Uint32Array(alt.slice(0, 24))];
        lastIntegrityFailure = `ALT_HEADER_MISMATCH:${id}:${h.join(',')}:${[
          ALT_MAGIC, region.alt.schemaVersion, region.alt.landmarkCount, region.alt.scaleM,
          region.nodeCount, region.alt.unreachableBucket,
        ].join(',')}`;
        return { ok: false, reason: 'DATA_CORRUPT' };
      }
      phase = 'STORAGE';
      const graphStage = stagePath(id, pkg.generation, false); stagingBytes += graph.byteLength; await writeBytes(graphStage, graph);
      const altStage = stagePath(id, pkg.generation, true); if (alt) { stagingBytes += alt.byteLength; await writeBytes(altStage, alt); }
      const stagedGraph = await readBytes(graphStage);
      if (!stagedGraph || await digest(stagedGraph) !== region.sha256) throw new Error('STAGE_VERIFY');
      if (alt) { const stagedAlt = await readBytes(altStage); if (!stagedAlt || await digest(stagedAlt) !== region.alt!.sha256) throw new Error('STAGE_VERIFY'); }
      await mkdir(generationPath(id, pkg.generation));
      await remove(completionPath(id, pkg.generation));
      await remove(`${completionPath(id, pkg.generation)}.next`);
      await remove(finalPath(id, pkg.generation, false));
      await rename(graphStage, finalPath(id, pkg.generation, false)); stagingBytes -= graph.byteLength;
      if (alt) { await remove(finalPath(id, pkg.generation, true)); await rename(altStage, finalPath(id, pkg.generation, true)); stagingBytes -= alt.byteLength; }
      const now = new Date().toISOString();
      const publishedGraph = await readBytes(finalPath(id, pkg.generation, false));
      const publishedAlt = alt ? await readBytes(finalPath(id, pkg.generation, true)) : null;
      if (!publishedGraph || await digest(publishedGraph) !== region.sha256 ||
          !graphValid(publishedGraph, region, manifest.graphManifest.graphFormat) ||
          (alt && (!publishedAlt || await digest(publishedAlt) !== region.alt!.sha256 || !altValid(publishedAlt, region)))) {
        throw new Error('PUBLISHED_VERIFY');
      }
      const marker: GenerationCompletion = {
        schemaVersion: 1, regionId: id, generation: pkg.generation,
        datasetId: manifest.datasetId, datasetVersion: manifest.datasetVersion,
        policyVersion: manifest.policyVersion, graphManifestSha256: manifest.graphManifestSha256,
        graphFormat: manifest.graphManifest.graphFormat, graphSha256: region.sha256,
        graphBytes: region.byteSize, nodeCount: region.nodeCount, edgeCount: region.edgeCount,
        altPresent: !!region.alt, altSha256: region.alt?.sha256 ?? null,
        altBytes: region.alt?.byteSize ?? 0, landmarkSetId: region.alt?.landmarkSetId ?? null,
        landmarkCount: region.alt?.landmarkCount ?? null, altScaleM: region.alt?.scaleM ?? null,
        altUnreachableBucket: region.alt?.unreachableBucket ?? null, completedAt: now,
      };
      const markerNext = `${completionPath(id, pkg.generation)}.next`;
      await writeText(markerNext, JSON.stringify(marker));
      await rename(markerNext, completionPath(id, pkg.generation));
      const record: InstalledRegionRecord = { regionId: id, datasetId: manifest.datasetId,
        datasetVersion: manifest.datasetVersion, policyVersion: manifest.policyVersion, generation: pkg.generation,
        graphManifestSha256: manifest.graphManifestSha256,
        graphSha256: region.sha256, altSha256: region.alt?.sha256 ?? null, graphBytes: region.byteSize,
        altBytes: region.alt?.byteSize ?? 0, installedAt: now, lastVerifiedAt: now, lastUsedAt: null, state: 'READY' };
      const index = next.findIndex((r) => r.regionId === id && r.generation === pkg.generation);
      if (index < 0) next.push(record); else next[index] = record;
      completed.push(id);
    } catch {
      const reason: RegionalDataFailure = phase === 'STORAGE' ? 'STORAGE_FAILED' : 'DOWNLOAD_FAILED';
      lastDownloadFailure = reason; return { ok: false, reason };
    }
    finally {
      activeDownloads = Math.max(0, activeDownloads - 1);
      /* Disk dolu / yazma arızası yarım partial bırakır: temizlenmezse her
         başarısız deneme kalıcı çöp biriktirir ve bütçeyi yer. Başarıda bu
         yollar rename ile zaten taşınmıştır, silme no-op'tur. */
      try { await remove(stagePath(id, pkg.generation, false)); } catch { /* fail-soft */ }
      try { await remove(stagePath(id, pkg.generation, true)); } catch { /* fail-soft */ }
      stagingBytes = stagingBytesBefore;
    }
  }
  try {
    const evicted = planStorageEviction(next, regionIds);
    for (const item of evicted) await remove(completionPath(item.regionId, item.generation));
    await publishRegistry({ schemaVersion: 1, regions: next });
    for (const item of evicted) {
      await remove(finalPath(item.regionId, item.generation, false));
      if (item.altSha256) await remove(finalPath(item.regionId, item.generation, true));
    }
  }
  catch { return { ok: false, reason: 'STORAGE_FAILED' }; }
  return { ok: true, downloaded: completed };
}

export function configureRegionalStoragePolicy(policy: RegionalStoragePolicy | null): void {
  storagePolicy = policy && Number.isSafeInteger(policy.totalBudgetBytes) && Number.isSafeInteger(policy.minimumReserveBytes) &&
    policy.totalBudgetBytes > 0 && policy.minimumReserveBytes >= 0 && policy.minimumReserveBytes < policy.totalBudgetBytes
    ? Object.freeze({ ...policy }) : null;
}

const pinKey = (regionId: string, generation: string) => `${regionId}@${generation}`;
export async function pinRegionalDataset(
  graphManifestValue: unknown, regionIds: readonly string[],
): Promise<{ readonly datasetId: string; readonly generations: readonly string[]; release(): void } | null> {
  const graph = validateTurkeyGraphManifest(graphManifestValue); if (!graph) return null;
  const graphManifestSha256 = await digest(new TextEncoder().encode(JSON.stringify(graph)).buffer);
  const current = await registry(); const selected: InstalledRegionRecord[] = [];
  for (const id of regionIds) {
    const region = graph.regions.find((r) => r.regionId === id);
    const item = newestInstalled(current.regions, (r) => r.regionId === id && r.datasetId === graph.datasetId &&
      r.policyVersion === graph.policyVersion && r.graphManifestSha256 === graphManifestSha256 &&
      r.graphSha256 === region?.sha256 && r.altSha256 === (region?.alt?.sha256 ?? null));
    if (!region || !item || !await installedValid(region, item, graph.graphFormat)) return null;
    selected.push(item);
  }
  const keys = selected.map((item) => pinKey(item.regionId, item.generation));
  for (const key of keys) pins.set(key, (pins.get(key) ?? 0) + 1);
  let released = false;
  return Object.freeze({ datasetId: graph.datasetId, generations: Object.freeze(selected.map((i) => i.generation)),
    release() { if (released) return; released = true; for (const key of keys) { const n = (pins.get(key) ?? 1) - 1; if (n <= 0) pins.delete(key); else pins.set(key, n); } } });
}

async function ensureStorageCapacity(records: InstalledRegionRecord[], incomingBytes: number, protectedRegionIds: readonly string[]): Promise<boolean> {
  if (!storagePolicy) return true;
  let installed = records.reduce((sum, item) => sum + item.graphBytes + item.altBytes, 0);
  const limit = storagePolicy.totalBudgetBytes - storagePolicy.minimumReserveBytes;
  if (incomingBytes > limit) return false;
  const candidates = records.filter((item) => !protectedRegionIds.includes(item.regionId) &&
    !pins.has(pinKey(item.regionId, item.generation))).sort((a, b) =>
      String(a.lastUsedAt ?? a.installedAt).localeCompare(String(b.lastUsedAt ?? b.installedAt)) ||
      pinKey(a.regionId, a.generation).localeCompare(pinKey(b.regionId, b.generation)));
  for (const item of candidates) {
    if (installed + incomingBytes <= limit) break;
    installed -= item.graphBytes + item.altBytes;
  }
  return installed + incomingBytes <= limit;
}

function planStorageEviction(records: InstalledRegionRecord[], protectedRegionIds: readonly string[]): InstalledRegionRecord[] {
  if (!storagePolicy) return [];
  const limit = storagePolicy.totalBudgetBytes - storagePolicy.minimumReserveBytes;
  let installed = records.reduce((sum, item) => sum + item.graphBytes + item.altBytes, 0);
  const candidates = records.filter((item) => !protectedRegionIds.includes(item.regionId) &&
    !pins.has(pinKey(item.regionId, item.generation))).sort((a, b) =>
      String(a.lastUsedAt ?? a.installedAt).localeCompare(String(b.lastUsedAt ?? b.installedAt)) ||
      pinKey(a.regionId, a.generation).localeCompare(pinKey(b.regionId, b.generation)));
  const evicted: InstalledRegionRecord[] = [];
  for (const item of candidates) {
    if (installed <= limit) break;
    const index = records.indexOf(item); if (index >= 0) records.splice(index, 1);
    installed -= item.graphBytes + item.altBytes;
    evicted.push(item);
  }
  if (installed > limit) throw new Error('INSUFFICIENT_STORAGE');
  return evicted;
}

export async function cleanupUnpinnedOldGenerations(): Promise<number> {
  const current = await registry(); const latest = new Map<string, InstalledRegionRecord>();
  for (const item of current.regions) {
    const previous = latest.get(item.regionId);
    if (!previous || item.installedAt > previous.installedAt) latest.set(item.regionId, item);
  }
  const keep: InstalledRegionRecord[] = []; const candidates: InstalledRegionRecord[] = [];
  for (const item of current.regions) {
    if (latest.get(item.regionId) === item || pins.has(pinKey(item.regionId, item.generation))) { keep.push(item); continue; }
    candidates.push(item);
  }
  if (!candidates.length) return 0;
  for (const item of candidates) await remove(completionPath(item.regionId, item.generation));
  await publishRegistry({ schemaVersion: 1, regions: keep });
  for (const item of candidates) {
    await remove(finalPath(item.regionId, item.generation, false));
    if (item.altSha256) await remove(finalPath(item.regionId, item.generation, true));
  }
  return candidates.length;
}

/** Residency'nin tek salt-okunur kurulu-artefakt sınırı; indirme başlatmaz. */
export async function readInstalledRegionalArtifact(
  region: TurkeyGraphRegion, kind: 'graph' | 'alt',
): Promise<ArrayBuffer | null> {
  const current = await registry();
  const item = newestInstalled(current.regions, (r) => r.regionId === region.regionId &&
    r.graphSha256 === region.sha256 && r.altSha256 === (region.alt?.sha256 ?? null));
  if (!item || (kind === 'alt' && !region.alt)) return null;
  const bytes = await readBytes(finalPath(region.regionId, item.generation, kind === 'alt'));
  const expected = kind === 'graph' ? region.sha256 : region.alt!.sha256;
  return bytes && await digest(bytes) === expected ? bytes : null;
}

/** CAROS LAB için salt-okunur, koordinat/URL taşımayan gerçek veri projeksiyonu. */
export async function getRegionalDataSnapshot(): Promise<Readonly<RegionalDistributionSnapshot>> {
  const current = await registry();
  return buildSnapshot(current);
}
export function getRegionalDistributionSnapshotSync(): Readonly<RegionalDistributionSnapshot> {
  return buildSnapshot(registryCache);
}
function buildSnapshot(current: RegistryFile): Readonly<RegionalDistributionSnapshot> {
  const installedGraphBytes = current.regions.reduce((sum, item) => sum + item.graphBytes, 0);
  const installedAltBytes = current.regions.reduce((sum, item) => sum + item.altBytes, 0);
  const pinnedBytes = current.regions.filter((item) => pins.has(pinKey(item.regionId, item.generation)))
    .reduce((sum, item) => sum + item.graphBytes + item.altBytes, 0);
  return Object.freeze({
    manifestStatus,
    datasetId: observedDatasetId,
    datasetVersion: observedDatasetVersion,
    installedRegions: current.regions.length,
    installedGraphBytes,
    installedAltBytes,
    diskBudgetBytes: storagePolicy?.totalBudgetBytes ?? null,
    pinnedBytes,
    evictableBytes: installedGraphBytes + installedAltBytes - pinnedBytes,
    activeDownloads,
    downloadRetries,
    stagingBytes,
    lastDownloadFailure,
    lastIntegrityFailure,
    registryRecoveryStatus,
    recoveredGenerations,
    rejectedGenerations,
    orphanGenerations,
    lastRebuildFailure,
    lastPublishFailure,
  });
}

/** Test composition seam'i; production seçimi Capacitor/Directory.Data olarak kalır. */
export function _setRegionalDataStorageAdapterForTest(adapter: RegionalDataStorageAdapter | null): void {
  injectedStorage = adapter;
}

/** Process yeniden başlamasını storage'ı silmeden taklit eder. */
export function _restartRegionalDataRuntimeForTest(): void {
  pins.clear(); storagePolicy = null; manifestStatus = 'UNCONFIGURED';
  observedDatasetId = null; observedDatasetVersion = null; activeDownloads = 0;
  downloadRetries = 0; stagingBytes = 0; lastDownloadFailure = null; lastIntegrityFailure = null;
  registryRecoveryStatus = 'EMPTY'; recoveredGenerations = 0; rejectedGenerations = 0; orphanGenerations = 0;
  lastRebuildFailure = null; lastPublishFailure = null; registryCache = { schemaVersion: 1, regions: [] };
}

/** Test izolasyonu; ürün API'si değildir. */
export function _resetRegionalDataForTest(): void {
  injectedStorage = null; volatile.clear(); _restartRegionalDataRuntimeForTest();
}

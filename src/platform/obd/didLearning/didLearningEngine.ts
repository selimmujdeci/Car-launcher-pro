/**
 * didLearningEngine — HER araçta otomatik üretici-DID keşfi + anlamlandırma.
 *
 * Saha 2026-09-23'te elle yapılan yolun (maske zinciri → üçlü okuma → sürüş
 * korelasyonu) ürünleşmiş hâli. DI'lı; gerçek bağlantılar `discovery/discoveryLive`
 * içinde (aktif tarama otoritesi — bkz. deepScanAuthority).
 *
 * ── AŞAMALAR ────────────────────────────────────────────────────────────────
 *  1. KİMLİK   — ECU'dan F187 (parça no) + F195 (yazılım) → ECU anahtarı, kayıt.
 *  2. SAYIM    — YALNIZ PARKTA (`canStartDeepScan`): maske tabanlarını yokla, maskeyi
 *                iki yönlü DOĞRULA (var diyen yanıt vermeli, yok diyen reddedilmeli),
 *                zinciri yürü, DID uzunluklarını üçlü okumayla çıkar. ECU'da başına bir kez.
 *  3. ÖRNEKLEME— her hızda, BÜTÇELİ (istekler arası boşluk, tek istek uçuşta), çekirdek
 *                veri bayatsa geri çekilir. Önce tam taramalar (sınıflandırma), sonra canlı
 *                DID'lere odak.
 *  4. ANALİZ   — periyodik: sınıf + referans eşleşmesi → oturum kanıtı → kayıt (terfi
 *                kuralı didLearningStore'da). Kanıtlı küme değişince profil katmanı yenilenir.
 *
 * GÜVENLİK: yalnız servis 22 (salt-okuma); oturum değiştirme/yazma YOK. Hat hatası araç
 * hakkında kanıt sayılmaz. Hiçbir hata OBD akışına sızmaz (fail-soft).
 */
import {
  DEFAULT_MASK_BASES, MAX_MASK_CHAIN_LENGTH, MASK_BLOCK, evaluateMaskSemantics, parseSupportMask,
  pickMaskProbes, toDidHex, type ProbeOutcome,
} from './supportBitmap';
import { chunkDids, hexToUnsigned, splitMultiDidResponse } from './multiDidCodec';
import { classifyDidSamples, type DidBehaviorClass, type DidSample } from './didClassifier';
import { matchDid, type RefSample } from './semanticMatcher';
import type { ReferenceKey } from './referenceCatalog';
import {
  emptyRecord, loadRecord, makeEcuKey, mergeSessionMatch, provenProfileFragment, saveRecord,
  type EcuLearningRecord,
} from './didLearningStore';
import type { DiscoveryHealthSnapshot } from '../discovery/discoverySafetyPolicy';
import { canStartDeepScan } from '../discovery/discoverySafetyPolicy';
import type { VehicleDidDef, VehicleEcuDef } from '../vehicleDidProfile';

export interface ReadDidResult { data: string | null; supported: boolean; kind?: 'OK' | 'NO_DATA' | 'NEG_7F'; nrc?: number | null }

export interface EngineDeps {
  readObdDid: (o: { tx: string; rx: string; did: string; service: '22' }) => Promise<ReadDidResult>;
  getHealth: () => DiscoveryHealthSnapshot;
  /** Hedef ECU'lar (motor önce). Boşsa 7E0/7E8. */
  listEcus: () => Promise<ReadonlyArray<{ tx: string; rx: string }>>;
  getVinHash: () => string | null;
  /** O ana kadar biriken referans örneklerini verir (tüketir). */
  drainReferences: () => ReadonlyArray<{ key: ReferenceKey; t: number; value: number }>;
  onProvenProfile: (fragment: { ecus: VehicleEcuDef[]; dids: VehicleDidDef[] }) => void;
  isEnabled: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** İstekler arası asgari boşluk (çekirdek poll'a yer). */
  requestGapMs?: number;
  analyzeEveryMs?: number;
}

export type EnginePhase = 'idle' | 'identifying' | 'enumerating' | 'sampling' | 'paused' | 'stopped';

export interface EcuRuntimeView {
  readonly ecuKey: string;
  readonly tx: string;
  readonly rx: string;
  readonly partNo: string | null;
  readonly software: string | null;
  readonly enumeratedCount: number;
  readonly sampledSweeps: number;
  readonly counts: Readonly<Record<string, number>>;
}

export interface EngineStatus {
  readonly phase: EnginePhase;
  readonly sessionId: string | null;
  readonly requests: number;
  readonly lastError: string | null;
  readonly ecus: readonly EcuRuntimeView[];
}

interface EcuRuntime {
  rec: EcuLearningRecord;
  tx: string;
  rx: string;
  dids: string[];
  lengths: Map<string, number>;
  samples: Map<string, DidSample[]>;
  lastHex: Map<string, string>;
  sweeps: number;
  cursor: number;
  focus: string[];
  /** Bu oturumda sayım denendi mi (maske yoksa her turda yeniden yoklanmaz). */
  enumAttempted: boolean;
  /** Art arda okunamayan DID sayacı — eşik aşılınca havuzdan çıkarılır. */
  failures: Map<string, number>;
}

const MAX_DID_SAMPLES = 400;
const MAX_REF_SAMPLES = 4000;
const FOCUS_CAP = 30;
/** Tam taramadan sonra odak listesine geçmeden önceki tur sayısı. */
const CLASSIFY_SWEEPS = 3;
/** Odak turunda her N istekte bir, yavaş (sabit/bayrak) DID'lerden bir grup okunur. */
const SLOW_LANE_EVERY = 6;
/** Tekli okumada art arda bu kadar ret → DID bu oturumda havuzdan çıkarılır. */
const UNREADABLE_AFTER = 3;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

function asciiOf(hex: string | null): string | null {
  if (!hex) return null;
  let s = '';
  for (let i = 0; i + 2 <= hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  s = s.trim();
  return s.length > 0 ? s : null;
}

export class DidLearningEngine {
  private readonly d: EngineDeps;
  private phase: EnginePhase = 'idle';
  private sessionId: string | null = null;
  private running = false;
  private stopRequested = false;
  private ecus: EcuRuntime[] = [];
  private refs = new Map<ReferenceKey, RefSample[]>();
  private requests = 0;
  private lastError: string | null = null;
  private lastAnalyzeAt = 0;
  private lastProvenSignature = '';

  constructor(deps: EngineDeps) { this.d = deps; }

  private now(): number { return (this.d.now ?? Date.now)(); }
  private sleep(ms: number): Promise<void> { return (this.d.sleep ?? defaultSleep)(ms); }

  status(): EngineStatus {
    return {
      phase: this.phase, sessionId: this.sessionId, requests: this.requests, lastError: this.lastError,
      ecus: this.ecus.map((e) => {
        const counts: Record<string, number> = {};
        for (const d of Object.values(e.rec.dids)) {
          counts[d.cls] = (counts[d.cls] ?? 0) + 1;
          counts[d.status] = (counts[d.status] ?? 0) + 1;
        }
        return {
          ecuKey: e.rec.ecuKey, tx: e.tx, rx: e.rx, partNo: e.rec.partNo, software: e.rec.software,
          enumeratedCount: e.dids.length, sampledSweeps: e.sweeps, counts,
        };
      }),
    };
  }

  records(): EcuLearningRecord[] { return this.ecus.map((e) => e.rec); }

  /** Oturumu başlatır; zaten çalışıyorsa no-op. Döngü `stop()` ya da bağlantı kaybına dek sürer. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.sessionId = `s${this.now().toString(36)}`;
    try {
      await this.run();
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.analyze(true);
      this.running = false;
      this.phase = 'stopped';
    }
  }

  stop(): void { this.stopRequested = true; }

  private healthy(): boolean {
    const h = this.d.getHealth();
    return h.connectionState === 'connected' && h.source === 'real' && h.dataFresh === true;
  }

  private async read(tx: string, rx: string, did: string): Promise<ReadDidResult | null> {
    this.requests++;
    try { return await this.d.readObdDid({ tx, rx, did, service: '22' }); } catch { return null; }
  }

  private outcomeOf(r: ReadDidResult | null): ProbeOutcome {
    if (!r) return 'error';
    if (r.kind === 'OK' && r.data) return 'ok';
    if (r.kind === 'NEG_7F') return 'rejected';
    if (r.kind === 'NO_DATA') return 'no_data';
    return r.supported && r.data ? 'ok' : 'rejected';
  }

  private async run(): Promise<void> {
    this.phase = 'identifying';
    const targets = await this.d.listEcus();
    const list = targets.length > 0 ? targets : [{ tx: '7E0', rx: '7E8' }];
    this.ecus = [];
    for (const t of list) {
      if (this.stopRequested || !this.d.isEnabled()) return;
      const part = asciiOf((await this.read(t.tx, t.rx, 'F187'))?.data ?? null);
      const sw = asciiOf((await this.read(t.tx, t.rx, 'F195'))?.data ?? null);
      const key = makeEcuKey(t.rx, part, sw, this.d.getVinHash());
      const rec = loadRecord(key) ?? emptyRecord(key, t.tx, t.rx, part, sw);
      rec.sessions += 1;
      const lengths = new Map<string, number>();
      for (const d of Object.values(rec.dids)) lengths.set(d.did, d.bytes);
      this.ecus.push({
        rec, tx: t.tx, rx: t.rx, dids: Object.keys(rec.dids).sort(), lengths,
        samples: new Map(), lastHex: new Map(), sweeps: 0, cursor: 0, focus: [],
        enumAttempted: false, failures: new Map(),
      });
    }
    this.publishProven(true);

    /* ÖRNEKLEME + FIRSATÇI SAYIM. Sayım yalnız parkta yapılır ama örneklemeyi
       BLOKLAMAZ (saha incelemesi: yeni bir ECU park beklerken sayımı bitmiş ECU'ların
       örneklenmesi tamamen duruyordu). Araç durduğu ilk anda sayılmamış ECU sayılır. */
    const gap = this.d.requestGapMs ?? 600;
    let tick = 0;
    while (!this.stopRequested && this.d.isEnabled()) {
      const h = this.d.getHealth();
      if (h.connectionState !== 'connected' || h.source !== 'real') break; // oturum bitti
      if (!this.healthy()) { this.phase = 'paused'; await this.sleep(3000); continue; }

      const pending = this.ecus.find((x) => !(x.rec.enumeration && x.dids.length > 0) && !x.enumAttempted);
      if (pending && canStartDeepScan(h).allowed) {
        this.phase = 'enumerating';
        pending.enumAttempted = true;
        await this.enumerate(pending);
        saveRecord(pending.rec);
        continue;
      }

      const sampleable = this.ecus.filter((x) => x.dids.length > 0);
      if (sampleable.length === 0) { this.phase = 'paused'; await this.sleep(3000); continue; }
      this.phase = 'sampling';
      const e = sampleable[tick % sampleable.length]!;
      tick++;
      await this.sampleNext(e, tick);
      this.ingestReferences();
      if (this.now() - this.lastAnalyzeAt >= (this.d.analyzeEveryMs ?? 60_000)) this.analyze(false);
      await this.sleep(gap);
    }
  }

  /* ── 2. SAYIM ─────────────────────────────────────────────────────────── */

  private async enumerate(e: EcuRuntime): Promise<void> {
    const found = new Set<number>();
    const bases: string[] = [];
    for (const base of DEFAULT_MASK_BASES) {
      if (this.stopRequested) return;
      const first = await this.read(e.tx, e.rx, toDidHex(base));
      const mask = parseSupportMask(base, first?.kind === 'OK' ? first.data : null);
      if (!mask || (mask.supported.length === 0 && !mask.continues)) continue;
      // İki yönlü doğrulama — 4 bayt tek başına maske kanıtı DEĞİL.
      const probes = pickMaskProbes(mask);
      const claimed: ProbeOutcome[] = [];
      for (const d of probes.claimed) claimed.push(this.outcomeOf(await this.read(e.tx, e.rx, toDidHex(d))));
      const unclaimed: ProbeOutcome[] = [];
      for (const d of probes.unclaimed) unclaimed.push(this.outcomeOf(await this.read(e.tx, e.rx, toDidHex(d))));
      if (evaluateMaskSemantics(claimed, unclaimed) !== 'CONFIRMED') continue;
      bases.push(toDidHex(base));
      let cur: typeof mask | null = mask;
      for (let i = 0; cur && i < MAX_MASK_CHAIN_LENGTH; i++) {
        cur.supported.forEach((d) => found.add(d));
        if (!cur.continues) break;
        const nb = cur.base + MASK_BLOCK;
        const r = await this.read(e.tx, e.rx, toDidHex(nb));
        cur = parseSupportMask(nb, r?.kind === 'OK' ? r.data : null);
      }
    }
    e.rec.enumeration = { method: bases.length > 0 ? 'mask_chain' : 'none', maskBases: bases, at: this.now() };
    e.dids = [...found].sort((a, b) => a - b).map(toDidHex);
    // Uzunluk + ilk değer: üçlü okuma; ayrılamayan grup tekli okumaya düşer.
    for (const group of chunkDids(e.dids)) {
      if (this.stopRequested) return;
      await this.readGroup(e, group, true);
    }
  }

  /** Grubu okur, örnekleri kaydeder. `learnLengths` iken ayrılamazsa tekliye düşer. */
  private async readGroup(e: EcuRuntime, group: readonly string[], learnLengths: boolean): Promise<void> {
    const t = this.now();
    const r = await this.read(e.tx, e.rx, group.join(''));
    let parts: Map<string, string> | null = null;
    if (r && r.kind === 'OK' && r.data) parts = splitMultiDidResponse(group, r.data, e.lengths);
    if (!parts && group.length > 1) {
      for (const did of group) await this.readGroup(e, [did], learnLengths);
      return;
    }
    if (!parts) {
      // Tekli okuma da başarısız: maske "var" dese de şu an okunamıyor. Hat hatası (r=null)
      // araç hakkında kanıt değildir → sayılmaz. Eşik aşılınca havuzdan çıkar (grup bozulmasın).
      if (r) {
        const did = group[0]!;
        const n = (e.failures.get(did) ?? 0) + 1;
        e.failures.set(did, n);
        if (n >= UNREADABLE_AFTER) {
          e.dids = e.dids.filter((d) => d !== did);
          e.focus = e.focus.filter((d) => d !== did);
        }
      }
      return;
    }
    for (const did of parts.keys()) e.failures.delete(did);
    for (const [did, hex] of parts) {
      if (learnLengths || !e.lengths.has(did)) e.lengths.set(did, hex.length / 2);
      e.lastHex.set(did, hex);
      const arr = e.samples.get(did) ?? [];
      arr.push({ t, raw: hexToUnsigned(hex) });
      if (arr.length > MAX_DID_SAMPLES) arr.splice(0, arr.length - MAX_DID_SAMPLES);
      e.samples.set(did, arr);
    }
  }

  /* ── 3. ÖRNEKLEME ─────────────────────────────────────────────────────── */

  private async sampleNext(e: EcuRuntime, tick: number): Promise<void> {
    const inFocus = e.sweeps >= CLASSIFY_SWEEPS && e.focus.length > 0;
    let pool: string[];
    if (!inFocus || tick % SLOW_LANE_EVERY === 0) pool = e.dids;
    else pool = e.focus;
    const groups = chunkDids(pool);
    if (groups.length === 0) return;
    const idx = e.cursor % groups.length;
    await this.readGroup(e, groups[idx]!, false);
    e.cursor++;
    if (!inFocus && idx === groups.length - 1) {
      e.sweeps++;
      if (e.sweeps >= CLASSIFY_SWEEPS) this.rebuildFocus(e);
      e.cursor = 0;
    }
  }

  private rebuildFocus(e: EcuRuntime): void {
    const scored: Array<[string, number]> = [];
    for (const did of e.dids) {
      const s = e.samples.get(did) ?? [];
      const distinct = new Set(s.map((x) => x.raw)).size;
      const bytes = e.lengths.get(did) ?? 1;
      if (distinct <= 1) continue;
      if (bytes <= 1 && distinct <= 6) continue; // bayrak — anlamlandırıcı eşlemez
      scored.push([did, distinct]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    e.focus = scored.slice(0, FOCUS_CAP).map(([d]) => d);
  }

  private ingestReferences(): void {
    for (const s of this.d.drainReferences()) {
      if (!Number.isFinite(s.value)) continue;
      const arr = this.refs.get(s.key) ?? [];
      if (arr.length > 0 && arr[arr.length - 1]!.t > s.t) continue; // zaman sırası korunur
      arr.push({ t: s.t, value: s.value });
      if (arr.length > MAX_REF_SAMPLES) arr.splice(0, arr.length - MAX_REF_SAMPLES);
      this.refs.set(s.key, arr);
    }
  }

  /* ── 4. ANALİZ ────────────────────────────────────────────────────────── */

  private analyze(final: boolean): void {
    this.lastAnalyzeAt = this.now();
    if (!this.sessionId) return;
    this.ingestReferences();
    for (const e of this.ecus) {
      // Odak DURAĞAN DEĞİL: rölantide sabit olup sürüşte değişen DID'ler (pedal, basınç)
      // yavaş şerit örnekleriyle yakalanır ve odağa girer.
      if (e.sweeps >= CLASSIFY_SWEEPS) this.rebuildFocus(e);
      for (const did of e.dids) {
        const samples = e.samples.get(did);
        if (!samples || samples.length === 0) continue;
        const bytes = e.lengths.get(did) ?? Math.max(1, (e.lastHex.get(did)?.length ?? 2) / 2);
        const cls: DidBehaviorClass = classifyDidSamples(samples, bytes);
        const match = cls === 'ANALOG' || cls === 'COUNTER' ? matchDid(samples, bytes, this.refs) : null;
        mergeSessionMatch(e.rec, did, bytes, cls, match, this.sessionId, e.lastHex.get(did) ?? '', this.now());
      }
      if (e.samples.size > 0 || final) saveRecord(e.rec);
    }
    this.publishProven(false);
  }

  private publishProven(force: boolean): void {
    const ecus: VehicleEcuDef[] = [];
    const dids: VehicleDidDef[] = [];
    for (const e of this.ecus) {
      const f = provenProfileFragment(e.rec);
      ecus.push(...f.ecus);
      dids.push(...f.dids);
    }
    const sig = dids.map((d) => `${d.ecu}:${d.did}:${d.decode.a}:${d.decode.b}`).sort().join('|');
    if (!force && sig === this.lastProvenSignature) return;
    this.lastProvenSignature = sig;
    try { this.d.onProvenProfile({ ecus, dids }); } catch { /* gösterim hatası öğrenmeyi durdurmaz */ }
  }
}

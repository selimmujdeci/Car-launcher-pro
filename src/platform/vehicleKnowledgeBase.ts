/**
 * vehicleKnowledgeBase — Araç Bilgi Tabanı TEMELİ (PR-28, foundation-only).
 *
 * AMAÇ: PR-25/26/27 ile öğrenilen bilgileri (VehicleKnowledge) araç bazlı, ORGANİZE,
 * istatistikli bir YEREL bilgi tabanına dönüştürür. Her fingerprint için tek bir zengin
 * kayıt tutar; aynı bilgiyi tekrar yazmaz; yerel istatistik üretir; offline-first çalışır.
 *
 * KATMAN (Clean Architecture): bu KB bir PROJEKSİYON/ORGANİZASYON katmanıdır. Auto Learning'in
 * yazdığı VehicleKnowledge'ı (fingerprint deposundan) SALT-OKUNUR okur ve kendi ayrı deposuna
 * (car-vehicle-knowledge-base) işler. Öğrenme/fingerprint/discovery mantığını DEĞİŞTİRMEZ.
 *
 * KESİN SINIRLAR (CLAUDE.md): Native OBD / poll / Discovery Pipeline-Queue / Auto Learning /
 * Fingerprint algoritması / PID-DID Registry / SQL-Supabase DEĞİŞMEZ. Cloud/AI/SQL YOK.
 * TAMAMEN ADDITIVE + FAIL-SOFT + zero-leak + bounded: KB çökse bile OBD/Discovery/Fingerprint/
 * Auto Learning akışları aynen sürer.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';
import { useVidStore, type VidStore } from '../store/useVidStore';
import {
  discoveryCaptureService,
  type DiscoveryObservation,
} from './obd/discovery';
import {
  buildFingerprint,
  vehicleFingerprintStore,
  VehicleFingerprintStore,
} from './vehicleFingerprintService';
import {
  isConnectionComplete,
  assembleFingerprintInput,
} from './vehicleFingerprintBuilder';
import {
  deriveConfidence,
  type VehicleKnowledge,
  type DiscoveredSignal,
} from './autoLearningEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Bilgi kaydı (knowledge record) — araç başına organize bilgi tabanı
 * ════════════════════════════════════════════════════════════════════════ */

export interface VehicleKnowledgeRecord {
  /** Parmak izi kimliği (bilgi tabanı anahtarı). */
  fingerprintHash:  string;
  /** VIN'den bağımsız araç imzası (protocol + ECU seti). */
  vehicleSignature: string;
  vin:              string;
  profileHint:      string;
  protocol:         string;

  /** Öğrenilen PID istatistikleri (id → firstSeen/lastSeen/seenCount/confidence). */
  discoveredPids:   Record<string, DiscoveredSignal>;
  /** Öğrenilen DID istatistikleri. */
  discoveredDids:   Record<string, DiscoveredSignal>;
  /** Gözlemlenen ECU adresleri (normalize + sıralı). */
  discoveredEcus:   string[];

  firstSeen:        number;
  lastSeen:         number;

  /** Toplam bağlantı (oturum) sayısı — fingerprint sourceCount ile beslenir. */
  totalConnections: number;
  /** Toplam keşif gözlemi (tüm PID+DID seenCount toplamı). */
  totalDiscoveries: number;

  confidence:       number;

  /** Görülen firmware/kalibrasyon sürümleri (tekilleştirilmiş). */
  firmwareVersions: string[];
  /** Desteklenen OBD modları (PID→'01', DID→'22'; türetilmiş). */
  supportedModes:   string[];
}

/** Araç bazlı özet istatistik. */
export interface VehicleKnowledgeStats {
  totalPids:        number;
  totalDids:        number;
  totalEcus:        number;
  totalDiscoveries: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF birleştirme / türetme
 * ════════════════════════════════════════════════════════════════════════ */

function _uniqSorted(...lists: readonly string[][]): string[] {
  const set = new Set<string>();
  for (const l of lists) for (const s of l) if (s) set.add(s);
  return [...set].sort();
}

function _sumSeen(map: Record<string, DiscoveredSignal>): number {
  let n = 0;
  for (const k in map) n += map[k]?.seenCount ?? 0;
  return n;
}

/**
 * İki sinyal haritasını birleştirir (bilgi tabanı için): sinyal başına firstSeen KORUNUR
 * (min), lastSeen GÜNCELLENİR (max), seenCount = max (Auto Learning kümülatif sayacı
 * yetkili), confidence = seenCount'tan yeniden türetilir (monotonik). Duplicate oluşmaz.
 */
function _mergeSignals(
  existing: Record<string, DiscoveredSignal>,
  incoming: Record<string, DiscoveredSignal>,
): Record<string, DiscoveredSignal> {
  const out: Record<string, DiscoveredSignal> = { ...existing };
  for (const id in incoming) {
    const inc = incoming[id];
    if (!inc) continue;
    const cur = out[id];
    const seenCount = Math.max(cur?.seenCount ?? 0, inc.seenCount ?? 0);
    out[id] = {
      firstSeen:  cur ? Math.min(cur.firstSeen, inc.firstSeen) : inc.firstSeen, // İLK görülme KORUNUR
      lastSeen:   Math.max(cur?.lastSeen ?? 0, inc.lastSeen ?? 0),
      seenCount,
      confidence: deriveConfidence(seenCount),
    };
  }
  return out;
}

function _maxSignalConfidence(...maps: Record<string, DiscoveredSignal>[]): number {
  let c = 0;
  for (const m of maps) for (const k in m) c = Math.max(c, m[k]?.confidence ?? 0);
  return c;
}

/**
 * Mevcut kayıt (veya null) + yeni öğrenilmiş bilgi → güncel bilgi kaydı. İLK görülme
 * korunur, son görülme/istatistik/confidence güncellenir; aynı bilgi tekrar yazılmaz
 * (idempotent). SAF — depoya dokunmaz.
 */
export function buildKnowledgeRecord(
  existing: VehicleKnowledgeRecord | null,
  k: VehicleKnowledge,
  now: number = Date.now(),
): VehicleKnowledgeRecord {
  const incPids = k.discoveredPids ?? {};
  const incDids = k.discoveredDids ?? {};
  const pids = _mergeSignals(existing?.discoveredPids ?? {}, incPids);
  const dids = _mergeSignals(existing?.discoveredDids ?? {}, incDids);
  const ecus = _uniqSorted(existing?.discoveredEcus ?? [], k.ecuAddresses ?? []);
  const fw = _uniqSorted(
    existing?.firmwareVersions ?? [],
    k.metadata?.firmwareVersion ? [k.metadata.firmwareVersion] : [],
  );

  const modes: string[] = [];
  if (Object.keys(pids).length > 0) modes.push('01');
  if (Object.keys(dids).length > 0) modes.push('22');

  const kFirst = k.firstSeen ?? now;
  const kLast = k.lastSeen ?? now;

  return {
    fingerprintHash:  k.hash,
    vehicleSignature: `${(k.protocol ?? '').toUpperCase()}::${ecus.join(',')}`,
    vin:              k.vin ?? '',
    profileHint:      k.profileHint ?? '',
    protocol:         k.protocol ?? '',
    discoveredPids:   pids,
    discoveredDids:   dids,
    discoveredEcus:   ecus,
    firstSeen:        existing ? Math.min(existing.firstSeen, kFirst) : kFirst, // KORUNUR
    lastSeen:         Math.max(existing?.lastSeen ?? 0, kLast),
    totalConnections: k.sourceCount ?? existing?.totalConnections ?? 1,
    totalDiscoveries: _sumSeen(pids) + _sumSeen(dids),
    confidence:       Math.max(existing?.confidence ?? 0, k.confidence ?? 0, _maxSignalConfidence(pids, dids)),
    firmwareVersions: fw,
    supportedModes:   modes,
  };
}

/** Bir bilgi kaydından araç bazlı özet istatistik hesaplar (SAF). */
export function vehicleStats(record: VehicleKnowledgeRecord): VehicleKnowledgeStats {
  return {
    totalPids:        Object.keys(record.discoveredPids).length,
    totalDids:        Object.keys(record.discoveredDids).length,
    totalEcus:        record.discoveredEcus.length,
    totalDiscoveries: record.totalDiscoveries,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded (max 8) LRU kalıcı depo — safeStorage (offline-first, ağ YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export const VEHICLE_KNOWLEDGE_STORAGE_KEY = 'car-vehicle-knowledge-base';
export const MAX_KNOWLEDGE_RECORDS = 8;

/**
 * Araç bilgi tabanı deposu — bounded(8) LRU, safeStorage ile kalıcı, ağ YOK. En yeni-görülen
 * BAŞTA; upsert kaydı öne taşır; taşınca en eski düşer. Bozuk veri → fail-soft boş liste.
 */
export class VehicleKnowledgeBaseStore {
  private _items: VehicleKnowledgeRecord[] = [];
  private _loaded = false;
  private readonly storageKey: string;
  private readonly maxItems: number;

  constructor(storageKey = VEHICLE_KNOWLEDGE_STORAGE_KEY, maxItems = MAX_KNOWLEDGE_RECORDS) {
    this.storageKey = storageKey;
    this.maxItems = maxItems;
  }

  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = safeGetRaw(this.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) this._items = parsed as VehicleKnowledgeRecord[];
      }
    } catch {
      this._items = [];
    }
  }

  private _persist(): void {
    try { safeSetRaw(this.storageKey, JSON.stringify(this._items)); } catch { /* kota — fail-soft */ }
  }

  /** Kaydı ekler/günceller (fingerprintHash ile upsert) ve LRU önüne taşır. */
  save(record: VehicleKnowledgeRecord): VehicleKnowledgeRecord {
    this._ensureLoaded();
    const idx = this._items.findIndex((x) => x.fingerprintHash === record.fingerprintHash);
    if (idx >= 0) this._items.splice(idx, 1);
    this._items.unshift(record);
    if (this._items.length > this.maxItems) this._items.length = this.maxItems; // en eski düşer
    this._persist();
    return record;
  }

  /** hash ile kaydı getirir (kopya) veya null. */
  get(hash: string): VehicleKnowledgeRecord | null {
    this._ensureLoaded();
    const found = this._items.find((x) => x.fingerprintHash === hash);
    return found ? { ...found } : null;
  }

  /** Tüm kayıtların kopyası (en yeni-görülen başta). */
  list(): VehicleKnowledgeRecord[] {
    this._ensureLoaded();
    return this._items.map((x) => ({ ...x }));
  }

  remove(hash: string): boolean {
    this._ensureLoaded();
    const idx = this._items.findIndex((x) => x.fingerprintHash === hash);
    if (idx < 0) return false;
    this._items.splice(idx, 1);
    this._persist();
    return true;
  }

  clear(): void {
    this._items = [];
    this._loaded = true;
    try { safeRemoveRaw(this.storageKey); } catch { /* yoksay */ }
  }

  get size(): number {
    this._ensureLoaded();
    return this._items.length;
  }
}

/** Uygulama geneli tekil bilgi tabanı deposu. Testler kendi örneğini kurar. */
export const vehicleKnowledgeBaseStore = new VehicleKnowledgeBaseStore();

/**
 * Bir VehicleKnowledge'ı bilgi tabanına işler (upsert): mevcut kayıt güncellenir, duplicate
 * oluşmaz. SAF birleştirme + depo yazımı. @returns güncel kayıt.
 */
export function upsertKnowledge(
  k: VehicleKnowledge,
  store: VehicleKnowledgeBaseStore = vehicleKnowledgeBaseStore,
  now: number = Date.now(),
): VehicleKnowledgeRecord {
  const existing = store.get(k.hash);
  const record = buildKnowledgeRecord(existing, k, now);
  return store.save(record);
}

/* ══════════════════════════════════════════════════════════════════════════
 * VehicleKnowledgeBase — Discovery + VID aboneliği (ince sarmalayıcı)
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleKnowledgeBase {
  private _unsubDisc: (() => void) | null = null;
  private _unsubVid: (() => void) | null = null;

  constructor(
    private readonly _kbStore: VehicleKnowledgeBaseStore = vehicleKnowledgeBaseStore,
    private readonly _fpStore: VehicleFingerprintStore = vehicleFingerprintStore,
    private readonly _readVid: () => VidStore = () => useVidStore.getState(),
    private readonly _readObs: () => DiscoveryObservation[] = () => discoveryCaptureService.getObservations(),
    private readonly _now: () => number = () => Date.now(),
  ) {}

  /** Discovery + VID aboneliklerini başlatır (idempotent). Döndürülen fonksiyon durdurur. */
  start(): () => void {
    if (this._unsubDisc || this._unsubVid) return () => this.stop();
    this._unsubDisc = discoveryCaptureService.subscribe(() => this._tick());
    this._unsubVid = useVidStore.subscribe(() => this._tick());
    this._tick();
    return () => this.stop();
  }

  stop(): void {
    this._unsubDisc?.(); this._unsubDisc = null;
    this._unsubVid?.();  this._unsubVid = null;
  }

  /**
   * Tek projeksiyon adımı: bağlı aracın öğrenilmiş bilgisini (VehicleKnowledge) fingerprint
   * deposundan SALT-OKUNUR okur → bilgi tabanına upsert eder. FAIL-SOFT.
   */
  private _tick(): void {
    try {
      const vid = this._readVid();
      if (!isConnectionComplete(vid)) return;
      const input = assembleFingerprintInput(vid, this._readObs());
      const base = buildFingerprint(input);
      const k = this._fpStore.load(base.hash) as VehicleKnowledge | null;
      if (!k) return; // henüz öğrenilmemiş → atla (bir sonraki tick'te işlenir)
      upsertKnowledge(k, this._kbStore, this._now());
    } catch {
      /* FAIL-SOFT: KB hatası mevcut akışları ASLA bozmaz */
    }
  }
}

/** Uygulama geneli tekil bilgi tabanı motoru (SystemBoot Wave-3'ten başlatılır). */
export const vehicleKnowledgeBase = new VehicleKnowledgeBase();

/** SystemBoot wiring yardımcı — başlatır, cleanup fonksiyonu döndürür. */
export function startVehicleKnowledgeBase(): () => void {
  return vehicleKnowledgeBase.start();
}

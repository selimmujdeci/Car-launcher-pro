/**
 * autoLearningEngine — Otomatik Öğrenme Motoru TEMELİ (PR-27, foundation-only).
 *
 * AMAÇ: Vehicle Fingerprint (PR-25/26) ile Discovery (PR-DISC) sistemini birleştirir.
 * Sistem, bir araçta tekrar görülen katalog-dışı PID/DID'leri o aracın parmak izine
 * BAĞLAYARAK öğrenmeye başlar → kendi kendini geliştiren YEREL bilgi tabanının çekirdeği.
 *
 * BU PR (yalnız altyapı):
 *   - Discovery gözlemlerini DİNLE (SALT-OKUNUR: getObservations/subscribe).
 *   - Gözlemleri, o an bağlı aracın fingerprint'ine EŞLE + PID/DID bilgisini işle
 *     (firstSeen / lastSeen / seenCount / confidence).
 *   - PR-26'daki "staged VIN" durumunu ÇÖZ: VIN'siz oluşmuş fingerprint sonradan VIN
 *     gelince aynı araç anlaşılırsa OTOMATİK merge → duplicate bırakma.
 *
 * KESİN SINIRLAR (CLAUDE.md): Native OBD / poll / Discovery Queue / Discovery Capture /
 * PID Registry / DID Registry / SQL-Supabase / cloud sync DEĞİŞMEZ. Cloud/AI YOK — yalnız
 * yerel bilgi. TAMAMEN ADDITIVE + FAIL-SOFT: öğrenme çökse bile OBD/Discovery/Fingerprint
 * akışları aynen sürer (hata sızmaz).
 *
 * KATMAN (Clean Architecture): saf öğrenme mantığı (apply/merge/deriveConfidence) React'sız
 * test edilebilir; motor sınıfı yalnız ince abonelik sarmalayıcısıdır.
 */

import { useVidStore, type VidStore } from '../store/useVidStore';
import {
  discoveryCaptureService,
  type DiscoveryObservation,
} from './obd/discovery';
import {
  buildFingerprint,
  normalizeVin,
  vehicleFingerprintStore,
  VehicleFingerprintStore,
} from './vehicleFingerprintService';
import {
  ingestVehicleFingerprint,
  isConnectionComplete,
  assembleFingerprintInput,
  type LearnedVehicleFingerprint,
} from './vehicleFingerprintBuilder';

/* ══════════════════════════════════════════════════════════════════════════
 * Bilgi modeli — fingerprint ÜSTÜNE öğrenilmiş PID/DID kataloğu
 * ════════════════════════════════════════════════════════════════════════ */

/** Öğrenilmiş tek bir sinyalin (PID/DID) yaşam-döngüsü kaydı. */
export interface DiscoveredSignal {
  firstSeen:  number;
  lastSeen:   number;
  seenCount:  number;
  confidence: number;
}

/**
 * Öğrenme bilgisiyle genişletilmiş fingerprint. discoveredPids/Dids depoda JSON olarak
 * şeffaf saklanır (foundation/builder tipleri DEĞİŞMEDEN — Clean Arch).
 */
export interface VehicleKnowledge extends LearnedVehicleFingerprint {
  /** PID (Mode 01…) → öğrenilmiş sinyal kaydı. */
  discoveredPids: Record<string, DiscoveredSignal>;
  /** DID (Mode 22 / UDS…) → öğrenilmiş sinyal kaydı. */
  discoveredDids: Record<string, DiscoveredSignal>;
}

/* ── Güven ──────────────────────────────────────────────────────────────── */
const INITIAL_CONFIDENCE = 0.5;
const CONFIDENCE_STEP = 0.1;
const MAX_CONFIDENCE = 1.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(MAX_CONFIDENCE, v));
}

/** Görülme sayısından güven türetir (deterministik, tavanı 1.0). */
export function deriveConfidence(seenCount: number): number {
  const n = Math.max(1, seenCount || 1);
  return clamp01(INITIAL_CONFIDENCE + CONFIDENCE_STEP * (n - 1));
}

/** Bir fingerprint'i bilgi katmanıyla (boş PID/DID haritaları) TAM-şekilli hale getirir. */
export function initKnowledge(fp: LearnedVehicleFingerprint | VehicleKnowledge): VehicleKnowledge {
  const k = fp as Partial<VehicleKnowledge>;
  return {
    ...(fp as LearnedVehicleFingerprint),
    discoveredPids: { ...(k.discoveredPids ?? {}) },
    discoveredDids: { ...(k.discoveredDids ?? {}) },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF öğrenme — Discovery gözlemlerini bilgiye yansıt (idempotent mirror)
 * ════════════════════════════════════════════════════════════════════════ */

function _normId(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * Discovery gözlemlerini fingerprint bilgisine İŞLER (SALT-OKUNUR kaynak → idempotent):
 * her sinyal için firstSeen KORUNUR, lastSeen/seenCount/confidence GÜNCELLENİR. seenCount
 * discovery gözleminin kendi sayısını yansıtır (tekrar görülünce artar) → deterministik.
 * Yeni (immutable) bilgi döndürür; girdiyi mutasyona uğratmaz.
 */
export function applyObservationsToKnowledge(
  fp: VehicleKnowledge,
  observations: readonly DiscoveryObservation[],
  now: number = Date.now(),
): VehicleKnowledge {
  const pids = { ...fp.discoveredPids };
  const dids = { ...fp.discoveredDids };
  let latest = fp.lastSeen;

  for (const o of observations) {
    const rec = o?.record;
    if (!rec) continue;
    const id = _normId(rec.pidOrDid);
    if (!id) continue;
    const map = rec.discoverySource === 'DID' ? dids : pids;
    const seenCount = Math.max(1, o.seenCount || 1);
    const firstAt = o.firstAt || now;
    const lastAt = o.lastAt || now;
    const existing = map[id];
    map[id] = {
      firstSeen:  existing?.firstSeen ?? firstAt, // İLK görülme KORUNUR
      lastSeen:   Math.max(existing?.lastSeen ?? 0, lastAt),
      seenCount,
      confidence: deriveConfidence(seenCount),
    };
    if (lastAt > latest) latest = lastAt;
  }

  return { ...fp, discoveredPids: pids, discoveredDids: dids, lastSeen: latest };
}

/* ══════════════════════════════════════════════════════════════════════════
 * VIN merge — staged (VIN'siz → VIN'li) çözümü
 * ════════════════════════════════════════════════════════════════════════ */

/** İki dizinin (normalize + sıralı ECU) eşit olup olmadığı. */
function _ecuEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}

/**
 * İki fingerprint AYNI ARACA mı ait? Kurallar:
 *  - İkisi de VIN'li → yalnız VIN eşitse aynı (farklı VIN = farklı araç → BİRLEŞTİRME).
 *  - Biri VIN'siz (staged) → protocol + ECU seti eşit VE adaptör MAC'i çelişmiyorsa aynı.
 * ECU seti boşsa güvenli tarafta kal (aynı sayma → birleştirme).
 */
export function isLikelySameVehicle(a: VehicleKnowledge, b: VehicleKnowledge): boolean {
  const aVin = normalizeVin(a.vin);
  const bVin = normalizeVin(b.vin);
  if (aVin && bVin) return aVin === bVin;

  if (a.protocol !== b.protocol) return false;
  if (a.ecuAddresses.length === 0 || !_ecuEqual(a.ecuAddresses, b.ecuAddresses)) return false;

  const macA = a.metadata.adapterMac;
  const macB = b.metadata.adapterMac;
  if (macA && macB && macA !== macB) return false; // farklı adaptör → farklı araç

  return true;
}

/** İki sinyal haritasını birleştirir (sinyal başına: min firstSeen, max lastSeen, toplam seenCount). */
function _mergeSignalMaps(
  a: Record<string, DiscoveredSignal>,
  b: Record<string, DiscoveredSignal>,
): Record<string, DiscoveredSignal> {
  const out: Record<string, DiscoveredSignal> = { ...a };
  for (const [id, sig] of Object.entries(b)) {
    const cur = out[id];
    if (!cur) {
      out[id] = { ...sig };
    } else {
      const seenCount = cur.seenCount + sig.seenCount;
      out[id] = {
        firstSeen:  Math.min(cur.firstSeen, sig.firstSeen),
        lastSeen:   Math.max(cur.lastSeen, sig.lastSeen),
        seenCount,
        confidence: deriveConfidence(seenCount),
      };
    }
  }
  return out;
}

/**
 * İki aracı (primary=SAĞ KALAN, tercihen VIN'li) tek kayıtta birleştirir. Kimlik primary'nin
 * (hash/VIN); yaşam-döngüsü ve öğrenilmiş bilgi İKİSİNİN toplamıdır. Duplicate kalmaz.
 */
export function mergeKnowledge(primary: VehicleKnowledge, secondary: VehicleKnowledge): VehicleKnowledge {
  const ecuUnion = [...new Set([...primary.ecuAddresses, ...secondary.ecuAddresses])].sort();
  return {
    ...primary,
    createdAt:   Math.min(primary.createdAt ?? primary.firstSeen, secondary.createdAt ?? secondary.firstSeen),
    firstSeen:   Math.min(primary.firstSeen, secondary.firstSeen),   // İLK görülme KORUNUR
    lastSeen:    Math.max(primary.lastSeen, secondary.lastSeen),
    sourceCount: (primary.sourceCount ?? 1) + (secondary.sourceCount ?? 1),
    confidence:  Math.max(primary.confidence ?? 0, secondary.confidence ?? 0),
    ecuAddresses: ecuUnion,
    metadata: {
      adapterMac:      primary.metadata.adapterMac      ?? secondary.metadata.adapterMac,
      firmwareVersion: primary.metadata.firmwareVersion ?? secondary.metadata.firmwareVersion,
      label:           primary.metadata.label           ?? secondary.metadata.label,
    },
    profileHint:    primary.profileHint || secondary.profileHint,
    discoveredPids: _mergeSignalMaps(primary.discoveredPids, secondary.discoveredPids),
    discoveredDids: _mergeSignalMaps(primary.discoveredDids, secondary.discoveredDids),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Otomatik Öğrenme Motoru — Discovery + VID aboneliği (ince sarmalayıcı)
 * ════════════════════════════════════════════════════════════════════════ */

export class AutoLearningEngine {
  private _unsubDisc: (() => void) | null = null;
  private _unsubVid: (() => void) | null = null;
  private readonly _store: VehicleFingerprintStore;
  private readonly _readVid: () => VidStore;
  private readonly _readObs: () => DiscoveryObservation[];
  private readonly _now: () => number;

  constructor(
    store: VehicleFingerprintStore = vehicleFingerprintStore,
    readVid: () => VidStore = () => useVidStore.getState(),
    readObs: () => DiscoveryObservation[] = () => discoveryCaptureService.getObservations(),
    now: () => number = () => Date.now(),
  ) {
    this._store = store;
    this._readVid = readVid;
    this._readObs = readObs;
    this._now = now;
  }

  /** Discovery + VID aboneliklerini başlatır (idempotent). Döndürülen fonksiyon durdurur (zero-leak). */
  start(): () => void {
    if (this._unsubDisc || this._unsubVid) return () => this.stop();
    this._unsubDisc = discoveryCaptureService.subscribe(() => this._tick());
    this._unsubVid = useVidStore.subscribe(() => this._tick());
    this._tick(); // mevcut durumu bir kez değerlendir
    return () => this.stop();
  }

  stop(): void {
    this._unsubDisc?.(); this._unsubDisc = null;
    this._unsubVid?.();  this._unsubVid = null;
  }

  /**
   * Tek öğrenme adımı: bağlı aracın fingerprint'ini bul (yoksa oluştur) → VIN merge →
   * discovery gözlemlerini bilgiye işle → kaydet. FAIL-SOFT: hata OBD/Discovery/Fingerprint
   * akışını ASLA etkilemez.
   */
  private _tick(): void {
    try {
      const vid = this._readVid();
      if (!isConnectionComplete(vid)) return;

      const input = assembleFingerprintInput(vid, this._readObs());
      const base = buildFingerprint(input);
      const loaded = this._store.load(base.hash) as VehicleKnowledge | null;
      // Fingerprint yoksa builder henüz oluşturmamış olabilir → burada oluştur (idempotent).
      let fp: VehicleKnowledge = initKnowledge(loaded ?? ingestVehicleFingerprint(input, this._store));

      // Staged VIN çözümü — bu araç VIN'liyse, aynı aracın VIN'siz kaydını birleştir.
      fp = this._mergeStagedVin(fp);

      // Öğren: discovery gözlemlerini (SALT-OKUNUR) bilgiye işle.
      const learned = applyObservationsToKnowledge(fp, this._readObs(), this._now());
      this._store.save(learned);
    } catch {
      /* FAIL-SOFT: öğrenme hatası mevcut akışları ASLA bozmaz */
    }
  }

  /** current VIN'liyse: aynı araca ait VIN'siz kaydı bul → merge → duplicate'i kaldır. */
  private _mergeStagedVin(current: VehicleKnowledge): VehicleKnowledge {
    if (!normalizeVin(current.vin)) return current; // VIN yok → birleştirilecek bir şey yok
    for (const other of this._store.list()) {
      if (other.hash === current.hash) continue;
      const sibling = initKnowledge(other as LearnedVehicleFingerprint);
      if (!normalizeVin(sibling.vin) && isLikelySameVehicle(current, sibling)) {
        const merged = mergeKnowledge(current, sibling);
        this._store.remove(sibling.hash);
        this._store.remove(current.hash);   // firstSeen korunacak şekilde taze yaz
        this._store.save(merged);
        return merged;
      }
    }
    return current;
  }
}

/** Uygulama geneli tekil öğrenme motoru (SystemBoot Wave-3'ten başlatılır). */
export const autoLearningEngine = new AutoLearningEngine();

/** SystemBoot wiring yardımcı — başlatır, cleanup fonksiyonu döndürür. */
export function startAutoLearningEngine(): () => void {
  return autoLearningEngine.start();
}

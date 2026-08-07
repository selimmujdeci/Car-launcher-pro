/**
 * aiCore/runtime/halAdapter.ts — HAL → AI Core BAĞLAM EŞLEMESİ (SAF · Faz-2 wiring).
 *
 * AMAÇ: Mevcut Vehicle HAL'ın anlık görüntüsünü (VehicleHalSnapshot) ve kimliğini
 * (VehicleIdentity) AI Core'un okuduğu şekle (`VehicleContextInput` + `SignalEnvelope`)
 * çevirir. İKİNCİ VERİ OTORİTESİ KURMAZ — HAL zaten tek gerçeğin kaynağıdır; bu modül yalnız
 * onun şeklini AI Core kontratına uyarlar (yeni ölçüm/karar üretmez).
 *
 * NEDEN SAF/AYRI: eşleme mantığı (birim, tazelik → state, "0 ≠ no-data", fingerprint gizliliği)
 * runtime motorundan bağımsız test edilebilmeli. `aiCoreRuntime` bu saf fonksiyonları HAL'i
 * edge-trigger'da OKUYUP çağırır (poll YOK).
 *
 * DECOUPLED: HAL modülünü import ETMEZ; yalnız yapısal *Like şekli bilir (bağımlılık döngüsü
 * yok, test HAL kurmadan çalışır). "vehicle." öneki soyulur → AI Usta anahtarlarıyla eşleşir
 * (ör. 'vehicle.coolant_temp' → 'coolant_temp'). SAF: zaman enjekte edilir, yan etki yok.
 */

import type { SignalEnvelope, SignalState, SignalSource } from '../../obd/signalEnvelope';
import type { VehicleContextInput } from '../vehicleContext';
import type { TriageSections } from '../../diagnosticTriage';

/* ── Decoupled HAL şekilleri (VehicleHal *Like — modül import edilmez) ── */

export interface HalSignalLike {
  readonly id: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly source: string;
  readonly timestamp: number;
  readonly stale: boolean;
  readonly unit: string | null;
  readonly supported: boolean;
}

export interface HalSnapshotLike {
  readonly revision: number;
  readonly updatedAt: number;
  readonly signals: readonly HalSignalLike[];
}

export interface HalIdentityLike {
  readonly fingerprintHash: string | null;
  readonly protocol: string | null;
  readonly supported: boolean;
}

/* ── Saf yardımcılar ────────────────────────────────────────────── */

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** HAL kaynak etiketini SignalEnvelope kaynak birliğine indirger. */
function _mapSource(src: string): SignalSource {
  return src === 'obd' ? 'obd' : src === 'can' ? 'can' : 'derived';
}

/** 'vehicle.coolant_temp' → 'coolant_temp' (AI Usta anahtar eşleşmesi). */
export function stripSignalPrefix(id: string): string {
  return typeof id === 'string' ? id.replace(/^vehicle\./, '') : '';
}

/**
 * T7 — "odometer" ADI YALNIZ GERÇEK ARAÇ KİLOMETRESİ İÇİNDİR.
 *
 * SAHA KUSURU (snapshot 2026-08-01): kanıt satırı
 *   `signal.odometer · derived → odometer=0.5085521637815167km`
 * diyordu. Bu değer aracın toplam kilometresi DEĞİLDİR: `vehicle.odometer`
 * HAL sinyali `UnifiedVehicleStore.odometer`den beslenir, o da VehicleCompute
 * worker'ının GPS/DR tick'lerinden İNTEGRE ETTİĞİ uygulama-içi mesafe sayacıdır
 * (ECU'dan okunmaz). Yarım kilometrelik bir değeri "odometer" diye raporlamak
 * bakım aralığı, Vehicle Passport ve Mavi için doğrudan YANLIŞ girdidir.
 *
 * Kural: kaynağı doğrulanmış bir araç kaynağı (obd/can/mcu) DEĞİLSE ad
 * `trip_distance`e taşınır. Gerçek ECU odometresi geldiğinde `odometer` adı
 * korunur — böylece iki kavram bir daha karışmaz.
 *
 * Geriye dönük uyum: eski `signal.odometer` anahtarını arayan tüketiciler artık
 * `signal.trip_distance` görür. Yanlış etiket SÜRDÜRÜLMEZ (görev şartı) — bu
 * kasıtlı ve tek yönlü bir düzeltmedir.
 */
export function canonicalSignalKey(rawKey: string, source: SignalEnvelope['source']): string {
  if (rawKey !== 'odometer') return rawKey;
  // Yalnız doğrulanmış ARAÇ kaynakları gerçek odometre sayılır.
  // ('derived' = GPS/DR entegrasyonu, 'gps', 'mock' → hepsi yol mesafesidir.)
  const fromVehicle = source === 'obd' || source === 'can';
  return fromVehicle ? 'odometer' : 'trip_distance';
}

/**
 * Bir HAL sinyalini SignalEnvelope'a çevirir. "0 ≠ no-data" korunur: desteklenmeyen →
 * unsupported (value null), sayı değilse → no_data (value null), stale bayrağı → stale,
 * aksi → valid. Güven HAL'den gelir (unsupported/no_data → 0). SAF.
 */
export function halSignalToEnvelope(sig: HalSignalLike, now: number): SignalEnvelope {
  const numeric = typeof sig.value === 'number' && Number.isFinite(sig.value) ? sig.value : null;
  const source = _mapSource(sig.source);
  const unit = typeof sig.unit === 'string' ? sig.unit : '';
  const updatedAt = typeof sig.timestamp === 'number' && Number.isFinite(sig.timestamp) ? sig.timestamp : 0;
  const ageMs = updatedAt > 0 ? Math.max(0, now - updatedAt) : 0;

  let state: SignalState;
  if (sig.supported === false) state = 'unsupported';
  else if (numeric === null) state = 'no_data';
  else if (sig.stale === true) state = 'stale';
  else state = 'valid';

  const decisionless = state === 'unsupported' || state === 'no_data';
  return {
    value: decisionless ? null : numeric,
    state,
    confidence: decisionless ? 0 : _clamp01(sig.confidence),
    source,
    updatedAt,
    ageMs,
    unit,
  };
}

/** Kontak (vehicle.ignition) sinyalinden tri-state (null=bilinmiyor) türet. */
function _ignition(signals: readonly HalSignalLike[]): boolean | null {
  const ig = signals.find((s) => s.id === 'vehicle.ignition');
  if (!ig || ig.supported === false) return null;
  return typeof ig.value === 'boolean' ? ig.value : null;
}

/**
 * HAL bağlantı olgusu — "en az bir desteklenen, taze, değeri olan sinyal" (HAL bridge'in
 * `vehicle.connection.changed` ile aynı olgusu). Yeni ölçüm değil, mevcut durumun okunması.
 */
export function halIsConnected(snapshot: HalSnapshotLike): boolean {
  if (!snapshot || !Array.isArray(snapshot.signals)) return false;
  return snapshot.signals.some(
    (s) => s.supported === true && s.stale === false && typeof s.value === 'number' && Number.isFinite(s.value),
  );
}

/**
 * Bağlantı olgusundan MİNİMAL Diagnostics bölümü (obdDeep.adapter). Verdict çekirdeğinin
 * INCONCLUSIVE dedektörünü (OBD bağlı değil → doğrulanamadı) besler — SAHTE veri değil,
 * mevcut bağlantı durumunun dürüst yansıması. DTC/handshake gibi zengin bölümler HAL'de
 * YOK → uydurulmaz (Faz-2 kapsamı; ileride ayrı kaynaklardan additive beslenir).
 */
export function deriveMinimalSections(snapshot: HalSnapshotLike): TriageSections {
  const connected = halIsConnected(snapshot);
  let lastSeenMs = 0;
  if (snapshot && Array.isArray(snapshot.signals)) {
    for (const s of snapshot.signals) {
      if (typeof s.timestamp === 'number' && s.timestamp > lastSeenMs) lastSeenMs = s.timestamp;
    }
  }
  return {
    obdDeep: {
      adapter: {
        source: connected ? 'real' : 'none',
        connectionState: connected ? 'connected' : 'disconnected',
        lastSeenMs,
      },
    },
  };
}

/**
 * HAL snapshot + identity → VehicleContextInput. Yalnız SAYISAL sinyaller bağlama girer
 * (boolean kontak ayrı tutulur); anahtarlar 'vehicle.' önekinden arındırılır. Fingerprint
 * yalnız identity.supported iken taşınır (HAM VIN assembleVehicleContext'te ayrıca reddedilir).
 * @param online navigator.onLine (wiring enjekte eder — bu saf modül tarayıcıya bakmaz).
 */
export function halSnapshotToContextInput(
  snapshot: HalSnapshotLike,
  identity: HalIdentityLike | null,
  now: number,
  online: boolean,
): VehicleContextInput {
  const signals: Record<string, SignalEnvelope> = {};
  if (snapshot && Array.isArray(snapshot.signals)) {
    for (const sig of snapshot.signals) {
      if (typeof sig.id !== 'string' || !sig.id) continue;
      // Boolean/dizi sinyaller (ignition/reverse/tpms) bağlam sinyali DEĞİL — sayısal olanlar.
      if (typeof sig.value !== 'number') continue;
      const rawKey = stripSignalPrefix(sig.id);
      if (!rawKey) continue;
      const env = halSignalToEnvelope(sig, now);
      // T7: türetilmiş yol mesafesi "odometer" adıyla yayılmaz (bkz. canonicalSignalKey).
      signals[canonicalSignalKey(rawKey, env.source)] = env;
    }
  }
  return {
    now,
    fingerprintHash: identity && identity.supported ? identity.fingerprintHash : null,
    connected: halIsConnected(snapshot),
    ignitionOn: _ignition(snapshot?.signals ?? []),
    online,
    signals,
    diagnosticSections: deriveMinimalSections(snapshot),
  };
}

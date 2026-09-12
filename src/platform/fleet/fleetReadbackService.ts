/**
 * fleetReadbackService — sürücü atamasının SUNUCUDAN GERİ-OKUNMASI (eksik kablo).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `driverAssignmentSnapshot` "trip başlangıcında sunucudan aktif atamayı bir kez
 * okur" diye tasarlanmıştı ve `capture()` yazılmıştı — ama ÇAĞIRAN HİÇ YOKTU
 * (2026-08-21 CAROS LAB denetimi, kütük #690). Sonuç: `fetchCount` üründe daima
 * 0, snapshot daima `UNKNOWN`, LAB · Fleet Driver Identity ekranı yapısal olarak
 * boş. Bu modül O KABLODUR — yeni bir karar katmanı DEĞİLDİR.
 *
 * ── NEDEN YALNIZ BU EKRAN BAĞLANABİLDİ (ölçüldü, varsayılmadı) ──────────────
 * Head unit'in kullanıcı OTURUMU yoktur; yalnız cihaz API anahtarı vardır
 * (`callVehicleRpc` → `p_api_key`). Sunucu tarafında yetkiler şöyle ölçüldü:
 *   · `get_active_driver_assignment(p_api_key)` → GRANT **anon** ✅ cihaz çağırabilir
 *   · `get_driver_dna` · `get_fleet_intelligence` · `get_evidence_coverage`
 *     · `list_fleet_insights` · `get_evidence_chain`  → GRANT **authenticated** ❌
 *   · `list_vehicle_presence_history` → `REVOKE ALL … FROM PUBLIC, anon` ❌ (bilinçli)
 * Yani diğer filo yüzeyleri "bozuk" değil, **bu cihazın yetkisinde değil**:
 * onlar şirket kapsamlı yönetici verisidir. `anon` GRANT açmak filo geneli
 * veriyi head unit'e sızdırırdı — YAPILMADI (bkz. Supabase kuralları,
 * "REVOKE ALL FROM anon ŞART").
 *
 * ── BÜTÇE ───────────────────────────────────────────────────────────────────
 * TİMER YOK · POLLING YOK. Trip başına TEK ağ çağrısı, yalnız `active`
 * false→true KENARINDA. Soğuk yol: hot-path'e (3 Hz hız/RPM) hiç girmez.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Buradaki hiçbir hata yolculuk akışını, telemetriyi veya UI'ı ETKİLEMEZ.
 * Ağ yoksa snapshot `UNKNOWN` + `reason` kalır — sürücü ASLA UYDURULMAZ.
 */

import { onTripState } from '../tripLogService';
import { driverSnapshotRuntime } from './driverAssignmentSnapshot';
import { bindAuthenticationVehicle } from './driverAuthentication';
import { getVehicleIdentity } from '../vehicleIdentityService';

/** Köprünün salt-okunur kanıtı — LAB bunu gösterir (yeni sayaç ailesi DEĞİL). */
export interface FleetReadbackEvidence {
  /** Köprü kuruldu mu (abonelik canlı). */
  readonly wired: boolean;
  /** `active` false→true kenarı kaç kez görüldü (yakalama DENEMESİ sayısı). */
  readonly tripStartCount: number;
  /** Son denemenin duvar saati damgası; `null` = hiç. */
  readonly lastAttemptAtMs: number | null;
  /** Son denemenin sonucu — enum, PII yok. */
  readonly lastOutcome: FleetReadbackOutcome | null;
  /** Araç bağı kuruldu mu (kimlik okunabildi mi). */
  readonly vehicleBound: boolean;
}

export type FleetReadbackOutcome =
  /** Sunucu aktif atama döndürdü. */
  | 'ASSIGNED'
  /** Sunucu yanıt verdi ama aktif atama YOK (geçerli bir cevap). */
  | 'NO_ASSIGNMENT'
  /** Ağ/RPC düştü — sürücü uydurulmadı. */
  | 'TRANSPORT'
  /** Cihaz eşleşmemiş: API anahtarı/araç kimliği yok → çağrı HİÇ yapılmadı. */
  | 'NOT_PAIRED';

let _wired = false;
let _tripStartCount = 0;
let _lastAttemptAtMs: number | null = null;
let _lastOutcome: FleetReadbackOutcome | null = null;
let _vehicleBound = false;
let _prevActive = false;
let _unsub: (() => void) | null = null;

/** LAB salt-okuma yüzeyi — ASLA fırlatmaz, hiçbir şey tetiklemez. */
export function getFleetReadbackEvidence(): FleetReadbackEvidence {
  return {
    wired: _wired,
    tripStartCount: _tripStartCount,
    lastAttemptAtMs: _lastAttemptAtMs,
    lastOutcome: _lastOutcome,
    vehicleBound: _vehicleBound,
  };
}

/**
 * Trip başlangıcında TEK atışlık geri-okuma.
 *
 * Eşleşmemiş cihazda ağ çağrısı HİÇ YAPILMAZ (`NOT_PAIRED`) — anlamsız bir
 * istekle radyoyu uyandırmayız ve sunucuya kimliksiz trafik göndermeyiz.
 */
async function _captureOnTripStart(nowMs: number): Promise<void> {
  _lastAttemptAtMs = nowMs;
  try {
    const identity = await getVehicleIdentity();
    if (identity === null) {
      _vehicleBound = false;
      _lastOutcome = 'NOT_PAIRED';
      /* Araç bağı YOKKEN doğrulama otoritesi bağlanmaz (yanlış araca
         yanlış sürücü bağlamaktansa UNBOUND kalmak doğrudur). */
      try { bindAuthenticationVehicle(null); } catch { /* fail-soft */ }
      return;
    }

    _vehicleBound = true;
    try { bindAuthenticationVehicle(identity.vehicleId); } catch { /* fail-soft */ }

    const snap = await driverSnapshotRuntime.capture(nowMs);
    _lastOutcome = snap.status === 'ACTIVE'
      ? 'ASSIGNED'
      : (snap.reason === 'TRANSPORT' || snap.reason === 'EXCEPTION'
          ? 'TRANSPORT'
          : 'NO_ASSIGNMENT');
  } catch {
    /* Köprü yolculuğu ASLA bozmaz. */
    _lastOutcome = 'TRANSPORT';
  }
}

/**
 * Köprüyü kurar. İDEMPOTENT — ikinci çağrı ikinci abonelik AÇMAZ.
 *
 * @returns temizleyici (SystemBoot `_reg` ile kaydeder → zero-leak).
 */
export function startFleetReadback(): () => void {
  if (_wired) return stopFleetReadback;
  _wired = true;
  _prevActive = false;

  try {
    _unsub = onTripState((s) => {
      /* SÖKÜLMÜŞ KÖPRÜ OKUMAZ: aboneliği bıraktıktan sonra uçuşta kalmış bir
         olay hâlâ bu geri çağrıya düşebilir (yayıncı listeyi kopyalayıp
         gezinirse). O olayla ağ çağrısı başlatmak, kapatılmış bir servisin
         hayaletini üretirdi — zero-leak sözleşmesi bunu yasaklar. */
      if (!_wired) return;
      const active = s.active === true;
      /* YALNIZ KENAR: trip süresince tekrar tekrar okumayız — snapshot
         bilinçli olarak yolculuk boyunca DONDURULUR (atama ortada değişse
         bile o yolculuğun başladığı andaki gerçek korunur). */
      if (active && !_prevActive) {
        _tripStartCount += 1;
        void _captureOnTripStart(Date.now());
      }
      _prevActive = active;
    });
  } catch {
    /* Abonelik kurulamazsa köprü ölü kalır ama ürün ETKİLENMEZ. */
    _wired = false;
  }

  return stopFleetReadback;
}

/** Aboneliği söker. Zero-leak. */
export function stopFleetReadback(): void {
  if (!_wired) return;
  _wired = false;
  _prevActive = false;
  if (_unsub) { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
}

/** @internal — testler arası izolasyon. */
export function _resetFleetReadbackForTest(): void {
  stopFleetReadback();
  _tripStartCount = 0;
  _lastAttemptAtMs = null;
  _lastOutcome = null;
  _vehicleBound = false;
}

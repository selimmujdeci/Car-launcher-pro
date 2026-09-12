/**
 * vehicleIdentity — P0-OBD-09 · KANONİK ARAÇ KİMLİĞİ (VIN) + PROVENANCE.
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * VIN'in tek deposu 13 satırlık `safety/vinContext` idi:
 *   `setHandshakeVin(v) { _vin = v?.trim().toUpperCase() ?? null }`
 * Yani **hiçbir doğrulama yoktu**. Sonuçları ölçüldü:
 *   · Kısmi/bozuk bir VIN (`"VF1RJL00"`) deposu doldurabiliyordu; `persistHandshakeVin`
 *     profile yazmadan ÖNCE `setHandshakeVin`i koşulsuz çağırdığı için
 *     `getHandshakeVin()` bozuk değeri DÖNDÜRÜYORDU.
 *   · O bozuk değer `saveObdFuelCalib(address, 1, getHandshakeVin())` ile
 *     **yakıt kalibrasyon anahtarı** oluyordu — yanlış araca kalibrasyon.
 *   · Kaynak (Mode 09 el sıkışması mı, UDS F190 mı), hangi ECU, hangi oturum:
 *     HİÇBİRİ saklanmıyordu.
 *   · Adaptör başka araca takıldığında eski VIN modül belleğinde KALIYORDU.
 *
 * ── BU KATMANIN SÖZLEŞMESİ ────────────────────────────────────────────────
 *  · FAIL-CLOSED: 17 hane / ISO 3779 biçimi tutmayan girdi **kimlik SAYILMAZ**;
 *    reddedilir ve reddin nedeni kaydedilir (sessiz yutma YOK).
 *  · PROVENANCE: her kabul edilen VIN kaynağını, ECU'sunu, oturumunu ve anını taşır.
 *  · ÇOK KAYNAKLI TUTARSIZLIK: iki kaynak FARKLI VIN bildirirse kimlik
 *    `CONFLICT` olur ve **hiçbiri kanonik sayılmaz**. "İlk gelen kazanır" bir
 *    çakışmayı sessizce çözerdi ve yanlış araca yazardık.
 *  · OTURUM: yeni OBD oturumunda kimlik BAYAT olur; yeni doğrulama gelmeden
 *    kanonik kabul edilmez (adaptör başka araca takılmış olabilir).
 *  · GİZLİLİK: dışa açılan yüzeyde ham VIN yerine **maskeli** biçim sunulur;
 *    ham değer yalnız açıkça isteyen iç tüketiciye verilir.
 *
 * ── SINIF ÜRETMEZ ─────────────────────────────────────────────────────────
 * Ticari/binek sınıfı VIN'den ÇIKARILAMAZ (aynı şasi hem M1 hem N1 tescillenir).
 * Sınıf otoritesi `legalVehicleClass`/`vehicleClassRuntime`tedir; bu katman ona
 * yalnız DOĞRULANMIŞ bir VIN sağlar.
 */

import { decodeVin, normalizeVin, type VinFacts } from './vinDecode';
import { maskVin } from './legalVehicleClass';

/** VIN'in geldiği kaynak — provenance'ın çekirdeği. */
export type VinSource =
  /** SAE J1979 Mode 09 PID 02 (el sıkışması). */
  | 'mode09'
  /** ISO 14229 DID F190 (UDS ReadDataByIdentifier). */
  | 'uds_f190'
  /** Kullanıcının araç profiline elle girdiği değer. */
  | 'profile';

export const VIN_SOURCE_LABEL: Readonly<Record<VinSource, string>> = {
  mode09:   'Mode 09 (el sıkışması)',
  uds_f190: 'UDS DID F190',
  profile:  'Araç profili (elle girildi)',
};

/** Kimliğin durumu. `CONFLICT` ile `NONE` BİRLEŞTİRİLMEZ. */
export type VinIdentityState =
  /** Hiç VIN okunmadı. */
  | 'NONE'
  /** Tek kaynaktan geçerli VIN — doğrulanmadı ama kullanılabilir. */
  | 'SINGLE'
  /** İki bağımsız kaynak AYNI VIN'i verdi — en güçlü hâl. */
  | 'VERIFIED'
  /** Kaynaklar FARKLI VIN bildirdi — hiçbiri kanonik SAYILMAZ. */
  | 'CONFLICT'
  /** VIN önceki OBD oturumuna ait — yeni ölçüm gelmeden kanonik değil. */
  | 'STALE';

export const VIN_STATE_LABEL: Readonly<Record<VinIdentityState, string>> = {
  NONE:     'VIN okunmadı',
  SINGLE:   'Tek kaynaktan okundu',
  VERIFIED: 'İki kaynak doğruladı',
  CONFLICT: 'Kaynaklar ÇELİŞİYOR',
  STALE:    'Önceki oturuma ait',
};

export interface VinObservation {
  readonly vin: string;
  readonly source: VinSource;
  /** Okunduğu ECU (rx header); bilinmiyorsa `null`. */
  readonly ecuRx: string | null;
  /** OBD oturum numarası. */
  readonly epoch: number;
  /** Kaydedildiği an (Unix ms). */
  readonly atMs: number;
}

/** Reddedilen bir girdi — sessizce yutulmaz, sayılır ve nedeni saklanır. */
export interface VinRejection {
  readonly reason: 'malformed' | 'empty';
  readonly source: VinSource;
  readonly atMs: number;
  /** Reddedilen değerin UZUNLUĞU — ham değer TAŞINMAZ (gizlilik + sahte VIN yayma yok). */
  readonly length: number;
}

export interface VehicleIdentitySnapshot {
  readonly state: VinIdentityState;
  /** Kanonik VIN — YALNIZ `SINGLE`/`VERIFIED` hâlinde dolu. */
  readonly vin: string | null;
  /** Maskeli biçim (`VF1**************`) — ekran/log için. */
  readonly maskedVin: string | null;
  /** Kabul edilmiş gözlemler (kaynak başına en yeni). */
  readonly observations: readonly VinObservation[];
  /** Çelişki hâlinde çakışan VIN'lerin MASKELİ biçimleri. */
  readonly conflicting: readonly string[];
  readonly rejections: readonly VinRejection[];
  /** VIN'den standartla çıkarılabilenler; kanonik VIN yoksa boş. */
  readonly facts: VinFacts;
  /** Kimliğin ait olduğu oturum; hiç yoksa `-1`. */
  readonly epoch: number;
}

/* ── Modül durumu (sınırlı) ───────────────────────────────────────────────── */

const MAX_REJECTIONS = 8;

let _obs = new Map<VinSource, VinObservation>();
let _rejections: VinRejection[] = [];

/* ── OTURUM SAĞLAYICISI — bağımlılık YÖNÜ bilinçli olarak TERS ─────────────
   Bu katman `obdService`i İTHAL ETMEZ. Ederse `manufacturerPidService` →
   `vinContext` → `obdService` kenarı doğar ve tüm OBD çekirdeği, sensör
   sorgusu/komut ayrıştırıcısı grafiğine girer (ölçüldü: 3 test dosyası
   `obdService` modül gövdesi yüzünden düştü). Sahibi olan `obdService`
   sağlayıcıyı KENDİSİ kaydeder; burada yalnız okunur. */
let _epochProvider: (() => number) | null = null;

/** Oturum numarası sağlayıcısını kaydeder (sahibi: `obdService`). */
export function setVinEpochProvider(fn: (() => number) | null): void {
  _epochProvider = fn;
}

/** Güncel OBD oturumu; sağlayıcı yoksa/atarsa `-1` (oturum kapısı kapanmaz). */
export function currentVinEpoch(): number {
  if (_epochProvider === null) return -1;
  try {
    const n = _epochProvider();
    return Number.isFinite(n) ? n : -1;
  } catch { return -1; }
}

/* ── Yazma ────────────────────────────────────────────────────────────────── */

/**
 * Bir VIN gözlemi kaydeder. FAIL-CLOSED: biçim tutmuyorsa **kabul edilmez**.
 *
 * @returns kabul edildiyse `true`.
 */
export function recordVinObservation(
  raw: string | null | undefined,
  source: VinSource,
  epoch: number,
  atMs: number,
  ecuRx: string | null = null,
): boolean {
  const n = normalizeVin(raw);
  if (n === null) {
    const len = typeof raw === 'string' ? raw.trim().length : 0;
    _rejections.push({ reason: len === 0 ? 'empty' : 'malformed', source, atMs, length: len });
    if (_rejections.length > MAX_REJECTIONS) _rejections = _rejections.slice(-MAX_REJECTIONS);
    return false;
  }
  _obs.set(source, { vin: n, source, ecuRx, epoch, atMs });
  return true;
}

/** Oturum/araç değişimi — TÜM gözlemler düşer (eski araç kimliği taşınmaz). */
export function resetVehicleIdentity(): void {
  _obs = new Map();
  _rejections = [];
}

/** @internal — testler arası izolasyon. */
export const _identityInternals = { reset: resetVehicleIdentity };

/* ── Okuma ────────────────────────────────────────────────────────────────── */

const EMPTY_FACTS: VinFacts = decodeVin(null, 2000);

/**
 * Kanonik kimlik anlık görüntüsü.
 *
 * @param currentEpoch Güncel OBD oturumu — gözlemler başka oturuma aitse `STALE`.
 * @param currentYear  Model yılı belirsizliğini daraltmak için (saat OKUNMAZ).
 */
export function getVehicleIdentity(
  currentEpoch: number, currentYear: number,
): VehicleIdentitySnapshot {
  const observations = [..._obs.values()];
  const rejections = [..._rejections];

  if (observations.length === 0) {
    return {
      state: 'NONE', vin: null, maskedVin: null, observations, conflicting: [],
      rejections, facts: EMPTY_FACTS, epoch: -1,
    };
  }

  const distinct = [...new Set(observations.map((o) => o.vin))];

  /* ÇELİŞKİ ÖNCE: "ilk gelen kazanır" bir çakışmayı sessizce çözerdi ve yanlış
     araca yazardık. Çelişkide HİÇBİRİ kanonik değildir. */
  if (distinct.length > 1) {
    return {
      state: 'CONFLICT', vin: null, maskedVin: null, observations,
      conflicting: distinct.map((v) => maskVin(v) ?? '???'),
      rejections, facts: EMPTY_FACTS, epoch: observations[0]!.epoch,
    };
  }

  const vin = distinct[0]!;
  const epoch = Math.max(...observations.map((o) => o.epoch));

  /* OTURUM KAPISI: adaptör başka araca takılmış olabilir. Eski oturumun VIN'i
     kanonik SAYILMAZ ama SİLİNMEZ — ekranda "önceki oturuma ait" görünür. */
  if (Number.isFinite(currentEpoch) && currentEpoch >= 0 && epoch !== currentEpoch) {
    return {
      state: 'STALE', vin: null, maskedVin: maskVin(vin), observations,
      conflicting: [], rejections, facts: EMPTY_FACTS, epoch,
    };
  }

  return {
    state: observations.length >= 2 ? 'VERIFIED' : 'SINGLE',
    vin,
    maskedVin: maskVin(vin),
    observations, conflicting: [], rejections,
    facts: decodeVin(vin, currentYear),
    epoch,
  };
}

/**
 * KANONİK VIN — karar katmanları için tek kapı.
 *
 * `CONFLICT`/`STALE`/`NONE` hâlinde `null` döner. Çelişkili ya da bayat bir VIN
 * ile araç kimliği kurmak, yanlış araca kalibrasyon/profil yazmak demektir.
 */
export function getCanonicalVin(currentEpoch: number, currentYear: number): string | null {
  const s = getVehicleIdentity(currentEpoch, currentYear);
  return s.state === 'SINGLE' || s.state === 'VERIFIED' ? s.vin : null;
}

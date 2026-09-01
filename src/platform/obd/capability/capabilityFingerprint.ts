/**
 * capabilityFingerprint — P0-VDK-F4C · ARAÇ VE ECU PARMAK İZİ (öğrenmenin anahtarı).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN YENİ BİR PARMAK İZİ (mevcut olan neden yetmiyor) ────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Mevcut `vehicleFingerprintService` bir **araç tanıma** kimliğidir ve kaydında
 * **HAM VIN'i şeffaf tutar** (`VehicleFingerprint.vin`). Yetenek öğrenmesi ise
 * diske uzun ömürlü yazılır ve F4-C'nin gizlilik şartı pazarlıksızdır:
 * **ham VIN/MAC kalıcı depoya GİREMEZ.**
 *
 * Bu yüzden burada AYRI bir kimlik üretilir — ama **yeni bir hash/kripto sistemi
 * KURULMAZ**: karma primitifi mevcut `fingerprintHash()`tir (aynı FNV-1a çifti).
 * Yeni gizli anahtar, yeni tuz üretici, yeni şifreleme YOKTUR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **VIN TEK KİMLİK DEĞİLDİR** ve VIN yokken de kimlik üretilir.
 * (2) **Ölçülmeyen alan `null`dur.** Sahte protokol, sahte imza, sahte DID YOK.
 * (3) **Güven UYDURULMAZ:** hangi kimlik eksenlerinin GERÇEKTEN ölçüldüğünden
 *     deterministik olarak türetilir ve eksen listesi kayıtla birlikte taşınır.
 * (4) **ECU rolü ADRESTEN UYDURULMAZ.** Kimlik tx/rx + protokol + ÖLÇÜLMÜŞ
 *     yanıt imzası/DID'den doğar; rol alanı yoktur.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 */

import { fingerprintHash } from '../../vehicleFingerprintService';

/* ══════════════════════════════════════════════════════════════════════════
   1) GÖZLEM GİRDİLERİ — hepsi ÖLÇÜM, hiçbiri varsayım
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir ECU'dan ÖLÇÜLMÜŞ kimlik kanıtları. */
export interface EcuIdentityObservation {
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  /** Ölçülen aktif protokol (ATDPN); bilinmiyorsa `null`. */
  readonly protocol: string | null;
  /**
   * Yanıt İMZASI — ECU'nun gerçekten döndürdüğü pozitif yanıtların kısa özeti
   * (ör. hangi servislerin hangi önekle cevapladığı). Ölçülmediyse `null`.
   * ⚠️ HAM GÖVDE DEĞİLDİR: kimlik için yeterli, içerik sızdırmayacak kadar dar.
   */
  readonly responseSignature: string | null;
  /** Kalibrasyon/yazılım kimliği DID kanıtı (ör. `F189` → sürüm). Yoksa `null`. */
  readonly calibrationDid: string | null;
  /** DID değerinin KARMASI — ham değer ASLA taşınmaz. */
  readonly calibrationValueHash: string | null;
}

/** Araç seviyesi, adaptörden BAĞIMSIZ özellikler. */
export interface VehicleTraitObservation {
  /** Ölçülen protokol; `null` = bilinmiyor. */
  readonly protocol: string | null;
  /** Mode 01 desteklenen PID bitmap'i (normalize); `null` = ölçülmedi. */
  readonly supportedPidBitmap: string | null;
  /** VIN — **YALNIZ karmaya girer, saklanmaz.** `null` = okunamadı. */
  readonly vin: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ECU PARMAK İZİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface EcuFingerprint {
  /** Kararlı kimlik — tx/rx + protokol + ölçülmüş imzalardan türer. */
  readonly id: string;
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  readonly protocol: string | null;
  readonly responseSignature: string | null;
  readonly calibrationDid: string | null;
  readonly calibrationValueHash: string | null;
  /** Kimliğe GERÇEKTEN katkı veren eksenler — güven bundan türer. */
  readonly measuredAxes: readonly EcuIdentityAxis[];
}

export type EcuIdentityAxis = 'ADDRESS' | 'PROTOCOL' | 'RESPONSE_SIGNATURE' | 'CALIBRATION';

function _norm(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : '';
}

/**
 * ECU kimliği. **Rol üretmez, marka tahmin etmez.**
 *
 * Adres tek başına kimlik DEĞİLDİR: aynı `7E0` iki farklı araçta iki farklı
 * ECU'dur. Bu yüzden imza ve kalibrasyon kanıtı kimliğe DAHİLDİR; onlar yoksa
 * kimlik yine üretilir ama `measuredAxes` zayıf kalır ve bunu SÖYLER.
 */
export function buildEcuFingerprint(o: EcuIdentityObservation): EcuFingerprint {
  const tx = _norm(o.txHeader);
  const rx = _norm(o.rxHeader);
  const proto = _norm(o.protocol);
  const sig = _norm(o.responseSignature);
  const did = _norm(o.calibrationDid);
  const valHash = _norm(o.calibrationValueHash);

  const axes: EcuIdentityAxis[] = [];
  if (tx.length > 0 || rx.length > 0) axes.push('ADDRESS');
  if (proto.length > 0) axes.push('PROTOCOL');
  if (sig.length > 0) axes.push('RESPONSE_SIGNATURE');
  if (did.length > 0 && valHash.length > 0) axes.push('CALIBRATION');

  const key = `TX:${tx}|RX:${rx}|P:${proto}|S:${sig}|C:${did}:${valHash}`;
  return {
    id: fingerprintHash(key),
    txHeader: tx.length > 0 ? tx : null,
    rxHeader: rx.length > 0 ? rx : null,
    protocol: proto.length > 0 ? proto : null,
    responseSignature: sig.length > 0 ? sig : null,
    calibrationDid: did.length > 0 ? did : null,
    calibrationValueHash: valHash.length > 0 ? valHash : null,
    measuredAxes: Object.freeze(axes),
  };
}

/**
 * AYNI ADRES, FARKLI ECU — çakışma tespiti.
 *
 * Bir araçta `7E0` bir motor ECU'suyken başka bir araçta başka bir modüldür.
 * Öğrenilmiş yeteneği adrese göre yeniden kullanmak, tam olarak bu yüzden
 * TEK BAŞINA GÜVENLİ DEĞİLDİR. Bu fonksiyon iki kimliğin aynı adresi paylaşıp
 * paylaşmadığını ve imzalarının ayrışıp ayrışmadığını ÖLÇER.
 */
export function detectEcuCollision(
  a: EcuFingerprint, b: EcuFingerprint,
): 'SAME_ECU' | 'ADDRESS_COLLISION' | 'DIFFERENT' {
  const sameAddress = a.txHeader === b.txHeader && a.rxHeader === b.rxHeader;
  if (a.id === b.id) return 'SAME_ECU';
  if (!sameAddress) return 'DIFFERENT';
  /* Adres aynı, kimlik farklı → imza/kalibrasyon ayrıştı. Bu bir ÇAKIŞMADIR
     ve öğrenilmiş yeteneğin körlemesine taşınmasını ENGELLER. */
  return 'ADDRESS_COLLISION';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ARAÇ PARMAK İZİ
   ══════════════════════════════════════════════════════════════════════════ */

export type VehicleIdentityAxis =
  | 'VIN' | 'PROTOCOL' | 'ECU_SET' | 'RESPONSE_SIGNATURE' | 'CALIBRATION' | 'PID_BITMAP';

export const VEHICLE_IDENTITY_AXIS_LABEL: Readonly<Record<VehicleIdentityAxis, string>> = {
  VIN:                'VIN (karma olarak)',
  PROTOCOL:           'protokol',
  ECU_SET:            'ECU uç noktası kümesi',
  RESPONSE_SIGNATURE: 'ECU yanıt imzası',
  CALIBRATION:        'kalibrasyon/yazılım kimliği',
  PID_BITMAP:         'desteklenen PID bitmap',
} as const;

export interface CapabilityFingerprint {
  /** Kalıcı kimlik — **ham VIN/MAC İÇERMEZ**. */
  readonly id: string;
  /** VIN ölçüldü mü (kanıt). VIN'in KENDİSİ burada YOKTUR. */
  readonly vinPresent: boolean;
  /** VIN karması — geri döndürülemez, kimlik ekseninde kullanılır. */
  readonly vinHash: string | null;
  readonly protocol: string | null;
  readonly supportedPidBitmap: string | null;
  /** Sıralı ECU parmak izleri (sıra kimliği değiştirmez). */
  readonly ecus: readonly EcuFingerprint[];
  /** GERÇEKTEN ölçülmüş kimlik eksenleri. */
  readonly measuredAxes: readonly VehicleIdentityAxis[];
  /**
   * Güven [0,1] — **ölçülen eksen sayısı / toplam eksen sayısı**.
   * Deterministik, açıklanabilir ve UYDURULMAMIŞTIR; `measuredAxes` ile
   * birlikte taşınır ki hangi kanıttan doğduğu görülebilsin.
   */
  readonly confidence: number;
}

const ALL_VEHICLE_AXES: readonly VehicleIdentityAxis[] = Object.freeze([
  'VIN', 'PROTOCOL', 'ECU_SET', 'RESPONSE_SIGNATURE', 'CALIBRATION', 'PID_BITMAP',
]);

/** Yeniden kullanım için asgari güven — altındaysa öğrenme ÜRÜNE uygulanmaz. */
export const MIN_REUSE_CONFIDENCE = 0.5;

/**
 * Araç kimliği. **VIN yoksa da çalışır** ve VIN'i ASLA açık saklamaz.
 *
 * Kimlik metnine yalnız karma ve normalize edilmiş teknik alanlar girer;
 * adaptör MAC'i kimliğe GİRMEZ (adaptör araç değildir — F4-C §5).
 */
export function buildCapabilityFingerprint(
  traits: VehicleTraitObservation, ecuObservations: readonly EcuIdentityObservation[],
): CapabilityFingerprint {
  const vinRaw = _norm(traits.vin);
  const vinHash = vinRaw.length > 0 ? fingerprintHash(`VIN:${vinRaw}`) : null;
  const protocol = _norm(traits.protocol);
  const bitmap = _norm(traits.supportedPidBitmap);

  const ecus = ecuObservations
    .map(buildEcuFingerprint)
    .sort((a, b) => a.id.localeCompare(b.id));

  const axes: VehicleIdentityAxis[] = [];
  if (vinHash !== null) axes.push('VIN');
  if (protocol.length > 0) axes.push('PROTOCOL');
  if (ecus.length > 0) axes.push('ECU_SET');
  if (ecus.some((e) => e.responseSignature !== null)) axes.push('RESPONSE_SIGNATURE');
  if (ecus.some((e) => e.calibrationValueHash !== null)) axes.push('CALIBRATION');
  if (bitmap.length > 0) axes.push('PID_BITMAP');

  const key = [
    `VH:${vinHash ?? ''}`,
    `P:${protocol}`,
    `E:${ecus.map((e) => e.id).join(',')}`,
    `B:${bitmap}`,
  ].join('|');

  return {
    id: fingerprintHash(key),
    vinPresent: vinHash !== null,
    vinHash,
    protocol: protocol.length > 0 ? protocol : null,
    supportedPidBitmap: bitmap.length > 0 ? bitmap : null,
    ecus: Object.freeze(ecus),
    measuredAxes: Object.freeze(axes),
    confidence: axes.length / ALL_VEHICLE_AXES.length,
  };
}

/** Kimlik yeniden kullanım için YETERLİ mi (güven + en az bir güçlü eksen). */
export function isFingerprintReusable(fp: CapabilityFingerprint): boolean {
  if (fp.confidence < MIN_REUSE_CONFIDENCE) return false;
  /* Yalnız adres+protokol ile öğrenme taşımak, adres çakışmasında yanlış araca
     yetenek atamak demektir. En az bir ÖLÇÜLMÜŞ ayırt edici eksen ŞART. */
  return fp.measuredAxes.includes('VIN')
    || fp.measuredAxes.includes('RESPONSE_SIGNATURE')
    || fp.measuredAxes.includes('CALIBRATION');
}

/** Ham VIN'in kaçak yapmadığını doğrulayan kanıt yardımcı (test ve LAB için). */
export function fingerprintLeaksRawVin(
  fp: CapabilityFingerprint, vin: string | null,
): boolean {
  if (vin === null || vin.trim().length === 0) return false;
  const needle = vin.trim().toUpperCase();
  return JSON.stringify(fp).toUpperCase().includes(needle);
}

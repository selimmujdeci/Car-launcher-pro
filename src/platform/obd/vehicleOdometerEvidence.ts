/**
 * vehicleOdometerEvidence — ARACIN TOPLAM KİLOMETRESİ İÇİN TEK KANIT KAPISI (F4.2).
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────
 * F4 denetimi üç halkanın da kopuk olduğunu ölçtü: ECU'dan odometre okuyan
 * bir yol YOK, native kalıcılık köprüsü Java'da TANIMSIZ (sessiz no-op),
 * backend'de 1083 aracın tamamında `odometer_km = 0` (kolon varsayılanı).
 * Bu yüzden bakım katmanı kilometre eksenini bilinçle `unknown`a çekmişti.
 *
 * ── BU DOSYA YENİ BİR TARAYICI DEĞİLDİR ──────────────────────────────────
 * Yeni ECU keşfi, yeni DID taraması, yeni zamanlayıcı, yeni capability
 * defteri KURMAZ. Mevcut otoriteleri okur:
 *   · profil şeması/derleyici : `vehicleDidProfile` (kaynak zorunlu, eval yok)
 *   · DID okuma/önbellek      : `manufacturerPidService` (`getDidValue`)
 *   · ölçüm anı               : `ManufacturerDidValue.updatedAt`
 *   · birim/aralık            : derlenmiş tanımın `unit` / `min` / `max`'ı
 *
 * ── EPİSTEMİK İLKE (CLAUDE.md §8) ────────────────────────────────────────
 * Hedef "her araçta kilometre göstermek" DEĞİL, "desteklenen araçta gerçeği
 * bilmek, desteklenmeyende bilmediğini bilmek"tir. Bu yüzden her dal
 * fail-closed: kanıt yoksa sayı YOK.
 *
 * SAF DEĞİL (mevcut servis durumunu okur) ama YAN ETKİSİZDİR: sorgu
 * başlatmaz, yazmaz, timer kurmaz.
 */

import { getDidValue, getSupportedDids } from './manufacturerPidService';
import type { CompiledDidDef } from './vehicleDidProfile';

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

/**
 * Odometre kanıtının durumu.
 *
 * `UNSUPPORTED` ile `UNKNOWN` AYRI gerçeklerdir: birincisi "bu araç profilinde
 * odometre tanımlı değil" (kalıcı), ikincisi "tanımlı ama henüz okunmadı"
 * (geçici). İkisini birleştirmek, desteklenen bir aracı desteklenmiyor gibi
 * göstermek olurdu.
 */
export type OdometerEvidenceStatus =
  | 'MEASURED'     // araçtan okundu, birim/aralık doğrulandı
  | 'UNSUPPORTED'  // yüklü profilde `vehicle_odometer` rolü YOK
  | 'UNKNOWN'      // rol var ama henüz geçerli bir okuma gelmedi
  | 'INVALID';     // okuma geldi ama güvenilmez (birim/aralık/sayı)

export interface OdometerEvidence {
  readonly status: OdometerEvidenceStatus;
  /** Yalnız `MEASURED` iken sayı taşır; diğer her durumda `null`. */
  readonly valueKm: number | null;
  /** Ölçümün alındığı an (epoch ms). Uydurulmaz; okuma yoksa `null`. */
  readonly measuredAt: number | null;
  /** Kanıtın kaynağı — kullanıcı girdisi ve trip mesafesi BURAYA GİREMEZ. */
  readonly source: 'ECU_REPORTED' | null;
  readonly protocol: 'UDS' | 'KWP' | null;
  /** Hangi ECU ve hangi tanımlayıcıdan okundu — denetlenebilirlik için. */
  readonly ecu: string | null;
  readonly identifier: string | null;
  /** Reddedildiyse insan-okur gerekçe. */
  readonly reason: string | null;
}

const NO_EVIDENCE = (
  status: OdometerEvidenceStatus,
  reason: string | null,
): OdometerEvidence => ({
  status, valueKm: null, measuredAt: null,
  source: null, protocol: null, ecu: null, identifier: null, reason,
});

/* ── Rol çözümü ────────────────────────────────────────────────────────── */

/**
 * Yüklü profildeki `vehicle_odometer` rollü tanımı bulur.
 *
 * BİRDEN FAZLA olması bir profil hatasıdır ve SESSİZCE ilki seçilmez:
 * hangisinin doğru olduğunu bilmiyoruz demektir (§12 ruhu — çelişki
 * gizlenmez).
 */
export function findOdometerDid(
  defs: readonly CompiledDidDef[],
): { ok: true; def: CompiledDidDef } | { ok: false; reason: string } {
  const hits = defs.filter((d) => d.role === 'vehicle_odometer');
  if (hits.length === 0) {
    return { ok: false, reason: 'Bu araç profilinde odometre tanımlı değil' };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: `Profilde ${hits.length} farklı odometre tanımı var — hangisinin doğru olduğu belirsiz`,
    };
  }
  return { ok: true, def: hits[0]! };
}

/* ── Doğrulama ─────────────────────────────────────────────────────────── */

/**
 * Okunan değeri kanıt sayılabilir mi diye sınar.
 *
 * KEYFİ ÜST SINIR YOKTUR (§14): makullük sınırı profilin KENDİ `min`/`max`
 * beyanıdır — o beyan da kaynak zorunluluğu altında yazılmıştır. Burada
 * "600.000 km imkânsız" gibi bir hüküm ÜRETİLMEZ.
 *
 * BİRİM KAPISI pazarlıksızdır: ölçek kanıtı olmadan sayı akmaz (§13).
 * Profil `km` demiyorsa değer reddedilir — mil/0,1 km/metre sessizce
 * kilometreye çevrilmez.
 */
export function validateOdometerReading(
  raw: unknown,
  def: CompiledDidDef,
): { ok: true; valueKm: number } | { ok: false; reason: string } {
  if (def.unit !== 'km') {
    return { ok: false, reason: `Ölçek doğrulanmadı (birim '${def.unit}')` };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, reason: 'Okuma sayısal değil' };
  }
  if (raw < 0) {
    return { ok: false, reason: 'Negatif kilometre fiziksel olarak imkânsız' };
  }
  /* Sıfır bir ÖLÇÜM olabilir (sıfır km araç) ama pratikte sentinel/boş
     yanıttır; profilin alt sınırı 0'dan büyükse zaten elenir. Alt sınırı 0
     olan profillerde 0 kabul edilir — uydurma değil, profilin beyanı. */
  if (raw < def.min || raw > def.max) {
    return {
      ok: false,
      reason: `Değer profil aralığının dışında (${def.min}–${def.max} ${def.unit})`,
    };
  }
  return { ok: true, valueKm: raw };
}

/* ── Kanonik okuma ─────────────────────────────────────────────────────── */

/**
 * Aracın toplam kilometresi için KANONİK kanıt.
 *
 * Yeni sorgu BAŞLATMAZ: mevcut üretici DID akışının önbelleğini okur. Bu
 * bilinçlidir — odometre için ayrı bir yoklama turu açmak ikinci bir
 * zamanlayıcı ve ikinci bir hat yükü demek olurdu.
 */
export function readVehicleOdometerEvidence(): OdometerEvidence {
  let defs: readonly CompiledDidDef[];
  try {
    defs = getSupportedDids();
  } catch {
    return NO_EVIDENCE('UNKNOWN', 'Araç profili okunamadı');
  }

  const found = findOdometerDid(defs);
  if (!found.ok) return NO_EVIDENCE('UNSUPPORTED', found.reason);

  const def = found.def;
  const protocol = def.service === '21' ? 'KWP' : 'UDS';

  const cached = getDidValue(def.did);
  if (!cached) {
    /* Tanım VAR ama okuma YOK: "desteklenmiyor" DEMEZ. Ayrıca önceki bir
       değeri yeni ölçüm gibi damgalamaz — burada saklanan değer yoktur. */
    return { ...NO_EVIDENCE('UNKNOWN', 'Odometre henüz okunmadı'),
      protocol, ecu: def.ecuId, identifier: def.did };
  }

  const check = validateOdometerReading(cached.value, def);
  if (!check.ok) {
    return { ...NO_EVIDENCE('INVALID', check.reason),
      protocol, ecu: def.ecuId, identifier: def.did };
  }

  const measuredAt = typeof cached.updatedAt === 'number' && Number.isFinite(cached.updatedAt)
    ? cached.updatedAt
    : null;
  if (measuredAt === null) {
    /* Ölçüm anı bilinmiyorsa değer KANIT SAYILMAZ: tazeliği denetlenemeyen
       bir kilometre, bakım hesabında "güncel" gibi kullanılamaz. */
    return { ...NO_EVIDENCE('INVALID', 'Ölçüm anı bilinmiyor'),
      protocol, ecu: def.ecuId, identifier: def.did };
  }

  return {
    status: 'MEASURED',
    valueKm: check.valueKm,
    measuredAt,
    source: 'ECU_REPORTED',
    protocol,
    ecu: def.ecuId,
    identifier: def.did,
    reason: null,
  };
}

/**
 * Bakım katmanının ihtiyacı: kanıtlı kilometre ya da `null`.
 *
 * `MEASURED` dışındaki HER durum `null` döner — `UNSUPPORTED`, `UNKNOWN` ve
 * `INVALID` arasındaki ayrım kanıt nesnesinde yaşar, sayıya dönüşmez.
 */
export function readVehicleOdometerKmOrNull(): number | null {
  const e = readVehicleOdometerEvidence();
  return e.status === 'MEASURED' ? e.valueKm : null;
}

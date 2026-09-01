/**
 * ecuAddressability — ECU KEŞİF VE ADRESLENEBİLİRLİK KANIT DEFTERİ (P0-OBD-FINAL-01).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sahada (Protocol 5 / KWP2000, classic BT) şu üçü AYNI ANDA doğruydu:
 *   · Normal PID poll'u çalışıyor, gerçek ECU cevapları geliyor.
 *   · Mode 03 → "43000000000000", Mode 07 → "47000000000000" (POZİTİF, 0 kod).
 *   · Araçta BİLİNEN bir arıza var ama üründe HİÇ görünmüyor.
 * Ve LAB'da "keşif gözlemleri" BOŞTU. Boş bir ekran iki bambaşka şeyi aynı
 * gösteriyordu: "hiç ECU yok" ile "keşif hiç çalışmadı / çözümlenemedi".
 *
 * Ölçülen kök: fonksiyonel prob (ATH1 + 0100) ÇALIŞIYOR ama çözümleyici yalnız
 * CAN header'ı tanıyordu → KWP hattında topoloji boş → motor ECU'su DIŞINDA
 * hiçbir birim SORULMUYORDU. Üstelik bu boşluğun NEDENİ hiçbir yerde
 * görünmüyordu; yani hata kendini saklıyordu.
 *
 * Bu defter o boşluğu kapatır: her ECU adayı için keşif kaynağı, tx/rx, protokol,
 * oturum mührü, prob sonucu, ADRESLENEBİLİRLİK ve o karara götüren SERVİS
 * denemeleri (servis · alt fonksiyon · ham yanıt · sonuç) yan yana durur.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Bu modül HİÇBİR ölçüm YAPMAZ, komut GÖNDERMEZ, karar DEĞİŞTİRMEZ.
 *    Tarama zaten hesapladığı gözlemi buraya YAZAR.
 *  · "UNKNOWN" gerçek bir değerdir ve "NOT_ADDRESSABLE" ile KARIŞTIRILMAZ:
 *    biri "sorulamadı", diğeri "soruldu, ulaşılamadı" demektir.
 *  · Oturum mührü kendini temizler: yeni epoch yazmaya başlayınca eski oturumun
 *    kayıtları düşer (dtcScanEvidence ile AYNI kural — ikinci bir sıfırlama
 *    çağrısına bağımlılık bu projenin tekrar eden kusurudur).
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6) ──────────────────────
 * Yalnız OBD protokol verisi taşınır: adres, protokol hanesi, servis numarası,
 * ham hex yanıt, enum sonuç. VIN · konum · MAC · kullanıcı verisi GİRMEZ.
 *
 * SAF DEĞİL (bounded ring durumu tutar) ama I/O yapmaz; Date.now yalnız damga.
 */

import type { EcuDiscoverySource, EcuProbeOutcome } from './ecuCompleteness';
import type { TxHeaderProvenance } from './ecuDiscovery';
import type { EcuAddressBits, EcuRole, EcuRoleEvidence } from './ecuRoleModel';

/**
 * Bir ECU'ya FİZİKSEL istek gönderilebildiğinin ÖLÇÜLMÜŞ durumu.
 *
 * Fonksiyonel bir yanıt (7DF / broadcast) "bu ECU var" der; "bu adrese istek
 * gidiyor" DEMEZ. İkisini birleştirmek, KWP hattında doğrulanmamış bir hedefe
 * 0x18 göndermek demektir — V-08'in yasakladığı tam olarak budur.
 */
export type EcuAddressability =
  /** Fiziksel adrese istek gitti ve ECU CEVAPLADI (pozitif ya da NRC fark etmez). */
  | 'PROVEN'
  /** Fiziksel istek gitti ama ECU SUSTU (NO DATA / timeout) — hedef doğrulanmadı. */
  | 'NOT_ADDRESSABLE'
  /** Fiziksel istek HİÇ GÖNDERİLMEDİ (tx türetilemedi / admisyon kapalı / tavan). */
  | 'NOT_ATTEMPTED'
  /** Ölçüm var ama sınıflandırılamadı (eski APK sonuç alanı taşımıyor). */
  | 'UNKNOWN';

export const ECU_ADDRESSABILITY_LABEL: Readonly<Record<EcuAddressability, string>> = {
  PROVEN:          'adreslenebilir — ECU fiziksel isteğe cevap verdi',
  NOT_ADDRESSABLE: 'ULAŞILAMADI — istek gitti, ECU sustu',
  NOT_ATTEMPTED:   'hiç denenmedi — istek GÖNDERİLMEDİ',
  UNKNOWN:         'BİLİNMİYOR — sonuç ölçülemedi',
} as const;

/** Bir ECU'ya yapılan TEK servis denemesinin künyesi. */
export interface EcuServiceAttempt {
  /** '03' · '07' · '0A' · '19' · '18' */
  readonly service: string;
  /** UDS/KWP alt fonksiyonu ('02', '18'…); standart modlarda null. */
  readonly subFunction: string | null;
  /** Native'in ÖLÇTÜĞÜ sonuç (enum/metin); taşınmadıysa null. */
  readonly outcome: string | null;
  /** Ham yanıt (kırpılmış); köprü taşımıyorsa null — boş string YAZILMAZ. */
  readonly raw: string | null;
  /** Çözümlenen kod adedi. */
  readonly codeCount: number;
}

export interface EcuDiscoveryObservation {
  readonly atMs: number;
  readonly sessionEpoch: number;
  /** Okuma anındaki aktif protokol (ATDPN); ölçülmediyse null. */
  readonly protocol: string | null;
  readonly rxHeader: string;
  /** Fiziksel istek adresi; türetilemediyse null (boş string YAZILMAZ). */
  readonly txHeader: string | null;
  readonly addressBits: EcuAddressBits;
  readonly label: string;
  readonly role: EcuRole;
  readonly roleEvidence: EcuRoleEvidence;
  readonly discoverySource: EcuDiscoverySource;
  readonly probeOutcome: EcuProbeOutcome;
  readonly txProvenance: TxHeaderProvenance;
  readonly addressability: EcuAddressability;
  /** Adreslenebilirlik kararının TR gerekçesi — LAB'da kararın NEDENİ görünür. */
  readonly addressabilityReason: string;
  /** Bu ECU'ya yapılan servis denemeleri (sıra korunur). */
  readonly attempts: readonly EcuServiceAttempt[];
  /** Tarama anındaki admisyon kararı (diagnosticAdmission). */
  readonly admission: string;
  /** KWP 0x18 kapısının bu ECU için ÖLÇÜLMÜŞ sonucu. */
  readonly kwpTargetVerified: boolean;
  /**
   * Sonuç kanonik DTC otoritesine YAYINLANDI mı. null = yayın adımı
   * çalışmadı / ölçülmedi — sahte false YAZILMAZ.
   */
  readonly publishedToAuthority: boolean | null;
}

/** Defter tavanı — MAX_SCAN_ECUS'ün iki katı; sınırsız kayıt cihazda bellek sorunudur. */
export const ECU_OBSERVATION_RING = 16;

let _ring: EcuDiscoveryObservation[] = [];

/**
 * Gözlem yazar. ASLA throw etmez — defter ürünü düşüremez.
 *
 * AYNI OTURUMDA aynı (rx + addressBits) için ikinci kayıt gelirse ESKİSİNİN
 * YERİNE geçer: bir tarama turu boyunca ECU'nun kanıtı BÜYÜR (03 → 07 → 0A →
 * 19/18), her aşamada yeni satır üretip defteri şişirmez.
 */
export function recordEcuObservation(o: EcuDiscoveryObservation): void {
  try {
    const last = _ring[_ring.length - 1];
    if (last !== undefined && last.sessionEpoch !== o.sessionEpoch) _ring = [];
    const key = `${o.addressBits}:${o.rxHeader}`;
    const idx = _ring.findIndex((e) => `${e.addressBits}:${e.rxHeader}` === key);
    if (idx >= 0) {
      const next = _ring.slice();
      next[idx] = o;
      _ring = next;
      return;
    }
    _ring = _ring.length >= ECU_OBSERVATION_RING
      ? [..._ring.slice(1), o]
      : [..._ring, o];
  } catch { /* kanıt kaydı ürünü DÜŞÜRMEZ */ }
}

/** Salt-okunur okuma — kopya döner (çağıran defteri bozamaz). */
export function getEcuObservations(): readonly EcuDiscoveryObservation[] {
  return _ring.slice();
}

/** @internal — testler arası izolasyon. */
export function _resetEcuObservationsForTest(): void { _ring = []; }

/**
 * ASCII katlama — tr-TR yerel ayarında "i" harfi toUpperCase ile "İ" olur ve
 * enum eşleşmesi SESSİZCE düşer (bkz. proje kütüğü: fail-open eşleşme).
 * Bu yüzden sınıflandırma toUpperCase KULLANMAZ.
 */
function fold(s: string): string {
  let out = '';
  for (const ch of s.trim()) {
    const c = ch.charCodeAt(0);
    out += (c >= 97 && c <= 122) ? String.fromCharCode(c - 32) : ch;
  }
  return out;
}

/**
 * Native'in ölçtüğü DTC okuma sonucunu ADRESLENEBİLİRLİK kararına çevirir (SAF).
 *
 * KURAL: cevap gelmesi yeter — POZİTİF de NEGATİF (7F) de "bu adres canlı"
 * kanıtıdır. Bir ABS ECU'su Mode 03'e "7F 03 11" diyebilir; bu, servisi
 * bilmediğini söyler ama ADRESİN ULAŞILABİLİR olduğunu KANITLAR. Yalnız
 * SESSİZLİK (NO DATA / timeout) hedefi çürütür.
 *
 * null girdi = eski APK sonuç alanı taşımıyor → UNKNOWN (fail-closed:
 * ölçemediğimiz şeyi "kanıtlandı" saymayız).
 */
export function addressabilityFromOutcome(outcome: string | null | undefined): EcuAddressability {
  if (outcome === null || outcome === undefined || outcome === '') return 'UNKNOWN';
  switch (fold(outcome)) {
    case 'OK':
    case 'UNSUPPORTED':
    case 'NO_SID':
      return 'PROVEN';
    case 'NO_RESPONSE':
    case 'TIMEOUT':
      return 'NOT_ADDRESSABLE';
    /* Hat hatası ECU hakkında BİR ŞEY SÖYLEMEZ — taşıma katmanı düştü. */
    case 'BUS_ERROR':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

/**
 * İki adreslenebilirlik gözlemini birleştirir: bir ECU'ya birden çok servis
 * denemesi yapılır ve KANIT BİRİKİR.
 *
 * Sıra bilinçlidir: bir kez PROVEN olan ECU, sonraki bir sessizlikle
 * "ulaşılamaz"a DÜŞMEZ (o sessizlik servisin değil hedefin değil, o anın
 * sonucudur); ama hiç kanıt yokken gelen sessizlik NOT_ADDRESSABLE'dır.
 */
export function mergeAddressability(
  prev: EcuAddressability, next: EcuAddressability,
): EcuAddressability {
  if (prev === 'PROVEN' || next === 'PROVEN') return 'PROVEN';
  if (prev === 'NOT_ADDRESSABLE' || next === 'NOT_ADDRESSABLE') return 'NOT_ADDRESSABLE';
  if (prev === 'UNKNOWN' || next === 'UNKNOWN') return 'UNKNOWN';
  return 'NOT_ATTEMPTED';
}

/**
 * manufacturerClearGate — ÜRETİCİ DTC SİLME KAPISI (P0-OBD-DIAG-02).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL BİR KOMUT GÖNDERMEZ. BİR KARAR ÜRETİR. ───────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Emisyon hafızası (Mode 04) ile ÜRETİCİ hafızası AYRI şeylerdir:
 *   · Mode 04 fonksiyonel yayınla gider ve SAE J1979 emisyon kodlarını siler.
 *     Mevcut `writeGate` + `dtcClearModel` o yolun sahibidir ve DEĞİŞMEDİ.
 *   · Üretici kodları (KWP 0x18/0x13 · UDS 0x19) bir ECU'nun KENDİ hafızasında
 *     yaşar ve silinmesi FİZİKSEL adresle, `0x14` (clearDiagnosticInformation)
 *     ya da KWP `0x14` eşdeğeriyle olur. Bu, YANLIŞ hedefe gittiğinde K-line'da
 *     başka bir modülü uyandırabilen DESTRUCTIVE bir komuttur.
 *
 * ── BU KAPI NEDEN ŞİMDİ YAZILDI AMA AÇILMADI ──────────────────────────────
 * Saha (2026-08-25/26): ECU 7A'ya fiziksel istek ULAŞMIYOR; üretici tabanından
 * TEK BİR kod bile okunamadı. "Silme" özelliğini bugün açmak, adresini bile
 * kanıtlayamadığımız bir ECU'ya araç hafızasını değiştiren komut göndermek
 * olurdu. Kapı bu yüzden ÖNCE yazıldı, KAPALI bırakıldı ve açılma koşulları
 * ÖLÇÜLEBİLİR hâle getirildi: gerçek DTC okunduğu gün karar TEK yerde,
 * kanıta bağlı olarak verilecek — o gün aceleyle yazılan bir kapı olmayacak.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  1. SAF: I/O yok · timer yok · `Date.now` yok · global durum yok. Tüm girdi
 *     çağırandan gelir; aynı girdi her zaman aynı kararı verir.
 *  2. FAIL-CLOSED: eksik/bilinmeyen her alan REDDE düşer. "Bilinmiyor" ASLA
 *     "izinli" sayılmaz.
 *  3. GEREKÇE ZORUNLU: her ret, HANGİ kanıtın eksik olduğunu söyler. Sessiz
 *     ret, kullanıcıya "çalışmıyor" hissi verir ve teşhis edilemez.
 *  4. HEDEF UYDURULMAZ: silme hedefi, kodu GERÇEKTEN OKUYAN ECU'nun kanıtlanmış
 *     tx header'ıdır. Başka bir adres türetilmez.
 *  5. KULLANICI ONAYI AYRI BİR KANITTIR: teknik koşullar sağlansa bile açık
 *     onay olmadan kapı AÇILMAZ (destructive komut sessizce koşamaz).
 */

import type { DtcSourceService } from './dtcAuthority';
import type { EcuAddressability } from './ecuAddressability';

/* ── Girdi ───────────────────────────────────────────────────────────────── */

/** Silinmesi istenen ÜRETİCİ kodunun ölçülmüş künyesi. */
export interface ManufacturerClearTarget {
  /** Kodun okunduğu ECU'nun tx header'ı (fiziksel hedef) — boşsa hedef YOK. */
  readonly txHeader: string | null;
  /** Aynı ECU'nun rx header'ı — kimlik. */
  readonly rxHeader: string | null;
  /** Bu ECU için ÖLÇÜLEN adreslenebilirlik. */
  readonly addressability: EcuAddressability;
  /** Kodu ÜRETEN servis — hangi hafızanın silineceğini o belirler. */
  readonly sourceService: DtcSourceService;
  /** O servisin son okumasında GERÇEKTEN kod döndü mü. */
  readonly observedCodeCount: number;
  /** Okumanın ait olduğu OBD oturumu. */
  readonly sessionEpoch: number;
}

export interface ManufacturerClearGateInput {
  readonly target: ManufacturerClearTarget;
  /** Şu anki OBD oturumu — hedefinkinden farklıysa kanıt BAYATTIR. */
  readonly currentSessionEpoch: number;
  /** Aktif protokol (ATDPN); okunamadıysa null. */
  readonly protocolActive: string | null;
  /** Silme komutunu taşıyacak native köprü GERÇEKTEN var mı. */
  readonly bridgeAvailable: boolean;
  /** Araç duruyor mu (ölçülmediyse null — null REDDE düşer). */
  readonly vehicleStopped: boolean | null;
  /** Kullanıcı bu ECU için silmeyi AÇIKÇA onayladı mı. */
  readonly userConfirmed: boolean;
  /**
   * Bu ürün sürümünde üretici silme yolu SAHADA doğrulandı mı.
   *
   * Bugün `false`tur ve öyle KALIR: gerçek bir üretici DTC okunup silme yolu
   * gerçek araçta doğrulanana kadar bu bayrağı `true` yapmak, kanıtsız bir
   * destructive komutu ürüne açmak olur (kütük #837).
   */
  readonly clearPathFieldVerified: boolean;
}

/* ── Karar ───────────────────────────────────────────────────────────────── */

export type ManufacturerClearDenyReason =
  | 'NO_TARGET'                 // kodu okuyan ECU'nun fiziksel hedefi yok
  | 'ADDRESS_NOT_PROVEN'        // adres ölçülmedi/ulaşılamadı
  | 'NO_OBSERVED_CODE'          // silinecek ölçülmüş kod YOK
  | 'STALE_SESSION'             // kanıt başka oturuma ait (araç değişmiş olabilir)
  | 'PROTOCOL_UNKNOWN'          // protokol okunamadı → hangi silme yolu belirsiz
  | 'BRIDGE_MISSING'            // native köprü yok (eski APK / web)
  | 'VEHICLE_NOT_STOPPED'       // araç duruyor mu ÖLÇÜLMEDİ ya da hareket hâlinde
  | 'NO_USER_CONFIRMATION'      // açık onay yok
  | 'CLEAR_PATH_UNVERIFIED'     // yol sahada hiç doğrulanmadı (bugünkü hâl)
  | 'UNSUPPORTED_SOURCE';       // kaynak servis üretici hafızası değil

export const MANUFACTURER_CLEAR_DENY_LABEL:
Readonly<Record<ManufacturerClearDenyReason, string>> = {
  NO_TARGET:             'kodu okuyan ECU\'nun fiziksel hedefi YOK — adres uydurulamaz',
  ADDRESS_NOT_PROVEN:    'fiziksel adreslenebilirlik KANITLANMADI',
  NO_OBSERVED_CODE:      'silinecek ÖLÇÜLMÜŞ üretici kodu YOK',
  STALE_SESSION:         'kanıt BAŞKA oturuma ait — adaptör başka araca takılmış olabilir',
  PROTOCOL_UNKNOWN:      'aktif protokol okunamadı — hangi silme yolu geçerli BİLİNMİYOR',
  BRIDGE_MISSING:        'native silme köprüsü YOK',
  VEHICLE_NOT_STOPPED:   'araç duruyor mu ÖLÇÜLMEDİ ya da hareket hâlinde',
  NO_USER_CONFIRMATION:  'kullanıcı bu ECU için silmeyi AÇIKÇA onaylamadı',
  CLEAR_PATH_UNVERIFIED: 'üretici silme yolu GERÇEK ARAÇTA hiç doğrulanmadı (kütük #837)',
  UNSUPPORTED_SOURCE:    'kaynak servis üretici hafızası DEĞİL — Mode 04 yolu ayrıdır',
} as const;

export interface ManufacturerClearDecision {
  /** `true` YALNIZ her koşul kanıtla sağlandığında. Varsayılan HER ZAMAN `false`. */
  readonly allowed: boolean;
  /** Karşılanmayan koşulların TAMAMI (ilk redde durulmaz — teşhis için hepsi). */
  readonly denyReasons: readonly ManufacturerClearDenyReason[];
  /** İzin verilseydi kullanılacak hedef; izin yoksa `null` (hedef sızdırılmaz). */
  readonly resolvedTarget: string | null;
  /** İnsan-okur tek satır — LAB ve UI bunu ELLE yazmaz. */
  readonly reason: string;
}

/** Üretici hafızasını üreten servisler — Mode 03/07/0A bu kapının DIŞINDADIR. */
const MANUFACTURER_SOURCES: ReadonlySet<DtcSourceService> = new Set(['19', '18', '13']);

/**
 * Üretici DTC silme kapısı (SAF, FAIL-CLOSED).
 *
 * Bugün gerçek bir çağrıda `allowed:false` döner ve en az `CLEAR_PATH_UNVERIFIED`
 * gerekçesini taşır — bu BİLİNÇLİDİR. Kapının işlevi bugün "izin vermek" değil,
 * izin verilebilmesi için hangi kanıtların gerektiğini ÖLÇÜLEBİLİR kılmaktır.
 */
export function evaluateManufacturerClearGate(
  input: ManufacturerClearGateInput,
): ManufacturerClearDecision {
  const t = input.target;
  const deny: ManufacturerClearDenyReason[] = [];

  const tx = (t.txHeader ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (tx.length < 6) deny.push('NO_TARGET');
  if (t.addressability !== 'PROVEN') deny.push('ADDRESS_NOT_PROVEN');
  if (!MANUFACTURER_SOURCES.has(t.sourceService)) deny.push('UNSUPPORTED_SOURCE');
  if (!(t.observedCodeCount > 0)) deny.push('NO_OBSERVED_CODE');
  if (t.sessionEpoch !== input.currentSessionEpoch) deny.push('STALE_SESSION');

  const proto = (input.protocolActive ?? '').trim();
  if (proto === '') deny.push('PROTOCOL_UNKNOWN');

  if (!input.bridgeAvailable) deny.push('BRIDGE_MISSING');
  /* `null` = ölçülmedi → REDDE düşer. "Bilinmiyor" izin DEĞİLDİR. */
  if (input.vehicleStopped !== true) deny.push('VEHICLE_NOT_STOPPED');
  if (!input.userConfirmed) deny.push('NO_USER_CONFIRMATION');
  if (!input.clearPathFieldVerified) deny.push('CLEAR_PATH_UNVERIFIED');

  const allowed = deny.length === 0;
  return {
    allowed,
    denyReasons: deny,
    /* Hedef YALNIZ izin verildiğinde dışarı çıkar: reddedilmiş bir kararın
       yanında hedef göstermek, çağıranın onu yine de kullanmasını kolaylaştırır. */
    resolvedTarget: allowed ? tx : null,
    reason: allowed
      ? `üretici silme koşulları KANITLA sağlandı — hedef ${tx} · kaynak ${t.sourceService}`
      : `üretici silme REDDEDİLDİ: ${deny.map((d) => MANUFACTURER_CLEAR_DENY_LABEL[d]).join(' · ')}`,
  };
}

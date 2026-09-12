/**
 * kwpAddressingProbe — KWP2000 FİZİKSEL ADRESLEME KANIT MATRİSİ (P0-OBD-DIAG-01).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN SAHA KUSURU (2026-08-25 · gerçek araç · Protocol 5 / KWP) ──────
 * ══════════════════════════════════════════════════════════════════════════
 * ECU keşfi ÇALIŞTI: `ECU 7A (KWP)` · rx `86F17A` · tx `817AF1` · 8-bit.
 * Fonksiyonel sorgular CEVAP VERDİ. Fiziksel `817AF1` istekleri SUSTU — ve
 * yalnız DTC servisleri değil, oturum probu (`10 81` / `10 C0`) DA sustu.
 * Araçta BİLİNEN GERÇEK bir arıza var ama emisyon hafızası (Mode 03/07) boş:
 * demek ki arıza ÜRETİCİ hafızasında yaşıyor ve oraya YALNIZ fiziksel
 * adreslemeyle ulaşılır. Yani fiziksel adresleme ürünün ÖNÜNDEKİ TEK KAPI.
 *
 * ── KODDAN ÇIKAN İKİ ÖLÇÜLMEMİŞ VARSAYIM ──────────────────────────────────
 * 1. `ecuDiscovery` fiziksel hedefi HER ZAMAN `81<src>F1` diye kuruyor.
 *    ISO 14230-2'de format baytı `1 0 L L L L L L`dir: üst iki bit adresleme
 *    kipi (10 = fiziksel), ALT ALTI BİT VERİ UZUNLUĞU. Yani `81` = "fiziksel,
 *    1 veri baytı". `03` için DOĞRU; ama `10 81` (2 bayt), `19 02 FF` (3) ve
 *    `18 00 FF 00` (4) için YANLIŞ uzunluk beyan eder. Kodun tek gerekçesi bir
 *    YORUM SATIRIDIR: *"ELM327 format baytının uzunluk bitlerini KENDİSİ
 *    doldurur"* — bu iddia bu depoda HİÇBİR YERDE ÖLÇÜLMEMİŞTİR.
 * 2. Fiziksel adrese HİÇ StartCommunication yapılmıyor. Hat fonksiyonel
 *    adrese (`33`) init edildi; bazı KWP ECU'ları fiziksel adres için AYRI
 *    oturum ister. Bu da ölçülmemiş bir varsayımdır.
 *
 * Elimizdeki tek gözlem "817AF1 sustu"ydu ve bu gözlem YUKARIDAKİ İKİ NEDENİ
 * ve "o adreste ECU yok"u AYIRT EDEMİYORDU.
 *
 * ── BU MODÜLÜN SÖZLEŞMESİ ─────────────────────────────────────────────────
 *  1. TAHMİN ETMEZ — ARACA ÖLÇTÜRÜR. Matris, meşru ISO 14230 varyantlarını
 *     sırayla dener ve HANGİSİNİN cevap verdiğini KANIT olarak yazar.
 *  2. HEPSİ SALT-OKUMA. Matriste yazma · aktüatör · rutin · security access ·
 *     silme YOKTUR; native ayrıca kapalı bir servis beyaz listesiyle bunu
 *     ZORLAR (TS bozulsa bile destructive komut hatta ÇIKAMAZ).
 *  3. KONTROL SATIRI ZORUNLUDUR: matris fonksiyonel yolu da ölçer. Fiziksel
 *     satırların hepsi susarken kontrol de susuyorsa teşhis "fiziksel adres
 *     yanlış" DEĞİL, "hat matris sırasında öldü"dür. Bu ayrım olmadan matris
 *     yanlış hüküm üretir.
 *  4. KAZANAN VARYANT ÜRÜNE GERİ YAZILIR: adres UYDURULMAZ, ÖLÇÜLÜR. Hiçbir
 *     araca özel sabit yoktur — kural ISO 14230'un kendisidir, kazananı araç
 *     seçer.
 *  5. FAIL-CLOSED: hiçbir satır cevaplamazsa adreslenebilirlik YÜKSELMEZ,
 *     0x18 / üretici zinciri AÇILMAZ, DTC silme AÇILMAZ.
 *  6. ECU ROLÜ TAHMİN EDİLMEZ. Bu modül adresten anlam çıkarmaz.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Yalnız OBD protokol verisi: header · servis · ham hex · enum. VIN · konum ·
 * MAC · kullanıcı verisi GİRMEZ.
 *
 * SAF DEĞİL (bounded ring durumu tutar) ama I/O yapmaz; `atMs` çağırandan gelir.
 */

/* ── Varyant tanımı ──────────────────────────────────────────────────────── */

/**
 * Bir matris satırı. `header` içindeki `{src}` ECU'nun kaynak adresiyle
 * doldurulur (fonksiyonel kontrol satırında yer almaz).
 */
export interface KwpAddressingVariant {
  /** Kararlı kimlik — kanıt defterinde ve testlerde bununla anılır. */
  readonly id: string;
  /** ATSH'e verilecek 3 baytlık header şablonu ('81{src}F1' · 'C133F1'). */
  readonly headerTemplate: string;
  /** Gönderilecek ham istek ('03' · '0100' · '1081' · '13'). */
  readonly request: string;
  /** Bu satır FİZİKSEL adresleme mi ölçüyor (kontrol satırı `false`). */
  readonly physical: boolean;
  /** TR etiket — LAB'da satırın NE ölçtüğü görünür. */
  readonly label: string;
  /** TR gerekçe — satırın NEDEN matriste olduğu (kanıtsız satır YASAK). */
  readonly why: string;
  /**
   * P0-OBD-DIAG-01/2 — istekten ÖNCE K-line BAŞLATMA (StartCommunication).
   *
   * `undefined` = başlatma YOK (satır mevcut oturumu kullanır — hatta hiçbir
   * kesinti üretmez). `'FAST'` = ELM327 `ATFI` (ISO 14230-4 hızlı başlatma),
   * `'SLOW'` = `ATSI` (ISO 9141-2 / 5 baud).
   *
   * NEDEN AYRI BİR SINIF: başlatma satırları K-line'ı GERÇEKTEN yeniden kurar,
   * yani çalışan fonksiyonel oturumu ANLIK olarak böler. Bu yüzden matrisin
   * SONUNDA dururlar ve YALNIZ (a) kontrol satırı cevap verdiyse — hat canlı —
   * ve (b) başlatmasız fiziksel satırların HEPSİ sustuysa koşarlar. Yani ancak
   * "hat çalışıyor ama fiziksel adres kapalı" ÖLÇÜLDÜKTEN sonra denenirler.
   */
  readonly initFirst?: 'FAST' | 'SLOW';
}

/**
 * MATRİS — SIRA BİLİNÇLİDİR ve gerekçelidir.
 *
 * Önce KONTROL (hat canlı mı), sonra en ucuz/en olası fiziksel varyantlar.
 * Her satır ISO 14230-2/-3'ten türer; hiçbiri araca özel sabit DEĞİLDİR.
 */
export const KWP_ADDRESSING_VARIANTS: readonly KwpAddressingVariant[] = Object.freeze([
  Object.freeze({
    id: 'CTRL_FUNCTIONAL_03',
    headerTemplate: 'C133F1',
    request: '03',
    physical: false,
    label: 'KONTROL · fonksiyonel C133F1 + Mode 03',
    why: 'Matris boyunca hattın CANLI olduğunu kanıtlar. Bu satır da susuyorsa '
       + 'fiziksel satırların sessizliği "adres yanlış" DEĞİL "hat öldü" demektir.',
  }),
  Object.freeze({
    id: 'PHY_LEN1_03',
    headerTemplate: '81{src}F1',
    request: '03',
    physical: true,
    label: 'fiziksel 81 + Mode 03 (uzunluk 1 — DOĞRU)',
    why: 'Ürünün BUGÜNKÜ kuralı. İstek 1 bayt olduğu için format baytındaki '
       + 'uzunluk (1) DOĞRUDUR; bu satır susarsa kusur uzunlukta DEĞİLDİR.',
  }),
  Object.freeze({
    id: 'PHY_LEN2_0100',
    headerTemplate: '82{src}F1',
    request: '0100',
    physical: true,
    label: 'fiziksel 82 + 01 00 (uzunluk 2 — DOĞRU)',
    why: 'Ürün 2+ baytlık her fiziksel isteği HÂLÂ `81` ile gönderiyor (uzunluk '
       + 'YANLIŞ beyan ediliyor). Bu satır doğru uzunlukla aynı ECU\'yu sorar: '
       + 'cevap gelirse kusur ÖLÇÜLMÜŞ olur ve `10 81`/`18`/`19` yolu açılır.',
  }),
  Object.freeze({
    id: 'PHY_LEN0_03',
    headerTemplate: '80{src}F1',
    request: '03',
    physical: true,
    label: 'fiziksel 80 + Mode 03 (uzunluk bitleri 0)',
    why: 'ISO 14230-2: format baytının uzunluk bitleri 0 ise uzunluk AYRI bir '
       + 'baytta taşınır. ELM327\'nin bunu kendisi ekleyip eklemediği bu depoda '
       + 'hiç ölçülmedi; satır tam olarak o varsayımı sınar.',
  }),
  Object.freeze({
    id: 'PHY_LEN1_13',
    headerTemplate: '81{src}F1',
    request: '13',
    physical: true,
    label: 'fiziksel 81 + servis 0x13 (readDTC — eski nesil)',
    why: 'ISO 14230-3\'te 0x18 öncesi nesil DTC okuma servisi 0x13\'tür ve çok '
       + 'sayıda 2000-2008 KWP ECU\'su YALNIZ onu bilir. Ürün bugün 0x13\'ü HİÇ '
       + 'sormuyor; bu satır desteğin VAR/YOK olduğunu kanıta bağlar.',
  }),
  Object.freeze({
    id: 'PHY_LEN2_1081',
    headerTemplate: '82{src}F1',
    request: '1081',
    physical: true,
    label: 'fiziksel 82 + 10 81 (uzunluk 2 — DOĞRU)',
    why: 'Oturum probu bugün `81` ile gidiyor (uzunluk 1 beyan, 2 bayt veri). '
       + 'Bu satır aynı oturum isteğini DOĞRU uzunlukla sorar — pozitif gelirse '
       + 'oturum kanıtı da uzunluk kusuru yüzünden kaybolmuş demektir.',
  }),
  Object.freeze({
    id: 'PHY_FASTINIT_03',
    headerTemplate: '81{src}F1',
    request: '03',
    physical: true,
    initFirst: 'FAST',
    label: 'fiziksel 81 + FAST INIT (ATFI) + Mode 03',
    why: 'SAHA TURU 2 (2026-08-25) beş başlatmasız fiziksel satırın HEPSİNİN sustuğunu, '
       + 'kontrol satırının ise CEVAP VERDİĞİNİ ölçtü → hat canlı, uzunluk hipotezi ELENDİ, '
       + 'eski servis (0x13) hipotezi ELENDİ. Geriye tek aday kaldı: hat fonksiyonel adrese '
       + '(0x33) başlatıldı ve bu ECU fiziksel adres için KENDİ StartCommunication adımını '
       + 'bekliyor. ISO 14230-2 hızlı başlatma ADRESE ÖZELDİR; ELM327 `ATFI` onu o anki '
       + 'header ile yapar. Bu satır o adayı ölçer.',
  }),
  Object.freeze({
    id: 'PHY_FASTINIT_1081',
    headerTemplate: '82{src}F1',
    request: '1081',
    physical: true,
    initFirst: 'FAST',
    label: 'fiziksel 82 + FAST INIT (ATFI) + 10 81',
    why: 'Başlatma sonrası bazı KWP birimleri veri servisinden ÖNCE tanı oturumu ister. '
       + 'Bu satır başlatma + oturum isteğini birlikte ölçer; pozitif gelirse fiziksel '
       + 'kanal açılmış ve üretici DTC yolu (0x18) kanıtlanmış olur.',
  }),
]);

/** Matris tavanı — K-line yavaştır; sınırsız deneme sürüş sırasında kabul edilemez. */
export const KWP_ADDRESSING_MAX_VARIANTS = 8;

/** Bir varyantın header'ını ECU kaynak adresiyle doldurur (SAF). */
export function resolveVariantHeader(v: KwpAddressingVariant, srcAddress: string): string {
  const src = srcAddress.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return v.headerTemplate.replace('{src}', src);
}

/**
 * ECU'nun rx header'ından KAYNAK adresini çıkarır (SAF).
 *
 * ISO 14230-2 yanıt header'ı `Fmt Tgt Src`tir: `86 F1 7A` → hedef F1 (tester),
 * KAYNAK 7A (ECU). Adres BURADAN OKUNUR, tahmin EDİLMEZ.
 * Geçersiz girdi → `null` (uydurma adres YASAK).
 */
export function ecuSourceFromRxHeader(rxHeader: string | null | undefined): string | null {
  const hex = (rxHeader ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 6) return null;
  const src = hex.slice(4, 6);
  /* Tester adresi bir ECU kaynağı olamaz (yankı satırı). */
  if (src === 'F1' || src === '6B' || src === '33') return null;
  return src;
}

/* ── Sonuç sınıflandırması ───────────────────────────────────────────────── */

export type KwpAddressingResult =
  /** ECU CEVAPLADI: pozitif yanıt ölçüldü (istek servisi + 0x40). */
  | 'ANSWERED'
  /** ECU ayrık NEGATİF yanıt verdi (`7F <sid> <nrc>`) — adres CANLI, servis yok. */
  | 'NEGATIVE'
  /** İstek gitti, ECU SUSTU (NO DATA / timeout). */
  | 'NO_RESPONSE'
  /** Yanıt geldi ama çözümlenemedi (klon adaptör "?" · bozuk çerçeve). */
  | 'MALFORMED'
  /** Hat/adaptör düştü — ECU hakkında BİR ŞEY SÖYLEMEZ. */
  | 'TRANSPORT_ERROR'
  /**
   * P0-OBD-DIAG-03 — K-line BAŞLATMA (ATFI/ATSI) DÜŞTÜ; istek HİÇ gönderilmedi.
   *
   * `TRANSPORT_ERROR`dan AYRI tutulur çünkü teşhis TAMAMEN FARKLIDIR: hat
   * hatası "istek gitti, hat bozuldu" demektir; bu ise "başlatma komutu bile
   * kabul edilmedi" demektir. Sahada (2026-08-26) iki ATFI satırı da buraya
   * düştü ve tek başına `TRANSPORT_ERROR` olarak raporlanmaları teşhisi
   * yanıltıyordu — ECU hakkında değil, ADAPTÖR/BAŞLATMA hakkında bir ölçümdür.
   */
  | 'INIT_FAILED'
  /** Satır HİÇ GÖNDERİLMEDİ (köprü yok · beyaz liste reddi · erken durdu). */
  | 'NOT_ATTEMPTED';

export const KWP_ADDRESSING_RESULT_LABEL: Readonly<Record<KwpAddressingResult, string>> = {
  ANSWERED:        'ECU CEVAPLADI — pozitif yanıt ölçüldü',
  NEGATIVE:        'ECU REDDETTİ (ayrık negatif) — adres CANLI, servis desteklenmiyor',
  NO_RESPONSE:     'ECU SUSTU — istek gitti, yanıt yok',
  MALFORMED:       'yanıt ÇÖZÜMLENEMEDİ',
  TRANSPORT_ERROR: 'HAT HATASI — ECU hakkında kanıt DEĞİL',
  INIT_FAILED:     'K-line BAŞLATMA düştü — istek HİÇ gönderilmedi (ECU kanıtı DEĞİL)',
  NOT_ATTEMPTED:   'gönderilmedi',
} as const;

/**
 * ASCII katlama — tr-TR yerelinde `toUpperCase()` "i"yi "İ" yapar ve enum
 * eşleşmesi SESSİZCE düşer (bu deponun tekrar eden fail-open kusuru).
 */
function fold(s: string): string {
  let out = '';
  for (const ch of s.trim()) {
    const c = ch.charCodeAt(0);
    out += (c >= 97 && c <= 122) ? String.fromCharCode(c - 32) : ch;
  }
  return out;
}

/** Ham yanıttan hex olmayan her şeyi atar (boşluk · CR · '>' promptu). */
export function compactHex(v: string | null | undefined): string {
  return (v ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
}

/**
 * P0-OBD-DIAG-03 — ELM327'nin METİN durum yanıtları (hex DEĞİL).
 *
 * ÖLÇÜLEN KUSUR (saha 2026-08-26): LAB'da `oturum yanıtı DAA` görüldü. Kaynak
 * `compactHex("NO DATA")`ydı: "NO DATA" içindeki `D`, `A`, `A` GEÇERLİ HEX
 * karakterleridir → adaptörün "veri yok" demesi, ekranda **uydurma bir hex
 * yanıta** dönüşüyordu. Bu, bu deponun en sert kuralının ihlalidir: ölçülmemiş
 * bir değeri ölçülmüş gibi göstermek. Metin durumları artık hex'e ÇEVRİLMEZ.
 */
const ELM_TEXT_STATUS = [
  'NODATA', 'STOPPED', 'ERROR', 'UNABLETOCONNECT', 'BUSINIT', 'BUSBUSY',
  'CANERROR', 'BUFFERFULL', 'SEARCHING', 'ACT', 'LVRESET',
] as const;

/** Girdi bir ELM METİN durumu mu (hex yanıt DEĞİL). */
export function isElmTextStatus(v: string | null | undefined): boolean {
  const t = (v ?? '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (t === '') return false;
  return ELM_TEXT_STATUS.some((k) => t.includes(k));
}

/**
 * Ham yanıtı GÖSTERİLEBİLİR biçime çevirir (SAF).
 *  · ELM metin durumu ise METNİ döndürür (kırpılmış) — hex'e ZORLANMAZ.
 *  · Gerçek hex ise sıkıştırılmış hex döner.
 *  · İkisi de değilse `null` (uydurma değer YOK).
 */
export function displayRaw(v: string | null | undefined): string | null {
  const src = (v ?? '').trim();
  if (src === '') return null;
  if (isElmTextStatus(src)) return src.replace(/\s+/g, ' ').slice(0, 40);
  const hex = compactHex(src);
  return hex === '' ? null : hex;
}

/** İsteğin servis baytından POZİTİF yanıt servisini üretir (SID + 0x40). */
export function positiveSidOf(request: string): string | null {
  const hex = compactHex(request);
  if (hex.length < 2) return null;
  const sid = Number.parseInt(hex.slice(0, 2), 16);
  if (!Number.isFinite(sid)) return null;
  return ((sid + 0x40) & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export interface KwpAddressingRaw {
  /** GERÇEKTEN gönderilen istek; gönderilmediyse null. */
  readonly request: string | null;
  /** Ham yanıt; köprü taşımıyorsa null — boş string YAZILMAZ. */
  readonly raw: string | null;
  /** Native'in ölçtüğü sonuç sınıfı; taşımıyorsa null. */
  readonly outcome: string | null;
  /**
   * P0-OBD-DIAG-03 — BAŞLATMA komutunun (ATFI/ATSI) HAM yanıtı.
   *
   * Sahada iki başlatma satırı da düştü ve gerekçe GÖRÜNMÜYORDU (`rx=YOK`):
   * adaptör `?` mi dedi (komutu bilmiyor), `BUS INIT: ERROR` mi (araç uyanmadı),
   * yoksa zaman mı aşıldı — üçü TAMAMEN FARKLI teşhistir ve kanıtsız ayrılamaz.
   */
  readonly initRaw?: string | null;
}

/**
 * Bir matris satırını SINIFLANDIRIR (SAF).
 *
 * KURAL SIRASI (fail-closed):
 *  1. Hiç gönderilmediyse → NOT_ATTEMPTED.
 *  2. Ham yanıtta ayrık `7F <sid>` VARSA → NEGATIVE. **Bu bir BAŞARIDIR**:
 *     ECU o adresten KONUŞUYOR demektir (adres kanıtlanır, servis yok).
 *  3. Ham yanıtta pozitif SID (istek + 0x40) VARSA → ANSWERED.
 *  4. Native sessizlik/timeout diyorsa → NO_RESPONSE.
 *  5. Native hat hatası diyorsa → TRANSPORT_ERROR.
 *  6. Kalan her şey → MALFORMED. Native "ok" DESE BİLE pozitif SID ham yanıtta
 *     YOKSA buraya düşer: ölçülmemiş başarıyı başarı saymak yasaktır.
 */
export function classifyKwpAddressingResponse(
  variant: KwpAddressingVariant, raw: KwpAddressingRaw,
): { result: KwpAddressingResult; nrc: number | null } {
  if (raw.request === null || fold(raw.outcome ?? '') === 'NOT_ATTEMPTED') {
    return { result: 'NOT_ATTEMPTED', nrc: null };
  }

  const hex = compactHex(raw.raw);
  const reqSid = compactHex(variant.request).slice(0, 2);

  /* Ayrık negatif ÖNCE bakılır: `7F 03 11` içinde "43" aramak anlamsızdır ve
     negatif yanıt bizim için POZİTİFTEN DE değerlidir (adres CANLI kanıtı). */
  const negIdx = hex.indexOf(`7F${reqSid}`);
  if (negIdx >= 0) {
    const byte = hex.slice(negIdx + 4, negIdx + 6);
    const parsed = byte.length === 2 ? Number.parseInt(byte, 16) : Number.NaN;
    return { result: 'NEGATIVE', nrc: Number.isFinite(parsed) ? parsed : null };
  }

  const posSid = positiveSidOf(variant.request);
  if (posSid !== null && hex.includes(posSid)) {
    return { result: 'ANSWERED', nrc: null };
  }

  switch (fold(raw.outcome ?? '')) {
    case 'NO_RESPONSE':
    case 'NODATA':
    case 'NO_DATA':
    case 'TIMEOUT':
      return { result: 'NO_RESPONSE', nrc: null };
    case 'TRANSPORT_ERROR':
    case 'BUS_ERROR':
      return { result: 'TRANSPORT_ERROR', nrc: null };
    case 'INIT_FAILED':
      return { result: 'INIT_FAILED', nrc: null };
    default:
      return { result: 'MALFORMED', nrc: null };
  }
}

/* ── Kanıt defteri ────────────────────────────────────────────────────────── */

export interface KwpAddressingProbeEntry {
  readonly atMs: number;
  readonly sessionEpoch: number;
  /** Hangi ECU için koştu (rx header — kimlik). */
  readonly rx: string;
  /** GERÇEKTEN kullanılan header (ATSH değeri). */
  readonly header: string;
  readonly variantId: string;
  readonly physical: boolean;
  /** Bu satır K-line başlatma yaptı mı ('FAST'/'SLOW'); yapmadıysa null. */
  readonly initFirst: 'FAST' | 'SLOW' | null;
  /** Başlatma komutunun HAM yanıtı (metin ya da hex); yoksa null. */
  readonly initRaw: string | null;
  readonly request: string | null;
  readonly raw: string | null;
  readonly result: KwpAddressingResult;
  readonly nrc: number | null;
  readonly protocol: string | null;
  readonly nativeOutcome: string | null;
  readonly error: string | null;
}

/** Defter tavanı — ECU başına 8 satır × 2 ECU; sınırsız kayıt cihazda bellek sorunudur. */
export const KWP_ADDRESSING_PROBE_RING = 16;

let _ring: KwpAddressingProbeEntry[] = [];

/** Gözlem yazar. ASLA throw etmez — defter ürünü düşürmez. Oturum mührü kendini temizler. */
export function recordKwpAddressingProbe(e: KwpAddressingProbeEntry): void {
  try {
    const last = _ring[_ring.length - 1];
    if (last !== undefined && last.sessionEpoch !== e.sessionEpoch) _ring = [];
    const frozen = Object.freeze({ ...e });
    _ring = _ring.length >= KWP_ADDRESSING_PROBE_RING
      ? [..._ring.slice(1), frozen]
      : [..._ring, frozen];
  } catch { /* kanıt kaydı ürünü DÜŞÜRMEZ */ }
}

/** Salt-okunur okuma — kopya döner (çağıran defteri bozamaz). */
export function getKwpAddressingProbes(): readonly KwpAddressingProbeEntry[] {
  return _ring.slice();
}

/** @internal — testler arası izolasyon. */
export function _resetKwpAddressingProbesForTest(): void { _ring = []; }

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export interface KwpAddressingVerdict {
  /**
   * `true` YALNIZ bir FİZİKSEL satır ECU'dan yanıt (pozitif VEYA ayrık negatif)
   * aldıysa. Fiziksel adreslenebilirliği açmaya YETKİLİ TEK kanıt budur.
   */
  readonly proven: boolean;
  /** Kanıtı üreten header — ürün bundan SONRA bu header'ı kullanır. */
  readonly provenHeader: string | null;
  /** Kanıtı üreten varyant kimliği. */
  readonly provenVariantId: string | null;
  /** Kanıtı üreten ham yanıt. */
  readonly response: string | null;
  /** Kontrol satırı (fonksiyonel) matris sırasında CEVAP VERDİ mi. */
  readonly controlAlive: boolean | null;
  /**
   * Kanıt YALNIZ K-line yeniden başlatıldıktan sonra geldiyse `true`.
   * Bu, "fiziksel adres kendi StartCommunication'ını ister" hükmünün ÖLÇÜLMÜŞ
   * hâlidir ve ürünün fiziksel istek yolunu KALICI olarak değiştirmesi gerektiğini
   * söyler (tek seferlik bir şans DEĞİL).
   */
  readonly requiredInit: 'FAST' | 'SLOW' | null;
  /** TR gerekçe — LAB'da kararın NEDENİ görünür. */
  readonly reason: string;
  /** Bu ECU için denenen satır sayısı. */
  readonly attempts: number;
}

/** Sonuç gücü — ANSWERED > NEGATIVE (ikisi de "adres canlı") > ölçüm yokluğu. */
const _RESULT_RANK: Readonly<Record<KwpAddressingResult, number>> = {
  ANSWERED: 5, NEGATIVE: 4, MALFORMED: 3, NO_RESPONSE: 2,
  TRANSPORT_ERROR: 1, INIT_FAILED: 1, NOT_ATTEMPTED: 0,
} as const;

/**
 * Bir ECU'nun BU OTURUMDAKİ matris kanıtını özetler (SAF).
 *
 * KONTROL SATIRI HÜKMÜ EZER: fiziksel satırların hepsi sustu VE kontrol de
 * sustuysa `proven:false` kalır ama gerekçe "hat öldü" der — "adres yanlış"
 * DEMEZ. Bu ayrım olmadan matris yanlış teşhis üretir.
 */
export function summarizeKwpAddressing(
  entries: readonly KwpAddressingProbeEntry[], rx: string, sessionEpoch: number,
): KwpAddressingVerdict {
  const target = compactHex(rx);
  const mine = entries.filter((e) =>
    e.sessionEpoch === sessionEpoch && compactHex(e.rx) === target);

  if (mine.length === 0) {
    return {
      proven: false, provenHeader: null, provenVariantId: null, response: null,
      controlAlive: null, requiredInit: null,
      reason: 'adresleme matrisi bu ECU için hiç koşmadı', attempts: 0,
    };
  }

  const control = mine.find((e) => !e.physical) ?? null;
  const controlAlive = control === null
    ? null
    : (control.result === 'ANSWERED' || control.result === 'NEGATIVE');

  const physical = mine.filter((e) => e.physical);
  let best: KwpAddressingProbeEntry | null = null;
  for (const e of physical) {
    if (best === null || _RESULT_RANK[e.result] > _RESULT_RANK[best.result]) best = e;
  }

  const proven = best !== null && (best.result === 'ANSWERED' || best.result === 'NEGATIVE');
  const requiredInit = proven && best !== null ? (best.initFirst ?? null) : null;

  let reason: string;
  if (proven && best !== null) {
    const nrcText = best.nrc !== null
      ? ` · NRC 0x${best.nrc.toString(16).toUpperCase().padStart(2, '0')}`
      : '';
    const initText = best.initFirst !== null && best.initFirst !== undefined
      ? ` · ${best.initFirst === 'FAST' ? 'ATFI (hızlı başlatma)' : 'ATSI (yavaş başlatma)'} GEREKTİ`
      : '';
    reason = `${best.variantId}: ATSH ${best.header}${initText} + ${best.request} → `
           + `${displayRaw(best.raw) ?? 'YANIT'} (${KWP_ADDRESSING_RESULT_LABEL[best.result]}${nrcText})`;
  } else if (controlAlive === false) {
    reason = 'HAT ÖLÜ — kontrol satırı (fonksiyonel) da cevap vermedi; fiziksel '
           + 'sessizlik "adres yanlış" KANITI DEĞİLDİR, matris yeniden koşmalıdır';
  } else if (physical.every((e) => e.result === 'INIT_FAILED' || e.result === 'NOT_ATTEMPTED')
             || (physical.some((e) => e.result === 'INIT_FAILED')
                 && physical.every((e) => e.result !== 'ANSWERED' && e.result !== 'NEGATIVE'))) {
    /* P0-OBD-DIAG-03: başlatma satırları düştüyse gerekçe ADAPTÖR tarafındadır;
       "ECU sustu" DEMEK DEĞİLDİR ve öyle raporlanamaz. Başlatmanın HAM yanıtı
       teşhisin kendisidir — burada AÇIKÇA taşınır. */
    const inits = physical.filter((e) => e.result === 'INIT_FAILED')
      .map((e) => `${e.variantId}: ${e.initFirst === 'SLOW' ? 'ATSI' : 'ATFI'} → ${e.initRaw ?? 'YANIT YOK'}`)
      .join(' · ');
    const plain = physical.filter((e) => e.result !== 'INIT_FAILED')
      .map((e) => `${e.variantId}:${e.result}`).join(' · ');
    reason = `BAŞLATMA DÜŞTÜ — istek hatta ÇIKMADI (${inits}). `
           + `Bu ADAPTÖR/başlatma ölçümüdür, "ECU sustu" DEĞİLDİR.`
           + (plain ? ` Başlatmasız satırlar: ${plain}.` : '');
  } else if (physical.length === 0) {
    reason = 'hiçbir fiziksel satır gönderilmedi';
  } else {
    const seen = physical.map((e) => `${e.variantId}:${e.result}`).join(' · ');
    reason = `hat CANLI ama hiçbir fiziksel varyant cevaplamadı (${seen}) — `
           + 'bu adres bu araçta fiziksel isteğe kapalı ya da başka bir kip gerekiyor';
  }

  return {
    proven,
    provenHeader: proven && best !== null ? best.header : null,
    provenVariantId: proven && best !== null ? best.variantId : null,
    response: proven && best !== null ? displayRaw(best.raw) : null,
    controlAlive,
    requiredInit,
    reason,
    attempts: mine.length,
  };
}

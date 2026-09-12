/**
 * kwpSessionProbe — KWP2000 TANI OTURUMU (servis 0x10) KONTROLLÜ KANIT PROBU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN SAHA KUSURU (2026-08-25 · gerçek araç · Protocol 5 / KWP) ──────
 * ══════════════════════════════════════════════════════════════════════════
 * ECU keşfi ÇALIŞTI ve doğru sonucu verdi:
 *     ECU 7A (KWP) · rx `86F17A` · tx `817AF1` · 8-bit · rol UNKNOWN
 * Fonksiyonel sorgular CEVAP VERDİ (Mode 03/07 → 3 OK), fiziksel `817AF1`
 * sorguları SUSTU (3 ECU SUSTU). Sonuç: adreslenebilirlik NOT_ADDRESSABLE →
 * 0x18 (üretici DTC tabanı) fail-closed olarak GÖNDERİLMEDİ.
 *
 * O KAPI DOĞRUDUR ve bu modül onu ZAYIFLATMAZ. Eksik olan şey KANITTI: KWP
 * hattında bir ECU'nun fiziksel adresine ULAŞILIP ULAŞILAMADIĞI hakkında
 * elimizde YALNIZ "Mode 03 sustu" gözlemi vardı. Oysa bazı KWP ECU'ları
 * (Renault/PSA sınıfı) TANI OTURUMU AÇILMADAN fiziksel isteklere hiç cevap
 * vermez — yani sessizlik "ECU yok" değil "oturum yok" ANLAMINA da gelebilir.
 * `ElmProtocol.openExtendedSession()` bu komutları ZATEN biliyordu (`10 81`,
 * `10 C0`) ama sonucunu bir `boolean`a düşürüp ATIYORDU ve yalnız bir NRC
 * sonrası YAN ETKİ olarak koşuyordu — hiçbir yerde KANIT olarak durmuyordu.
 * Bu yüzden `KwpDtcEvidence.sessionRequest/sessionResponse` alanları kodda
 * VARDI ama SONSUZA DEK `null` kalıyordu.
 *
 * ── BU MODÜLÜN SÖZLEŞMESİ ─────────────────────────────────────────────────
 *  1. AMAÇ YALNIZ KANIT TOPLAMAKTIR. Bu modül komut GÖNDERMEZ (native köprü
 *     gönderir), karar DEĞİŞTİRMEZ, veri yoluna DOKUNMAZ.
 *  2. İstek `10 81` (ISO 14230-4 standart tanı oturumu); pozitif kabul
 *     `50 81`. Desteklenen alternatif `10 C0` → `50 C0` (birçok Renault/PSA
 *     KWP ECU'sunun genişletilmiş oturumu). İkisi de SALT OTURUM komutudur:
 *     ECU'ya YAZMAZ, security access DEĞİLDİR.
 *  3. POZİTİF KANIT = pozitif önek HAM YANITTA GERÇEKTEN GÖRÜLDÜ. Native'in
 *     "ok" demesi TEK BAŞINA yetmez (ham yanıt boşsa `MALFORMED`) — bu
 *     projenin tekrar eden kusuru "sonuç alanına körlemesine güvenmek"tir.
 *  4. FAIL-CLOSED: sessizlik · NRC · bozuk yanıt · ölçüm yokluğu POZİTİF
 *     SAYILMAZ. Pozitif kanıt YOKSA fiziksel adreslenebilirlik AÇILMAZ ve
 *     0x18 zinciri AÇILMAZ — `UNKNOWN`/`NOT_ADDRESSABLE` KORUNUR.
 *  5. ECU ROLÜ TAHMİN EDİLMEZ. Bu modül adresten anlam çıkarmaz.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Yalnız OBD protokol verisi taşınır: adres · servis · ham hex · enum sonuç.
 * VIN · konum · MAC · kullanıcı verisi GİRMEZ.
 *
 * SAF DEĞİL (bounded ring durumu tutar) ama I/O yapmaz; `atMs` çağırandan gelir.
 */

/** Bir oturum denemesinin ÖLÇÜLMÜŞ sonucu. */
export type KwpSessionResult =
  /** Pozitif önek (`5081`/`50C0`) ham yanıtta GÖRÜLDÜ — oturum AÇILDI. */
  | 'POSITIVE'
  /** ECU ayrık negatif yanıt verdi (`7F 10 <nrc>`) — adres canlı, oturum RED. */
  | 'NEGATIVE'
  /** İstek gitti, ECU SUSTU (NO DATA / timeout). */
  | 'NO_RESPONSE'
  /** Yanıt geldi ama ne pozitif ne ayrık negatif — çözümlenemedi. */
  | 'MALFORMED'
  /** Hat/adaptör düştü — ECU hakkında BİR ŞEY SÖYLEMEZ. */
  | 'TRANSPORT_ERROR'
  /** İstek HİÇ GÖNDERİLMEDİ (köprü yok · protokol yavaş seri değil · hedef yok). */
  | 'NOT_ATTEMPTED';

export const KWP_SESSION_RESULT_LABEL: Readonly<Record<KwpSessionResult, string>> = {
  POSITIVE:        'oturum AÇILDI — pozitif yanıt ölçüldü',
  NEGATIVE:        'ECU REDDETTİ (ayrık negatif yanıt) — adres canlı, oturum yok',
  NO_RESPONSE:     'ECU SUSTU — istek gitti, yanıt yok',
  MALFORMED:       'yanıt ÇÖZÜMLENEMEDİ — pozitif önek yok',
  TRANSPORT_ERROR: 'HAT HATASI — ECU hakkında kanıt DEĞİL',
  NOT_ATTEMPTED:   'hiç denenmedi — istek GÖNDERİLMEDİ',
} as const;

/** Denenecek oturum komutları — SIRA BİLİNÇLİDİR (standart önce). */
export interface KwpSessionCommand {
  /** Ham istek hex ('1081'). */
  readonly request: string;
  /** Pozitif yanıt öneki ('5081') — ham yanıtta ARANIR. */
  readonly positive: string;
  /** TR açıklama — LAB'da kararın NEDENİ görünür. */
  readonly label: string;
}

export const KWP_SESSION_COMMANDS: readonly KwpSessionCommand[] = Object.freeze([
  Object.freeze({ request: '1081', positive: '5081', label: 'ISO 14230-4 standart tanı oturumu' }),
  Object.freeze({ request: '10C0', positive: '50C0', label: 'üretici genişletilmiş oturum (Renault/PSA sınıfı)' }),
]);

/** Native köprünün taşıdığı ham ölçüm (karar VERİLMEZ, yalnız taşınır). */
export interface KwpSessionProbeRaw {
  /** Gönderilen istek ('1081'/'10C0'); gönderilmediyse null. */
  readonly request: string | null;
  /** Ham yanıt (boşluklu olabilir); köprü taşımıyorsa null — boş string YAZILMAZ. */
  readonly raw: string | null;
  /** Native'in ölçtüğü sonuç sınıfı; taşımıyorsa null. */
  readonly outcome: string | null;
  /** Ayrık negatif yanıt NRC baytı; yoksa null. */
  readonly nrc: number | null;
}

/**
 * ASCII katlama — tr-TR yerelinde `toUpperCase()` "i"yi "İ" yapar ve enum
 * eşleşmesi SESSİZCE düşer (bkz. proje kütüğü: fail-open eşleşme). Bu yüzden
 * sınıflandırma `toUpperCase` KULLANMAZ.
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
 * P0-OBD-DIAG-03 — METİN DURUMU HEX'E ZORLANMAZ.
 *
 * ÖLÇÜLEN KUSUR (saha 2026-08-26): LAB'da `oturum yanıtı DAA` göründü. Kaynak
 * `compactHex("NO DATA")`ydı — "NO DATA" içindeki `D`, `A`, `A` GEÇERLİ HEX
 * karakterleridir, dolayısıyla adaptörün "veri yok" demesi ekranda **uydurma
 * bir ECU yanıtına** dönüşüyordu. Bu, ölçülmemiş bir değeri ölçülmüş gibi
 * göstermektir ve bu deponun en sert kuralının ihlalidir.
 */
export function displayRaw(v: string | null | undefined): string | null {
  const src = (v ?? '').trim();
  if (src === '') return null;
  const letters = src.replace(/[^A-Za-z]/g, '').toUpperCase();
  for (const k of ['NODATA', 'STOPPED', 'ERROR', 'UNABLETOCONNECT', 'BUSINIT',
    'BUSBUSY', 'CANERROR', 'BUFFERFULL', 'SEARCHING']) {
    if (letters.includes(k)) return src.replace(/\s+/g, ' ').slice(0, 40);
  }
  const hex = compactHex(src);
  return hex === '' ? null : hex;
}

/**
 * Bir oturum denemesini SINIFLANDIRIR (SAF).
 *
 * KURAL SIRASI (fail-closed):
 *  1. Ham yanıtta pozitif önek VARSA → POSITIVE. (En güçlü kanıt; native'in
 *     sonuç alanı bunu EZEMEZ.)
 *  2. Ham yanıtta `7F10` VARSA → NEGATIVE (+NRC).
 *  3. Native sonucu sessizlik/timeout diyorsa → NO_RESPONSE.
 *  4. Native sonucu hat hatası diyorsa → TRANSPORT_ERROR.
 *  5. Hiç istek gönderilmediyse → NOT_ATTEMPTED.
 *  6. Kalan her şey → MALFORMED. "ok" dendi ama pozitif önek YOKSA da BURAYA
 *     düşer: ölçülmemiş bir başarıyı başarı saymak bu projenin tekrar eden
 *     kusurudur.
 */
export function classifyKwpSessionResponse(
  command: KwpSessionCommand, raw: KwpSessionProbeRaw,
): { result: KwpSessionResult; nrc: number | null } {
  if (raw.request === null || fold(raw.outcome ?? '') === 'NOT_ATTEMPTED') {
    return { result: 'NOT_ATTEMPTED', nrc: null };
  }

  const hex = compactHex(raw.raw);
  if (hex.includes(command.positive)) return { result: 'POSITIVE', nrc: null };

  const negIdx = hex.indexOf('7F10');
  if (negIdx >= 0) {
    const byte = hex.slice(negIdx + 4, negIdx + 6);
    const parsed = byte.length === 2 ? Number.parseInt(byte, 16) : Number.NaN;
    return { result: 'NEGATIVE', nrc: Number.isFinite(parsed) ? parsed : (raw.nrc ?? null) };
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
    case 'NEGATIVE_NRC':
      /* Native NRC bildirdi ama ham yanıt taşınmadı — kanıt yine de AYRIKTIR. */
      return { result: 'NEGATIVE', nrc: raw.nrc ?? null };
    default:
      return { result: 'MALFORMED', nrc: null };
  }
}

/* ── Kanıt defteri ────────────────────────────────────────────────────────── */

export interface KwpSessionProbeEntry {
  readonly atMs: number;
  readonly sessionEpoch: number;
  /** Fiziksel istek adresi (tx) — hangi ECU'ya sorulduğu. */
  readonly tx: string;
  readonly rx: string;
  /** Ölçüm anındaki aktif protokol (ATDPN); okunamadıysa null. */
  readonly protocol: string | null;
  readonly request: string | null;
  readonly positiveNeedle: string;
  readonly raw: string | null;
  readonly result: KwpSessionResult;
  readonly nrc: number | null;
  /** Native'in ham sonuç alanı (kanıt zinciri kopmasın diye SAKLANIR). */
  readonly nativeOutcome: string | null;
  readonly error: string | null;
}

/** Defter tavanı — ECU başına 2 komut × 8 ECU; sınırsız kayıt cihazda bellek sorunudur. */
export const KWP_SESSION_PROBE_RING = 16;

let _ring: KwpSessionProbeEntry[] = [];

/**
 * Gözlem yazar. ASLA throw etmez — defter ürünü düşüremez.
 * Oturum mührü kendini temizler (`ecuAddressability` ile AYNI kural).
 */
export function recordKwpSessionProbe(e: KwpSessionProbeEntry): void {
  try {
    const last = _ring[_ring.length - 1];
    if (last !== undefined && last.sessionEpoch !== e.sessionEpoch) _ring = [];
    const frozen = Object.freeze({ ...e });
    _ring = _ring.length >= KWP_SESSION_PROBE_RING
      ? [..._ring.slice(1), frozen]
      : [..._ring, frozen];
  } catch { /* kanıt kaydı ürünü DÜŞÜRMEZ */ }
}

/** Salt-okunur okuma — kopya döner (çağıran defteri bozamaz). */
export function getKwpSessionProbes(): readonly KwpSessionProbeEntry[] {
  return _ring.slice();
}

/** @internal — testler arası izolasyon. */
export function _resetKwpSessionProbesForTest(): void { _ring = []; }

/** Bir ECU'nun oturum kanıtının ÖZETİ (tek karar noktası). */
export interface KwpSessionVerdict {
  /**
   * `true` YALNIZ pozitif yanıt ÖLÇÜLDÜYSE. Bu, fiziksel adreslenebilirliği
   * ve 0x18 zincirini açmaya YETKİLİ TEK kanıttır.
   */
  readonly proven: boolean;
  /** Kanıtı üreten istek ('1081'/'10C0'); yoksa null. */
  readonly request: string | null;
  /** Kanıtı üreten ham yanıt; yoksa null. */
  readonly response: string | null;
  /** En güçlü ölçülen sonuç (POSITIVE > NEGATIVE > MALFORMED > NO_RESPONSE > …). */
  readonly result: KwpSessionResult;
  /** TR gerekçe — LAB'da kararın NEDENİ görünür. */
  readonly reason: string;
  /** Bu ECU için yapılan deneme sayısı. */
  readonly attempts: number;
}

/** Sonuç gücü sırası — POZİTİF her zaman kazanır, sessizlik onu EZEMEZ. */
const _RESULT_RANK: Readonly<Record<KwpSessionResult, number>> = {
  POSITIVE: 5, NEGATIVE: 4, MALFORMED: 3, NO_RESPONSE: 2,
  TRANSPORT_ERROR: 1, NOT_ATTEMPTED: 0,
} as const;

/**
 * Bir ECU'nun (tx) BU OTURUMDAKİ oturum kanıtını özetler (SAF).
 * Kayıt yoksa `NOT_ATTEMPTED` — "denendi ve olmadı" ile "hiç sorulmadı" AYRI.
 */
export function summarizeKwpSession(
  entries: readonly KwpSessionProbeEntry[], tx: string, sessionEpoch: number,
): KwpSessionVerdict {
  const target = compactHex(tx);
  const mine = entries.filter((e) =>
    e.sessionEpoch === sessionEpoch && compactHex(e.tx) === target);

  if (mine.length === 0) {
    return {
      proven: false, request: null, response: null, result: 'NOT_ATTEMPTED',
      reason: 'oturum probu bu ECU için hiç koşmadı', attempts: 0,
    };
  }

  let best = mine[0]!;
  for (const e of mine) {
    if (_RESULT_RANK[e.result] > _RESULT_RANK[best.result]) best = e;
  }

  const proven = best.result === 'POSITIVE';
  const nrcText = best.nrc !== null
    ? ` · NRC 0x${best.nrc.toString(16).toUpperCase().padStart(2, '0')}`
    : '';
  const reason = proven
    ? `${best.request} → ${displayRaw(best.raw) ?? 'YANIT'} (${best.positiveNeedle} ölçüldü)`
    : `${KWP_SESSION_RESULT_LABEL[best.result]}${nrcText}`;

  return {
    proven,
    request: best.request,
    /* P0-OBD-DIAG-03: metin durumu hex'e ZORLANMAZ (bkz. `displayRaw`). */
    response: displayRaw(best.raw),
    result: best.result,
    reason,
    attempts: mine.length,
  };
}

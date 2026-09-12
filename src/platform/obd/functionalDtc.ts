/**
 * functionalDtc — P0-VDK-F2C1 · FONKSİYONEL DTC KANONİK ÇÖZÜMLEYİCİSİ (Mode 03/07/0A).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (F2-B'de ÖLÇÜLEN tek açık borç) ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Mode 03/07/0A kodlarını bugüne kadar YALNIZ native çözüyordu
 * (`ElmProtocol.parseDtcResponse`, Java). TS'e HAZIR bir `codes[]` listesi
 * geliyordu. Bunun iki ölçülmüş bedeli vardı:
 *
 *  · **Replay bu yolda kod ÜRETEMİYORDU.** F2-B sanal taşıması ham gövdeyi
 *    teslim edebiliyor ama onu çözecek bir ürün katmanı YOKTU → fail-closed
 *    `PARSER_GAP`. Yani sahadan gelen bir Mode 03 izi masada çalıştırılamıyordu.
 *  · **Anlam otoritesi ikiye bölünmüştü.** Üretici kodları TS'te
 *    (`udsDtc`/`kwpDtc`), fonksiyonel kodlar Java'da çözülüyordu; ikisinin
 *    aynı kuralı uyguladığı HİÇBİR yerde kanıtlanamıyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ SEMANTİK SÖZLÜĞÜ DEĞİLDİR.** Sonuç sınıfı MEVCUT
 *     `dtcOutcomeSemantics.DtcReadSemanticOutcome` sözlüğüdür ve sınıflandırma
 *     MEVCUT `classifyDtcReadResponse` ile yapılır. Burada tek bir sınıf bile
 *     yeniden tanımlanmaz.
 * (2) **İKİNCİ GÖVDE AYIRICISI DEĞİLDİR.** ISO-TP birleştirme · çok-ECU ayrımı
 *     · hiza düzeltmesi MEVCUT `splitDtcBodies`tedir.
 * (3) **`dtcAuthority` YERİNE GEÇMEZ.** Dedupe · gözlem kimliği · kapsam hükmü
 *     otoritenindir; bu modül yalnız BAYT → KAYIT çözümüdür.
 * (4) **HÜKÜM VERMEZ.** Açıklama · önem derecesi · "aktif mi" tahmini ·
 *     verdict ÜRETMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NATIVE İLE PARİTE: YORUMLANARAK DEĞİL, EŞLEŞTİRİLEREK ─────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu çözümleyici native davranışın "yeniden yorumu" DEĞİLDİR. Kurallar
 * `ElmProtocol.dtcPayloadAfterSid` / `parseDtcResponse` / `decodeDtcPair`
 * kaynağından BİREBİR alınmıştır ve JVM kilitlerinin (`DtcClassParserTest`)
 * fixture'ları TS tarafında AYNEN koşulur (`functionalDtcParser.test.ts`).
 * Native'in ödediği kusurlar burada da kapalıdır:
 *
 *  · sayaç baytı **parite ile TAHMİN EDİLMEZ**, doğrulanır (aksi hâlde dolgulu
 *    `47 01 00 89 00 00 00` yanıtı `P0100` + `B0900` UYDURUYORDU),
 *  · SID **yalnız çift hizada** aranır (hizasız eşleşme tüm gövdeyi kaydırır),
 *  · sayaç n kod diyor ama gövdede yoksa → **KISMİ**, sessizce kısa liste
 *    dönmez ("daha az arıza var" demek olurdu).
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · O(n).
 */

import {
  classifyDtcReadResponse, splitDtcBodies,
  type DtcReadSemanticOutcome,
} from './dtcOutcomeSemantics';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

export type FunctionalDtcMode = '03' | '07' | '0A';

/** SAE J1979: pozitif yanıt SID = istek modu + 0x40. */
export const FUNCTIONAL_POSITIVE_SID: Readonly<Record<FunctionalDtcMode, string>> = {
  '03': '43', '07': '47', '0A': '4A',
} as const;

/**
 * Çözümün NEDEN eksik/bozuk olduğunun ölçülmüş sebebi.
 * `null` = bozukluk YOK (sonuç eksiksiz).
 */
export type FunctionalMalformedReason =
  /** Sayaç n kod diyor, gövdede o kadar kod YOK — yanıt yarıda kesilmiş. */
  | 'PARTIAL_COUNT'
  /** Gövdede beklenen pozitif SID hiç bulunamadı. */
  | 'MISSING_POSITIVE_SID'
  /** Gövde tek hane fazlası taşıyor — bayt hizası tutmuyor. */
  | 'ODD_BODY_LENGTH'
  /** Kayıt yuvasına tam oturmayan artık bayt kaldı. */
  | 'LEFTOVER_BYTES'
  /** Ham metin hex olarak çözülemedi. */
  | 'NON_HEX_BODY'
  /**
   * Ham yanıt TAŞIMA katmanında KIRPILMIŞ — çözüm EKSİK olabilir.
   * Bu bir çözümleyici kusuru DEĞİL, girdinin eksikliğidir ve sonucun
   * ürün otoritesi olmasını ENGELLER (bkz. `functionalDtcSource`).
   */
  | 'TRUNCATED_INPUT';

export const FUNCTIONAL_MALFORMED_LABEL: Readonly<Record<FunctionalMalformedReason, string>> = {
  PARTIAL_COUNT:        'sayaç kadar kod YOK — yanıt yarıda kesilmiş',
  MISSING_POSITIVE_SID: 'beklenen pozitif SID gövdede yok',
  ODD_BODY_LENGTH:      'bayt hizası tutmuyor (tek hane fazla)',
  LEFTOVER_BYTES:       'kayıt yuvasına oturmayan artık bayt',
  NON_HEX_BODY:         'ham yanıt hex olarak çözülemedi',
  TRUNCATED_INPUT:      'ham yanıt KIRPILMIŞ — çözüm eksik olabilir',
} as const;

/** Çözülmüş TEK kayıt. Açıklama · önem · "aktif mi" BURADA ÜRETİLMEZ. */
export interface FunctionalDtcRecord {
  /** SAE J2012 künyesi — `P0301` · `C1234` · `B0900` · `U0100`. */
  readonly code: string;
  /** Kaydın HAM iki baytı (4 hex hane) — kanıt kaybolmaz. */
  readonly rawBytes: string;
  readonly sourceMode: FunctionalDtcMode;
  /** Tüm yanıt içindeki sıra (0'dan). Sıra ÜRÜN ÇIKTISINDA da korunur. */
  readonly recordIndex: number;
  /** Kaydın geldiği gövde (çok-ECU'da hangi satır). */
  readonly bodyIndex: number;
  /**
   * Kaydı gönderen ECU kimliği — ÖLÇÜLDÜYSE (ATH1). `null` = ölçülmedi.
   * ⚠️ ASLA türetilmez: tek ECU varsayımı YAPILMAZ.
   */
  readonly ecuHeader: string | null;
}

export interface FunctionalDtcParseInput {
  readonly mode: FunctionalDtcMode;
  /** HAM ELM327 metni (boşluk/satır/kimlik dâhil) ya da `null`. */
  readonly rawResponse: string | null;
  /**
   * Taşıma katmanının ham yanıtı KIRPTIĞI biliniyorsa `true`.
   * Bilinmiyorsa `undefined` — çağıran muhafazakâr davranır (fail-closed).
   */
  readonly truncated?: boolean;
}

export interface FunctionalDtcParseResult {
  readonly mode: FunctionalDtcMode;
  /** MEVCUT sözlük — bu dosya yeni sınıf TANIMLAMAZ. */
  readonly outcome: DtcReadSemanticOutcome;
  /** Beklenen pozitif SID (43/47/4A). */
  readonly positiveSid: string;
  /** Boşluk/kimlik temizlenmiş, karşılaştırılabilir gövde. */
  readonly normalizedRaw: string;
  readonly records: readonly FunctionalDtcRecord[];
  /** Atlanan `0000` dolgu yuvası adedi — ÖLÇÜM, kayıp değil. */
  readonly paddingRecords: number;
  /** Kayıt yuvasına oturmayan artık hane adedi. */
  readonly leftoverBytes: number;
  /** Çözülen toplam bayt (kayıt yuvalarına giren). */
  readonly bytesConsumed: number;
  readonly malformedReason: FunctionalMalformedReason | null;
  /** Çok-ECU yanıtta kodların sahibi ölçülebildi mi. */
  readonly ecuAttribution: 'MEASURED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  /** Kaç ayrı gövde (satır/segment) işlendi. */
  readonly bodyCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) BAYT → KOD (SAE J2012 / ISO 15031-6)
   ══════════════════════════════════════════════════════════════════════════ */

const DTC_FAMILY = 'PCBU';

/**
 * İki baytlık (4 hex hane) DTC çiftini künyeye çevirir.
 *
 * Bit düzeni (ISO 15031-6):
 *   bit 15-14 → aile:  00=P · 01=C · 10=B · 11=U
 *   bit 13-12 → ilk rakam (0-3, ONDALIK)
 *   bit 11-8  → ikinci rakam (0-F, ONALTILIK)
 *   bit 7-0   → son iki hane (ham, ONALTILIK)
 *
 * Native `decodeDtcPair` ile BİREBİR aynı (`%c%d%X%s`).
 */
export function decodeDtcPair(pairHex: string): string {
  const b1 = parseInt(pairHex.slice(0, 2), 16);
  const letter = DTC_FAMILY.charAt((b1 >> 6) & 0x03);
  const d1 = (b1 >> 4) & 0x03;
  const d2 = (b1 & 0x0f).toString(16).toUpperCase();
  return `${letter}${d1}${d2}${pairHex.slice(2).toUpperCase()}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SID / SAYAÇ SOYMA
   ══════════════════════════════════════════════════════════════════════════ */

interface PayloadResult {
  readonly payload: string | null;
  readonly reason: FunctionalMalformedReason | null;
}

/**
 * Gövdeden SID'i ve (varsa) SAYAÇ baytını soyar.
 *
 * ⚠️ Bu fonksiyonun her satırı native `dtcPayloadAfterSid`ten gelir ve
 * oradaki ölçülmüş kusurların KAPALI hâlidir. Değiştirilmesi gerekiyorsa
 * JVM kilitleri ve TS kilitleri BİRLİKTE güncellenmelidir — aksi hâlde iki
 * çözümleyici sessizce ayrışır ve bu fazın kapattığı borç geri gelir.
 */
function payloadAfterSid(hex: string, positiveSid: string): PayloadResult {
  if (hex.length === 0) return { payload: null, reason: 'MISSING_POSITIVE_SID' };

  /* SID YALNIZ ÇİFT hizada aranır. Hizasız bir "47" (önceki baytın alt yarısı
     + sonrakinin üst yarısı) gövdeyi yarım bayt kaydırır ve TÜM kodları
     sessizce bozardı — ölçülmüş kusur sınıfı. */
  let idx = -1;
  for (let i = 0; i + positiveSid.length <= hex.length; i += 2) {
    if (hex.startsWith(positiveSid, i)) { idx = i; break; }
  }
  if (idx < 0) return { payload: null, reason: 'MISSING_POSITIVE_SID' };

  let body = hex.slice(idx + positiveSid.length);
  let oddTrim = false;
  if (body.length % 2 === 1) { body = body.slice(0, -1); oddTrim = true; }
  const bytes = body.length / 2;
  if (bytes === 0) return { payload: '', reason: oddTrim ? 'ODD_BODY_LENGTH' : null };

  const oddBody = bytes % 2 === 1;          // 1 + 2n → yapısal olarak sayaçlı
  const n = parseInt(body.slice(0, 2), 16);

  if (oddBody) {
    /* Sayaç yorumu ZORUNLU. n kod sığmıyorsa yanıt KISMİDİR ve eksik listeyi
       sessizce döndürmek "daha az arıza var" demektir → fail-closed. */
    if (n > 0 && 1 + 2 * n > bytes) return { payload: null, reason: 'PARTIAL_COUNT' };
    return {
      payload: n > 0 ? body.slice(2, 2 + 4 * n) : body.slice(2),
      reason: oddTrim ? 'ODD_BODY_LENGTH' : null,
    };
  }

  /* Çift gövde: DOLGULU CAN mı, K-line mi? Sayaç yorumu TAHMİN EDİLMEZ,
     DOĞRULANIR — dört koşulun tamamı sağlanmalıdır. */
  if (n >= 1 && 1 + 2 * n <= bytes) {
    const candidate = body.slice(2, 2 + 4 * n);
    const leftover = body.slice(2 + 4 * n);
    let pairsOk = true;
    for (let i = 0; i + 4 <= candidate.length; i += 4) {
      if (candidate.startsWith('0000', i)) { pairsOk = false; break; }
    }
    const leftoverIsPadding = /^0*$/.test(leftover);
    /* Dolgulu TEK çerçeve (SID dâhil 7-8 bayt) ya da tek K-line çerçevesine
       (3 yuva = 6 bayt) sığmayan BİRLEŞTİRİLMİŞ gövde. */
    const shapeOk = bytes + 1 === 7 || bytes + 1 === 8 || bytes > 6;
    if (pairsOk && leftoverIsPadding && shapeOk) {
      return { payload: candidate, reason: oddTrim ? 'ODD_BODY_LENGTH' : null };
    }
  }

  /* K-line: sayaç yok, tüm çiftler kod yuvasıdır ("0000" dolgu atlanır). */
  return { payload: body, reason: oddTrim ? 'ODD_BODY_LENGTH' : null };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KANONİK ÇÖZÜM
   ══════════════════════════════════════════════════════════════════════════ */

function emptyResult(
  mode: FunctionalDtcMode, outcome: DtcReadSemanticOutcome,
  normalizedRaw: string, reason: FunctionalMalformedReason | null,
): FunctionalDtcParseResult {
  return {
    mode, outcome, positiveSid: FUNCTIONAL_POSITIVE_SID[mode], normalizedRaw,
    records: [], paddingRecords: 0, leftoverBytes: 0, bytesConsumed: 0,
    malformedReason: reason, ecuAttribution: 'NOT_APPLICABLE', bodyCount: 0,
  };
}

/**
 * Fonksiyonel DTC yanıtını çözer — **kod UYDURMAZ, sessizce kod DÜŞÜRMEZ**.
 *
 * Sonuç sınıfı MEVCUT `classifyDtcReadResponse` otoritesinden gelir; bu
 * fonksiyon yalnız kod sayısını ona bildirir. Böylece "NO DATA ≠ kod yok" ·
 * "7F = desteklenmiyor" · "43 00 = gerçekten temiz" ayrımları TEK yerde kalır.
 */
export function parseFunctionalDtcResponse(
  input: FunctionalDtcParseInput,
): FunctionalDtcParseResult {
  const { mode, rawResponse } = input;
  const positiveSid = FUNCTIONAL_POSITIVE_SID[mode];
  const raw = rawResponse ?? '';
  const normalizedRaw = raw.replace(/\s+/g, '').toUpperCase();

  /* Ölçüm yokluğu ile bulgu yokluğu ASLA karışmaz — sınıfı mevcut otorite verir. */
  if (normalizedRaw.length === 0) {
    return emptyResult(mode, classifyDtcReadResponse(mode, rawResponse, 0), '', null);
  }

  const bodies = splitDtcBodies(raw);

  /* Taşıma sınıfı (NO DATA · 7F · BUS ERROR · "?") POZİTİF çözümü GEÇERSİZ
     kılar: o yanıtlarda kod yuvası YOKTUR ve aramak sahte kod üretme riskidir. */
  const preOutcome = classifyDtcReadResponse(mode, rawResponse, 0);
  if (preOutcome !== 'POSITIVE_EMPTY' && preOutcome !== 'POSITIVE_WITH_CODES'
    && preOutcome !== 'PARTIAL_TIMEOUT' && preOutcome !== 'MALFORMED') {
    return { ...emptyResult(mode, preOutcome, normalizedRaw, null), bodyCount: bodies.length };
  }

  const records: FunctionalDtcRecord[] = [];
  const seen = new Set<string>();
  let padding = 0;
  let leftover = 0;
  let consumed = 0;
  let reason: FunctionalMalformedReason | null = null;
  let sidFound = false;
  let headerSeen = false;

  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b]!;
    if (body.header !== null) headerSeen = true;
    if (!/^[0-9A-F]*$/.test(body.hex)) { reason ??= 'NON_HEX_BODY'; continue; }

    const { payload, reason: r } = payloadAfterSid(body.hex, positiveSid);
    if (r !== null && r !== 'MISSING_POSITIVE_SID') reason ??= r;
    if (payload === null) continue;
    sidFound = true;

    let i = 0;
    for (; i + 4 <= payload.length; i += 4) {
      const pair = payload.slice(i, i + 4);
      /* `0000` GERÇEK bir DTC değildir (K-line sıfır dolgusu) — ama sayılır,
         çünkü "kaç yuva boştu" ileride kapsam sorusunun parçasıdır. */
      if (pair === '0000') { padding++; consumed += 2; continue; }
      /* "Kod yok" yanıtının artığı (`43 00`/`47 00`/`4A 00`) hizalama kayması
         sonucu yuvaya düşerse sahte `C0300`/`C0700`/`C0A00` üretiyordu. */
      if (pair === positiveSid + '00') { padding++; consumed += 2; continue; }

      const code = decodeDtcPair(pair);
      consumed += 2;
      /* Dedupe: birebir aynı kayıt (çok-çerçeveli yanıt tekrarı) tek satıra
         iner — native `LinkedHashSet` davranışıyla AYNI, sıra korunur. */
      if (seen.has(code)) continue;
      seen.add(code);
      records.push({
        code, rawBytes: pair, sourceMode: mode,
        recordIndex: records.length, bodyIndex: b, ecuHeader: body.header,
      });
    }
    /* Yuvaya oturmayan artık: SESSİZCE ATILMAZ. */
    const rest = payload.length - i;
    if (rest > 0) { leftover += rest; reason ??= 'LEFTOVER_BYTES'; }
  }

  if (!sidFound) reason ??= 'MISSING_POSITIVE_SID';
  /* Girdi kırpılmışsa çözüm EKSİK olabilir — bu bilgi kaybolamaz. */
  if (input.truncated === true) reason = 'TRUNCATED_INPUT';

  /* Hüküm MEVCUT otoriteden: kod sayısı verilir, sınıf ORADA belirlenir. */
  let outcome = classifyDtcReadResponse(mode, rawResponse, records.length);
  if (reason === 'PARTIAL_COUNT') outcome = 'PARTIAL_TIMEOUT';
  else if (records.length === 0 && !sidFound) outcome = 'MALFORMED';

  return {
    mode, outcome, positiveSid, normalizedRaw,
    records, paddingRecords: padding, leftoverBytes: leftover,
    bytesConsumed: consumed, malformedReason: reason,
    /* Tek gövde varsa atıf sorusu DOĞMAZ; birden çok gövdede kimlik
       ölçülmediyse UYDURULMAZ. */
    ecuAttribution: bodies.length <= 1 ? 'NOT_APPLICABLE'
      : headerSeen ? 'MEASURED' : 'UNKNOWN',
    bodyCount: bodies.length,
  };
}

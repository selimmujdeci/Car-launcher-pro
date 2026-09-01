/**
 * goldenFunctional — P0-VDK-F2C1 · FONKSİYONEL DTC GOLDEN KORPUSU (Mode 03/07/0A).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI KORPUS ─────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `goldenClio` üretici (UDS 0x19) zincirini kilitler ve DEĞİŞTİRİLMEDİ.
 * Bu korpus onun yanında FONKSİYONEL (7DF · Mode 03/07/0A) zinciri kilitler:
 * ham gövde → kanonik TS çözümleyicisi → otorite → ürün sonucu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── HAM BAYTLAR AÇIK YAZILIR (yardımcıyla ÜRETİLMEZ) ──────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Fixture'ı bir kodlayıcı fonksiyonla üretmek, çözümleyiciyi KENDİ tersiyle
 * test etmek olurdu: ikisi birlikte yanlışsa test yeşil kalır. Bu yüzden
 * baytlar LİTERAL yazılır ve beklenen kodlar SAE J2012 kuralıyla EL İLE
 * doğrulanmıştır (aşağıdaki çözüm notları).
 *
 * ── ÖLÇÜLEN DÜZELTME ──────────────────────────────────────────────────────
 * Görev tanımındaki A ve C örnekleri (`430301000000` · `4A0301000000`) beş
 * baytlık gövde taşır: sayaç `03` üç kayıt vaat eder ama gövdede iki kayıt
 * yeri vardır → çözümleyici (doğru şekilde) `PARTIAL_COUNT` üretir, kod
 * ÜRETMEZ. Yani o baytlarla yazılan bir kilit, çözümleyiciyi yanlış
 * davranışa sabitlerdi. Gövdeler ALTI bayta tamamlandı (K-line sıfır dolgusu);
 * B örneği zaten doğruydu ve AYNEN korundu.
 */

export interface GoldenFunctionalTrace {
  readonly name: string;
  readonly mode: '03' | '07' | '0A';
  /** Hatta gönderilen istek. */
  readonly request: string;
  /** ECU'nun ÖLÇÜLMÜŞ ham yanıtı (ELM327 biçimi). */
  readonly rawResponse: string;
  /** Bu gövdeden çözülmesi GEREKEN kodlar — sıra ÖNEMLİ. */
  readonly expectedCodes: readonly string[];
  /** Çözümün elle doğrulanmış gerekçesi. */
  readonly note: string;
}

/**
 * TRACE A — Mode 03 (onaylı/stored), tek kod.
 *
 * `43 03 01 00 00 00 00` → SID `43`, gövde `03 01 00 00 00 00` (6 bayt, ÇİFT).
 * Sayaç yorumu DOĞRULANMAZ (`n=0x03` üç kayıt ister, 1+2·3=7 > 6) → K-line
 * yorumu: çiftler `0301` · `0000` · `0000`.
 * `0301` → bit15-14 = 00 (P) · bit13-12 = 0 · bit11-8 = 3 · alt bayt `01` → **P0301**.
 */
export const GOLDEN_FUNCTIONAL_A: GoldenFunctionalTrace = {
  name: 'TRACE A · Mode 03 · tek kod',
  mode: '03',
  request: '03',
  rawResponse: '43 03 01 00 00 00 00',
  expectedCodes: ['P0301'],
  note: 'K-line sıfır dolgulu; sayaç yorumu doğrulanmaz → tüm çiftler yuva.',
};

/**
 * TRACE B — Mode 07 (bekleyen/pending), iki kod.
 *
 * `47 03 80 04 20 00 00` → gövde `03 80 04 20 00 00` (6 bayt, ÇİFT).
 * Sayaç yorumu DOĞRULANMAZ (1+2·3=7 > 6) → K-line: `0380` · `0420` · `0000`.
 * `0380` → P0380 (kızdırma bujisi devresi) · `0420` → P0420 (katalizör verimi).
 */
export const GOLDEN_FUNCTIONAL_B: GoldenFunctionalTrace = {
  name: 'TRACE B · Mode 07 · iki kod',
  mode: '07',
  request: '07',
  rawResponse: '47 03 80 04 20 00 00',
  expectedCodes: ['P0380', 'P0420'],
  note: 'Görev tanımındaki örnek AYNEN korundu — bayt dizisi zaten tutarlıydı.',
};

/**
 * TRACE C — Mode 0A (kalıcı/permanent), tek kod.
 *
 * `4A 03 01 00 00 00 00` → gövde `03 01 00 00 00 00` (6 bayt) → **P0301**.
 * A ile AYNI kod, FARKLI sınıf: kalıcı kod silinemez ve ürün bunu ayrı
 * gözlem olarak taşımalıdır.
 */
export const GOLDEN_FUNCTIONAL_C: GoldenFunctionalTrace = {
  name: 'TRACE C · Mode 0A · kalıcı kod',
  mode: '0A',
  request: '0A',
  rawResponse: '4A 03 01 00 00 00 00',
  expectedCodes: ['P0301'],
  note: 'A ile aynı kod, AYRI sınıf (kalıcı) — sınıf karışmamalı.',
};

/** Dört ailenin TEK yanıtta ayrıştığı CAN sayaçlı gövde. */
export const GOLDEN_FUNCTIONAL_FAMILIES: GoldenFunctionalTrace = {
  name: 'TRACE D · Mode 03 · P/C/B/U aileleri',
  mode: '03',
  request: '03',
  rawResponse: '43 04 03 01 41 23 81 23 C1 00',
  expectedCodes: ['P0301', 'C0123', 'B0123', 'U0100'],
  note: 'CAN sayaçlı (n=4): 0301→P0301 · 4123→C0123 · 8123→B0123 · C100→U0100.',
};

/** Çok-ECU fonksiyonel yanıt — atıf ÖLÇÜLEBİLİR (ATH1 kimlikleri var). */
export const GOLDEN_FUNCTIONAL_MULTI_ECU: GoldenFunctionalTrace = {
  name: 'TRACE E · Mode 03 · çok-ECU',
  mode: '03',
  request: '03',
  rawResponse: '7E8 43 01 71 00 00\n7E9 43 01 20 00 00',
  expectedCodes: ['P0171', 'P0120'],
  note: 'İki ayrı ECU satırı; kodların sahibi 7E8/7E9 olarak ÖLÇÜLÜR.',
};

/** Gerçekten temiz ECU — pozitif yanıt, sıfır kod. "Ölçüm yok" DEĞİL. */
export const GOLDEN_FUNCTIONAL_EMPTY: GoldenFunctionalTrace = {
  name: 'TRACE F · Mode 03 · pozitif boş',
  mode: '03',
  request: '03',
  rawResponse: '43 00 00 00 00 00 00',
  expectedCodes: [],
  note: 'POSITIVE_EMPTY — servis çalıştı, bulgu yok. NO DATA ile KARIŞTIRILAMAZ.',
};

export const GOLDEN_FUNCTIONAL_CORPUS: readonly GoldenFunctionalTrace[] = [
  GOLDEN_FUNCTIONAL_A,
  GOLDEN_FUNCTIONAL_B,
  GOLDEN_FUNCTIONAL_C,
  GOLDEN_FUNCTIONAL_FAMILIES,
  GOLDEN_FUNCTIONAL_MULTI_ECU,
  GOLDEN_FUNCTIONAL_EMPTY,
];

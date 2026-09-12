/**
 * goldenClio — SAHA REFERANS KORPUSU (Renault Clio · tek ELM327).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN AYRI DOSYA
 * ══════════════════════════════════════════════════════════════════════════
 * Bu liste ürünün ÖLÇÜLMÜŞ saha kusurunun kanıtıdır: aynı araçta Car Scanner
 * YİRMİ kayıt gösterirken CarOS kullanıcıya HİÇBİR üretici kodu göstermiyordu
 * (bkz. `dtcFieldParity.test.ts` başlığı — dedupe · parser · UI zincirinde üç
 * ayrı kayıp).
 *
 * Korpus `dtcFieldParity.test.ts` içine gömülüydü ve bu yüzden BAŞKA hiçbir
 * kilit ondan yararlanamıyordu. P0-VDK-F2B replay paritesi TAM OLARAK bu
 * listeyi uçtan uca doğrulamak zorunda olduğundan korpus buraya alındı —
 * **içerik DEĞİŞMEDİ**, yalnız paylaşılabilir hâle geldi.
 *
 * ⚠️ Bu bir parser fixture'ı DEĞİLDİR. Doğru kullanım, gövdeyi HAM YANIT
 * olarak taşımaya sokup ürünün normal zincirini (transport → parser →
 * authority → verdict) çalıştırmaktır. Parser'a doğrudan veri vermek, tam da
 * bu kusurun kaçtığı deliktir.
 */

/** Parantez içi = FTB (failure type byte, ISO 14229-1 D.2 / SAE J2012-DA). */
export const GOLDEN_CLIO: ReadonlyArray<readonly [code: string, ftb: string]> = [
  ['P0833', '29'], ['P1525', 'F3'], ['P0488', '77'], ['P0380', '11'],
  ['P0380', '12'], ['P0380', '13'], ['P0380', '96'], ['P2002', '94'],
  ['P0190', '24'], ['P047B', '92'], ['P047B', '29'], ['P0544', '16'],
  ['P2263', '21'], ['P2263', '22'], ['P0638', '77'], ['P0101', '22'],
  ['P0627', '11'], ['P0627', '13'], ['P0645', '12'], ['P0002', '91'],
];

/** SAE J2012 kodunu 2 baytlık ham DTC'ye geri çevirir (çözücünün TERSİ). */
export function encodeDtcBytes(code: string): string {
  const letter = ['P', 'C', 'B', 'U'].indexOf(code[0]!);
  const d1 = parseInt(code[1]!, 16);
  const d2 = parseInt(code[2]!, 16);
  const b0 = (letter << 6) | (d1 << 4) | d2;
  const b1 = parseInt(code.slice(3, 5), 16);
  return b0.toString(16).toUpperCase().padStart(2, '0')
    + b1.toString(16).toUpperCase().padStart(2, '0');
}

/* Durumlar bilinçli olarak KARIŞIK: aktif · onaylı-pasif · arşiv · test yok.
   Hepsi ECU'nun GERÇEK kaydıdır; hiçbiri filtrelenip yok edilmemelidir. */
export const GOLDEN_STATUS_CYCLE = ['09', '08', '00', '40', '04'] as const;

export function goldenStatusFor(i: number): string {
  return GOLDEN_STATUS_CYCLE[i % GOLDEN_STATUS_CYCLE.length]!;
}

/** Korpusu UDS 0x19-02 gövdesine kodlar ("5902" SOYULMUŞ). */
export function goldenUdsBody(): string {
  return 'FF' + GOLDEN_CLIO.map(([code, ftb], i) =>
    encodeDtcBytes(code) + ftb + goldenStatusFor(i)).join('');
}

/** Korpusu 3-BAYT DTC taşıyan KWP 0x18 gövdesine kodlar ("58" SOYULMUŞ). */
export function goldenKwp3ByteBody(): string {
  const count = GOLDEN_CLIO.length.toString(16).toUpperCase().padStart(2, '0');
  return count + GOLDEN_CLIO.map(([code, ftb], i) =>
    encodeDtcBytes(code) + ftb + goldenStatusFor(i)).join('');
}

/** `P0833(29)` biçiminde beklenen ekran künyeleri. */
export function goldenDisplayCodes(): string[] {
  return GOLDEN_CLIO.map(([c, f]) => `${c}(${f})`);
}

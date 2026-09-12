/**
 * kwpDtc — KWP2000 ReadDTCByStatus (servis 0x18) ayrıştırması (OBD-OS-F3-3).
 *
 * NEDEN AYRI MODÜL: KWP DTC'si 2 BAYTTIR (UDS 0x19'da 3). Aynı çözücüyü kullanmak,
 * KWP kodlarını yanlış çözer (kayıt boyu 3 yerine 4 bayt sanılır → tüm liste kayar).
 * Bu, sessiz veri bozulmasının klasik yolu — o yüzden ayrı ve açıkça isimlendirilmiş.
 *
 * KWP araçlar (Renault Trafic, eski Fiat/Doblo, çoğu 2000-2008 Avrupa aracı) UDS 0x19'u
 * TANIMAZ; üretici DTC'leri 0x18'de yaşar. F1-2 uyarısının KWP tarafındaki cevabı.
 *
 * BİÇİM (ISO 14230-3): native "58" önekini soyar → `<count 1 bayt> (<DTC hi><DTC lo><status>)*`
 * Kod dönüşümü SAE J2012 ile AYNI (ilk 2 bit harf) — UDS ile ortak `decodeUdsDtcCode`.
 *
 * ZERO-TRUST: kırık/eksik kayıt SESSİZCE ATLANIR; `count` alanına KÖRÜ KÖRÜNE güvenilmez
 * (bazı ECU'lar yanlış sayar) — gerçek kayıtlar sayılır.
 *
 * SAF: modül-durumu yok, I/O yok — tam test edilebilir.
 */

import { decodeUdsDtcCode, parseUdsStatusByte, type UdsDtcStatus } from './udsDtc';

export interface KwpDtc {
  /** SAE J2012 formatında kod ('P0301', 'C1234'…). */
  code: string;
  /** Ham DTC (hex) — 2 BAYT (klasik KWP) ya da 3 BAYT (ISO 14229 biçimi). */
  rawDtc: string;
  /** Ham status baytı. */
  rawStatus: string;
  /** KWP status baytı UDS ile aynı bit düzenini kullanır (ISO 14230-3 / 14229 D.1). */
  status: UdsDtcStatus;
  /**
   * P0-OBD-FINISH — 3 BAYTLIK DTC biçiminde arıza ALT TİPİ (FTB, 2 hane hex).
   * 2 baytlık klasik KWP kaydında YOKTUR → `undefined` (sahte '00' YAZILMAZ).
   */
  failureType?: string;
  /** Bu kaydın ÖLÇÜLEN boyu (bayt): 3 = DTC 2 bayt + status · 4 = DTC 3 bayt + status. */
  recordBytes: 3 | 4;
}

/**
 * P0-OBD-FINISH — KAYIT BOYU TAHMİN EDİLMEZ, `count` BAYTIYLA ÖLÇÜLÜR.
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * Bu modül kayıt boyunu 3 BAYT (DTC 2 bayt + status) olarak SABİTLEMİŞTİ.
 * Doğru bir varsayımdı ama TEK doğru biçim DEĞİL: aynı 0x18/0x13 zarfı içinde
 * ISO 14229 biçimli 3 BAYTLIK DTC + status (kayıt 4 bayt) taşıyan ECU'lar var
 * — Car Scanner'ın `P0380(11)` / `P0380(12)` gibi ALT KODLU gösterdiği kayıtlar
 * tam olarak bu biçimdir (parantez içi = FTB, ISO 14229-1 D.2 / SAE J2012-DA).
 *
 * 20 kayıtlık 4-baytlık bir gövde 3'e BÖLÜNMEZ (80 % 3 = 2) → eski kod
 * `validateKwpDtcResponse`ta MALFORMED diyor, `parseKwpDtcResponse` ise
 * kaydırarak ÇÖP kod üretiyordu. Yani o araçlarda üretici DTC'si ya HİÇ
 * görünmüyor ya da YANLIŞ görünüyordu.
 *
 * ── ÇÖZÜM: ÖLÇÜM, TAHMİN DEĞİL ────────────────────────────────────────────
 * ECU'nun kendi beyan ettiği `count` baytı iki biçim arasında AYRIMI KESİN
 * yapar: `count*3 === gövde` → 2 baytlık DTC · `count*4 === gövde` → 3 baytlık
 * DTC. İkisi yalnız `count === 0` iken çakışır (o da kayıt YOK demektir).
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * `count` HİÇBİRİYLE uyuşmuyorsa (bozuk/yalancı sayaç) davranış ESKİSİYLE
 * AYNI kalır: 3 baytlık kayıt varsayılır. Yani bu değişiklik hiçbir mevcut
 * KWP aracını bozmaz — yalnız daha önce ÇÖZÜLEMEYEN gövdeyi çözer.
 */
export function detectKwpRecordBytes(rawHex: string): 3 | 4 {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length < 2) return 3;
  const declared = parseInt(clean.slice(0, 2), 16);
  if (!Number.isFinite(declared) || declared <= 0) return 3;
  const bodyBytes = (clean.length - 2) / 2;
  if (declared * 4 === bodyBytes && declared * 3 !== bodyBytes) return 4;
  return 3;
}

/**
 * KWP 0x18 gövdesini ayrıştırır ("58" SOYULMUŞ hali).
 * Gövde: `<count 1 bayt> (<DTC hi 1><DTC lo 1><status 1>)*` → kayıt boyu 3 BAYT.
 */
export function parseKwpDtcResponse(rawHex: string): KwpDtc[] {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  // En az: 1 bayt count + 3 bayt tek kayıt = 8 hex hane.
  if (clean.length < 8) return [];

  /* Kayıt boyu ÖLÇÜLÜR (bkz. detectKwpRecordBytes) — sabitlenmiş 3 bayt
     varsayımı, 3 baytlık DTC taşıyan ECU'larda tüm listeyi kaydırıyordu. */
  const recordBytes = detectKwpRecordBytes(clean);
  const stride = recordBytes * 2;             // hex hane
  const dtcHexLen = (recordBytes - 1) * 2;    // DTC alanı (2 ya da 3 bayt)

  const body = clean.slice(2);   // count baytını at (kör güvenmiyoruz — gerçek kayıtları sayarız)
  const out: KwpDtc[] = [];

  for (let i = 0; i + stride <= body.length; i += stride) {
    const rawDtc = body.slice(i, i + dtcHexLen);
    const rawStatus = body.slice(i + dtcHexLen, i + stride);

    const b0 = parseInt(rawDtc.slice(0, 2), 16);
    const b1 = parseInt(rawDtc.slice(2, 4), 16);
    const sb = parseInt(rawStatus, 16);
    const ftb = recordBytes === 4 ? rawDtc.slice(4, 6) : null;
    const b2 = ftb === null ? 0 : parseInt(ftb, 16);
    if ([b0, b1, b2, sb].some((x) => Number.isNaN(x))) continue;   // bozuk kayıt → atla
    if (b0 === 0 && b1 === 0 && b2 === 0) continue;                // dolgu kaydı

    out.push({
      code: decodeUdsDtcCode(b0, b1),   // kod dönüşümü UDS ile ORTAK (SAE J2012)
      rawDtc,
      rawStatus,
      status: parseUdsStatusByte(sb),
      ...(ftb === null ? {} : { failureType: ftb }),
      recordBytes,
    });
  }

  return out;
}

/**
 * P0-OBD-PARITY — ECU'nun gönderdiği kayıt sayısı (parser'dan BAĞIMSIZ ölçüm).
 * Bkz. `udsDtc.countUdsDtcRecords`. `null` = gövde kayıt sınırına oturmuyor.
 */
export function countKwpDtcRecords(rawHex: string): number | null {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length < 2) return null;
  const stride = detectKwpRecordBytes(clean) * 2;
  if (((clean.length - 2) % stride) !== 0) return null;
  return (clean.length - 2) / stride;
}

/**
 * KWP `count` + kayıt sınırlarını doğrular; count uyuşmazlığı malformed'dur.
 * P0-OBD-FINISH: ÖLÇÜLEN kayıt boyu da döner (3 ya da 4 bayt) — çağıran
 * "hangi biçim çözüldü" sorusunu kanıtla yanıtlayabilsin.
 */
export function validateKwpDtcResponse(
  rawHex: string,
): { valid: boolean; declaredCount: number | null; recordBytes: 3 | 4 } {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const recordBytes = detectKwpRecordBytes(clean);
  if (clean.length < 2) return { valid: false, declaredCount: null, recordBytes };
  const count = parseInt(clean.slice(0, 2), 16);
  if (!Number.isFinite(count)) return { valid: false, declaredCount: null, recordBytes };
  const bodyHex = clean.length - 2;
  const stride = recordBytes * 2;
  if ((bodyHex % stride) !== 0) return { valid: false, declaredCount: count, recordBytes };
  return { valid: count === bodyHex / stride, declaredCount: count, recordBytes };
}

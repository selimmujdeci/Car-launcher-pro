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
  /** Ham 2 bayt DTC (hex) — üretici tablosu (DF eşlemesi) için KAYBOLMAZ. */
  rawDtc: string;
  /** Ham status baytı. */
  rawStatus: string;
  /** KWP status baytı UDS ile aynı bit düzenini kullanır (ISO 14230-3 / 14229 D.1). */
  status: UdsDtcStatus;
}

/**
 * KWP 0x18 gövdesini ayrıştırır ("58" SOYULMUŞ hali).
 * Gövde: `<count 1 bayt> (<DTC hi 1><DTC lo 1><status 1>)*` → kayıt boyu 3 BAYT.
 */
export function parseKwpDtcResponse(rawHex: string): KwpDtc[] {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  // En az: 1 bayt count + 3 bayt tek kayıt = 8 hex hane.
  if (clean.length < 8) return [];

  const body = clean.slice(2);   // count baytını at (kör güvenmiyoruz — gerçek kayıtları sayarız)
  const out: KwpDtc[] = [];

  for (let i = 0; i + 6 <= body.length; i += 6) {
    const rawDtc = body.slice(i, i + 4);        // 2 BAYT (UDS'te 3 — kritik fark)
    const rawStatus = body.slice(i + 4, i + 6);

    const b0 = parseInt(rawDtc.slice(0, 2), 16);
    const b1 = parseInt(rawDtc.slice(2, 4), 16);
    const sb = parseInt(rawStatus, 16);
    if ([b0, b1, sb].some((x) => Number.isNaN(x))) continue;   // bozuk kayıt → atla
    if (b0 === 0 && b1 === 0) continue;                        // dolgu kaydı

    out.push({
      code: decodeUdsDtcCode(b0, b1),   // kod dönüşümü UDS ile ORTAK (SAE J2012)
      rawDtc,
      rawStatus,
      status: parseUdsStatusByte(sb),
    });
  }

  return out;
}

/**
 * udsDtc — UDS Service 0x19 (ReadDTCInformation) ayrıştırması (OBD-OS-F3-1).
 *
 * NEDEN: standart Mode 03/07/0A yalnız EMİSYONLA ilgili (P0…) kodları döner. Renault DF…,
 * VAG, BMW gibi ÜRETİCİ-ÖZEL kodlar UDS 0x19'da yaşar. F1-2'nin "MIL yanıyor ama standart
 * kod yok" uyarısının cevabı tam olarak budur — Car Scanner'ın gördüğü, bizim göremediğimiz
 * kodlar. Bu modül olmadan çoklu-ECU taraması bile üretici arızasını bulamaz.
 *
 * BİÇİM (ISO 14229-1): olumlu yanıt `59 02 <availabilityMask> (<DTC 3 bayt><status 1 bayt>)*`
 * Native "5902" önekini SOYAR → bu modüle `<availabilityMask><kayıtlar…>` gelir.
 *
 * DTC 3 BAYT → KOD (SAE J2012 / ISO 15031-6, Mode 03 ile AYNI kodlama):
 *   bayt0 bit7-6 → harf: 00=P (powertrain) · 01=C (chassis) · 10=B (body) · 11=U (network)
 *   bayt0 bit5-4 → 1. hane (0-3) · bayt0 bit3-0 → 2. hane
 *   bayt1        → 3. ve 4. hane
 *   bayt2        → FTB (Failure Type Byte) — UDS'e ÖZGÜ: arızanın ALT TİPİ (ör. 0x1C).
 *                  Mode 03'te bu bayt YOKTUR → aynı arıza iki modda farklı görünür.
 *
 * STATUS BAYTI (ISO 14229-1 Tablo D.1) — F3-1'in asıl kazancı: "kod var" demek yetmez,
 * AKTİF Mİ, GEÇMİŞ Mİ, ONAYLI MI ayrılır. Mode 03 bunu ayıramaz.
 *
 * ZERO-TRUST: eksik/bozuk kayıt SESSİZCE ATLANIR (uydurma kod üretilmez); çözülemeyen
 * gövde boş liste döner — "kod yok" demek DEĞİLDİR, çağıran `supported` ile ayırır.
 *
 * SAF: modül-durumu yok, I/O yok — tam test edilebilir.
 */

/** UDS DTC status baytının çözülmüş bayrakları (ISO 14229-1 D.1). */
export interface UdsDtcStatus {
  /** bit0 — şu anki test döngüsünde ARIZA VAR (aktif). */
  testFailed: boolean;
  /** bit1 — bu çalışma döngüsünde en az bir kez başarısız oldu. */
  testFailedThisCycle: boolean;
  /** bit2 — bekleyen (pending). */
  pending: boolean;
  /** bit3 — ONAYLI (confirmed) — kalıcı hafızaya yazıldı. */
  confirmed: boolean;
  /** bit6 — bu çalışma döngüsünde test hiç tamamlanmadı. */
  testNotCompletedThisCycle: boolean;
  /** bit7 — sürücü uyarı göstergesi (MIL) talep edildi. */
  warningIndicatorRequested: boolean;
}

export interface UdsDtc {
  /** SAE J2012 formatında kod ('P0301', 'C1234', 'U0100'…). */
  code: string;
  /** UDS'e özgü arıza alt tipi (Failure Type Byte, 2 hane hex) — Mode 03'te YOKTUR. */
  failureType: string;
  /** Ham 3 bayt DTC (hex) — üretici tablosuyla (FleetKB) eşleştirmek için KAYBOLMAZ. */
  rawDtc: string;
  /** Ham status baytı (hex). */
  rawStatus: string;
  status: UdsDtcStatus;
}

const LETTERS = ['P', 'C', 'B', 'U'] as const;

/** Status baytını bayraklara çözer (saf). */
export function parseUdsStatusByte(b: number): UdsDtcStatus {
  return {
    testFailed:                (b & 0x01) !== 0,
    testFailedThisCycle:       (b & 0x02) !== 0,
    pending:                   (b & 0x04) !== 0,
    confirmed:                 (b & 0x08) !== 0,
    testNotCompletedThisCycle: (b & 0x40) !== 0,
    warningIndicatorRequested: (b & 0x80) !== 0,
  };
}

/** 3 baytlık UDS DTC'yi SAE J2012 koduna çevirir (Mode 03 ile AYNI kodlama). */
export function decodeUdsDtcCode(b0: number, b1: number): string {
  const letter = LETTERS[(b0 >> 6) & 0x03]!;
  const d1 = (b0 >> 4) & 0x03;
  const d2 = b0 & 0x0f;
  const d34 = b1.toString(16).toUpperCase().padStart(2, '0');
  return `${letter}${d1}${d2.toString(16).toUpperCase()}${d34}`;
}

/**
 * UDS 0x19-02 gövdesini ayrıştırır ("5902" SOYULMUŞ hali).
 *
 * Gövde: `<availabilityMask 1 bayt> (<DTC 3 bayt> <status 1 bayt>)*`
 * Eksik/kırık son kayıt SESSİZCE ATLANIR (uydurma kod YOK).
 */
export function parseUdsDtcResponse(rawHex: string): UdsDtc[] {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  // En az: 1 bayt availability + 4 bayt tek kayıt = 10 hex hane.
  if (clean.length < 10) return [];

  const body = clean.slice(2);   // availabilityMask baytını at
  const out: UdsDtc[] = [];

  for (let i = 0; i + 8 <= body.length; i += 8) {
    const rawDtc = body.slice(i, i + 6);
    const rawStatus = body.slice(i + 6, i + 8);

    const b0 = parseInt(rawDtc.slice(0, 2), 16);
    const b1 = parseInt(rawDtc.slice(2, 4), 16);
    const b2 = parseInt(rawDtc.slice(4, 6), 16);
    const sb = parseInt(rawStatus, 16);
    if ([b0, b1, b2, sb].some((x) => Number.isNaN(x))) continue;   // bozuk kayıt → atla

    // '000000' dolgu (padding) kaydı — gerçek DTC değil.
    if (b0 === 0 && b1 === 0 && b2 === 0) continue;

    out.push({
      code: decodeUdsDtcCode(b0, b1),
      failureType: rawDtc.slice(4, 6),
      rawDtc,
      rawStatus,
      status: parseUdsStatusByte(sb),
    });
  }

  return out;
}

/**
 * P0-OBD-PARITY — ECU'NUN GÖNDERDİĞİ KAYIT SAYISI (parser'dan BAĞIMSIZ ölçüm).
 *
 * NEDEN AYRI: `parseUdsDtcResponse().length` parser'ın ÜRETTİĞİ sayıdır. Eğer
 * parser bir kaydı düşürürse (bozuk bayt, dolgu) o kayıp GÖRÜNMEZ olur —
 * çünkü karşılaştıracak bağımsız bir sayı yoktur. Bu fonksiyon zarfın KENDİ
 * geometrisinden sayar: `RAW` ile `PARSED` ayrı ölçümler hâline gelir ve
 * aradaki fark `PARSE_DROPPED` olarak raporlanabilir.
 *
 * `null` = gövde kayıt sınırına oturmuyor (malformed) — sayı UYDURULMAZ.
 */
export function countUdsDtcRecords(rawHex: string): number | null {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length < 2 || ((clean.length - 2) % 8) !== 0) return null;
  return (clean.length - 2) / 8;
}

/** 0x19-02/0A gövdesinin kayıt sınırlarını doğrular; boş geçerli liste ile malformed ayrılır. */
export function validateUdsDtcResponse(rawHex: string): { valid: boolean; availabilityMask: string | null } {
  const clean = (rawHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length < 2 || ((clean.length - 2) % 8) !== 0)
    return { valid: false, availabilityMask: null };
  return { valid: true, availabilityMask: clean.slice(0, 2) };
}

/**
 * UDS DTC'yi standart tarama modlarına eşler — çoklu-ECU raporunda tek dilde konuşmak için.
 * ONAYLI > BEKLEYEN önceliği (fail-closed: daha ciddi olanı seç).
 */
export function udsDtcToScanMode(dtc: UdsDtc): 'stored' | 'pending' {
  return dtc.status.confirmed || dtc.status.testFailed ? 'stored' : 'pending';
}

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-FINISH — DTC KAYDININ DURUM SEMANTİĞİ (status baytı → tek etiket)
   ══════════════════════════════════════════════════════════════════════════

   ÖLÇÜLEN KUSUR: ürün UDS/KWP kayıtlarını `stored | pending` ikilisine
   düşürüyordu (`udsDtcToScanMode`). Car Scanner AYNI araçta aynı kayıtları
   BEŞ ayrı durumda gösteriyor: "Onaylı" · "Arşiv / Etkin değil" · "Test
   tamamlanmadı" · "Bu işlem çevriminde test tamamlanmadı" · "Son DTC
   silindikten sonra test tamamlanmadı". İkiliye düşürmek, ARŞİVDEKİ bir
   kaydı AKTİF ARIZA gibi göstermek (yanlış alarm) ya da tersine aktif bir
   arızayı sıradan bir "kayıtlı kod" saymak demekti.

   BU FONKSİYON SINIFLANDIRIR, FİLTRELEMEZ. ECU'dan gelen hiçbir kayıt bu
   yüzden düşürülmez — yalnız DOĞRU adıyla gösterilir (görev Aşama 4).

   Kaynak: ISO 14229-1 Tablo D.1 (statusOfDTC bit tanımları) — bitler zaten
   `parseUdsStatusByte` ile çözülüyordu, kimse KARAR üretmiyordu.
   SAF: I/O yok, durum yok. */

export type UdsDtcState =
  /** bit0 — arıza ŞU AN mevcut (testFailed). En ciddi durum. */
  | 'ACTIVE'
  /** bit3 — kalıcı hafızaya yazılmış, ama şu an test düşmüyor. */
  | 'CONFIRMED_INACTIVE'
  /** bit2 — bekleyen; henüz onaylanmadı. */
  | 'PENDING'
  /** bit6 — bu çalışma çevriminde test TAMAMLANMADI (sonuç BİLİNMİYOR). */
  | 'TEST_INCOMPLETE'
  /** Kayıt var ama hiçbir aktiflik/onay biti yok → arşiv (etkin değil). */
  | 'STORED_INACTIVE'
  /** Status baytı OKUNAMADI — sahte durum ÜRETİLMEZ. */
  | 'UNKNOWN';

export const UDS_DTC_STATE_LABEL: Readonly<Record<UdsDtcState, string>> = {
  ACTIVE:             'AKTİF',
  CONFIRMED_INACTIVE: 'ONAYLI (şu an düşmüyor)',
  PENDING:            'BEKLEYEN',
  TEST_INCOMPLETE:    'TEST TAMAMLANMADI',
  STORED_INACTIVE:    'ARŞİV / ETKİN DEĞİL',
  UNKNOWN:            'DURUM BİLİNMİYOR',
} as const;

/**
 * Status baytından TEK durum üretir (fail-closed öncelik: aktif > onaylı >
 * bekleyen > test yok > arşiv). `null` status → `UNKNOWN` (sahte "temiz" YOK).
 */
export function classifyUdsDtcState(status: UdsDtcStatus | null | undefined): UdsDtcState {
  if (!status) return 'UNKNOWN';
  if (status.testFailed) return 'ACTIVE';
  if (status.confirmed) return 'CONFIRMED_INACTIVE';
  if (status.pending || status.testFailedThisCycle) return 'PENDING';
  if (status.testNotCompletedThisCycle) return 'TEST_INCOMPLETE';
  return 'STORED_INACTIVE';
}

/**
 * P0-OBD-FINISH — KULLANICIYA GÖSTERİLECEK KOD METNİ: `P0380(11)`.
 *
 * ÖLÇÜLEN KUSUR: alt kod (FTB / failure type byte) ayrıştırılıp `failureType`
 * alanına yazılıyordu ama EKRANA HİÇ ÇIKMIYORDU. Aynı araçta Car Scanner
 * `P0380(11)`, `P0380(12)`, `P0380(13)`, `P0380(96)` gösterirken CarOS tek bir
 * "P0380" gösteriyordu — dört AYRI devre arızası tek satıra iniyordu.
 *
 * Alt kod yoksa (standart Mode 03) sade kod döner — parantez UYDURULMAZ.
 */
export function formatDtcDisplayCode(code: string, subCode?: string | null): string {
  const s = (subCode ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return s.length === 0 ? code : `${code}(${s})`;
}

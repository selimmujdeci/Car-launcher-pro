/**
 * StandardPidEnums — SAE J1979 / ISO 15031-5 bit/enum çözücüler + readiness sorgusu (Patch 11C).
 *
 * KAYNAK: yalnız kamu standardı (SAE J1979 Tablo B.1 — PID 0x01/0x03/0x1C bit tanımları).
 * Hiçbir üçüncü-taraf uygulamadan liste/formül alınmadı (StandardPidRegistry ile aynı
 * ticari lisans kuralı — CLAUDE.md).
 *
 * KAPSAM: bu 3 PID sayısal DEĞİL, bit/enum kodlu durum PID'leridir — bu yüzden
 * StandardPidRegistry'nin sayısal `decode: (b)=>number` sözleşmesine girmezler,
 * ayrı yapılandırılmış çözücüler burada tanımlanır. Okuma yolu: sürekli izlenen
 * PID'ler DEĞİL, talep-güdümlü tek-seferlik (`readPidOnce`) — Mali-400 boşta-sıfır-
 * maliyet sözleşmesi bozulmaz.
 *
 * PID 0x01 (Monitor status since DTCs cleared) — 4 bayt A/B/C/D:
 *  - A: bit7 = MIL; bit6-0 = onaylı DTC sayısı.
 *  - B: bit3 = ateşleme tipi (0=benzin/kıvılcım, 1=dizel/sıkıştırma) — bu bit
 *    C/D baytlarındaki SÜREKSİZ monitör bit haritasını da belirler (benzin ve
 *    dizelde FARKLI monitör kümeleri var, karıştırılmamalı). bit0-2 = sürekli
 *    monitörlerin (misfire/yakıt/kapsamlı bileşen) DESTEKLENDİĞİ; bit4-6 = aynı
 *    üçünün TAMAMLANDI/TAMAMLANMADI durumu (bit=1 → tamamlanmadı).
 *  - C: süreksiz monitör DESTEK bitmask'i (benzin/dizel farklı bit anlamı).
 *  - D: süreksiz monitör TAMAMLANMA bitmask'i (bit=1 → tamamlanmadı), C ile aynı bit sırası.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';

/* ── PID 0x01 — MIL / DTC sayısı / readiness monitörleri ─────────────────── */

export interface MonitorStatus {
  /** Türkçe monitör adı ("Katalizör", "Ateşleme Hatası (Misfire)"...). */
  monitor: string;
  /** Araç bu monitörü destekliyor mu. */
  available: boolean;
  /** Test tamamlandı mı (true = hazır). Desteklenmeyen monitörde anlamsız (available:false). */
  ready: boolean;
  /** true = sürekli izlenir (misfire/yakıt/kapsamlı bileşen); false = süreksiz (muayene testi). */
  continuous: boolean;
}

export interface DiagnosticStatusPid01 {
  mil: boolean;
  dtcCount: number;
  ignitionType: 'spark' | 'compression';
  monitors: MonitorStatus[];
  /** Desteklenen TÜM monitörler tamamlandı mı — muayene hazırlığı özeti. */
  allReady: boolean;
}

/**
 * PID 0x01 (4 bayt A B C D) çözümü. Ham baytlar mode/pid başlığı SOYULMUŞ olmalı.
 * @throws Error bayt sayısı < 4 (çağıran yakalamalı — hatalı/kısa yanıt).
 */
export function decodePid01(bytes: number[]): DiagnosticStatusPid01 {
  if (bytes.length < 4) throw new Error('PID 01 için en az 4 bayt gerekir');
  const a = bytes[0]!;
  const b = bytes[1]!;
  const c = bytes[2]!;
  const d = bytes[3]!;

  const mil = (a & 0x80) !== 0;
  const dtcCount = a & 0x7f;
  const ignitionType: 'spark' | 'compression' = (b & 0x08) !== 0 ? 'compression' : 'spark';

  const monitors: MonitorStatus[] = [
    { monitor: 'Ateşleme Hatası (Misfire)', available: (b & 0x01) !== 0, ready: (b & 0x10) === 0, continuous: true },
    { monitor: 'Yakıt Sistemi',             available: (b & 0x02) !== 0, ready: (b & 0x20) === 0, continuous: true },
    { monitor: 'Kapsamlı Bileşenler',       available: (b & 0x04) !== 0, ready: (b & 0x40) === 0, continuous: true },
  ];

  if (ignitionType === 'spark') {
    monitors.push(
      { monitor: 'Katalizör',                 available: (c & 0x01) !== 0, ready: (d & 0x01) === 0, continuous: false },
      { monitor: 'Isıtılmış Katalizör',       available: (c & 0x02) !== 0, ready: (d & 0x02) === 0, continuous: false },
      { monitor: 'Buharlaşma Sistemi (EVAP)', available: (c & 0x04) !== 0, ready: (d & 0x04) === 0, continuous: false },
      { monitor: 'İkincil Hava Sistemi',      available: (c & 0x08) !== 0, ready: (d & 0x08) === 0, continuous: false },
      { monitor: 'Klima Soğutucu Sistemi',    available: (c & 0x10) !== 0, ready: (d & 0x10) === 0, continuous: false },
      { monitor: 'O2 Sensörü',                available: (c & 0x20) !== 0, ready: (d & 0x20) === 0, continuous: false },
      { monitor: 'O2 Sensör Isıtıcısı',       available: (c & 0x40) !== 0, ready: (d & 0x40) === 0, continuous: false },
      { monitor: 'EGR Sistemi',               available: (c & 0x80) !== 0, ready: (d & 0x80) === 0, continuous: false },
    );
  } else {
    monitors.push(
      { monitor: 'NMHC Katalizörü',           available: (c & 0x01) !== 0, ready: (d & 0x01) === 0, continuous: false },
      { monitor: 'NOx/SCR Sistemi',           available: (c & 0x02) !== 0, ready: (d & 0x02) === 0, continuous: false },
      { monitor: 'Turbo/Kompresör Basıncı',   available: (c & 0x08) !== 0, ready: (d & 0x08) === 0, continuous: false },
      { monitor: 'Egzoz Gazı Sensörü',        available: (c & 0x20) !== 0, ready: (d & 0x20) === 0, continuous: false },
      { monitor: 'Partikül Filtresi (DPF)',   available: (c & 0x40) !== 0, ready: (d & 0x40) === 0, continuous: false },
      { monitor: 'EGR/VVT Sistemi',           available: (c & 0x80) !== 0, ready: (d & 0x80) === 0, continuous: false },
    );
  }

  const supported = monitors.filter((m) => m.available);
  const allReady = supported.length > 0 && supported.every((m) => m.ready);

  return { mil, dtcCount, ignitionType, monitors, allReady };
}

/* ── PID 0x03 — Yakıt sistemi durumu (açık/kapalı çevrim enum) ───────────── */

export type FuelSystemStatusCode =
  | 'acik_cevrim_yetersiz_sicaklik'
  | 'kapali_cevrim'
  | 'acik_cevrim_surus_kosullari'
  | 'acik_cevrim_ariza'
  | 'kapali_cevrim_ariza'
  | 'bilinmeyen';

interface FuelSystemLabel { code: FuelSystemStatusCode; label: string }

/** SAE J1979 PID 03 bitmask enum — değerler bağımsız bitler DEĞİL, TEKİL durumlardır. */
const FUEL_SYSTEM_LABELS: Readonly<Record<number, FuelSystemLabel>> = {
  0x00: { code: 'bilinmeyen',                      label: 'Yakıt sistemi bilgisi yok' },
  0x01: { code: 'acik_cevrim_yetersiz_sicaklik',    label: 'Açık çevrim — motor henüz ısınmadı' },
  0x02: { code: 'kapali_cevrim',                    label: 'Kapalı çevrim — O2 sensörü geri beslemesi aktif' },
  0x04: { code: 'acik_cevrim_surus_kosullari',       label: 'Açık çevrim — sürüş koşulları (güç zenginleştirme/yavaşlama)' },
  0x08: { code: 'acik_cevrim_ariza',                label: 'Açık çevrim — sistem arızası tespit edildi' },
  0x10: { code: 'kapali_cevrim_ariza',              label: 'Kapalı çevrim — geri besleme sisteminde arıza' },
};

export interface FuelSystemStatusResult {
  bank1: FuelSystemLabel | null;
  /** Tek yakıt sistemli araçlarda null (2. bayt 0x00 → banka yok). */
  bank2: FuelSystemLabel | null;
}

/**
 * PID 0x03 çözümü (1-2 bayt — çoğu araç tek banka bildirir, 2. bayt 0 ise banka 2 yok).
 * @throws Error bayt sayısı 0 (çağıran yakalamalı).
 */
export function decodePid03(bytes: number[]): FuelSystemStatusResult {
  if (bytes.length < 1) throw new Error('PID 03 için en az 1 bayt gerekir');
  const b1 = bytes[0]!;
  const b2 = bytes.length > 1 ? bytes[1]! : 0;
  return {
    bank1: FUEL_SYSTEM_LABELS[b1] ?? null,
    bank2: b2 !== 0 ? (FUEL_SYSTEM_LABELS[b2] ?? null) : null,
  };
}

/* ── PID 0x1C — OBD standardı enum ───────────────────────────────────────── */

/** SAE J1979 Tablo B.1 — bilinen/yaygın kodlar (tam liste 1-33 arası rezervasyonlar hariç). */
const OBD_STANDARD_LABELS: Readonly<Record<number, string>> = {
  1: 'OBD-II (California ARB)',
  2: 'OBD (Federal EPA)',
  3: 'OBD ve OBD-II',
  4: 'OBD-I',
  5: 'OBD Uyumlu Değil',
  6: 'EOBD (Avrupa)',
  7: 'EOBD ve OBD-II',
  8: 'EOBD ve OBD',
  9: 'EOBD, OBD ve OBD-II',
  10: 'JOBD (Japonya)',
  11: 'JOBD ve OBD-II',
  12: 'JOBD ve EOBD',
  13: 'JOBD, EOBD ve OBD-II',
  17: 'Motor Üreticisi Teşhis (EMD)',
  18: 'Motor Üreticisi Teşhis Gelişmiş (EMD+)',
  19: 'Ağır Vasıta OBD (Kısmi)',
  20: 'Ağır Vasıta OBD (HD OBD)',
  21: 'Dünya Çapında Uyumlu OBD (WWH-OBD)',
  23: 'Ağır Vasıta Euro OBD Aşama I',
  24: 'Ağır Vasıta Euro OBD Aşama I (NOx kontrollü)',
  25: 'Ağır Vasıta Euro OBD Aşama II',
  26: 'Ağır Vasıta Euro OBD Aşama II (NOx kontrollü)',
  28: 'Brezilya OBD Faz 1',
  29: 'Brezilya OBD Faz 2',
  30: 'Kore OBD (KOBD)',
  31: 'Hindistan OBD I',
  32: 'Hindistan OBD II',
};

export interface ObdStandardResult { code: number; label: string }

/**
 * PID 0x1C çözümü (1 bayt).
 * @throws Error bayt sayısı 0 (çağıran yakalamalı).
 */
export function decodePid1C(bytes: number[]): ObdStandardResult {
  if (bytes.length < 1) throw new Error('PID 1C için en az 1 bayt gerekir');
  const code = bytes[0]!;
  return { code, label: OBD_STANDARD_LABELS[code] ?? `Bilinmeyen/rezerve OBD standardı (kod ${code})` };
}

/* ── Ortak yardımcı ───────────────────────────────────────────────────────── */

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 2 <= clean.length; i += 2) out.push(parseInt(clean.substring(i, i + 2), 16));
  return out;
}

/* ── Genel API — teşhis durumu sorgusu ───────────────────────────────────── */

export interface DiagnosticStatusResult {
  mil: boolean;
  dtcCount: number;
  obdStandard: string;
  fuelSystemStatus: FuelSystemStatusResult;
  monitors: MonitorStatus[];
  /** Desteklenen tüm monitörler tamamlandı mı — muayene sorusunun doğrudan cevabı. */
  allReady: boolean;
}

/**
 * Muayene/readiness sorgusu — PID 01 (temel, zorunlu) + 03/1C (opsiyonel, fail-soft)
 * tek-seferlik okunur (`readPidOnce`, USER önceliği; sürekli poll GRUBUNA dahil DEĞİL).
 *
 * @returns null = PID 01 okunamadı (bağlantı yok/eski native plugin/desteklenmiyor) —
 *          temel veri olmadan özet anlamsız olacağından dürüstçe null döner.
 *          PID 03/1C okunamazsa (fail-soft) yalnız o alanlar varsayılana düşer,
 *          mil/dtcCount/monitors/allReady yine döner.
 */
export async function readDiagnosticStatus(): Promise<DiagnosticStatusResult | null> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.readPidOnce) return null;

  let status01: DiagnosticStatusPid01;
  try {
    const r01 = await CarLauncher.readPidOnce({ pid: '01' });
    if (!r01.data) return null; // NO DATA/desteklenmiyor — temel veri yok
    status01 = decodePid01(hexToBytes(r01.data));
  } catch (e) {
    logError('Diag:ReadPid01Failed', e);
    return null;
  }

  let fuelSystemStatus: FuelSystemStatusResult = { bank1: null, bank2: null };
  try {
    const r03 = await CarLauncher.readPidOnce({ pid: '03' });
    if (r03.data) fuelSystemStatus = decodePid03(hexToBytes(r03.data));
  } catch (e) {
    logError('Diag:ReadPid03Failed', e); // opsiyonel — diğer alanları etkilemez
  }

  let obdStandard = 'Bilinmiyor';
  try {
    const r1c = await CarLauncher.readPidOnce({ pid: '1C' });
    if (r1c.data) obdStandard = decodePid1C(hexToBytes(r1c.data)).label;
  } catch (e) {
    logError('Diag:ReadPid1CFailed', e); // opsiyonel — diğer alanları etkilemez
  }

  return {
    mil: status01.mil,
    dtcCount: status01.dtcCount,
    obdStandard,
    fuelSystemStatus,
    monitors: status01.monitors,
    allReady: status01.allReady,
  };
}

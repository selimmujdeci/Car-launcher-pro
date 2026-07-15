/**
 * DTC Service — Diagnostic Trouble Code reading, description, and clearing.
 *
 * Architecture:
 *  - Module-level push state (same pattern as obdService)
 *  - Turkish DTC code database for P/B/C/U codes
 *  - Native path: CarLauncher.readDTC() + clearDTC()
 *  - Mock fallback with random realistic codes for demo/web mode
 */

import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { logError } from './crashLogger';
import { getOBDDataSnapshot } from './obdService';
import { evaluateDtcClearGate, type WriteGateDecision } from './obd/writeGate';
import { getSupportedPids } from './obd/extendedPidService';
import { STANDARD_PID_MAP, decodeStandardPid } from './obd/StandardPidRegistry';
import {
  registerDtcCatalog,
  registerLazyDtcSource,
  resolveDtcRecord,
  ensureExtendedDtcLoaded,
  type DtcRecord,
  type DTCCode,
} from './obd/dtcDataSource';

/* ── Types ───────────────────────────────────────────────── */

// DTC tip tanımları veri-kaynağı katmanına (dtcDataSource) taşındı; geriye dönük
// uyumluluk için buradan re-export edilir — mevcut `import { DTCCode } from './dtcService'`
// tüketicileri değişmeden çalışmaya devam eder.
export type { DTCCode, DTCSeverity, DtcRecord } from './obd/dtcDataSource';
export type { DriveSafety, EstimatedCost, DtcCatalog } from './obd/dtcDataSource';

// Geniş DTC kataloğunu (163 standart kod → toplam 200+) LAZY kaynak olarak kaydet.
// Bu satır yalnız bir yükleyici PUSH eder — dtcExtendedCatalog dinamik import'u
// (ve ~30KB veri) YALNIZ preloadExtendedDtcCatalog() çağrılınca indirilir → Vite
// ayrı chunk'a böler, ilk yükleme (Mali-400) bütçesine girmez.
registerLazyDtcSource(() => import('./obd/data/dtcExtendedCatalog').then((m) => m.default));

/**
 * Geniş DTC kataloğunu (P0 uzun kuyruk / P2 / B / C / U — 163 kod) talep üzerine
 * yükler ve senkron kayıt defterine birleştirir. İlk çağrıda dinamik import (~1 chunk),
 * sonraki çağrılar anında (memoize). Native DTC okuma yolları bunu otomatik çağırır;
 * UI de (ör. DTC paneli açılırken) çağırarak tam kataloğu önden hazırlayabilir.
 */
export const preloadExtendedDtcCatalog = ensureExtendedDtcLoaded;

export interface DTCState {
  codes: DTCCode[];
  isReading: boolean;
  isClearing: boolean;
  lastReadAt: number | null;
  error: string | null;
  /** true → son okuma başarısız; codes bir önceki başarılı okumanın verisini korur */
  isStale: boolean;
}

/** Patch 11A: Mode 03/07/0A birleşik sonuç — hangi moddan geldiğini `status` taşır. */
export type DTCStatus = 'stored' | 'pending' | 'permanent';

export interface DTCCodeWithStatus extends DTCCode {
  status: DTCStatus;
}

/**
 * OBD-OS-F0-1: her modun okuma SONUCU — fail-closed verdi için. 'ok' = okuma başarılı
 * (boş liste de başarıdır); 'failed' = gerçek hata/timeout (tarama KISMİ kalır); 'unsupported'
 * = araç/adaptör o modu hiç bildirmiyor (hata DEĞİL, belirsizlik yapmaz).
 */
export interface DtcScanCompleteness {
  stored:    'ok' | 'failed';
  pending:   'ok' | 'failed' | 'unsupported';
  permanent: 'ok' | 'failed' | 'unsupported';
}

export interface ReadAllDTCsResult {
  /** stored + pending + permanent birleşik liste (status alanıyla ayrışır). */
  codes: DTCCodeWithStatus[];
  /**
   * false = araç/adaptör Mode 0A'yı (kalıcı kod) HİÇ desteklemiyor (tipik olarak 2010
   * öncesi araçlar) — bu durum "kalıcı kod yok" (permanentSupported:true, permanent kod
   * bulunmaz) ile KARIŞTIRILMAMALI; UI bu ayrımı dürüstçe göstermeli.
   */
  permanentSupported: boolean;
  /** OBD-OS-F0-1: mod-bazlı okuma sonucu — fail-closed verdi bunu kullanır (kısmi tarama tespiti). */
  completeness: DtcScanCompleteness;
}

/** Patch 11B: Mode 02 freeze frame — arızayı tetikleyen an'ın PID anlık görüntüsü. */
export interface FreezeFrameValue {
  pid: string;
  name: string;
  value: number;
  unit: string;
}

export interface FreezeFrameResult {
  /** Freeze frame'i tetikleyen DTC kodu. */
  dtc: string;
  values: FreezeFrameValue[];
}

/**
 * Freeze frame'de anlamlı görülen PID alt kümesi (Patch 11B görev tanımı).
 * OBD-OS-F1-3: artık TABAN — kanıt (desteklenen-PID keşfi) varsa aşağıdaki öncelik
 * listesiyle GENİŞLETİLİR; kanıt yoksa AYNEN bu 7 PID kullanılır (fail-soft, regresyonsuz).
 */
const FREEZE_FRAME_PIDS: readonly string[] = ['0C', '0D', '05', '04', '0B', '0F', '11'];

/**
 * OBD-OS-F1-3 — Freeze frame PID ÖNCELİK listesi (teşhis değeri sırasına göre).
 *
 * NEDEN TAVAN VAR: freeze frame'de her PID AYRI bir ELM327 sorgusudur (~200 ms; araç
 * desteklemiyorsa NO-DATA beklemesi de aynı maliyette). Desteklenen 60+ PID'in hepsini
 * sormak taramayı 12+ saniyeye çıkarır — Mali-400 bütçe kuralı bunu yasaklar. Bu yüzden
 * arızanın "donmuş anını" en iyi anlatan PID'ler ÖNCE sorulur ve MAX_FREEZE_FRAME_PIDS'te
 * kesilir. Sıra rastgele değil: motor devri/hız/yük/sıcaklık = arıza anının bağlamı;
 * trim/lambda = karışım kanıtı; MAF/MAP = hava yolu; voltaj/yakıt = besleme.
 */
const FREEZE_FRAME_PRIORITY: readonly string[] = [
  // 1) Arıza anının çekirdek bağlamı (mevcut 7 — sıra korunur)
  '0C', '0D', '05', '04', '0B', '0F', '11',
  // 2) Karışım/yanma kanıtı (yakıt trim + lambda + ateşleme avansı)
  '06', '07', '08', '09', '0E', '44',
  // 3) Hava yolu + besleme
  '10', '33', '42', '2F', '43',
  // 4) Bağlam/süre (arıza ne zaman, hangi koşulda)
  '1F', '46', '5C', '5E',
];

/** Freeze frame'de sorulacak azami PID sayısı (tarama süresi bütçesi ~≤4 s). */
const MAX_FREEZE_FRAME_PIDS = 16;

/**
 * OBD-OS-F1-3: bu araçta freeze frame için sorulacak PID listesini seçer (SAF — test edilebilir).
 *
 * @param supported desteklenen-PID kanıtı (Mode 01 bitmap keşfi); null = kanıt YOK.
 * @returns kanıt varsa öncelik listesinden DESTEKLENENLER (tavanla kesilmiş);
 *          kanıt yoksa mevcut statik 7'li taban (fail-soft — kör genişleme YAPILMAZ).
 */
export function selectFreezeFramePids(supported: Set<string> | null): string[] {
  if (!supported || supported.size === 0) return [...FREEZE_FRAME_PIDS];
  const picked = FREEZE_FRAME_PRIORITY.filter((pid) => supported.has(pid));
  // Kanıt var ama kesişim boşsa (tuhaf bitmap) tabana düş — boş liste dönüp FF'i öldürme.
  if (picked.length === 0) return [...FREEZE_FRAME_PIDS];
  return picked.slice(0, MAX_FREEZE_FRAME_PIDS);
}

/* ── DTC Database (Turkish) ──────────────────────────────── */

const DTC_DB: Record<string, DtcRecord> = {
  // ── Ateşleme / Silindir ──────────────────────────────────
  P0300: { description: 'Tespit Edilemeyen Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Bujiler', 'Yakıt enjektörü', 'Kompresyon düşük', 'Ateşleme bobini'] },
  P0301: { description: '1. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (1. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },
  P0302: { description: '2. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (2. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },
  P0303: { description: '3. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (3. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },
  P0304: { description: '4. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (4. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },

  // ── Yakıt / Lambda ───────────────────────────────────────
  P0171: { description: 'Banka 1 Yakıt Karışımı Çok Zayıf', system: 'Yakıt', severity: 'warning', possibleCauses: ['Hava manifold kaçağı', 'MAF sensörü kirli', 'O2 sensörü arızalı', 'Yakıt pompası zayıf'] },
  P0172: { description: 'Banka 1 Yakıt Karışımı Çok Zengin', system: 'Yakıt', severity: 'warning', possibleCauses: ['Yakıt basıncı yüksek', 'Enjektör sızıntısı', 'MAF sensörü'] },
  P0174: { description: 'Banka 2 Yakıt Karışımı Çok Zayıf', system: 'Yakıt', severity: 'warning', possibleCauses: ['Hava kaçağı', 'Yakıt basıncı düşük'] },
  P0175: { description: 'Banka 2 Yakıt Karışımı Çok Zengin', system: 'Yakıt', severity: 'warning', possibleCauses: ['Enjektör sızıntısı', 'Yakıt basıncı yüksek'] },
  P0087: { description: 'Yakıt Rayı Basıncı Çok Düşük', system: 'Yakıt', severity: 'critical', possibleCauses: ['Yakıt pompası arıza', 'Yakıt filtresi tıkanık', 'Basınç regülatörü'] },

  // ── Lambda / Egzoz ───────────────────────────────────────
  P0420: { description: 'Katalitik Konvertör Verimliliği Düşük (Banka 1)', system: 'Egzoz', severity: 'warning', possibleCauses: ['Katalitik konvertör', 'O2 sensörü (arka)', 'Egzoz kaçağı'] },
  P0421: { description: 'Katalitik Konvertör Verimliliği Düşük (Banka 2)', system: 'Egzoz', severity: 'warning', possibleCauses: ['Katalitik konvertör', 'O2 sensörü', 'Egzoz kaçağı'] },
  P0130: { description: 'O2 Sensörü Devre Arızası (Banka 1 Sensör 1)', system: 'Egzoz', severity: 'warning', possibleCauses: ['O2 sensörü', 'Kablo hasarı', 'Egzoz kaçağı'] },
  P0136: { description: 'O2 Sensörü Devre Arızası (Banka 1 Sensör 2)', system: 'Egzoz', severity: 'warning', possibleCauses: ['O2 sensörü (arka)', 'Kablo hasarı'] },

  // ── Emisyon (EVAP) ───────────────────────────────────────
  P0440: { description: 'EVAP Yakıt Buharı Sistemi Genel Arıza', system: 'Emisyon', severity: 'warning', possibleCauses: ['Yakıt deposu kapağı gevşek', 'EVAP solenoid', 'Hortum kaçağı'] },
  P0442: { description: 'EVAP Küçük Sızıntı Tespit Edildi', system: 'Emisyon', severity: 'info', possibleCauses: ['Yakıt deposu kapağı', 'Küçük hortum çatlağı'] },
  P0455: { description: 'EVAP Büyük Sızıntı Tespit Edildi', system: 'Emisyon', severity: 'warning', possibleCauses: ['Yakıt deposu kapağı yok/arızalı', 'Büyük hortum kaçağı', 'Karbon filtresi'] },
  P0456: { description: 'EVAP Çok Küçük Sızıntı', system: 'Emisyon', severity: 'info', possibleCauses: ['Yakıt deposu kapağı', 'EVAP sistemi hortumları'] },

  // ── Soğutma ──────────────────────────────────────────────
  P0115: { description: 'Motor Soğutma Sıcaklık Sensörü Devre Arızası', system: 'Soğutma', severity: 'warning', possibleCauses: ['ECT sensörü', 'Kablo hasarı', 'Soğutucu sıvı düzeyi'] },
  P0116: { description: 'Motor Soğutma Sıcaklık Sensörü Aralık Dışı', system: 'Soğutma', severity: 'warning', possibleCauses: ['ECT sensörü', 'Termostat'] },
  P0128: { description: 'Motor Soğutma Termostatı Arızası (Çok Soğuk)', system: 'Soğutma', severity: 'warning', possibleCauses: ['Termostat açık kalmış', 'Soğutucu sıvı sensörü'] },

  // ── Hava Girişi ──────────────────────────────────────────
  P0100: { description: 'MAF Sensörü Devre Arızası', system: 'Hava Girişi', severity: 'critical', possibleCauses: ['MAF sensörü kirli/arızalı', 'Hava filtresi tıkanık', 'Kablo'] },
  P0101: { description: 'MAF Sensörü Performans Arızası', system: 'Hava Girişi', severity: 'warning', possibleCauses: ['MAF sensörü kirli', 'Hava kaçağı', 'Kablo'] },
  P0112: { description: 'IAT Sensörü Devre Düşük', system: 'Hava Girişi', severity: 'warning', possibleCauses: ['IAT sensörü', 'Kablo kısa devre'] },
  P0113: { description: 'IAT Sensörü Devre Yüksek (Açık)', system: 'Hava Girişi', severity: 'warning', possibleCauses: ['IAT sensörü', 'Kablo açık devre'] },

  // ── Gaz Kelebeği ────────────────────────────────────────
  P0120: { description: 'Gaz Kelebeği Konum Sensörü Devre Arızası', system: 'Motor', severity: 'critical', possibleCauses: ['TPS sensörü', 'Elektronik gaz kelebeği', 'Kablo'] },
  P0121: { description: 'Gaz Kelebeği Konum Sensörü Aralık Dışı', system: 'Motor', severity: 'warning', possibleCauses: ['TPS sensörü', 'Gaz kelebeği gövdesi'] },

  // ── Krank / Eksantrik ────────────────────────────────────
  P0335: { description: 'Krank Mili Konum Sensörü (CKP) Arızası', system: 'Motor', severity: 'critical', possibleCauses: ['CKP sensörü', 'Relüktör çarkı hasar', 'Kablo hasarı'] },
  P0340: { description: 'Eksantrik Mili Konum Sensörü (CMP) Devre Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['CMP sensörü', 'Eksantrik mili', 'Zamanlama zinciri'] },
  P0016: { description: 'Krank-Eksantrik Mili Korelasyon Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Zamanlama zinciri/kayışı', 'VVT valf', 'Motor yağı'] },

  // ── Şanzıman ─────────────────────────────────────────────
  P0700: { description: 'Şanzıman Kontrol Sistemi (TCM) Arızası', system: 'Şanzıman', severity: 'critical', possibleCauses: ['TCM arızası', 'Solenoid valfleri', 'Şanzıman yağı kirli/düşük'] },
  P0715: { description: 'Giriş/Türbin Hız Sensörü Devre Arızası', system: 'Şanzıman', severity: 'warning', possibleCauses: ['Hız sensörü', 'Kablo hasarı'] },
  P0730: { description: 'Yanlış Vites Oranı', system: 'Şanzıman', severity: 'warning', possibleCauses: ['Şanzıman yağı', 'Solenoid', 'Mekanik aşınma'] },
  P0740: { description: 'Tork Konvertör Kilitleme Devresi Arızası', system: 'Şanzıman', severity: 'warning', possibleCauses: ['TCC solenoid', 'Şanzıman yağı', 'Mekanik arıza'] },

  // ── Hız Sensörü ──────────────────────────────────────────
  P0500: { description: 'Araç Hız Sensörü (VSS) Arızası', system: 'Aktarma', severity: 'warning', possibleCauses: ['VSS sensörü', 'ABS modülü', 'Kablo hasarı'] },
  P0501: { description: 'Araç Hız Sensörü Aralık Dışı', system: 'Aktarma', severity: 'warning', possibleCauses: ['VSS sensörü', 'Diferansiyel sensör'] },

  // ── Karoseri (B kodları) ─────────────────────────────────
  B0001: { description: 'Sürücü Hava Yastığı Devre Arızası', system: 'Güvenlik (SRS)', severity: 'critical', possibleCauses: ['Hava yastığı modülü', 'Kontakt sarmal', 'SRS modülü'] },
  B0010: { description: 'Yolcu Hava Yastığı Devre Arızası', system: 'Güvenlik (SRS)', severity: 'critical', possibleCauses: ['Hava yastığı modülü', 'Kablo hasarı', 'SRS modülü'] },
  B1000: { description: 'Elektronik Kontrol Ünitesi (ECU) Dahili Arıza', system: 'Gövde Elektronik', severity: 'critical', possibleCauses: ['ECU arızası', 'Güç beslemesi', 'Toprak bağlantısı'] },

  // ── Şasi / ABS (C kodları) ───────────────────────────────
  C0034: { description: 'Sol Ön ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sol ön)', 'Sensör halkası', 'ABS modülü', 'Kablo'] },
  C0040: { description: 'Sağ Ön ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sağ ön)', 'Sensör halkası', 'Kablo'] },
  C0041: { description: 'Sağ Ön ABS Sensörü Aralık/Performans', system: 'Fren/ABS', severity: 'warning', possibleCauses: ['ABS sensörü kirli', 'Sensör halkası hasar'] },
  C0045: { description: 'Sol Arka ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sol arka)', 'Kablo hasarı'] },
  C0050: { description: 'Sağ Arka ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sağ arka)', 'Kablo hasarı'] },

  // ── Ağ/İletişim (U kodları) ──────────────────────────────
  U0001: { description: 'CAN Veri Yolu Yüksek Hız İletişim Hatası', system: 'CAN Ağı', severity: 'critical', possibleCauses: ['CAN kablosu', 'Terminatör direnci', 'Modül arızası'] },
  U0100: { description: 'ECM/PCM ile CAN İletişim Hatası', system: 'CAN Ağı', severity: 'critical', possibleCauses: ['ECM/PCM', 'CAN veri yolu', 'Güç besleme sorunu'] },
  U0101: { description: 'TCM ile CAN İletişim Hatası', system: 'CAN Ağı', severity: 'warning', possibleCauses: ['TCM modülü', 'CAN kablosu'] },
  U0121: { description: 'ABS Modülü ile İletişim Hatası', system: 'CAN Ağı', severity: 'warning', possibleCauses: ['ABS modülü', 'CAN veri yolu', 'Güç beslemesi'] },
  U0155: { description: 'Gösterge Paneli ile İletişim Hatası', system: 'CAN Ağı', severity: 'info', possibleCauses: ['Gösterge paneli modülü', 'CAN bağlantısı'] },
};

// Hot-core kataloğu senkron kayıt defterine yükle — lookupDtc bu kaynaktan çözer.
// (Mevcut 49 kodun davranışı birebir korunur; lazy kaynaklar ileride eklenir.)
registerDtcCatalog(DTC_DB);

const MOCK_CODES = ['P0171', 'P0420', 'P0300', 'P0128', 'P0455', 'C0034', 'U0100'];

/* ── Module state ────────────────────────────────────────── */

let _state: DTCState = {
  codes: [],
  isReading: false,
  isClearing: false,
  lastReadAt: null,
  error: null,
  isStale: false,
};

const _listeners = new Set<(s: DTCState) => void>();

function _notify(): void {
  const snap = { ..._state, codes: [..._state.codes] };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<DTCState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

/* ── Helpers ─────────────────────────────────────────────── */

/**
 * Ham DTC kodunu tam kayda çözer — çekirdek + kayıtlı (lazy dahil) kaynaklardan.
 * Kaynak bulunamazsa prefix tabanlı dürüst fallback döner ("Bilinmeyen" değil,
 * en azından sistem grubu). Saf/senkron — sesli asistan & bakım beyni de tüketir.
 */
export function lookupDtc(raw: string): DTCCode {
  const code = raw.toUpperCase().trim();
  const entry = resolveDtcRecord(code);
  if (entry) return { code, ...entry };

  const systemMap: Record<string, string> = {
    P: 'Motor/Sürüş', B: 'Karoseri', C: 'Şasi', U: 'Ağ/İletişim',
  };
  const prefix = code[0] ?? 'P';

  return {
    code,
    description: `${systemMap[prefix] ?? 'Bilinmeyen'} Sistemi Arızası`,
    system: systemMap[prefix] ?? 'Bilinmeyen',
    severity: 'warning',
    possibleCauses: ['Yetkili servise danışın'],
  };
}

function _getMockCodes(): DTCCode[] {
  if (Math.random() > 0.35) return []; // 65% chance of no codes
  const n = Math.floor(Math.random() * 3) + 1;
  return MOCK_CODES
    .sort(() => Math.random() - 0.5)
    .slice(0, n)
    .map(lookupDtc);
}

/* ── Public API ──────────────────────────────────────────── */

export async function readDTCCodes(): Promise<void> {
  if (_state.isReading) return;
  _setState({ isReading: true, error: null });

  try {
    if (Capacitor.isNativePlatform()) {
      // Native cihazda gerçek ECU okuma — mock'a asla düşme
      try {
        // Geniş kataloğu (200+) çözümlemeden ÖNCE yükle (fail-soft; hot-core her hâlde hazır)
        await ensureExtendedDtcLoaded();
        const result = await CarLauncher.readDTC();
        const codes = (result.codes ?? []).map(lookupDtc);
        _setState({ codes, isReading: false, lastReadAt: Date.now(), isStale: false });
      } catch (err) {
        // Fix 4: hata durumunda mevcut codes listesi korunur, isStale=true ile işaretlenir.
        // UI "hata okunamadı" ile "hata yok" arasındaki farkı isStale üzerinden ayırt eder.
        // Native nedeni eklenir — "OBD bağlı değil" / "ELM327 hata yanıtı" ayrımı
        // saha teşhisinde kritik (2026-06-11: metot hiç yoktu, hep generic mesajdı).
        const detail = err instanceof Error && err.message ? ` — ${err.message}` : '';
        _setState({
          isReading: false,
          lastReadAt: Date.now(),
          isStale: true,
          error: `Arıza kodu okunamadı${detail || ' — OBD okuyucu yanıt vermiyor veya bu işlemi desteklemiyor'}`,
        });
      }
      return;
    }

    // Yalnızca web/demo modda simüle veri
    await new Promise<void>((r) => setTimeout(r, 1_500));
    _setState({ codes: _getMockCodes(), isReading: false, lastReadAt: Date.now(), isStale: false });

  } catch (err) {
    // Fix 4: beklenmedik hata — codes listesi korunur, isStale=true işaretlenir
    _setState({
      isReading: false,
      isStale: true,
      error: err instanceof Error ? err.message : 'Okuma sırasında hata oluştu',
    });
  }
}

/**
 * OBD-OS-F0-6: DTC hafızasını siler (Mode 04) — WriteGate'ten GEÇMEDEN native'e gitmez.
 *
 * Kapı kanıtını ÇAĞIRANDAN ALMAZ, OBD servisinden kendi okur (`getOBDDataSnapshot`):
 * çağıran "hız 0" diye yalan söyleyemez → salt-okuma vaadi kod düzeyinde zorlanır.
 * Çağırandan alınan TEK şey `confirmed` (kullanıcının açık rızası — bunu yalnız UI bilir).
 *
 * Reddedilirse: native `clearDTC()` ÇAĞRILMAZ, kod listesi KORUNUR, sebep `error`'a yazılır.
 */
export async function clearDTCCodes(opts: { confirmed: boolean }): Promise<WriteGateDecision> {
  const gateDenied = (d: WriteGateDecision): WriteGateDecision => {
    if (!d.allowed) _setState({ isClearing: false, error: d.userMessage });
    return d;
  };

  if (_state.isClearing || _state.codes.length === 0) {
    return { allowed: false, reason: 'not_connected', userMessage: 'Silinecek arıza kodu yok.', advisories: [] };
  }

  // ── WRITE GATE (fail-closed) ────────────────────────────────────────────
  const obd = getOBDDataSnapshot();
  const decision = evaluateDtcClearGate({
    connectionState: obd.connectionState,
    speedKmh:        obd.speed,
    rpm:             obd.rpm,
    lastSeenMs:      obd.lastSeenMs,
    nowMs:           Date.now(),
    confirmed:       opts.confirmed,
  });
  // Web/demo modunda gerçek araç yoktur (native yazma da yapılmaz) → kapı yalnız
  // native'de zorunlu. Bu, tarayıcı demosunu bozmadan sahadaki yazmayı korur.
  if (!decision.allowed && Capacitor.isNativePlatform()) return gateDenied(decision);

  _setState({ isClearing: true, error: null });

  try {
    if (Capacitor.isNativePlatform()) {
      // Native: gerçek ECU temizleme denenir. BAŞARISIZSA UI listesi TEMİZLENMEZ —
      // aksi halde kullanıcı kodların araçtan silindiğini sanır (veri bütünlüğü hatası).
      try {
        await CarLauncher.clearDTC();
      } catch (e) {
        logError('DTC:NativeClearFailed', e);
        _setState({
          isClearing: false,
          isStale:    true,
          error:      'Arıza kodları araçtan silinemedi — OBD okuyucu bu işlemi desteklemiyor olabilir',
        });
        return decision; // codes listesi KORUNUR — yalancı temizleme yok
      }
    }

    // Native başarılı veya web/demo modu → onay gecikmesi + listeyi temizle
    await new Promise<void>((r) => setTimeout(r, 2_000));
    _setState({ codes: [], isClearing: false, lastReadAt: Date.now() });

  } catch (err) {
    _setState({
      isClearing: false,
      error: err instanceof Error ? err.message : 'Silme sırasında hata oluştu',
    });
  }
  return decision;
}

/**
 * Patch 11A: kayıtlı (Mode 03) + bekleyen (Mode 07) + kalıcı (Mode 0A) arıza kodlarını
 * TEK çağrıda okur. Her mod BAĞIMSIZ dener (fail-soft) — biri hata verirse/eski native
 * plugin'de yoksa diğerleri yine döner. Web/demo modda boş sonuç (bu API yalnız native
 * cihazda anlamlı; mock akışı readDTCCodes() üzerinden ayrı yürür).
 *
 * DTCState/readDTCCodes() modül durumuna DOKUNMAZ — bağımsız, saf-async bir okuma
 * yüzeyi (gelecekte sesli asistan/bakım beyni de aynı API'yi tüketecek).
 */
export async function readAllDTCs(): Promise<ReadAllDTCsResult> {
  if (!Capacitor.isNativePlatform()) {
    // Web/demo: gerçek okuma yok → bilinçli boş, "tam" sayılır (belirsizlik üretmez).
    return { codes: [], permanentSupported: true, completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' } };
  }

  await ensureExtendedDtcLoaded(); // 200+ katalog hazır (fail-soft)

  const codes: DTCCodeWithStatus[] = [];
  let permanentSupported = true;
  // OBD-OS-F0-1: mod-bazlı okuma sonucu — hata olan mod 'failed' işaretlenir → verdi belirsizleşir.
  const completeness: DtcScanCompleteness = { stored: 'ok', pending: 'ok', permanent: 'ok' };

  try {
    const r = await CarLauncher.readDTC();
    (r.codes ?? []).forEach((c) => codes.push({ ...lookupDtc(c), status: 'stored' }));
  } catch (e) {
    logError('DTC:ReadAllStoredFailed', e);
    completeness.stored = 'failed';
  }

  try {
    if (CarLauncher.readPendingDTC) {
      const r = await CarLauncher.readPendingDTC();
      (r.codes ?? []).forEach((c) => codes.push({ ...lookupDtc(c), status: 'pending' }));
    } else {
      completeness.pending = 'unsupported'; // eski native plugin — Mode 07 metodu yok
    }
  } catch (e) {
    logError('DTC:ReadAllPendingFailed', e);
    completeness.pending = 'failed';
  }

  try {
    if (CarLauncher.readPermanentDTC) {
      const r = await CarLauncher.readPermanentDTC();
      permanentSupported = r.supported;
      if (r.supported) (r.codes ?? []).forEach((c) => codes.push({ ...lookupDtc(c), status: 'permanent' }));
      // supported:false → mod desteklenmiyor (dürüst), okuma yine BAŞARILI (completeness 'ok').
    } else {
      // Eski native plugin — metod hiç yok, "desteklenmiyor" sayılır (dürüst varsayılan).
      permanentSupported = false;
      completeness.permanent = 'unsupported';
    }
  } catch (e) {
    logError('DTC:ReadAllPermanentFailed', e);
    permanentSupported = false;
    completeness.permanent = 'failed';
  }

  return { codes, permanentSupported, completeness };
}

/**
 * Patch 11B: Mode 02 freeze frame — arızayı tetikleyen DTC + o anki PID anlık görüntüsü.
 * Formül çözümlemesi StandardPidRegistry.decode İLE AYNI (Mode 01/02 formülleri özdeş) —
 * native yalnız ham baytı döner, kopya formül YOK. Her PID bağımsız denenir (fail-soft):
 * araç bir PID'i freeze frame'de desteklemiyorsa yalnız o PID atlanır, diğerleri gelir.
 *
 * @returns null = freeze frame yok / araç desteklemiyor / eski native plugin.
 */
export async function readFreezeFrame(): Promise<FreezeFrameResult | null> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.readFreezeFrameDtc) return null;

  try {
    const { dtc } = await CarLauncher.readFreezeFrameDtc();
    if (!dtc) return null; // freeze frame kayıtlı değil

    const values: FreezeFrameValue[] = [];
    if (CarLauncher.readFreezeFramePid) {
      // F1-3: sabit 7 PID yerine ARACIN DESTEKLEDİĞİ set (kanıt varsa). Kanıt yoksa taban.
      for (const pid of selectFreezeFramePids(getSupportedPids())) {
        try {
          const { data } = await CarLauncher.readFreezeFramePid({ pid });
          if (!data) continue; // NO DATA/desteklenmiyor — bu PID atlanır, tarama durmaz
          const value = decodeStandardPid(pid, data);
          if (Number.isNaN(value)) continue;
          const def = STANDARD_PID_MAP.get(pid);
          if (!def) continue;
          values.push({ pid, name: def.name, value, unit: def.unit });
        } catch (e) {
          logError('DTC:FreezeFramePidFailed', e); // tek PID hatası diğerlerini engellemez
        }
      }
    }
    return { dtc, values };
  } catch (e) {
    logError('DTC:FreezeFrameFailed', e);
    return null;
  }
}

export function onDTCState(fn: (s: DTCState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state, codes: [..._state.codes] });
  return () => { _listeners.delete(fn); };
}

/** Tanı raporu için anlık DTC durumu (kopya — dış mutasyona kapalı). */
export function getDTCStateSnapshot(): DTCState {
  return { ..._state, codes: [..._state.codes] };
}

export function useDTCState(): DTCState {
  const [s, setS] = useState<DTCState>({ ..._state, codes: [..._state.codes] });
  useEffect(() => onDTCState(setS), []);
  return s;
}

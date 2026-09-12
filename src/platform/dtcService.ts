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
import { vdkDtcClassFn, isReplayActive } from './obd/vdkTransport';
import { resolveFunctionalDtcSource } from './obd/functionalDtcSource';
import { recordFunctionalDtcEvidence } from './obd/functionalDtcEvidence';
import { logError } from './crashLogger';
import { getOBDDataSnapshot, getObdSessionEpoch } from './obdService';
import { evaluateDtcClearGate, type WriteGateDecision } from './obd/writeGate';
/* ARCH-05 — CLEAR_DTC ürün yaptırımı. Write gate FİZİKSEL önkoşulu (hız ·
   tazelik · bağlantı), authorization ise ÇAĞIRANIN YETKİSİNİ denetler; ikisi
   AYRI sorulardır ve biri diğerinin yerine GEÇMEZ. */
import { authorizeOperation, revalidateAuthorization } from './security/enforcement';
import type { SecurityPrincipalClass, ChannelEvidence } from './security/enforcement';
import './security/securityWiring';
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
import { recordDtcEvidence, type DtcReadOutcome } from './obd/dtcScanEvidence';
import { DTC_SERVICE_OF_CLASS, DTC_CLASS_OF_STATUS } from './obd/dtcClassModel';
import {
  classifyClearResponse, describeClearNrc, evaluateClearVerdict, isClearSuccessVerdict,
  DTC_CLEAR_OUTCOME_LABEL, DTC_CLEAR_VERDICT_MESSAGE,
  type ClearObservedCode, type DtcClearCommandOutcome, type DtcClearVerdict,
} from './obd/dtcClearModel';
import { recordDtcClearAttempt, type DtcClearRereadClass } from './obd/dtcClearEvidence';
import {
  beginDtcScanRound, recordDtcObservation, recordDtcServiceScan,
  DTC_CLASS_OF_SERVICE_CANON, type DtcScanOutcome, type DtcSourceService,
} from './obd/dtcAuthority';
import { getDiagnosticAdmission } from './obd/diagnosticAdmission';
import {
  acceptResponse, beginTransaction, completeTransaction, consumeRequest, prepareTransaction,
} from './obd/diagnosticTransaction';
import { traceFromTransaction, traceTransactionBoundary } from './obd/traceRecorder';
import { classifyDtcReadResponse } from './obd/dtcOutcomeSemantics';

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
  /**
   * P0-OBD-09 — kodun geldiği ECU. Fonksiyonel adres (7DF) okumasında `null`
   * KALIR — adresten ECU UYDURULMAZ.
   */
  ecuLabel?: string | null;
  /** Kodun ait olduğu OBD oturumu (session epoch). Bilinmiyorsa `null`. */
  sessionEpoch?: number | null;
}

/**
 * OBD-OS-F0-1: her modun okuma SONUCU — fail-closed verdi için. 'ok' = okuma başarılı
 * (boş liste de başarıdır); 'failed' = gerçek hata/timeout (tarama KISMİ kalır); 'unsupported'
 * = araç/adaptör o modu hiç bildirmiyor (hata DEĞİL, belirsizlik yapmaz).
 *
 * P0-OBD-CORE-05: `'deferred'` — admisyon kapısı (bkz. `obd/diagnosticAdmission.ts`) bu
 * turda sorguyu HİÇ GÖNDERMEDİ (KWP recovery/reconnect/session-not-ready sürüyor).
 * `'failed'` İLE KARIŞTIRILMAZ: `failed` "denendi ve düştü" demektir, `deferred`
 * "denenmedi, ECU'ya tek bayt gitmedi" demektir — ikisi AYNI kovaya atılırsa hem
 * "ECU/adaptör arızalı" yalancı alarmı üretir hem de recovery bitince otomatik
 * düzelecek bir durumu kalıcı hata gibi gösterir.
 */
export type DtcScanModeOutcome = 'ok' | 'failed' | 'unsupported' | 'no_response' | 'deferred';

export interface DtcScanCompleteness {
  stored:    DtcScanModeOutcome;
  pending:   DtcScanModeOutcome;
  permanent: DtcScanModeOutcome;
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
/**
 * P0-OBD-DIAG-02 — kodun AÇIKLAMASI KATALOGDAN mı geldi (SAF).
 *
 * `lookupDtc` katalogda olmayan kod için SAE J2012 ön ekinden ("P" → Motor)
 * TÜRETİLMİŞ genel bir cümle üretir. Bu türetme meşrudur ama bir TANIM DEĞİLDİR
 * ve üretici kodlarında (Renault DF… sınıfı, P1xxx) neredeyse her zaman devreye
 * girer. UI ikisini AYIRT ETMEK ZORUNDADIR: türetilmiş cümleyi katalog tanımı
 * gibi göstermek, kullanıcıya bilmediğimiz bir arızayı biliyormuş gibi sunmaktır.
 */
export function isKnownDtcCode(raw: string): boolean {
  try { return resolveDtcRecord((raw ?? '').toUpperCase().trim()) !== undefined; }
  catch { return false; }
}

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
 * P0-OBD-10 — SİLİNEBİLİR KOD ENVANTERİ.
 *
 * ÖLÇÜLEN KUSUR: silme önkoşulu YALNIZ `_state.codes`e (Mode 03 / onaylanmış)
 * bakıyordu. Gerçek araçta tek arıza P0089 **BEKLEYEN (Mode 07)** idi; o liste
 * `readAllDTCs()` sonucunda yaşıyor ve `_state`e HİÇ girmiyordu → hem düğme
 * pasif kalıyor hem servis erken dönüyordu: **ECU'ya tek bayt gitmiyordu.**
 *
 * Bu alan o boşluğu kapatır: son tam taramanın (03+07+0A) sonucu burada durur.
 * `DTCState.codes` sözleşmesi (Mode 03) DEĞİŞMEDİ — regresyon kilitleri aynen
 * geçerlidir; bu AYRI bir alandır, ikinci otorite değil aynı okumanın kaydı.
 */
let _lastScan: {
  codes: DTCCodeWithStatus[];
  completeness: DtcScanCompleteness;
  atMs: number;
  sessionEpoch: number;
} | null = null;

/** Yeni OBD oturumunda son tarama düşer — eski kodlar yeni oturuma TAŞINMAZ. */
function _dropScanIfOtherSession(epoch: number): void {
  if (_lastScan !== null && _lastScan.sessionEpoch !== epoch) _lastScan = null;
}

/**
 * P0-OBD-CORE-05 — admisyon kapısı REDDETTİĞİNDE dönülen sonuç.
 *
 * `_lastScan` BİLİNÇLİ OLARAK DEĞİŞTİRİLMEZ (bu turun otoritesi YOKTUR — ECU'ya
 * hiç sorgu gitmedi). Yalnız BAŞKA oturumun bayat kaydı elenir (aynı kural her
 * okuma yolunda geçerli — bir adaptör başka araca takılmışsa eski tur asla
 * gösterilmez). `completeness` her üç mod için 'deferred'dir: `DTC_READ_FAILED`
 * ÜRETİLMEZ, "denendi ve düştü" ile "hiç denenmedi" KARIŞTIRILMAZ.
 */
function _deferredReadAllDTCsResult(sessionEpoch: number): ReadAllDTCsResult {
  _dropScanIfOtherSession(sessionEpoch);
  const priorPermanentOk = _lastScan !== null && _lastScan.sessionEpoch === sessionEpoch
    ? _lastScan.completeness.permanent === 'ok'
    : true; // ölçülmedi — mevcut optimistik varsayılan (regresyonsuz) korunur
  return {
    codes: [],
    permanentSupported: priorPermanentOk,
    completeness: { stored: 'deferred', pending: 'deferred', permanent: 'deferred' },
  };
}

/**
 * Mode 04 ile SİLİNEBİLİR kodların anlık envanteri (stored + pending).
 *
 * KALICI (Mode 0A) bilinçli olarak DIŞARIDADIR: SAE J1979'a göre kalıcı kod
 * Mode 04 ile silinmez, ECU koşullar sağlanınca kendi temizler. Onu envantere
 * katmak, silinemeyecek bir kod için düğme açıp sonra "silinemedi" demek olurdu.
 */
export function getClearableDtcSnapshot(): {
  codes: DTCCodeWithStatus[];
  count: number;
  scanRan: boolean;
} {
  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { epoch = -1; }
  _dropScanIfOtherSession(epoch);

  const byKey = new Map<string, DTCCodeWithStatus>();
  // Mode 03 akışı (regresyon-kilitli) her zaman envanterin parçasıdır.
  for (const c of _state.codes) byKey.set(`${c.code}|stored`, { ...c, status: 'stored' });
  for (const c of _lastScan?.codes ?? []) {
    if (c.status === 'permanent') continue;
    byKey.set(`${c.code}|${c.status}`, c);
  }
  return {
    codes: [...byKey.values()],
    count: byKey.size,
    scanRan: _lastScan !== null || _state.lastReadAt !== null,
  };
}

/** Son tam taramanın (03/07/0A) kapsamı; hiç tarama yapılmadıysa `null`. */
export function getLastScanCompleteness(): DtcScanCompleteness | null {
  return _lastScan?.completeness ?? null;
}

/** Test izolasyonu — modül durumunu sıfırlar. */
export function _resetDtcServiceForTest(): void {
  _state = { codes: [], isReading: false, isClearing: false, lastReadAt: null, error: null, isStale: false };
  _lastScan = null;
}

/** `clearDTCCodes` dönüşü — kapı kararı + (varsa) ÖLÇÜLEN silme raporu. */
export type DtcClearResult = WriteGateDecision & {
  /**
   * Silme denemesinin ölçülen sonucu. `null` YALNIZ kapı reddettiğinde veya
   * silinecek kod olmadığında olur — yani ECU'ya komut hiç gitmediğinde.
   */
  clear: DtcClearReport | null;
};

export interface DtcClearReport {
  readonly verdict: DtcClearVerdict;
  readonly commandOutcome: DtcClearCommandOutcome;
  /** Kullanıcıya söylenecek DÜRÜST cümle — UI/sesli asistan bunu ELLE yazmaz. */
  readonly userMessage: string;
  /** Hüküm "temizlendi" demeye izin veriyor mu. */
  readonly success: boolean;
  readonly removed: readonly string[];
  readonly remaining: readonly string[];
  readonly returned: readonly string[];
  readonly permanentRemaining: readonly string[];
  /** Silme sonrası yeniden okuma yapıldı mı (yapılmadıysa hüküm DOĞRULANAMADI). */
  readonly rereadRan: boolean;
}

/** `clearDTCCodes` çağıran KİMLİĞİ — varsayılan, baş ünitedeki kullanıcıdır. */
export interface ClearDtcOptions {
  /** İki aşamalı UI onayı verildi mi (write gate girdisi). */
  readonly confirmed: boolean;
  /**
   * ARCH-05 principal sınıfı. Varsayılan `LOCAL_UI`: fiziksel olarak baş
   * ünitenin başındaki kullanıcı. Sesli asistan (`MAVI`) ve uzak kanal
   * (`PHONE_REMOTE`) KENDİ sınıflarını vermek ZORUNDADIR — varsayılana
   * yaslanmak sessizce ayrıcalık kazanmak olurdu.
   */
  readonly principal?: SecurityPrincipalClass;
  /** Kanalın KENDİ ölçtüğü kanıt (E2E doğrulaması, oturum nesli…). */
  readonly channel?: ChannelEvidence;
  /** ARCH-03 operasyon kimliği; verilmezse oturum/zaman türetilir. */
  readonly operationId?: string;
}

/**
 * OBD-OS-F0-6 + P0-OBD-10: DTC hafızasını siler (Mode 04).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BAŞARI SÖZLEŞMESİ (bu turun özü) ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * **"Komut gönderildi" ASLA "kod silindi" DEĞİLDİR.** Başarı YALNIZ iki
 * ölçümün birlikte sağlanmasıyla ilan edilir:
 *   (1) ECU'nun Mode 04'e verdiği POZİTİF yanıt (SID 0x44, çift hizada), VE
 *   (2) silme sonrası 03/07/0A YENİDEN OKUMASI (kodlar gerçekten gitti mi).
 * Yeniden okuma düşerse hüküm "silindi" değil **DOĞRULANAMADI**dır.
 *
 * ÖNCEKİ DAVRANIŞ (kusur): `await CarLauncher.clearDTC()` istisna fırlatmadıysa
 * `codes: []` yazılıyordu — ekran temizleniyor, araçta kod duruyordu.
 *
 * Kapı kanıtını ÇAĞIRANDAN ALMAZ, OBD servisinden kendi okur (`getOBDDataSnapshot`):
 * çağıran "hız 0" diye yalan söyleyemez. Çağırandan alınan TEK şey `confirmed`.
 */
export async function clearDTCCodes(opts: ClearDtcOptions): Promise<DtcClearResult> {
  let sessionEpoch = -1;
  try { sessionEpoch = getObdSessionEpoch(); } catch { sessionEpoch = -1; }

  /* ── ARCH-05 · YETKİ KAPISI (write gate'ten AYRI ve ONDAN ÖNCE) ─────────
     Write gate "araç fiziksel olarak uygun mu" diye sorar; bu kapı "BU ÇAĞIRAN
     silebilir mi" diye sorar. İkisi ayrı sorulardır: hareketsiz bir araçta
     yetkisiz bir çağıran hâlâ silememelidir. Yetki kararı `operationId` ile
     ARCH-03 operasyonuna bağlanır; başka bir operasyona TAŞINAMAZ. */
  const principalClass: SecurityPrincipalClass = opts.principal ?? 'LOCAL_UI';
  const operationId = opts.operationId ?? `dtc.clear:${sessionEpoch}:${Date.now()}`;
  const authorization = authorizeOperation({
    principalClass, capability: 'CLEAR_DTC', operationId,
    targetRef: 'dtc:memory', channel: opts.channel,
    /* Native yüzey kanıtını ALAN SAHİBİ ölçer: silme köprüsü GERÇEKTEN var mı.
       Genel bir izin okuyucusu burada ikinci bir gerçek üretirdi; köprünün
       varlığı ise doğrudan ve yanılmaz bir ölçümdür. Yokluğu `false`tur —
       "belki vardır" YOKTUR. */
    nativePermission: typeof CarLauncher.clearDtcCodes === 'function'
      || typeof CarLauncher.clearDTC === 'function',
  });

  const inventory = getClearableDtcSnapshot();
  const before: ClearObservedCode[] = inventory.codes.map((c) => ({ code: c.code, status: c.status }));
  const beforeLabels = inventory.codes.map((c) => `${c.code}/${c.status}`);

  const gateDenied = (d: WriteGateDecision): DtcClearResult => {
    if (!d.allowed) {
      _setState({ isClearing: false, error: d.userMessage });
      recordDtcClearAttempt({
        tx: null, raw: null, commandOutcome: null, nrc: null, protocol: null,
        scope: 'functional_7DF', elapsedMs: null,
        gateAllowed: false,
        gateDenyReason: d.allowed ? null : d.reason,
        before: beforeLabels, reread: [], rereadCompleteness: null,
        verdict: 'DENIED', removed: [], remaining: [], returned: [], permanentRemaining: [],
        sessionEpoch, error: null,
      });
    }
    return { ...d, clear: null };
  };

  if (_state.isClearing || inventory.count === 0) {
    return {
      allowed: false, reason: 'not_connected',
      userMessage: 'Silinecek arıza kodu yok.', advisories: [], clear: null,
    };
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

  /* ── ARCH-05 YETKİ REDDİ → ECU'YA TEK BAYT GİTMEZ ─────────────────────
     SIRA BİLİNÇLİDİR: write gate FİZİKSEL önkoşulu sorar ve kullanıcıya çok
     daha eyleme dönük bir cümle verir ("araç hareket halinde"); yetki kapısı
     ondan SONRA ama HER TÜRLÜ yan etkiden ÖNCE gelir. İkisi de native çağrının
     önündedir, dolayısıyla "deny ⇒ sıfır yan etki" iddiası her iki sırada da
     doğrudur — ama gerekçe dürüstlüğü bu sırayla daha yüksektir.
     Kapı native platformda ZORUNLUDUR (write gate ile AYNI kapsam kuralı:
     tarayıcı demosunda gerçek araç ve gerçek yazma yoktur). Reddedilen çağrı
     `isClearing` bayrağını KURMAZ ve kanıt defterine DENIED yazar. */
  if (!authorization.allowed && Capacitor.isNativePlatform()) {
    return gateDenied({
      allowed: false, reason: 'not_authorized', advisories: decision.advisories,
      userMessage: 'Bu işlem için yetki yok — arıza hafızası silinmedi.',
    });
  }

  _setState({ isClearing: true, error: null });

  /* ── Web/demo yolu: gerçek araç YOK → ECU'ya komut GİTMEZ, kanıt YAZILMAZ.
       Mevcut demo davranışı (listeyi boşalt) AYNEN korunur. */
  if (!Capacitor.isNativePlatform()) {
    await new Promise<void>((r) => setTimeout(r, 2_000));
    _setState({ codes: [], isClearing: false, lastReadAt: Date.now() });
    _lastScan = null;
    return { ...decision, clear: null };
  }

  /* ── 1) MODE 04 — KANITLI GÖNDERİM ────────────────────────────────────── */
  let commandOutcome: DtcClearCommandOutcome = 'UNKNOWN';
  let raw: string | null = null;
  let nrc: string | null = null;
  let protocol: string | null = null;
  let elapsedMs: number | null = null;
  let transportError: string | null = null;

  /* ── ARCH-05 TOCTOU · YAN ETKİDEN HEMEN ÖNCE YENİDEN DOĞRULAMA ────────
     Yetkilendirme ile bu satır arasında araç değişmiş, oturum nesli ilerlemiş,
     hareket kanıtı bozulmuş ya da yetki geri alınmış olabilir. Karar YENİDEN
     ÜRETİLMEZ; hâlâ AYNI dünyaya ait olduğu doğrulanır. Değiştiyse komut
     GİTMEZ. */
  if (Capacitor.isNativePlatform() && !revalidateAuthorization(authorization, opts.channel)) {
    _setState({ isClearing: false });
    return gateDenied({
      allowed: false, reason: 'not_authorized', advisories: decision.advisories,
      userMessage: 'Yetki bağlamı değişti — arıza hafızası silinmedi.',
    });
  }

  try {
    if (CarLauncher.clearDtcCodes) {
      // Yeni yol: ECU'nun OLUMSUZ cevabı istisna DEĞİLDİR — kanıt olarak döner.
      const r = await CarLauncher.clearDtcCodes();
      raw           = typeof r.raw === 'string' ? r.raw : null;
      nrc           = typeof r.nrc === 'string' ? r.nrc : null;
      protocol      = typeof r.protocol === 'string' ? r.protocol : null;
      elapsedMs     = typeof r.elapsedMs === 'number' ? r.elapsedMs : null;
      commandOutcome = isClearCommandOutcome(r.outcome)
        ? r.outcome
        // Native tanınmayan bir sınıf döndüyse HÜKÜM UYDURULMAZ; ham yanıt
        // elimizde olduğu için AYNI kurallarla TS tarafında sınıflandırılır.
        : classifyClearResponse(raw).outcome;
      if (commandOutcome === 'NEGATIVE' && nrc === null) nrc = classifyClearResponse(raw).nrc;
    } else {
      /* Geri-uyumluluk: eski native plugin `clearDtcCodes` taşımıyor. Ham yanıt
         YOKTUR → `raw` null KALIR (boş string "ham geldi ama boştu" demek olurdu).
         Eski metot yalnız resolve/reject taşır; reject "ECU onay vermedi" olabilir. */
      await CarLauncher.clearDTC();
      commandOutcome = 'POSITIVE';
    }
  } catch (e) {
    logError('DTC:NativeClearFailed', e);
    transportError = e instanceof Error ? e.message : String(e);
    // Eski yolun "ECU silme onayı vermedi" reddi bir TAŞIMA hatası DEĞİLDİR;
    // ham yanıt taşımadığı için en dürüst sınıf UNKNOWN'dır (hüküm verilmez).
    commandOutcome = CarLauncher.clearDtcCodes ? 'TRANSPORT_ERROR' : 'UNKNOWN';
  }

  /* ── 2) SİLME SONRASI YENİDEN OKUMA — hükümün ZORUNLU kanıtı ──────────── */
  let after: ClearObservedCode[] | null = null;
  let afterCompleteness: DtcScanCompleteness | null = null;
  const reread: DtcClearRereadClass[] = [];

  if (commandOutcome === 'POSITIVE') {
    try {
      const scan = await readAllDTCs();
      after = scan.codes.map((c) => ({ code: c.code, status: c.status }));
      afterCompleteness = scan.completeness;
      for (const [service, status, outcome] of [
        ['03', 'stored',    scan.completeness.stored]    as const,
        ['07', 'pending',   scan.completeness.pending]   as const,
        ['0A', 'permanent', scan.completeness.permanent] as const,
      ]) {
        reread.push({
          service,
          codes: scan.codes.filter((c) => c.status === status).map((c) => c.code),
          outcome,
        });
      }
    } catch (e) {
      logError('DTC:ClearRereadFailed', e);
      after = null;
      afterCompleteness = null;
    }
  }

  /* ── 3) HÜKÜM — saf modelde, tek yerde ────────────────────────────────── */
  const verdictResult = evaluateClearVerdict({ outcome: commandOutcome, before, after, afterCompleteness });
  const verdict = verdictResult.verdict;
  const success = isClearSuccessVerdict(verdict);

  let userMessage = DTC_CLEAR_VERDICT_MESSAGE[verdict];
  if (verdict === 'COMMAND_FAILED') {
    const detail = commandOutcome === 'NEGATIVE'
      ? describeClearNrc(nrc)
      : commandOutcome === 'TRANSPORT_ERROR' ? transportError : null;
    userMessage = `${userMessage} (${DTC_CLEAR_OUTCOME_LABEL[commandOutcome]}${detail ? ` — ${detail}` : ''})`;
  }

  recordDtcClearAttempt({
    tx: '04', raw, commandOutcome, nrc, protocol,
    scope: 'functional_7DF', elapsedMs,
    gateAllowed: true, gateDenyReason: null,
    before: beforeLabels,
    reread, rereadCompleteness: afterCompleteness,
    verdict,
    removed: verdictResult.removed,
    remaining: verdictResult.remaining,
    returned: verdictResult.returned,
    permanentRemaining: verdictResult.permanentRemaining,
    sessionEpoch,
    error: transportError,
  });

  /* ── 4) DURUM — ÖLÇÜMDEN yazılır, körlemesine boşaltılmaz ───────────────
     KAPI: yeniden okuma YAPILMIŞ olması yetmez, GÜVENİLİR de olmalı. Hüküm
     DOĞRULANAMADI ise (bir mod düştü) o okuma OTORİTE SAYILMAZ — liste korunur
     ve BAYAT işaretlenir. Kısmi bir okumadan "temizlendi" çıkarmak, bu turun
     kapattığı yalancı-temizlik sınıfının ta kendisidir. */
  const rereadTrusted = after !== null && verdict !== 'UNVERIFIED';
  if (rereadTrusted) {
    // Yeniden okuma OTORİTEDİR: Mode 03 listesi ölçülen sonuçtan kurulur.
    // Bayat oturum/cache kodu buraya SIZAMAZ — liste taze taramanın kendisidir.
    _setState({
      codes: (_lastScan?.codes ?? []).filter((c) => c.status === 'stored').map((c) => ({ ...c })),
      isClearing: false,
      lastReadAt: Date.now(),
      isStale: false,
      error: success ? null : userMessage,
    });
  } else {
    // Doğrulama yapılamadı → liste KORUNUR ve BAYAT işaretlenir. Yalancı temizlik YOK.
    _setState({ isClearing: false, isStale: true, error: userMessage });
  }

  return {
    ...decision,
    clear: {
      verdict, commandOutcome, userMessage, success,
      removed: verdictResult.removed,
      remaining: verdictResult.remaining,
      returned: verdictResult.returned,
      permanentRemaining: verdictResult.permanentRemaining,
      rereadRan: after !== null,
    },
  };
}

/** Native'den gelen `outcome` bilinen sözlükte mi — bilinmeyeni kabul ETMEYİZ. */
function isClearCommandOutcome(v: unknown): v is DtcClearCommandOutcome {
  return v === 'POSITIVE' || v === 'NEGATIVE' || v === 'NO_DATA' || v === 'NO_RESPONSE'
      || v === 'BUS_ERROR' || v === 'UNSUPPORTED' || v === 'UNKNOWN' || v === 'TRANSPORT_ERROR';
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

  /* P0-OBD-09 — OTURUM MÜHRÜ. Her kod hangi OBD oturumunda okunduğunu taşır;
     yeniden bağlanma / araç değişimi sonrası eski kodlar yeni oturuma
     KARIŞAMAZ (bkz. dtcClassModel.mergeDtcObservations). Epoch okunamazsa
     `-1` taşınır — sahte 0 YASAK. */
  /* ── P0-VDK-F1A · KANONİK TANI İŞLEMİ ────────────────────────────────────
     Epoch mühürleme + admisyon kapısı + bütçe + iptal + geç-yanıt koruması
     ARTIK TEK YERDE (`diagnosticTransaction`). Bu blok eskiden her tanı
     girişinde ELLE kopyalanıyordu; kopyalanan her satır bir kusur adayıydı.
     İKİNCİ OTORİTE KURULMADI: epoch hâlâ `obdService`, admisyon hâlâ
     `diagnosticAdmission` tekelindedir — işlem yalnız onları ÇAĞIRIR. */
  const txn = beginTransaction({ purpose: 'dtc_scan' });

  /* P0-OBD-CORE-05 — ADMİSYON KAPISI. "Transport connected" TEK BAŞINA yeterli
     değildir: KWP recovery/reconnect sürerken bu sorgular hatta çıkarsa saha
     kanıtı `ReadAll_03_Failed`/`ReadAll_07_Failed`/`ReadAll_0A_Failed` gibi
     KALICI hata izlenimi bırakır — oysa recovery bitince AYNI sorgu normal
     cevaplar. Kapı REDDEDERSE ECU'ya TEK BAYT GİTMEZ: `_lastScan` (varsa)
     bu turun DIŞINDA kalır ve AYNEN korunur — dtcAuthority (kanonik otorite)
     de bu turda GÜNCELLENMEZ ("sorulmadı" ile "soruldu, 0 kod" karışmasın).
     Çalışan bir queue komutu PREEMPT EDİLMEZ — yalnız bu YENİ turun
     BAŞLAMASI ertelenir; ikinci bir reconnect/recovery otoritesi KURULMAZ. */
  const prepared = await prepareTransaction(txn);
  const sessionEpoch = txn.sessionEpoch;
  if (!prepared.ok) {
    return _deferredReadAllDTCsResult(sessionEpoch);
  }
  traceTransactionBoundary(txn, 'begin');

  /* P0-OBD-CORE-03 — TUR TEMİZLİĞİ. Aynı oturumda ikinci bir tarama (ör. silme
     sonrası yeniden okuma) artık OLMAYAN kodları defterde bırakırsa ekran
     "kod hâlâ var" der. Gözlemler tur başında düşer; servis sonuçları KORUNUR
     (her servis kendi sonucunu yeniden yazar). */
  beginDtcScanRound(sessionEpoch);

  const codes: DTCCodeWithStatus[] = [];
  let permanentSupported = true;
  // OBD-OS-F0-1: mod-bazlı okuma sonucu — hata olan mod 'failed' işaretlenir → verdi belirsizleşir.
  const completeness: DtcScanCompleteness = { stored: 'ok', pending: 'ok', permanent: 'ok' };

  /**
   * P0-OBD-09 — TEK SINIF okur ve KANIT yazar.
   *
   * Öncelik: yeni `readDtcClass` (HAM yanıtı da taşır) → yoksa eski metot.
   * Eski metot yolunda ham YOKTUR ve `raw: null` yazılır — boş string yazmak
   * "ham geldi ama boştu" demek olurdu (sahte kanıt).
   */
  async function readClass(
    status: DTCStatus,
    legacy: () => Promise<{ codes: string[]; supported?: boolean } | null>,
  ): Promise<{ outcome: DtcReadOutcome; codes: string[] }> {
    const service = DTC_SERVICE_OF_CLASS[DTC_CLASS_OF_STATUS[status]];
    /* ── P0-VDK-F1A · BÜTÇE KAPISI ────────────────────────────────────────
       Hakkımız yoksa (iptal · süre/istek bütçesi · bayat oturum) ECU'ya TEK
       BAYT GİTMEZ. Sonuç `failed` DEĞİL: sorgu HİÇ GÖNDERİLMEDİ ve bunu
       "okuma düştü" saymak kapsam kaybını YANLIŞ yere yazardı. Mevcut
       'unsupported' sınıfı da uygun değil ("ECU bilmiyor" demek olurdu) —
       bu yüzden mevcut `deferred` semantiği kullanılır. */
    if (!consumeRequest(txn)) {
      recordDtcEvidence({
        service, outcome: 'deferred', sessionEpoch, raw: null, protocol: null,
        error: `işlem bütçesi/canlılığı reddetti: ${txn.lastDenial ?? 'UNKNOWN'}`,
      });
      return { outcome: 'deferred', codes: [] };
    }
    try {
      let got: string[] = [];
      let raw: string | null = null;
      let supported = true;
      let protocol: string | null = null;
      let elapsedMs: number | null = null;
      let recoveryCount: number | null = null;

      /* P0-VDK-F2B — TAŞIMA KAPISI (canlı araç ya da doğrulanmış iz). Bu
         satırın altındaki hiçbir kural Real/Virtual farkını BİLMEZ. */
      const classFn = vdkDtcClassFn();
      if (classFn) {
        const r = await classFn({ mode: service });
        got = r.codes ?? [];
        raw = typeof r.raw === 'string' ? r.raw : null;
        supported = r.supported !== false;
        protocol  = typeof r.protocol === 'string' ? r.protocol : null;
        elapsedMs = typeof r.elapsedMs === 'number' ? r.elapsedMs : null;
        recoveryCount = typeof r.recoveryCount === 'number' ? r.recoveryCount : null;

        /* P0-OBD-11 — NATIVE SINIFI OTORITEDIR.
           "NO DATA" (ECU SUSTU) ile "43 00" (ECU cevap verdi, kod yok) ayrimini
           YALNIZ native olcebilir; `supported` bunu tasiyamaz (ikisi de true idi).
           Eski plugin bu alani tasimiyorsa asagidaki geri-uyumluluk yolu isler. */
        const nativeOutcome = mapNativeClassOutcome(r.outcome);
        if (nativeOutcome !== null && nativeOutcome !== 'ok') {
          recordDtcEvidence({
            service, outcome: nativeOutcome, sessionEpoch, raw,
            protocol, elapsedMs, recoveryCount,
            error: nativeOutcome === 'failed' ? `ELM sinifi: ${String(r.outcome)}` : null,
          });
          /* Başarısız okuma da KANONİK OTORİTEYE yazılır — "0 kod" hükmü
             ancak `ok` taramadan doğar; sessizlik defterde GÖRÜNÜR kalmalı.
             P0-OBD-CORE-05 — `diagnosticOutcome`: HAM yanıttan türeyen zengin
             semantik sınıf (POSITIVE_EMPTY/NEGATIVE_UNSUPPORTED/…) ana hükmü
             DEĞİŞTİRMEZ, yalnız CAROS LAB'a ek teşhis taşır. */
          _recordCanonicalScan(
            service,
            nativeOutcome === 'no_response' ? 'no_data'
              : nativeOutcome === 'unsupported' ? 'unsupported' : 'failed',
            0, protocol, sessionEpoch,
            classifyDtcReadResponse(service, raw, 0),
          );
          return { outcome: nativeOutcome, codes: [] };
        }
      } else {
        const r = await legacy();
        if (r === null) {
          recordDtcEvidence({ service, outcome: 'unsupported', sessionEpoch, raw: null });
          // Eski native plugin bu modu HİÇ taşımıyor — ham yanıt yok, sınıflandırılamaz.
          _recordCanonicalScan(service, 'unsupported', 0, null, sessionEpoch, 'NOT_RUN');
          return { outcome: 'unsupported', codes: [] };
        }
        got = r.codes ?? [];
        supported = r.supported !== false;
      }

      /* ══════════════════════════════════════════════════════════════════
         P0-VDK-F2C1 · ANLAM OTORİTESİ — KANONİK TS ÇÖZÜMLEYİCİSİ
         ══════════════════════════════════════════════════════════════════
         ÖLÇÜLEN BORÇ (F2-B): bu yolda kodları YALNIZ native çözüyordu
         (`ElmProtocol.parseDtcResponse`). Ham gövde TS'e ZATEN geliyordu
         ama KULLANILMIYORDU → replay bu yolda kod üretemiyor, üretici
         zinciriyle (UDS/KWP, TS'te çözülür) aynı kuralı uyguladığı hiçbir
         yerde kanıtlanamıyordu.

         Seçim ADI KONMUŞ kurallarla `functionalDtcSource`ta yapılır:
           ham gövde VAR   → kanonik TS = ÜRÜN OTORİTESİ, native = TANIK
           ham gövde YOK   → native     = LEGACY YEDEK (provenance açık)
           kırpık gövde    → kanonik otorite OLAMAZ (eksik liste riski)
         Gizli "hangisi doluysa onu kullan" mantığı YOKTUR. */
      const src = resolveFunctionalDtcSource({
        mode: service,
        rawResponse: raw,
        /* Replay'de native HİÇ çağrılmaz → tanık yok (kusur değil). */
        nativeCodes: isReplayActive() ? null : got,
      });
      recordFunctionalDtcEvidence(src, isReplayActive());
      /* Çelişkide kanonik KAZANIR (ölçülmüş ham gövdeden çözülmüştür) ama
         fark kanıtta GÖRÜNÜR kalır — sessizce biri seçilmez. */
      got = [...src.codes];

      /* ── FAIL-CLOSED: ÇÖZÜLEMEYEN GÖVDE "TEMİZ" DEĞİLDİR ────────────────
         Kanonik çözümleyici gövdeyi TANIYAMADIYSA ve native de kod
         kurtaramadıysa elde bir ÖLÇÜM vardır ama HÜKÜM yoktur. Bunu `ok`
         saymak "servis çalıştı, bulgu yok" demektir — yani anlaşılamayan bir
         yanıtı temiz ilan etmek. Kapsam KAYBI olarak raporlanır. */
      if (src.block === 'RAW_UNPARSEABLE' && src.provenance !== 'LEGACY_NATIVE') {
        recordDtcEvidence({
          service, outcome: 'failed', sessionEpoch, raw, protocol, elapsedMs, recoveryCount,
          error: `kanonik çözümleyici gövdeyi tanımadı: ${src.parse?.malformedReason ?? 'UNKNOWN'}`,
        });
        _recordCanonicalScan(service, 'failed', 0, protocol, sessionEpoch,
          classifyDtcReadResponse(service, raw, 0));
        return { outcome: 'failed', codes: [] };
      }

      /* P0-VDK-F2A · KANONİK İZ — fonksiyonel (7DF) Mode 03/07/0A okuması. */
      traceFromTransaction(txn, {
        operation: service === '03' ? 'mode03' : service === '07' ? 'mode07' : 'mode0A',
        rawRequest: service, rawResponse: raw,
        transportOutcome: supported ? 'ok' : 'unsupported',
        latencyMs: elapsedMs, protocol, sessionEpoch,
      });

      /* ── P0-VDK-F1A · GEÇ YANIT KAPISI ──────────────────────────────────
         Native çağrı UÇUŞTAYKEN tur iptal edilmiş, süresi dolmuş ya da OBD
         oturumu (epoch) değişmiş olabilir. Eskiden böyle bir yanıt sonucu
         SESSİZCE yazıyordu: bir taramanın kodları başka bir oturuma
         karışabiliyordu. Kapı kapalıysa yanıt DEFTERE YAZILMAZ — ve `failed`
         de DENMEZ, çünkü okuma düşmedi; ARTIK GEÇERSİZ. */
      if (!acceptResponse(txn)) {
        recordDtcEvidence({
          service, outcome: 'deferred', sessionEpoch, raw, protocol, elapsedMs, recoveryCount,
          error: `geç yanıt reddedildi: ${txn.lastDenial ?? 'UNKNOWN'}`,
        });
        return { outcome: 'deferred', codes: [] };
      }

      if (!supported) {
        recordDtcEvidence({ service, outcome: 'unsupported', sessionEpoch, raw, protocol, elapsedMs, recoveryCount });
        _recordCanonicalScan(service, 'unsupported', 0, protocol, sessionEpoch, classifyDtcReadResponse(service, raw, 0));
        return { outcome: 'unsupported', codes: [] };
      }

      recordDtcEvidence({ service, outcome: 'ok', codes: got, sessionEpoch, raw, protocol, elapsedMs, recoveryCount });
      /* P0-OBD-CORE-03 — KANONİK OTORİTE. Fonksiyonel (7DF) okuma tek bir
         ECU'ya ait DEĞİLDİR → `ecuKey: null`, rol `null` (adresten rol
         UYDURULMAZ). Gözlem KAYBOLMAZ: aynı kod başka sınıfta/ECU'da ayrı
         gözlemdir (bkz. `observationKey`). */
      _recordCanonicalScan(service, 'ok', got.length, protocol, sessionEpoch, classifyDtcReadResponse(service, raw, got.length));
      for (const c of got) {
        codes.push({ ...lookupDtc(c), status, ecuLabel: null, sessionEpoch });
        recordDtcObservation({
          dtcCode: c, dtcClass: DTC_CLASS_OF_SERVICE_CANON[service],
          ecuKey: null, ecuRole: null, rxHeader: null, txHeader: null,
          protocol, sessionEpoch, sourceService: service, provenance: 'functional_7DF',
        });
      }
      return { outcome: 'ok', codes: got };
    } catch (e) {
      logError(`DTC:ReadAll_${service}_Failed`, e);
      recordDtcEvidence({
        service, outcome: 'failed', sessionEpoch, raw: null,
        error: e instanceof Error ? e.message : String(e),
      });
      /* Istisna = TASIMA hatasi (baglanti koptu / plugin reject). Bu bir
         KAPSAM KAYBIDIR ve "kod yok" DEGILDIR. Ham yanit YOK (istisna raw
         taşımaz) → sınıflandırıcı ÇAĞRILMAZ, gerçek nedeni (taşıma hatası)
         doğrudan yazılır. */
      _recordCanonicalScan(service, 'timeout', 0, null, sessionEpoch, 'TRANSPORT_ERROR');
      return { outcome: 'failed', codes: [] };
    }
  }

  /* Mode 03 — onaylanmış/stored. */
  const stored = await readClass('stored', async () => CarLauncher.readDTC());
  completeness.stored = stored.outcome;

  /* Mode 07 — BEKLEYEN. SAE J1979'da ZORUNLU moddur; eski native plugin'de
     metot yoksa 'unsupported' yazılır (dürüst) ama bu ARAÇ desteklemiyor
     demek DEĞİLDİR — ürün soramamış demektir. */
  const pending = await readClass('pending', async () =>
    CarLauncher.readPendingDTC ? CarLauncher.readPendingDTC() : null);
  completeness.pending = pending.outcome;

  /* Mode 0A — KALICI. 2010 öncesi araçlarda gerçekten yoktur. */
  const permanent = await readClass('permanent', async () =>
    CarLauncher.readPermanentDTC ? CarLauncher.readPermanentDTC() : null);
  completeness.permanent = permanent.outcome;
  /* `permanentSupported` YALNIZ pozitif yanit gelirse true. ECU sustuysa (NO DATA)
     "arac Mode 0A destekliyor" DENEMEZ - o da bir olcum eksikligidir. */
  permanentSupported = permanent.outcome === 'ok';

  /* P0-OBD-10 — SON TARAMA KAYDI. Silme önkoşulu ve silme sonrası doğrulama
     bu kaydı okur; böylece BEKLEYEN (Mode 07) kod da silinebilir envanterine
     girer. Oturum mührü taşınır: başka oturumun taraması bu kayda YAZILAMAZ.

     DÜŞEN MOD ENVANTERİ SİLMEZ: bir sınıfın okuması 'failed' ise o sınıf için
     AYNI OTURUMDA ölçülmüş önceki kodlar KORUNUR. Aksi halde tek bir geçici
     okuma hatası envanteri boşaltır ve silme düğmesi sessizce ölürdü —
     "okunamadı" ile "kod yok" arasındaki farkı silmek bu projenin tekrar eden
     kusurudur. Taşınan şey UYDURMA değil, önceki ÖLÇÜMdür. */
  const prior = _lastScan !== null && _lastScan.sessionEpoch === sessionEpoch ? _lastScan.codes : [];
  const carried: DTCCodeWithStatus[] = [];
  for (const [status, outcome] of [
    ['stored',    completeness.stored]    as const,
    ['pending',   completeness.pending]   as const,
    ['permanent', completeness.permanent] as const,
  ]) {
    /* P0-OBD-11: 'no_response' de envanteri SILMEZ. ECU sustu diye onceki
       oturumda OLCULMUS P0089 i listeden dusurmek, "kod kayboldu" yanilsamasi
       uretir - kod kaybolmadi, bu taramada SORULAMADI. */
    if (outcome === 'failed' || outcome === 'no_response') {
      for (const c of prior) if (c.status === status) carried.push({ ...c });
    }
  }
  _lastScan = {
    codes: [...codes.map((c) => ({ ...c })), ...carried],
    completeness, atMs: Date.now(), sessionEpoch,
  };

  /* İşlem kapanır: bu andan SONRA gelen hiçbir async yanıt bu turun
     sonucunu DEĞİŞTİREMEZ (`acceptResponse` terminal durumda `false` döner). */
  traceTransactionBoundary(txn, 'end');
  completeTransaction(txn);
  return { codes, permanentSupported, completeness };
}

/**
 * P0-OBD-CORE-03 — fonksiyonel (7DF) servis taramasını kanonik otoriteye yazar.
 * Tek yer: her çağrı noktası aynı alanları doldursun ve alan unutulmasın.
 */
function _recordCanonicalScan(
  service: DtcSourceService,
  outcome: DtcScanOutcome,
  codeCount: number,
  protocol: string | null,
  sessionEpoch: number,
  /** P0-OBD-CORE-05 — zengin semantik sınıf (bkz. `dtcOutcomeSemantics`); opsiyonel, ana hükmü DEĞİŞTİRMEZ. */
  diagnosticOutcome?: string,
): void {
  recordDtcServiceScan({
    service, ecuKey: null, ecuRole: null, txHeader: null,
    outcome, sessionEpoch, codeCount, protocol, diagnosticOutcome,
  });
}

/**
 * P0-OBD-11 — native `readDtcClass.outcome` → `DtcReadOutcome`.
 *
 * Native ve TS sözlükleri BİREBİR eşlenir; TANINMAYAN değer `null` döner ve
 * çağıran eski (geri-uyumlu) yola düşer — uydurma sınıf ÜRETİLMEZ.
 *
 *  · `OK`          → 'ok'          (POZİTİF yanıt; kod 0 olabilir = gerçek "kod yok")
 *  · `NO_RESPONSE` → 'no_response' (ECU SUSTU — "kod yok" DEĞİL)
 *  · `UNSUPPORTED` → 'unsupported' (açık negatif yanıt / "?")
 *  · `BUS_ERROR`   → 'failed'      (hat/protokol hatası veya kısmi yanıt)
 *  · `NO_SID`      → 'failed'      (yanıt geldi ama pozitif SID yok → çözümlenemedi)
 */
export function mapNativeClassOutcome(v: unknown): DtcReadOutcome | null {
  switch (v) {
    case 'OK':          return 'ok';
    case 'NO_RESPONSE': return 'no_response';
    case 'UNSUPPORTED': return 'unsupported';
    case 'BUS_ERROR':   return 'failed';
    case 'NO_SID':      return 'failed';
    /* P0-VDK-F2B — HAM YANIT VAR, ÇÖZÜCÜ YOK.
       Fonksiyonel Mode 03/07/0A kodlarını `ElmProtocol.parseDtcResponse`
       (native) çözer; bu katmanda karşılığı YOKTUR. Ham gövde ölçülmüş olsa
       bile ürün ondan kod ÜRETEMEZ → sonuç bir KAPSAM KAYBIdır.
       `ok` demek "0 kod bulundu" hükmünü doğururdu; yani arızalı bir aracı
       temiz ilan etmek. O yüzden fail-closed `failed`. */
    case 'PARSER_UNAVAILABLE': return 'failed';
    default:            return null;   // eski plugin / tanınmayan → geri-uyumlu yol
  }
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

  /* P0-OBD-CORE-05 — ADMİSYON KAPISI. Saha kanıtı: `FreezeFrameFailed` recovery
     sürerken art arda üretiliyordu; recovery bitince AYNI sorgu normal çalıştı.
     Kapı reddederse ECU'ya TEK BAYT GİTMEZ — `null` dönülür (bu fonksiyonun
     mevcut sözleşmesinde zaten "kayıtlı değil/desteklenmiyor/bilinmiyor" ile
     AYNI dürüst "bilmiyorum" anlamını taşır); `DTC:FreezeFrameFailed` LOGLANMAZ
     (denenmedi — "denendi ve düştü" ile karışmasın). */
  const admission = await getDiagnosticAdmission();
  if (admission.admission !== 'READY') return null;

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

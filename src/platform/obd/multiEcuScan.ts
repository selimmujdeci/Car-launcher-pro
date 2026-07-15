/**
 * multiEcuScan — Çoklu-ECU tarama orkestrasyonu (OBD-OS-F2-2 · F2-3 · F2-4).
 *
 * Car Scanner farkının somut çıktısı: DTC artık YALNIZ motor ECU'sundan değil, keşfedilen
 * HER ECU'dan okunur ve her kod HANGİ ECU'dan geldiğini taşır (provenance). Bugüne kadar
 * ABS/airbag/şanzıman arızaları basitçe GÖRÜNMÜYORDU — sorulmuyordu bile.
 *
 * ROUTER SÖZLEŞMESİ (F2-2): her istek doğru ECU'ya (tx/rx header) yönlendirilir; native
 * `withEcuHeader` header set → oku → restore'u ATOMİK yapar. Yanlış ECU'ya sızıntı olamaz:
 * bir ECU'nun sonucu yalnız kendi kaydına yazılır (aşağıdaki test bunu kilitler).
 *
 * FAIL-SOFT (F2-4): bir ECU düşerse (timeout/hata) tarama DURMAZ — o ECU 'failed' işaretlenir,
 * diğerleri okunmaya devam eder. Kapsam (coverage) dürüstçe raporlanır: kısmi tarama
 * "temiz" DEMEZ (F0-1/F1-4 ile aynı fail-closed felsefe).
 *
 * BÜTÇE: ECU × mod = sorgu sayısı. Her sorgu ~0.5-4 sn → tavan konur (MAX_SCAN_ECUS).
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';
import { buildTopology, emptyTopology, type DiscoveredEcu, type VehicleTopology } from './ecuDiscovery';
import { parseUdsDtcResponse, udsDtcToScanMode } from './udsDtc';

/** Taranacak azami ECU sayısı — tarama süresi bütçesi (ECU × 3 mod × ~2 sn). */
export const MAX_SCAN_ECUS = 8;

/** Bir ECU'da bir modun okuma sonucu. */
export type EcuModeStatus = 'ok' | 'failed' | 'unsupported';

/** Kaynağı etiketli DTC — hangi ECU'dan, hangi moddan geldiği KAYBOLMAZ. */
export interface EcuDtc {
  code: string;
  /** Kodun okunduğu ECU (provenance — 'Motor (ECM)' / 'ECU 7E1'). */
  ecuLabel: string;
  ecuTxHeader: string;
  mode: 'stored' | 'pending' | 'permanent';
  /**
   * OBD-OS-F3-1: kod UDS 0x19'dan (üretici tabanı) mı geldi? true → standart OBD taraması
   * bunu GÖREMEZDİ (Renault DF… sınıfı). UI bunu ayırt edip "üretici kodu" diye gösterir.
   */
  fromUds?: boolean;
  /** UDS'e özgü arıza alt tipi (FTB) — yalnız fromUds kodlarda. */
  failureType?: string;
  /** UDS status: kod ŞU AN aktif mi (testFailed) — Mode 03 bunu ayıramaz. */
  active?: boolean;
}

export interface EcuScanResult {
  ecu: DiscoveredEcu;
  stored: EcuModeStatus;
  pending: EcuModeStatus;
  permanent: EcuModeStatus;
  /** F3-1: bu ECU UDS 0x19'u destekliyor mu? null = denenmedi. */
  uds: EcuModeStatus | null;
  codes: EcuDtc[];
}

export interface MultiEcuScanReport {
  topology: VehicleTopology;
  results: EcuScanResult[];
  /** Tüm ECU'lardan toplanan kodlar (provenance korunur). */
  allCodes: EcuDtc[];
  /** Okuma denemesi düşen (ECU, mod) çifti sayısı — >0 ise tarama KISMİ. */
  failedReads: number;
  /** Taranan ECU sayısı (tavanla kesilmiş olabilir). */
  scannedEcus: number;
  /** Tavan yüzünden taranMAYAN ECU sayısı — sessiz kırpma YASAK, raporlanır. */
  skippedEcus: number;
}

const MODES: ReadonlyArray<{ mode: '03' | '07' | '0A'; key: 'stored' | 'pending' | 'permanent' }> = [
  { mode: '03', key: 'stored' },
  { mode: '07', key: 'pending' },
  { mode: '0A', key: 'permanent' },
];

/**
 * Araçtaki ECU'ları keşfeder (F2-1). Native prob yoksa/başarısızsa boş topoloji (fail-soft) —
 * `probedAt: null` "keşif çalışmadı" demektir, "ECU yok" DEĞİL.
 */
export async function discoverEcus(): Promise<VehicleTopology> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.probeEcus) return emptyTopology();
  try {
    const { raw } = await CarLauncher.probeEcus();
    return buildTopology(raw ?? '', Date.now());
  } catch (e) {
    logError('OBD:EcuProbeFailed', e);
    return emptyTopology();   // keşif düştü → "bakılmadı" (fail-closed: uydurma ECU yok)
  }
}

/**
 * Tam araç taraması (F2-4): keşfedilen HER ECU'da Mode 03/07/0A okur.
 *
 * FAIL-SOFT: bir ECU/mod düşerse diğerleri devam eder; düşen okuma `failedReads`'e sayılır
 * → çağıran (UI/verdict) kısmi taramayı "temiz" sanmaz.
 */
export async function scanAllEcus(topology: VehicleTopology): Promise<MultiEcuScanReport> {
  const scanList = topology.ecus.slice(0, MAX_SCAN_ECUS);
  const skippedEcus = Math.max(0, topology.ecus.length - scanList.length);

  const results: EcuScanResult[] = [];
  const allCodes: EcuDtc[] = [];
  let failedReads = 0;

  for (const ecu of scanList) {
    const result: EcuScanResult = {
      ecu,
      stored: 'failed',
      pending: 'failed',
      permanent: 'failed',
      uds: null,
      codes: [],
    };

    for (const { mode, key } of MODES) {
      if (!Capacitor.isNativePlatform() || !CarLauncher.readDtcFromEcu) {
        result[key] = 'unsupported';
        continue;
      }
      try {
        const res = await CarLauncher.readDtcFromEcu({ tx: ecu.txHeader, rx: ecu.rxHeader, mode });
        if (res.supported === false) {
          result[key] = 'unsupported';   // ECU o modu bilmiyor — hata DEĞİL
          continue;
        }
        result[key] = 'ok';
        for (const code of res.codes ?? []) {
          // ROUTER KİLİDİ: kod YALNIZ kendi ECU'sunun kaydına yazılır (sızıntı yok).
          const tagged: EcuDtc = { code, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader, mode: key };
          result.codes.push(tagged);
          allCodes.push(tagged);
        }
      } catch (e) {
        result[key] = 'failed';
        failedReads++;
        logError('OBD:EcuDtcFailed', e);   // bu ECU/mod düştü — tarama DURMAZ
      }
    }

    // OBD-OS-F3-1: ÜRETİCİ-ÖZEL DTC'ler (UDS 0x19). Standart modlar yalnız emisyon (P0…)
    // kodlarını verir; Renault DF… sınıfı arızalar BURADA yaşar. F1-2'nin "MIL yanıyor ama
    // standart kod yok" uyarısının somut cevabı budur. Fail-soft: ECU 0x19'u bilmiyorsa
    // (NRC 0x11/0x12/0x31 → supported:false) bu bir HATA DEĞİLDİR, tarama sürer.
    const udsCodes = await readUdsForEcu(ecu, result);
    result.codes.push(...udsCodes);
    allCodes.push(...udsCodes);
    if (result.uds === 'failed') failedReads++;

    results.push(result);
  }

  return {
    topology,
    results,
    allCodes,
    failedReads,
    scannedEcus: scanList.length,
    skippedEcus,
  };
}

/**
 * OBD-OS-F3-1: bir ECU'da UDS 0x19-02 okur ve kodları DEDUPE ederek döner.
 *
 * DEDUPE ŞART: aynı arıza hem Mode 03'te (P0301) hem UDS 0x19'da görünebilir — aynı kodu
 * iki kez listelemek kullanıcıya "iki arıza var" yalanı söyler. Standart moddan gelen kod
 * KAZANIR (zaten listede); UDS yalnız EK olanları getirir — asıl kazanç zaten o (üretici kodu).
 */
async function readUdsForEcu(ecu: DiscoveredEcu, result: EcuScanResult): Promise<EcuDtc[]> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.readUdsDtcs) {
    result.uds = 'unsupported';
    return [];
  }
  try {
    const res = await CarLauncher.readUdsDtcs({ tx: ecu.txHeader, rx: ecu.rxHeader, statusMask: 'FF' });
    if (res.supported === false) {
      result.uds = 'unsupported';   // ECU 0x19'u bilmiyor — hata DEĞİL (çoğu eski araç)
      return [];
    }
    result.uds = 'ok';

    const already = new Set(result.codes.map((c) => c.code));
    const out: EcuDtc[] = [];
    for (const d of parseUdsDtcResponse(res.raw ?? '')) {
      if (already.has(d.code)) continue;   // standart modda zaten var → TEKRAR LİSTELEME
      out.push({
        code: d.code,
        ecuLabel: ecu.label,
        ecuTxHeader: ecu.txHeader,
        mode: udsDtcToScanMode(d),
        fromUds: true,                     // ← standart tarama bunu GÖREMEZDİ
        failureType: d.failureType,
        active: d.status.testFailed,       // Mode 03 bu ayrımı YAPAMAZ
      });
    }
    return out;
  } catch (e) {
    result.uds = 'failed';
    logError('OBD:UdsDtcFailed', e);       // UDS düştü — standart sonuçlar KORUNUR
    return [];
  }
}

/**
 * Tam araç taraması — keşif + ECU başına DTC (F2-4 tek giriş noktası).
 * Keşif hiç çalışmadıysa (native yok / prob düştü) boş rapor döner; çağıran mevcut
 * tek-ECU akışına düşer (graceful degrade — regresyon yok).
 */
export async function runFullVehicleScan(): Promise<MultiEcuScanReport> {
  const topology = await discoverEcus();
  return scanAllEcus(topology);
}

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
import { scanHintsFor, recordVehicleObservation } from './fleetKbService';
import { parseUdsDtcResponse, udsDtcToScanMode } from './udsDtc';
import { parseKwpDtcResponse } from './kwpDtc';
import { isSlowSerialProtocol } from './protocolProfile';
import { getHandshakeDiagnostics } from '../obdService';

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
  /**
   * V-08: kod KWP 0x18'den mi geldi? KWP araçlarda UDS 0x19 YOKTUR; üretici
   * kodları burada yaşar. `fromUds` ile AYRI tutulur — ikisini birleştirmek
   * kodun hangi protokolden geldiğini (provenance) yok ederdi.
   */
  fromKwp?: boolean;
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
  /**
   * V-08: KWP 0x18 durumu. `null` = DENENMEDİ (protokol CAN olduğu için).
   *
   * `null` ile `'unsupported'` AYRI ANLAMLIDIR ve karıştırılmamalıdır:
   * `null`  → "bu araçta sorulmadı" · `'unsupported'` → "soruldu, ECU bilmiyor".
   * İkisini birleştirmek, KWP aracında üretici kodu olmadığı hâlde "temiz"
   * demeye yol açardı — tam olarak V-08'in yasakladığı sessiz yalan.
   */
  kwp: EcuModeStatus | null;
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
export async function scanAllEcus(
  topology: VehicleTopology,
  /**
   * V-04/4 — filo hafızasından gelen İPUCU: daha önce bu araçta UDS 0x19'u
   * desteklediği GÖRÜLEN ECU'ların tx başlıkları.
   *
   * YALNIZ SIRA belirler; hiçbir ECU atlanmaz, hiçbir sonuç hafızadan üretilmez.
   * Tek etkisi: `MAX_SCAN_ECUS` tavanına takılan araçlarda üretici kodlarını
   * taşıyan ECU'ların tavanın DIŞINDA kalmaması. Boş dizi → davranış eskisi gibi.
   */
  udsFirst: readonly string[] = [],
): Promise<MultiEcuScanReport> {
  const ordered = orderByUdsHint(topology.ecus, udsFirst);
  const scanList = ordered.slice(0, MAX_SCAN_ECUS);

  /* V-08 — AKTİF PROTOKOL TARAMA BAŞINDA BİR KEZ OKUNUR ve tur boyunca SABİT
     kalır. ECU başına yeniden okumak, tarama ortasında bir yeniden bağlanma
     olursa aynı turun bir kısmını KWP bir kısmını CAN kuralıyla işlerdi —
     rapor kendi içinde çelişirdi. Okunamazsa `null`: KWP dalı DENENMEZ
     (fail-closed) ve bu durum `kwp: null` olarak dürüstçe raporlanır. */
  let activeProtocol: string | null = null;
  try {
    /* `protocolActive` = ATDPN ile GERÇEKTEN okunan protokol (denenen değil). */
    activeProtocol = getHandshakeDiagnostics().protocolActive ?? null;
  } catch { activeProtocol = null; }
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
      kwp: null,
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

    /* V-08 — KWP 0x18: UDS 0x19'un KWP KARŞILIĞI.
       YALNIZ yavaş seri protokolde (KWP2000 / ISO9141) denenir. CAN'de denemek
       anlamsız trafik üretir ve KWP hattı zaten yavaştır. Protokol bilinmiyorsa
       DENENMEZ ve `kwp` `null` kalır — "sorulmadı" ile "desteklenmiyor" AYRI. */
    if (isSlowSerialProtocol(activeProtocol)) {
      const kwpCodes = await readKwpForEcu(ecu, result);
      result.codes.push(...kwpCodes);
      allCodes.push(...kwpCodes);
      if (result.kwp === 'failed') failedReads++;
    }

    results.push(result);
  }

  /* V-08 — KWP kanalının son tur kanıtını hatırla (yeni ölçüm YOK). */
  try {
    const kwpStates = results.map((r) => r.kwp).filter((v) => v !== null);
    _kwpEvidence = Object.freeze({
      lastScanAtMs: Date.now(),
      protocolAtScan: activeProtocol,
      attempted: kwpStates.length > 0,
      channelAvailable: Capacitor.isNativePlatform() && typeof CarLauncher.readKwpDtcs === 'function',
      okCount: kwpStates.filter((v) => v === 'ok').length,
      unsupportedCount: kwpStates.filter((v) => v === 'unsupported').length,
      failedCount: kwpStates.filter((v) => v === 'failed').length,
      codeCount: allCodes.filter((c) => c.fromKwp === true).length,
    });
  } catch { /* fail-soft: kanıt toplama taramayı ASLA bozmaz */ }

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
 * İpucundaki ECU'ları öne alır — KARARLI sıralama (stable): ipucunda olanlar kendi
 * aralarındaki sırayı, olmayanlar da kendi aralarındaki sırayı KORUR.
 *
 * Neden `sort` değil de iki kova: `Array.prototype.sort` kararlılığı ES2019'dan beri
 * garanti olsa da niyeti okunur kılmak, "sıra neden değişti" sorusunu ileride
 * kimsenin sormamasını sağlar. Filtreleme YOKTUR — küme aynı kalır.
 */
function orderByUdsHint(
  ecus: readonly DiscoveredEcu[],
  udsFirst: readonly string[],
): DiscoveredEcu[] {
  if (udsFirst.length === 0) return [...ecus];
  const hinted = new Set(udsFirst);
  const first: DiscoveredEcu[] = [];
  const rest: DiscoveredEcu[] = [];
  for (const e of ecus) (hinted.has(e.txHeader) ? first : rest).push(e);
  return [...first, ...rest];
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

/* ── V-08: KWP DTC kanalının SALT-OKUNUR kanıtı ─────────────────────────────
 *
 * NEDEN: KWP dalı yalnız TAM ARAÇ TARAMASI sırasında çalışır; sürekli bir
 * akışı yoktur. CAROS LAB "bu araçta KWP DTC sorulabildi mi" sorusunu ancak
 * son turun sonucunu HATIRLARSAK cevaplayabilir.
 *
 * YENİ ÖLÇÜM ÜRETİLMEZ: tarama zaten hesapladığı durumu buraya yazar. Sınırlı
 * (yalnız son tur), süreç-ömürlü, timer yok, I/O yok. */

export interface KwpDtcEvidence {
  /** Son tam taramanın damgası; `null` = bu oturumda hiç taranmadı. */
  readonly lastScanAtMs: number | null;
  /** Tarama anındaki aktif protokol (ATDPN) — `null` = okunamadı. */
  readonly protocolAtScan: string | null;
  /** KWP dalı GERÇEKTEN denendi mi (yavaş seri kapısı geçildi mi). */
  readonly attempted: boolean;
  /** Native köprü bu ortamda var mı — yoksa deneme HİÇ yapılamaz. */
  readonly channelAvailable: boolean;
  /** ECU başına sonuç sayaçları (yalnız denenen turda anlamlı). */
  readonly okCount: number;
  readonly unsupportedCount: number;
  readonly failedCount: number;
  /** Bu turda KWP'den gelen (standart modda OLMAYAN) kod adedi. */
  readonly codeCount: number;
}

const _EMPTY_KWP_EVIDENCE: KwpDtcEvidence = Object.freeze({
  lastScanAtMs: null, protocolAtScan: null, attempted: false,
  channelAvailable: false, okCount: 0, unsupportedCount: 0,
  failedCount: 0, codeCount: 0,
});

let _kwpEvidence: KwpDtcEvidence = _EMPTY_KWP_EVIDENCE;

/** LAB salt-okuma yüzeyi — hiçbir şey tetiklemez, ASLA fırlatmaz. */
export function getKwpDtcEvidence(): KwpDtcEvidence {
  return _kwpEvidence;
}

/** @internal — testler arası izolasyon. */
export function _resetKwpDtcEvidenceForTest(): void {
  _kwpEvidence = _EMPTY_KWP_EVIDENCE;
}

/**
 * V-08 — bir ECU'da KWP 0x18 (ReadDTCByStatus) okur ve kodları DEDUPE ederek döner.
 *
 * NEDEN AYRI FONKSİYON: KWP DTC **2 BAYTTIR** (UDS 0x19'da 3). Aynı çözücüyü
 * kullanmak kayıt boyunu yanlış sayar ve TÜM LİSTE KAYAR — sessiz veri
 * bozulmasının klasik yolu. Bu yüzden `kwpDtc.ts` ayrı çözücüdür.
 *
 * DEDUPE ŞART: aynı arıza hem Mode 03'te hem 0x18'de görünebilir; iki kez
 * listelemek kullanıcıya "iki arıza var" yalanı söyler. Standart moddan gelen
 * kod KAZANIR; KWP yalnız EK olanları getirir (asıl kazanç zaten üretici kodu).
 *
 * FAIL-SOFT: ECU 0x18'i bilmiyorsa bu bir HATA DEĞİLDİR (`unsupported`) ve
 * standart sonuçlar KORUNUR.
 */
async function readKwpForEcu(ecu: DiscoveredEcu, result: EcuScanResult): Promise<EcuDtc[]> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.readKwpDtcs) {
    result.kwp = 'unsupported';
    return [];
  }
  try {
    const res = await CarLauncher.readKwpDtcs({ tx: ecu.txHeader, rx: ecu.rxHeader });
    if (res.supported === false) {
      result.kwp = 'unsupported';   // ECU 0x18'i bilmiyor — hata DEĞİL
      return [];
    }
    result.kwp = 'ok';

    const already = new Set(result.codes.map((c) => c.code));
    const out: EcuDtc[] = [];
    for (const d of parseKwpDtcResponse(res.raw ?? '')) {
      if (already.has(d.code)) continue;   // standart modda zaten var → TEKRAR LİSTELEME
      out.push({
        code: d.code,
        ecuLabel: ecu.label,
        ecuTxHeader: ecu.txHeader,
        /* KWP 0x18 "saklanan" arızaları döndürür; bekleyen/kalıcı ayrımı
           standart modların işidir — burada UYDURULMAZ. */
        mode: 'stored',
        fromKwp: true,                     // ← standart tarama bunu GÖREMEZDİ
        active: d.status.testFailed,       // Mode 03 bu ayrımı YAPAMAZ
      });
    }
    return out;
  } catch (e) {
    result.kwp = 'failed';
    logError('OBD:KwpDtcFailed', e);       // KWP düştü — standart sonuçlar KORUNUR
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

  /* V-04/4 — FİLO HAFIZASI (fail-soft, iki uç da isteğe bağlı):
     ① okuma ucu: bilinen UDS'li ECU'lar öne alınır (yalnız SIRA).
     ② yazma ucu: tur bitince gözlem öğrenilir.
     Hafıza okunamaz/yazılamazsa tarama ESKİSİ GİBİ çalışır — öğrenme bir lüks,
     teşhis bir zorunluluktur. */
  let udsFirst: readonly string[] = [];
  try { udsFirst = scanHintsFor(topology).udsFirst; }
  catch (e) { logError('OBD:FleetKbHint', e); }

  const report = await scanAllEcus(topology, udsFirst);

  try {
    const udsCapable = report.results
      .filter((r) => r.uds === 'ok')
      .map((r) => r.ecu.txHeader);
    recordVehicleObservation(topology, udsCapable);
  } catch (e) {
    logError('OBD:FleetKbRecord', e);
  }

  return report;
}

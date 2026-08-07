/**
 * autoDidDiscovery — OTOMATİK marka-DID keşfi (VIN başına 1 kez, cache'li, NAZİK).
 *
 * NEDEN: PID'ler bitmask (00/20/40…) ile zaten otomatik bulunuyor. DID'lerde ise UDS'de
 * "desteklenen DID listesi" standardı YOKTUR → 2200-22FF aralığını brute-force sorup
 * yanıt vereni kaydetmek gerekir. Bu orkestratör bunu OTOMATİK yapar:
 *   1. Bağlantı STABİL sağlıklı olunca (connected + real + dataFresh, ≥HEALTHY_STABLE_MS),
 *   2. VIN'i (F190) okur → HASH'ler (ham VIN saklanmaz — gizlilik),
 *   3. bu VIN daha önce tarandıysa cache'ten döner (BİR DAHA TARAMAZ),
 *   4. yeni VIN → discoverEcus ile ECU'ları bulur, her ECU'da 2200-22FF'i
 *      didDiscoveryService ile (150ms inter-DID) tarar, yanıt veren DID + HAM değerleri
 *      VIN-hash başına persist eder.
 *
 * DÜRÜSTLÜK (CLAUDE.md ticari kural): tarama yalnız "hangi DID + HAM değer" bulur —
 * ANLAM (yağ sıcaklığı mı, DPF mi) ÜRETMEZ. Marka DID sözlüğü olmadan anlamlandırma
 * yapılmaz; ham değerler tanı ekranında gösterilir, gerçek gösterge değeriyle eşleştirilip
 * profile (renaultDaciaProfile) elle eklenir.
 *
 * GÜVENLİK (kırılgan bağlantı — SAHA 2026-07-19 V-LINK donma dersi): brute-force tarama
 * ELM kanalını çekirdek poll'la (RPM/hız) PAYLAŞIR → boğarsa donma tetikler. O yüzden:
 *   - yalnız STABİL sağlıklıyken başlar,
 *   - AbortSignal: tarama sırasında sağlık bozulursa ANINDA durur (core poll'a yol açar),
 *   - ECU sayısı ve tur bounded; fail-soft (hata bağlantıyı ETKİLEMEZ).
 * 🔴 Cihazda doğrulanmadı — özellikle "taramanın RPM'i/bağlantıyı bozmadığı" ölçülmeli.
 */
import { startDiscovery } from './didDiscoveryService';
import { discoverEcus } from './multiEcuScan';
import { CarLauncher } from '../nativePlugin';
import { getOBDDataSnapshot, onOBDData } from '../obdService';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { logError } from '../crashLogger';

/** Bulunan tek DID kaydı (ham — anlam YOK). */
export interface AutoDidRecord {
  /** 4 hex hane, büyük harf (ör. '2201'). */
  did: string;
  /** Ham yanıt data'sı (başlık soyulmuş), hex. Gösterge değeriyle eşleştirmek için. */
  dataHex: string;
  /** Hangi ECU'dan (rx header) — provenance. */
  ecuRx: string;
}

interface AutoDidCache {
  vinHash: string;
  scannedAt: number;
  ecus: number;
  dids: AutoDidRecord[];
}

const CACHE_PREFIX = 'obd:autoDid:';
const DID_FROM = '2200';
const DID_TO = '22FF';
/** Taranacak azami ECU (süre/trafik bütçesi — motor + birkaç modül). */
const MAX_ECUS = 3;
/** Bu kadar KESİNTİSİZ sağlıklı olunca tarama başlar (core poll otursun, adaptör ısınsın). */
export const HEALTHY_STABLE_MS = 30_000;
/** Cache tazeleme — bu süreden eski tarama yeniden yapılır (yazılım/ECU değişimi olabilir). */
const RESCAN_AFTER_MS = 90 * 24 * 3_600_000; // ~90 gün

/* ── VIN YOKLAMA BÜTÇESİ (saha 2026-07-31 — çok-ECU düzeltmesinin YAN ETKİSİ) ────
 * `startAutoDidWatcher` HER OBD veri olayında tetikler (saniyede birkaç kez) ve
 * VIN okunamazsa `_sessionDone` işaretlenmez → yoklama bir sonraki olayda YENİDEN
 * başlar. Tek sabit adres denendiği sürece bu ucuzdu; artık her deneme
 * `discoverEcus()` (ATH1 + 0100 broadcast + ATH0 restore) + en fazla MAX_ECUS kez
 * `ATSH/ATCRA + 22F190` demek → VIN vermeyen bir araçta çekirdek poll'u (hız/RPM)
 * sürekli bekletir, yani "bayat veri" şikâyetini AZALTMAK yerine ARTIRIRDI.
 * Bu yüzden yoklama sayı + soğuma ile sınırlanır; tükenince oturumda vazgeçilir
 * (bağlantı sıfırlanınca `_resetAutoDidForTest`/yeniden başlatma ile sıfırlanır). */
const VIN_PROBE_MAX_ATTEMPTS = 3;
const VIN_PROBE_COOLDOWN_MS = 120_000; // 2 dk — başarısız yoklamalar arası zorunlu sessizlik

let _running = false;
let _sessionDone = false;
let _healthySince = 0;
let _lastResult: AutoDidRecord[] = [];
let _watcherUnsub: (() => void) | null = null;
let _vinProbeAttempts = 0;
let _vinProbeBlockedUntil = 0;

/** FNV-1a — VIN → kısa cache anahtarı (ham VIN ASLA saklanmaz). */
function hashVin(vin: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < vin.length; i++) {
    h ^= vin.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function isHealthy(): boolean {
  const s = getOBDDataSnapshot();
  return s.connectionState === 'connected' && s.source === 'real' && s.dataFresh === true;
}

function loadCache(vinHash: string): AutoDidCache | null {
  try {
    const raw = safeGetRaw(CACHE_PREFIX + vinHash);
    return raw ? (JSON.parse(raw) as AutoDidCache) : null;
  } catch { return null; }
}

function saveCache(c: AutoDidCache): void {
  try { safeSetRaw(CACHE_PREFIX + c.vinHash, JSON.stringify(c)); } catch { /* persist fail-soft */ }
}

/**
 * F190 (VIN) hex → ASCII. Okunamazsa `null`.
 *
 * ── ADRES ARTIK SABİT DEĞİL (saha 2026-07-31) ──────────────────────────────
 * Eskiden `7E0/7E8` SABİT yazılıydı ("11-bit CAN varsayımı"). Gerçek araçta
 * ölçüldü: protokol **7** (ISO 15765-4, **29-bit**) olan bir araçta ECU kendini
 * `18DAF110` ile tanıtıyordu ama VIN isteği `ATSH7E0 · ATCRA7E8 · 22F190`
 * gönderiyordu → **her seferinde `NO DATA`**, `vinPresent:false`. Yani 29-bit
 * araçlarda VIN HİÇ okunamıyordu.
 *
 * Doğru adres zaten `ecuDiscovery` tarafından türetiliyordu
 * (`txHeader: 18DA<ecu>F1`); bu yol onu kullanmıyordu. Artık adres DIŞARIDAN
 * verilir ve çağıran keşfedilen ECU'ları sırayla dener.
 */
async function readVinFrom(tx: string, rx: string): Promise<string | null> {
  if (!CarLauncher.readObdDid) return null;
  try {
    const r = await CarLauncher.readObdDid({ tx, rx, did: 'F190', service: '22' });
    if (!r.supported || !r.data) return null;
    const clean = r.data.replace(/[^0-9A-Fa-f]/g, '');
    let vin = '';
    for (let i = 0; i + 2 <= clean.length; i += 2) {
      const code = parseInt(clean.substring(i, i + 2), 16);
      if (code >= 32 && code < 127) vin += String.fromCharCode(code); // yazdırılabilir ASCII
    }
    vin = vin.trim();
    return vin.length >= 8 ? vin : null; // VIN 17 karakter; ≥8 = makul (klon/kısmi tolere)
  } catch { return null; }
}

/**
 * VIN'i ADAY ECU'LARDAN sırayla okur; ilk geçerli cevap kazanır.
 *
 * Sıra ÖNEMLİ: keşfedilen ECU'lar (29-bit dâhil) önce denenir; hiçbiri
 * cevaplamazsa `7E0/7E8` YALNIZ SON ÇARE olarak kalır — 11-bit araçlarda eski
 * davranış aynen korunur, 29-bit araçlarda ise VIN artık okunabilir.
 */
async function readVin(
  candidates: ReadonlyArray<{ readonly tx: string; readonly rx: string }>,
): Promise<string | null> {
  for (const c of candidates) {
    const vin = await readVinFrom(c.tx, c.rx);
    if (vin) return vin;
  }
  return null;
}

/** Son taramanın sonucu (tanı ekranı/rapor okur). */
export function getAutoDiscoveredDids(): AutoDidRecord[] {
  return _lastResult.slice();
}

/**
 * Otomatik DID keşfini (gerekiyorsa) başlatır. İdempotent; oturumda BİR kez.
 * Yalnız STABİL sağlıklıyken; taramada sağlık bozulursa abort (core poll boğulmaz).
 */
export async function maybeStartAutoDidDiscovery(): Promise<void> {
  if (_running || _sessionDone || !isHealthy()) return;
  // VIN yoklama bütçesi — bkz. VIN_PROBE_MAX_ATTEMPTS notu (hat boğulmasın).
  if (_vinProbeAttempts >= VIN_PROBE_MAX_ATTEMPTS) return;
  if (Date.now() < _vinProbeBlockedUntil) return;
  _running = true;
  try {
    /* SIRA DEĞİŞTİ (saha 2026-07-31): önce ECU TOPOLOJİSİ, sonra VIN.
     *
     * Eskiden VIN sabit `7E0/7E8` ile okunuyor ve BAŞARISIZ olunca fonksiyon
     * `return` ediyordu → 29-bit araçlarda ECU keşfine HİÇ SIRA GELMİYORDU
     * (ölçüldü: protokol 7, ECU `18DAF110`, VIN her seferinde `NO DATA`).
     * Artık adresler önce keşfedilir, VIN o adreslerden okunur. */
    const topo = await discoverEcus();
    const ecus = (topo.ecus.length > 0
      ? topo.ecus.map((e) => ({ tx: e.txHeader, rx: e.rxHeader }))
      : [{ tx: '7E0', rx: '7E8' }]   // 11-bit son çare — eski davranış korunur
    ).slice(0, MAX_ECUS);

    const vin = await readVin(ecus);
    if (!vin) {
      // VIN yoksa keyleyemeyiz → bir sonraki pencerede tekrar denenir, AMA bütçeyle:
      // soğuma bitmeden ve deneme hakkı tükendikten sonra hat bir daha meşgul edilmez.
      _vinProbeAttempts += 1;
      _vinProbeBlockedUntil = Date.now() + VIN_PROBE_COOLDOWN_MS;
      return;
    }
    const vinHash = hashVin(vin);

    const cached = loadCache(vinHash);
    if (cached && (Date.now() - cached.scannedAt) < RESCAN_AFTER_MS) {
      _lastResult = cached.dids;
      _sessionDone = true; // bu araç zaten tarandı
      return;
    }

    // Sağlık bozulursa aborta çeviren signal.
    const ctrl = new AbortController();
    const unsub = onOBDData(() => { if (!isHealthy()) ctrl.abort(); });
    const all: AutoDidRecord[] = [];
    try {
      for (const ecu of ecus) {
        if (ctrl.signal.aborted || !isHealthy()) break;
        const outcome = await startDiscovery({
          tx: ecu.tx, rx: ecu.rx, from: DID_FROM, to: DID_TO, service: '22', signal: ctrl.signal,
        });
        for (const r of outcome.results) {
          all.push({ did: r.did, dataHex: r.dataHex, ecuRx: ecu.rx });
        }
        // Bağlantı koptu/iptal → kalan ECU'ları zorlamadan bırak (nazik).
        if (outcome.summary.stopReason === 'connection_lost' || outcome.summary.stopReason === 'aborted') break;
      }
    } finally {
      unsub();
    }

    _lastResult = all;
    saveCache({ vinHash, scannedAt: Date.now(), ecus: ecus.length, dids: all });
    _sessionDone = true;
  } catch (e) {
    logError('OBD:AutoDidDiscovery', e); // fail-soft — bağlantıyı ASLA etkilemez
  } finally {
    _running = false;
  }
}

/**
 * Otomatik keşif izleyicisini başlatır: bağlantı ≥HEALTHY_STABLE_MS kesintisiz sağlıklı
 * olunca tek sefer taramayı tetikler. SystemBoot/obd başlangıcından çağrılır. İdempotent.
 * Dönen cleanup aboneliği söker (zero-leak).
 */
export function startAutoDidWatcher(): () => void {
  if (_watcherUnsub) return _watcherUnsub;
  // YENİ izleyici = yeni OBD oturumu (servis yeniden başladı / araç değişti) → VIN
  // yoklama bütçesi tazelenir. Tek oturum içindeki sağlık dalgalanmaları bütçeyi
  // sıfırlamaz (aksi halde flapping, sınırın amacını ortadan kaldırırdı).
  _vinProbeAttempts = 0;
  _vinProbeBlockedUntil = 0;
  const unsub = onOBDData(() => {
    if (_sessionDone) return;
    if (isHealthy()) {
      if (_healthySince === 0) _healthySince = Date.now();
      else if (Date.now() - _healthySince >= HEALTHY_STABLE_MS) void maybeStartAutoDidDiscovery();
    } else {
      _healthySince = 0; // sağlık bozuldu → istikrar sayacı sıfırla
    }
  });
  _watcherUnsub = () => { unsub(); _watcherUnsub = null; };
  return _watcherUnsub;
}

/** @internal — testler arası izolasyon. */
export function _resetAutoDidForTest(): void {
  _running = false;
  _sessionDone = false;
  _healthySince = 0;
  _lastResult = [];
  _vinProbeAttempts = 0;
  _vinProbeBlockedUntil = 0;
  if (_watcherUnsub) { _watcherUnsub(); _watcherUnsub = null; }
}

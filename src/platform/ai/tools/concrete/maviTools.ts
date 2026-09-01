/**
 * maviTools — Faz 1 ALLOWLIST'i: 5 güvenli, SALT-OKUNUR/navigasyon aracı.
 *
 * ── YENİ VERİ YOLU YOK ──────────────────────────────────────────────────────
 * Araçlar MEVCUT otoriteleri kullanır:
 *   - araç durumu / canlı özet / DTC → Context Engine'in SALT-OKUNUR kaynakları
 *     (`createMaviContextSources`) — aynı sentinel/fizik/tazelik disiplini.
 *   - ekran açma → mevcut `screenRegistry` (kanonik ALLOWLIST + `getScreenById`)
 * Yeni polling, abonelik, OBD/ECU komutu OLUŞTURULMAZ.
 *
 * Sonuçlar BOUNDED ve tiplidir; ham nesne/dump döndürülmez. Prompt/araç verisi
 * LOGLANMAZ.
 */

import { createMaviContextSources } from '../../context/concrete/maviContextSources';
import { evaluateVehicleDtcVerdict } from '../../../obd/dtcAuthority';
import { getScreenById, screenIds } from '../../../screenRegistry';
import { readCurrentLocation } from '../../../location/currentLocationService';
import type { ToolDefinition, ToolResult } from '../toolTypes';

/** Fiziksel geçerlilik — Context Engine'le AYNI mantık (sentinel/NaN elenir). */
const LIMITS = {
  rpm:            { min: 0,   max: 12_000 },
  speedKph:       { min: 0,   max: 320 },
  coolantC:       { min: -40, max: 200 },
  fuelPercent:    { min: 0,   max: 100 },
  batteryVoltage: { min: 6,   max: 36 },
} as const;

function usable(v: unknown, l: { min: number; max: number }): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== -1 && v >= l.min && v <= l.max;
}

const unavailable = (message: string): ToolResult => ({ ok: false, error: 'unavailable', message });

/* ── 1) Araç bağlantı durumu ───────────────────────────────────────────────── */

const vehicleConnectionTool: ToolDefinition = {
  name:        'get_vehicle_connection',
  description: 'Aracın OBD bağlantısının şu anki durumunu okur (bağlı mı, veri taze mi, veri gerçek mi simülasyon mu).',
  effect:      'read',
  parameters:  {},
  handler: () => {
    const obd = safeObd();
    if (!obd) return unavailable('Araç bağlantı bilgisi okunamadı.');
    const connected = obd.connected === true;
    return {
      ok: true,
      data: {
        connected,
        dataOrigin: obd.source === 'mock' ? 'simulation' : 'real',
      },
      summary: connected ? 'Araç bağlantısı aktif.' : 'Araç bağlı değil.',
    };
  },
};

/* ── 2) Canlı OBD özeti ────────────────────────────────────────────────────── */

const liveSnapshotTool: ToolDefinition = {
  name:        'get_vehicle_live_summary',
  description: 'Araçtan gelen son canlı ölçümlerin özetini okur (devir, hız, motor suyu sıcaklığı, yakıt, akü gerilimi). Yeni ölçüm İSTEMEZ.',
  effect:      'read',
  parameters:  {},
  handler: () => {
    const obd = safeObd();
    if (!obd) return unavailable('Canlı veri okunamadı.');
    if (obd.connected !== true) return unavailable('Araç bağlı olmadığı için canlı veri yok.');

    const data: Record<string, string | number | boolean> = {};
    if (usable(obd.rpm, LIMITS.rpm))                       data['rpm'] = obd.rpm as number;
    if (usable(obd.speed, LIMITS.speedKph))                data['speedKph'] = obd.speed as number;
    if (usable(obd.engineTemp, LIMITS.coolantC))           data['coolantC'] = obd.engineTemp as number;
    if (usable(obd.fuelLevel, LIMITS.fuelPercent))         data['fuelPercent'] = obd.fuelLevel as number;
    if (usable(obd.batteryVoltage, LIMITS.batteryVoltage)) data['batteryVoltage'] = obd.batteryVoltage as number;

    if (Object.keys(data).length === 0) return unavailable('Şu an okunabilir canlı ölçüm yok.');
    if (typeof obd.lastSeenMs === 'number' && obd.lastSeenMs > 0) data['observedAtMs'] = obd.lastSeenMs;

    return { ok: true, data, summary: 'Son canlı ölçüm özeti okundu.' };
  },
};

/* ── 3) DTC özeti ──────────────────────────────────────────────────────────── */

/** Kod biçimi doğrulaması — serbest metin/açıklama TAŞINMAZ. */
const DTC_CODE_RE = /^[PBCU][0-3][0-9A-F]{3}$/;
const MAX_TOOL_DTC_CODES = 5;

const dtcSummaryTool: ToolDefinition = {
  name:        'get_vehicle_dtc_summary',
  description: 'Son arıza kodu taramasının özetini okur (kod sayısı ve en fazla 5 kod). Yeni tarama BAŞLATMAZ, kod SİLMEZ.',
  effect:      'read',
  parameters:  {},
  handler: () => {
    const sources = createMaviContextSources();
    let dtc: { codes?: readonly string[]; lastReadAt?: number | null; isStale?: boolean } | undefined;
    try { dtc = sources.readDtc?.(); } catch { dtc = undefined; }
    if (!dtc) return unavailable('Arıza kodu bilgisi okunamadı.');

    const codes = (dtc.codes ?? [])
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => DTC_CODE_RE.test(c))
      .slice(0, MAX_TOOL_DTC_CODES);

    const data: Record<string, string | number | boolean> = {
      count: codes.length,
      stale: dtc.isStale === true,
    };
    codes.forEach((code, i) => { data[`code${i + 1}`] = code; });
    if (typeof dtc.lastReadAt === 'number' && dtc.lastReadAt > 0) data['lastReadAtMs'] = dtc.lastReadAt;

    /* P0-OBD-CORE-03 — "kod bulunmuyor" YALNIZ kanıtlı temizlikte söylenir.
       `codes` Mode 03'tür; bekleyen/kalıcı/çoklu-ECU/üretici bulguları orada
       YOKTUR ve boş dizi "okuma yapılmadı"yı da kapsar. */
    const verdict = evaluateVehicleDtcVerdict();
    data['verdict'] = verdict.verdict;
    return {
      ok: true, data,
      summary: codes.length > 0 ? `${codes.length} arıza kodu bulundu.`
             : verdict.verdict === 'clean' ? 'Kayıtlı arıza kodu bulunmuyor.'
             : verdict.message,
    };
  },
};

/* ── 4) Uygulama içi sayfaya git ───────────────────────────────────────────── */

const openScreenTool: ToolDefinition = {
  name:        'open_app_screen',
  description: 'Uygulama içinde bilinen bir ekranı açar. Yalnız tanımlı ekran kimlikleri kabul edilir.',
  effect:      'navigate',
  parameters:  {
    screenId: {
      type:        'enum',
      description: 'Açılacak ekranın kanonik kimliği.',
      required:    true,
      values:      screenIds(),          // ALLOWLIST — kayıt defterinden
    },
  },
  handler: (args) => {
    const id = String(args['screenId'] ?? '');
    const screen = getScreenById(id);    // fuzzy DEĞİL, kesin kimlik (fail-closed)
    if (!screen) return unavailable('Bilinmeyen ekran.');
    try {
      screen.open();
    } catch {
      return { ok: false, error: 'failed', message: 'Ekran açılamadı.' };
    }
    return { ok: true, data: { screenId: id, opened: true }, summary: `${screen.label} açıldı.` };
  },
};

/* ── 5) Mevcut konum ("Neredeyim?") ────────────────────────────────────────── */

/**
 * SALT-OKUNUR konum sorgusu. Yeni GPS aboneliği/watch AÇMAZ — mevcut store snapshot'ını
 * (`UnifiedVehicleStore` ← gpsService) okur. Adres için mevcut Nominatim sağlayıcısı
 * bounded (3s) çağrılır; başarısızlık cevabı ENGELLEMEZ (koordinatla dürüstçe cevaplanır).
 *
 * Konum PII'dir: `data` alanına yalnız cevabın dayandığı asgari alanlar konur ve hiçbir
 * şey LOGLANMAZ (toolTypes telemetrisi zaten yalnız alan SAYISINI taşır).
 */
const currentLocationTool: ToolDefinition = {
  name:        'get_current_location',
  description: 'Kullanıcının şu anki konumunu okur ve varsa adresini söyler ("Neredeyim?"). Navigasyon BAŞLATMAZ, rota kurmaz.',
  effect:      'read',
  parameters:  {},
  handler: async (): Promise<ToolResult> => {
    let readout: Awaited<ReturnType<typeof readCurrentLocation>>;
    try {
      readout = await readCurrentLocation();
    } catch {
      return unavailable('Konum verisini şu anda alamıyorum.');
    }

    // Fix yok / geçersiz / çok eski → fail-closed. Tahmin YÜRÜTÜLMEZ.
    if (!readout.ok) return unavailable(readout.text);

    const data: Record<string, string | number | boolean> = {
      answer:    readout.text,
      latitude:  readout.latitude as number,
      longitude: readout.longitude as number,
      stale:     readout.classification.klass === 'aging',
    };
    if (readout.address) data['address'] = readout.address;
    if (typeof readout.timestampMs === 'number') data['observedAtMs'] = readout.timestampMs;
    if (typeof readout.ageMs === 'number')       data['ageMs'] = readout.ageMs;
    if (typeof readout.accuracyM === 'number')   data['accuracyM'] = readout.accuracyM;
    if (readout.provider)                        data['provider'] = readout.provider;

    return { ok: true, data, summary: readout.text };
  },
};

/* ── Yardımcı ──────────────────────────────────────────────────────────────── */

function safeObd(): ReturnType<NonNullable<ReturnType<typeof createMaviContextSources>['readObd']>> | undefined {
  try {
    return createMaviContextSources().readObd?.();
  } catch {
    return undefined;
  }
}

/**
 * FAZ 1 ALLOWLIST'i. Yeni araç eklemek = bu diziye TANIM eklemek; router,
 * doğrulama ve sağlayıcı şema çevirisi DEĞİŞMEZ.
 */
export const MAVI_TOOLS: readonly ToolDefinition[] = [
  vehicleConnectionTool,
  liveSnapshotTool,
  dtcSummaryTool,
  openScreenTool,
  currentLocationTool,
];

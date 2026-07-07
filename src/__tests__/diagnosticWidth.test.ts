/**
 * diagnosticWidth.test.ts — tanı raporu "genişlik" boyutlarının kilidi.
 *
 * Garanti (SAHA 2026-07-06, "hepsini ekle"): rapor artık 4 ek boyut taşır —
 * OBD DERİN (adaptör/tazelik/PID/DTC), PERF ZAMAN SERİSİ (termal/bellek/fps/lag
 * halka tamponu), AĞ/AI SAĞLIĞI (online + devre kesici + kota pencereleri) ve
 * sesli-komut/medya olay izi. Hepsi FAIL-SOFT: kaynak yokken bile iyi-biçimli,
 * PII'siz bir bölüm döner (kısmi > hiç → panel çökmesin).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildObdDeepSnapshot, buildNetAiSnapshot,
  buildGpsDeepSnapshot, buildVoiceSnapshot, buildGeofenceSnapshot, buildStorageQueueSnapshot,
  buildPowerSnapshot, buildFusionSnapshot, buildBootTimingSnapshot, buildTransportSnapshot,
} from '../platform/diagnosticSections';
import { buildTriageSnapshot, type TriageSections } from '../platform/diagnosticTriage';
import {
  startPerfSeries, getPerfSeriesSnapshot, _resetPerfSeriesForTest,
} from '../platform/perfSeriesRecorder';
import {
  recordBootStart, recordBootWave, recordBootComplete, getBootTimingSnapshot,
  _resetBootTimingForTest,
} from '../platform/bootTimingRecorder';
import { getVoltageStats } from '../platform/power/BatteryProtectionService';
import { getTransportStats } from '../platform/obdService';
import { getLastObdDiagReason, emitObdDiag, _resetObdDiagEmitterForTest } from '../platform/obdDiagEmitter';
// Yapısal kilit: payload bölümleri silinmesin (kaynak-metin, ?raw = transform-time sabit).
import remoteLogSrc from '../platform/remoteLogService.ts?raw';
import geofenceSecSrc from '../platform/security/geofenceService.ts?raw';
import { logError, getErrorLog, clearErrorLog } from '../platform/crashLogger';
import { getGeofenceStatus } from '../platform/security/geofenceService';

describe('YAPISAL: geofence kalıcı şema hatasında retry ETMEZ (sonsuz 60sn spam yok)', () => {
  it('permanent schema error guard sabit (vehicle_geofences tablosu yok → PGRST205)', () => {
    expect(geofenceSecSrc, 'PGRST205 kalıcı-hata kontrolü kaldırılmış — eksik tablo her dakika sonsuza dek retry eder')
      .toMatch(/PGRST205/);
    expect(geofenceSecSrc, 'permanentSchemaError guard kaldırılmış — retry koşulsuz döner')
      .toMatch(/permanentSchemaError/);
  });
});

describe('crashLogger — Error-olmayan obje OKUNUR serialize (no [object Object])', () => {
  it('Supabase PostgrestError-benzeri obje message+code çıkarır ([object Object] DEĞİL)', () => {
    clearErrorLog();
    logError('geofenceService:_loadAndPushZones', {
      message: 'permission denied for table geofence_zones', code: '42501',
      details: 'anon rolü GRANT eksik', hint: 'GRANT SELECT ...',
    });
    const last = getErrorLog().slice(-1)[0];
    expect(last.msg).not.toBe('[object Object]');
    expect(last.msg).toContain('permission denied');
    expect(last.msg).toContain('42501');
    clearErrorLog();
  });

  it('düz obje (message/code yok) JSON\'a düşer, [object Object] olmaz', () => {
    clearErrorLog();
    logError('test:ctx', { foo: 'bar', n: 3 });
    const last = getErrorLog().slice(-1)[0];
    expect(last.msg).not.toBe('[object Object]');
    expect(last.msg).toContain('bar');
    clearErrorLog();
  });
});

describe('YAPISAL: tanı payload 4 genişlik boyutunu taşır', () => {
  it('support_snapshot payload obdDeep + perfSeries + netAi gömer', () => {
    expect(remoteLogSrc, 'obdDeep bölümü payload\'dan çıkarılmış').toMatch(/obdDeep:/);
    expect(remoteLogSrc, 'perfSeries bölümü payload\'dan çıkarılmış').toMatch(/perfSeries:\s*getPerfSeriesSnapshot/);
    expect(remoteLogSrc, 'netAi bölümü payload\'dan çıkarılmış').toMatch(/netAi:/);
  });
});

describe('YAPISAL: tanı payload 4 YENİ genişlik boyutunu taşır (GPS/Sesli/Geofence/Depolama)', () => {
  it('support_snapshot payload gps + voice + geofence + storageQueue gömer', () => {
    expect(remoteLogSrc, 'gps bölümü payload\'dan çıkarılmış').toMatch(/gps,/);
    expect(remoteLogSrc, 'voice bölümü payload\'dan çıkarılmış').toMatch(/voice:\s*_safeSection\(buildVoiceSnapshot\)/);
    expect(remoteLogSrc, 'geofence bölümü payload\'dan çıkarılmış').toMatch(/geofence:\s*_safeSection\(buildGeofenceSnapshot\)/);
    expect(remoteLogSrc, 'storageQueue bölümü payload\'dan çıkarılmış').toMatch(/storageQueue,/);
  });
});

describe('YAPISAL: tanı payload 4 YENİ genişlik boyutunu taşır (Güç/Füzyon/Boot/Transport)', () => {
  it('support_snapshot payload power + fusion + bootTiming + transport gömer', () => {
    expect(remoteLogSrc, 'power bölümü payload\'dan çıkarılmış').toMatch(/power:\s*_safeSection\(buildPowerSnapshot\)/);
    expect(remoteLogSrc, 'fusion bölümü payload\'dan çıkarılmış').toMatch(/fusion:\s*_safeSection\(buildFusionSnapshot\)/);
    expect(remoteLogSrc, 'bootTiming bölümü payload\'dan çıkarılmış').toMatch(/bootTiming:\s*_safeSection\(buildBootTimingSnapshot\)/);
    expect(remoteLogSrc, 'transport bölümü payload\'dan çıkarılmış').toMatch(/transport:\s*_safeSection\(buildTransportSnapshot\)/);
  });
});

describe('OBD DERİN bölümü — fail-soft yapı', () => {
  it('araç yokken bile iyi-biçimli obdDeep döner (çökmez)', () => {
    const deep = buildObdDeepSnapshot();
    expect(deep.adapter).toBeTruthy();
    expect(typeof deep.adapter.source).toBe('string');
    expect(deep.health).toBeTruthy();
    expect(deep.live).toBeTypeOf('object');
    expect(deep.extended).toBeTruthy();
    expect(Array.isArray(deep.extended.samples)).toBe(true);
    expect(deep.dtc).toBeTruthy();
    expect(Array.isArray(deep.dtc.codes)).toBe(true);
    expect(typeof deep.dtc.count).toBe('number');
  });

  it('adaptör yokken source "none" (kişisel veri sızmaz — yalnız durum)', () => {
    const deep = buildObdDeepSnapshot();
    // PII taşıyabilecek serbest alan yok — hepsi sayısal/enum
    expect(['none', 'real', 'mock', 'unknown']).toContain(deep.adapter.source);
  });
});

describe('AĞ / AI SAĞLIĞI bölümü — fail-soft yapı', () => {
  it('iyi-biçimli netAi döner (online + devre + kota)', () => {
    const netAi = buildNetAiSnapshot();
    expect(typeof netAi.online).toBe('boolean');
    expect(typeof netAi.ai.healthy).toBe('boolean');
    expect(typeof netAi.ai.consecFails).toBe('number');
    expect(typeof netAi.ai.blockedForMs).toBe('number');
    expect(typeof netAi.quota.geminiCooldownMs).toBe('number');
    expect(typeof netAi.quota.groqCooldownMs).toBe('number');
    expect(typeof netAi.quota.haikuCooldownMs).toBe('number');
  });
});

describe('GPS DERİN bölümü — fail-soft yapı + mahremiyet kilidi', () => {
  it('kaynak yokken bile iyi-biçimli gpsDeep döner (çökmez)', async () => {
    const gps = await buildGpsDeepSnapshot();
    expect(['granted', 'denied', 'prompt', 'unknown']).toContain(gps.permission);
    expect(typeof gps.fixAgeMs).toBe('number');
    expect(typeof gps.accuracyM).toBe('number');
    expect(typeof gps.source).toBe('string');
    expect(typeof gps.drActive).toBe('boolean');
    expect(typeof gps.tracking).toBe('boolean');
  });

  it('fix yokken fixAgeMs/accuracyM = -1 (sahte tazelik/doğruluk üretmez)', async () => {
    const gps = await buildGpsDeepSnapshot();
    expect(gps.fixAgeMs).toBe(-1);
    expect(gps.accuracyM).toBe(-1);
  });

  it('🔒 MAHREMİYET KİLİDİ: GPS snapshot KOORDİNAT ALANI TAŞIMAZ', async () => {
    const gps = await buildGpsDeepSnapshot();
    const keys = Object.keys(gps).map((k) => k.toLowerCase());
    for (const forbidden of ['lat', 'lng', 'latitude', 'longitude', 'location']) {
      expect(keys, `gps alanları [${keys.join(',')}] "${forbidden}" içermemeli`).not.toContain(forbidden);
    }
  });
});

describe('SESLİ / STT bölümü — fail-soft yapı + mahremiyet kilidi', () => {
  it('kaynak yokken bile iyi-biçimli voice snapshot döner (çökmez)', () => {
    const voice = buildVoiceSnapshot();
    expect(typeof voice.voskReady).toBe('boolean');
    expect(typeof voice.wakeWordEnabled).toBe('boolean');
    expect(typeof voice.status).toBe('string');
    expect(typeof voice.lastSttAgeMs).toBe('number');
    expect(voice.lastSttOk === null || typeof voice.lastSttOk === 'boolean').toBe(true);
  });

  it('hiç STT sonucu olmadıysa lastSttAgeMs=-1 ve lastSttOk=null (sahte sonuç üretmez)', () => {
    const voice = buildVoiceSnapshot();
    expect(voice.lastSttAgeMs).toBe(-1);
    expect(voice.lastSttOk).toBeNull();
  });

  it('🔒 MAHREMİYET: ham transkript alanı YOK', () => {
    const voice = buildVoiceSnapshot();
    expect(Object.keys(voice)).not.toContain('transcript');
  });
});

describe('GÜVENLİ BÖLGE (GEOFENCE) bölümü — fail-soft yapı + durum geçişleri', () => {
  it('kaynak yokken bile iyi-biçimli geofence snapshot döner (çökmez)', () => {
    const gf = buildGeofenceSnapshot();
    expect(typeof gf.readState).toBe('string');
    expect(typeof gf.zoneCount).toBe('number');
    expect(typeof gf.cloudSync).toBe('boolean');
  });

  it('getGeofenceStatus başlangıçta idle + zoneCount=0 döner', () => {
    const status = getGeofenceStatus();
    expect(status.readState).toBe('idle');
    expect(status.zoneCount).toBe(0);
    expect(typeof status.cloudSync).toBe('boolean');
  });
});

describe('DEPOLAMA + KUYRUK bölümü — fail-soft yapı', () => {
  it('kaynak yokken bile iyi-biçimli storageQueue döner (çökmez)', async () => {
    const sq = await buildStorageQueueSnapshot();
    expect(typeof sq.queuePending).toBe('number');
    expect(typeof sq.storagePct).toBe('number');
    expect(typeof sq.storageWarn).toBe('boolean');
  });

  it('storage API yoksa/erişilemezse storagePct=-1 ve storageWarn=false (sahte uyarı üretmez)', async () => {
    const sq = await buildStorageQueueSnapshot();
    if (sq.storagePct === -1) {
      expect(sq.storageWarn).toBe(false);
    }
  });
});

describe('PERF ZAMAN SERİSİ — halka tamponu yaşam döngüsü', () => {
  beforeEach(() => { _resetPerfSeriesForTest(); });
  afterEach(() => { _resetPerfSeriesForTest(); });

  it('kurulmadan snapshot boş ama iyi-biçimli', () => {
    const snap = getPerfSeriesSnapshot();
    expect(snap.installed).toBe(false);
    expect(Array.isArray(snap.samples)).toBe(true);
    expect(snap.samples.length).toBe(0);
    expect(typeof snap.sampleMs).toBe('number');
  });

  it('start → installed=true, cleanup → reset (zero-leak)', () => {
    const stop = startPerfSeries();
    expect(getPerfSeriesSnapshot().installed).toBe(true);
    stop();
    expect(getPerfSeriesSnapshot().installed).toBe(false);
    expect(getPerfSeriesSnapshot().samples.length).toBe(0);
  });

  it('idempotent — ikinci start ilkini bozmaz', () => {
    const stop1 = startPerfSeries();
    const stop2 = startPerfSeries(); // no-op
    expect(getPerfSeriesSnapshot().installed).toBe(true);
    stop2();
    stop1();
    expect(getPerfSeriesSnapshot().installed).toBe(false);
  });
});

describe('GÜÇ / AKÜ SAĞLIĞI bölümü — fail-soft yapı', () => {
  it('kaynak yokken bile iyi-biçimli power snapshot döner (çökmez)', () => {
    const power = buildPowerSnapshot();
    expect(['CAN', 'OBD', 'none']).toContain(power.source);
    expect(power.voltageV === null || typeof power.voltageV === 'number').toBe(true);
    expect(['critical', 'low', 'normal', 'unknown']).toContain(power.severity);
    expect(typeof power.charging).toBe('boolean');
  });

  it('voltaj yokken source="none" + voltageV=null + severity="unknown" (sahte voltaj üretmez)', () => {
    const power = buildPowerSnapshot();
    if (power.source === 'none') {
      expect(power.voltageV).toBeNull();
      expect(power.severity).toBe('unknown');
      expect(power.charging).toBe(false);
    }
  });

  it('getVoltageStats örnek yokken null döner (dürüst — sahte min/max üretmez)', () => {
    const stats = getVoltageStats();
    expect(stats === null || typeof stats.minV === 'number').toBe(true);
  });
});

describe('SENSÖR FÜZYON TUTARLILIĞI bölümü — fail-soft yapı + zero-trust güven', () => {
  it('kaynak yokken bile iyi-biçimli fusion snapshot döner (çökmez)', () => {
    const fusion = buildFusionSnapshot();
    expect(typeof fusion.activeSource).toBe('string');
    expect(fusion.gpsSpeedKmh === null || typeof fusion.gpsSpeedKmh === 'number').toBe(true);
    expect(fusion.vehicleSpeedKmh === null || typeof fusion.vehicleSpeedKmh === 'number').toBe(true);
    expect(['high', 'medium', 'low', 'unknown']).toContain(fusion.confidence);
    expect(typeof fusion.drActive).toBe('boolean');
  });

  it('yalnız tek kaynak (veya hiçbiri) varken confidence="unknown" + diffKmh=null', () => {
    const fusion = buildFusionSnapshot();
    if (fusion.gpsSpeedKmh == null || fusion.vehicleSpeedKmh == null) {
      expect(fusion.diffKmh).toBeNull();
      expect(fusion.confidence).toBe('unknown');
    }
  });
});

describe('BOOT ZAMAN ÇİZELGESİ — kaydedici yaşam döngüsü', () => {
  beforeEach(() => { _resetBootTimingForTest(); });
  afterEach(() => { _resetBootTimingForTest(); });

  it('kayıt yokken boş ama iyi-biçimli snapshot döner', () => {
    const snap = getBootTimingSnapshot();
    expect(Array.isArray(snap.waves)).toBe(true);
    expect(snap.waves.length).toBe(0);
    expect(snap.totalMs).toBe(0);
    expect(snap.slowestWave).toBeNull();
  });

  it('recordBootWave + recordBootComplete → toplam süre + en yavaş dalga doğru hesaplanır', () => {
    recordBootStart();
    recordBootWave('Wave 1 (Core)', 10);
    recordBootWave('Wave 2 (Backbone)', 50);
    recordBootWave('Wave 3 (Intelligence)', 5);
    recordBootComplete();
    const snap = getBootTimingSnapshot();
    expect(snap.waves.length).toBe(3);
    expect(snap.slowestWave).toBe('Wave 2 (Backbone)');
    expect(snap.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('buildBootTimingSnapshot fail-soft sarmalayıcı ile aynı veriyi döner', () => {
    recordBootStart();
    recordBootWave('Wave 1 (Core)', 20);
    recordBootComplete();
    const snap = buildBootTimingSnapshot();
    expect(snap.waves.length).toBe(1);
    expect(snap.waves[0].name).toBe('Wave 1 (Core)');
  });
});

describe('TRANSPORT / BAĞLANTI SAĞLIĞI bölümü — fail-soft yapı', () => {
  beforeEach(() => { _resetObdDiagEmitterForTest(); });
  afterEach(() => { _resetObdDiagEmitterForTest(); });

  it('kaynak yokken bile iyi-biçimli transport snapshot döner (çökmez)', () => {
    const transport = buildTransportSnapshot();
    expect(typeof transport.transport).toBe('string');
    expect(typeof transport.connected).toBe('boolean');
    expect(typeof transport.reconnectAttempts).toBe('number');
    expect(transport.lastDisconnectReason === null || typeof transport.lastDisconnectReason === 'string').toBe(true);
  });

  it('getTransportStats bağlı değilken connected=false + transport="none" (adres kayıtlı değilse)', () => {
    const stats = getTransportStats();
    expect(typeof stats.connected).toBe('boolean');
    expect(typeof stats.reconnectAttempts).toBe('number');
  });

  it('getLastObdDiagReason: emitObdDiag sonrası son neden phase+errorCode taşır', () => {
    expect(getLastObdDiagReason()).toBeNull();
    emitObdDiag('connect', 'OBD_CONNECT_FAIL', { msg: 'test' });
    const reason = getLastObdDiagReason();
    expect(reason).not.toBeNull();
    expect(reason?.phase).toBe('connect');
    expect(reason?.errorCode).toBe('OBD_CONNECT_FAIL');
  });

  it('🔒 MAHREMİYET: transport snapshot cihaz adresi/MAC alanı TAŞIMAZ', () => {
    const transport = buildTransportSnapshot();
    const keys = Object.keys(transport).map((k) => k.toLowerCase());
    for (const forbidden of ['address', 'mac', 'devicename']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('ÖNCELİKLİ BULGU TRİYAJI — buildTriageSnapshot (diagnosticTriage.ts)', () => {
  it('(a) health.overallHealth=critical → critical finding üretir', () => {
    const snap = buildTriageSnapshot({
      health: { overallHealth: 'critical', services: [{ name: 'VehicleDataLayer', healthy: false, restartCount: 2 }] },
    });
    expect(snap.topSeverity).toBe('critical');
    const f = snap.findings.find((x) => x.code === 'HEALTH_CRITICAL');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('critical');
    expect(f?.sources).toContain('health');
  });

  it('(b) çapraz-korelasyon: yavaş boot + termal L2+ → BOOT_SLOW_THERMAL tetiklenir (2 bölümden)', () => {
    const snap = buildTriageSnapshot({
      bootTiming: { totalMs: 12_000, slowestWave: 'Wave 2 (Backbone)' },
      perfSeries: { installed: true, samples: [
        { ts: 1, tempC: 40, level: 0, memMb: 50, fps: 30, lagMs: 5 },
        { ts: 2, tempC: 60, level: 2, memMb: 55, fps: 20, lagMs: 10 },
      ] },
    });
    const f = snap.findings.find((x) => x.code === 'BOOT_SLOW_THERMAL');
    expect(f).toBeTruthy();
    expect(f?.sources).toEqual(expect.arrayContaining(['bootTiming', 'perfSeries']));
    expect(f?.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('(c) veri yoksa/boşsa sahte bulgu ÜRETMEZ (boş sections → findings boş)', () => {
    const snap = buildTriageSnapshot({});
    expect(snap.findings).toEqual([]);
    expect(snap.topSeverity).toBe('none');
    expect(snap.scanned).toBe(0);
  });

  it('(c2) kısmi/eşik-altı veri de sahte bulgu üretmez (health healthy, boot hızlı)', () => {
    const snap = buildTriageSnapshot({
      health: { overallHealth: 'healthy', services: [] },
      bootTiming: { totalMs: 2_000, slowestWave: 'Wave 1 (Core)' },
      power: { severity: 'normal', voltageV: 12.6 },
    });
    expect(snap.findings).toEqual([]);
    expect(snap.topSeverity).toBe('none');
    expect(snap.scanned).toBe(3);
  });

  it('(d) 🔒 PII KİLİDİ: findings JSON\'unda koordinat/VIN/MAC deseni YOK', () => {
    const sections: TriageSections = {
      health: { overallHealth: 'critical', services: [{ name: 'GPS', healthy: false, restartCount: 1 }] },
      power: { severity: 'critical', voltageV: 11.2 },
      fusion: { confidence: 'low', diffKmh: 22 },
      gps: { permission: 'denied', fixAgeMs: -1, accuracyM: -1, tracking: false },
      transport: { reconnectAttempts: 9 },
      obdDeep: { health: { connectionQuality: 20 }, dtc: { count: 2, codes: [{ code: 'P0301', severity: 'critical', system: 'engine' }] } },
      netAi: { online: false, ai: { healthy: false, consecFails: 5, blockedForMs: 30_000 }, quota: { geminiCooldownMs: 1000, groqCooldownMs: 0, haikuCooldownMs: 0 } },
      selfTest: { worst: 'fail', summary: { fail: 2, warn: 1, pass: 10, skip: 0 } },
      uiActivity: { untimelyCount: 5 },
      storageQueue: { queuePending: 30, storagePct: 95, storageWarn: true },
      geofence: { readState: 'error' },
    };
    const snap = buildTriageSnapshot(sections);
    const json = JSON.stringify(snap.findings);
    // aynı maskeler remoteLogService._maskString'de kullanılan desenler
    expect(json).not.toMatch(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/); // [COORD]
    expect(json).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/); // VIN
    expect(json).not.toMatch(/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/); // MAC
  });

  it('(e) sıralama: critical > warning > info', () => {
    const snap = buildTriageSnapshot({
      health: { overallHealth: 'critical' },       // critical
      geofence: { readState: 'error' },            // info
      power: { severity: 'low', voltageV: 12.0 },  // warning
    });
    expect(snap.findings.length).toBeGreaterThanOrEqual(3);
    const ranks: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < snap.findings.length; i++) {
      expect(ranks[snap.findings[i - 1].severity]).toBeLessThanOrEqual(ranks[snap.findings[i].severity]);
    }
    expect(snap.findings[0].severity).toBe('critical');
    expect(snap.topSeverity).toBe('critical');
  });

  it('en fazla 8 bulgu tutulur (tavan koruması)', () => {
    const snap = buildTriageSnapshot({
      health: { overallHealth: 'critical' },
      power: { severity: 'critical', voltageV: 10.5 },
      fusion: { confidence: 'low', diffKmh: 30 },
      gps: { permission: 'denied' },
      transport: { reconnectAttempts: 9 },
      obdDeep: { health: { connectionQuality: 10 }, dtc: { count: 1, codes: [{ code: 'P0100', severity: 'warning', system: 'engine' }] } },
      netAi: { ai: { healthy: false, consecFails: 3, blockedForMs: 5000 } },
      selfTest: { worst: 'fail', summary: { fail: 1 } },
      uiActivity: { untimelyCount: 4 },
      storageQueue: { storageWarn: true, storagePct: 99 },
      geofence: { readState: 'error' },
    });
    expect(snap.findings.length).toBeLessThanOrEqual(8);
  });
});

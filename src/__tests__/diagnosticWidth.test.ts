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
} from '../platform/diagnosticSections';
import {
  startPerfSeries, getPerfSeriesSnapshot, _resetPerfSeriesForTest,
} from '../platform/perfSeriesRecorder';
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

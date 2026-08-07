/**
 * companionActiveTopic.test.ts — kısa süreli konuşma bağlamı (Görev 2).
 *
 * ── DİKEY AKIŞ (kilitlenen) ─────────────────────────────────────────────────
 *   araç yorumu (buildInterpretedVehicleContext)
 *     → bounded topic yazımı (allowlist kimliği)
 *       → takip sorusu
 *         → GERÇEK prompt okuyucusu (buildCompanionSystemPrompt)
 *           → bounded ipucu satırı
 *             → belirsizlikte fail-closed netleştirme
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · Yalnız RAM (persist YOK) · timer/poll YOK · serbest metin konu OLAMAZ.
 *  · Aktif konu bulunması belirsiz eylemi ASLA otomatik yürütmez.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Araç kaynakları — yorum üretimini test başına kontrol ederiz. */
const OBD = vi.hoisted(() => ({
  engineTemp: 88, fuelLevel: 60, batteryLevel: -1, range: -1, estimatedRangeKm: -1,
}));
vi.mock('../platform/obdService', () => ({
  onOBDData: (cb: (d: Record<string, unknown>) => void) => {
    cb({
      vehicleType: 'ice', speed: 40, rpm: 1800,
      engineTemp: OBD.engineTemp, fuelLevel: OBD.fuelLevel,
      estimatedRangeKm: OBD.estimatedRangeKm, range: OBD.range,
      batteryLevel: OBD.batteryLevel, chargingState: 'not_charging',
    });
    return () => {};
  },
}));
const TREND = vi.hoisted(() => ({ historyCount: 0, lastDtcCode: null as string | null }));
vi.mock('../platform/ai/mechanic/concrete/maviMechanicHistory', () => ({
  readDiagnosticTrendInput: () => ({
    historyCount: TREND.historyCount, lastDtcCode: TREND.lastDtcCode,
  }),
}));
vi.mock('../platform/tripLogService', () => ({
  getTripSnapshot: () => ({ active: false, current: null, history: [], totalDistanceKm: 0, totalTrips: 0 }),
}));
vi.mock('../platform/dtcService', () => ({
  onDTCState: (cb: (s: { codes: unknown[] }) => void) => { cb({ codes: [] }); return () => {}; },
}));
vi.mock('../platform/navigationService', () => ({
  getNavigationState: () => ({ isNavigating: false }),
}));

import {
  selectActiveTopic, topicFreshness, buildTopicHintLine, resolveDemonstrativeReference,
  isCompanionTopicId, topicLabelTr,
  TOPIC_MAX_TURN_AGE, TOPIC_HINT_MAX_CHARS, COMPANION_TOPIC_PRIORITY,
} from '../platform/companion/companionContext';
import {
  _buildPromptForTest, getActiveTopicSnapshot, evaluateDemonstrativeRequest,
  _resetCompanionChatForTest,
} from '../platform/companion/companionChatProvider';

/** Motor ısınma eşiği: interpretEngineTempConcern > 105 °C. */
const HOT = 112;
const NORMAL_TEMP = 88;

beforeEach(() => {
  _resetCompanionChatForTest();
  OBD.engineTemp = NORMAL_TEMP;
  OBD.fuelLevel = 60;
  OBD.batteryLevel = -1;
  OBD.range = -1;
  OBD.estimatedRangeKm = -1;
  TREND.historyCount = 0;
  TREND.lastDtcCode = null;
});

/* ── 1. Gerçek yazan: araç yorumu → konu ────────────────────── */

describe('1 — motor sıcaklığı yorumu üretilince aktif konu yazılır', () => {
  it('ısınan motor → engine_temperature; normalde o konu yazılmaz', () => {
    OBD.engineTemp = HOT;
    _buildPromptForTest();
    expect(getActiveTopicSnapshot().topic).toBe('engine_temperature');

    _resetCompanionChatForTest();
    OBD.engineTemp = NORMAL_TEMP;   // 50..105 arası → interpretEngineTempConcern null
    _buildPromptForTest();
    expect(getActiveTopicSnapshot().topic).not.toBe('engine_temperature');
  });

  it('öncelik: motor sıcaklığı arıza eğilimini ve yakıtı EZER', () => {
    OBD.engineTemp = HOT;
    TREND.historyCount = 3; TREND.lastDtcCode = 'P0301';
    _buildPromptForTest();
    expect(getActiveTopicSnapshot().topic).toBe('engine_temperature');
  });

  it('yalnız arıza eğilimi varsa diagnostic_trend seçilir', () => {
    TREND.historyCount = 2; TREND.lastDtcCode = 'P0420';
    _buildPromptForTest();
    expect(getActiveTopicSnapshot().topic).toBe('diagnostic_trend');
  });
});

/* ── 2 + 3. Gerçek okuyan: takip sorusunda prompt ipucu ────── */

describe('2/3 — takip sorusunda bounded ipucu prompt\'a girer; konu yoksa GİRMEZ', () => {
  it('ilk tur ipucu YOK; TAKİP turunda ipucu VAR', () => {
    OBD.engineTemp = HOT;
    const first = _buildPromptForTest();
    expect(first).not.toContain('ÖNCEKİ KONU');   // konu bu turda doğdu → ipucu değil

    const followUp = _buildPromptForTest();       // takip sorusu
    expect(followUp).toContain('ÖNCEKİ KONU');
    expect(followUp).toContain('motor sıcaklığı');
    // ZORLAYICI DEĞİL: netleştirme talimatı taşımalı, "kesin bunu varsay" DEMEMELİ.
    expect(followUp).toContain('netleştir');
    expect(followUp).not.toContain('kesin olarak bunu varsay');
  });

  it('hiç yorum üretilmeyen oturumda ipucu HİÇ eklenmez', () => {
    OBD.engineTemp = -50;   // geçersiz → yorum yok
    OBD.fuelLevel = -1;     // geçersiz → yorum yok
    _buildPromptForTest();
    const second = _buildPromptForTest();
    expect(second).not.toContain('ÖNCEKİ KONU');
    expect(getActiveTopicSnapshot().topic).toBeNull();
  });
});

/* ── 4. Süresi geçmiş konu okunmaz (PASİF bitiş) ───────────── */

describe('4 — süresi geçmiş konu okunmaz ve RAM\'den düşer', () => {
  it(`konu ${TOPIC_MAX_TURN_AGE} turdan sonra ipucu üretmez`, () => {
    OBD.engineTemp = HOT;
    _buildPromptForTest();                       // tur 1 — konu yazıldı
    // Sonraki turlarda HİÇBİR yorum üretilmemeli, yoksa konu her turda TAZELENİR
    // (yakıt yorumu da bir konu üreticisidir — bu yüzden o da kapatılır).
    OBD.engineTemp = NORMAL_TEMP;
    OBD.fuelLevel = -1;

    let last = '';
    for (let i = 0; i < TOPIC_MAX_TURN_AGE; i++) last = _buildPromptForTest();
    expect(last).toContain('ÖNCEKİ KONU');       // sınır içinde hâlâ okunur

    const expired = _buildPromptForTest();       // sınır aşıldı
    expect(expired).not.toContain('ÖNCEKİ KONU');
    expect(getActiveTopicSnapshot().topic).toBeNull();   // pasif temizlik
  });

  it('saf tazelik kuralı: negatif/geçersiz tur farkı expired (fail-closed)', () => {
    expect(topicFreshness(0)).toBe('fresh');
    expect(topicFreshness(1)).toBe('fresh');
    expect(topicFreshness(2)).toBe('aging');
    expect(topicFreshness(TOPIC_MAX_TURN_AGE)).toBe('aging');
    expect(topicFreshness(TOPIC_MAX_TURN_AGE + 1)).toBe('expired');
    expect(topicFreshness(-1)).toBe('expired');
    expect(topicFreshness(NaN)).toBe('expired');
  });
});

/* ── 5. Yeniden başlatmada konu GERİ GELMEZ ────────────────── */

describe('5 — konu yalnız RAM\'de; oturum bitince yok olur', () => {
  it('reset (yeniden başlatma vekili) sonrası konu YOK', () => {
    OBD.engineTemp = HOT;
    _buildPromptForTest();
    expect(getActiveTopicSnapshot().topic).toBe('engine_temperature');

    _resetCompanionChatForTest();
    expect(getActiveTopicSnapshot().topic).toBeNull();
    expect(_buildPromptForTest()).not.toContain('ÖNCEKİ KONU');
  });

  it('KAYNAK KİLİDİ: konu durumu kalıcı depoya YAZILMAZ', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'companion', 'companionChatProvider.ts'), 'utf-8');
    const block = src.slice(src.indexOf('let _topicTurn'), src.indexOf('function buildInterpretedVehicleContext'));
    for (const forbidden of ['safeSetRaw', 'localStorage', 'setInterval', 'setTimeout', 'safeStorage']) {
      expect(block, `konu bloğu '${forbidden}' kullanmamalı`).not.toContain(forbidden);
    }
  });
});

/* ── 6. Ham DTC / kullanıcı mesajı SIZMAZ ──────────────────── */

describe('6 — konu state\'ine ham veri sızmaz (allowlist kimliği)', () => {
  it('ham DTC kodu konu kimliği OLAMAZ', () => {
    TREND.historyCount = 4; TREND.lastDtcCode = 'P0301';
    _buildPromptForTest();
    const snap = getActiveTopicSnapshot();
    expect(snap.topic).toBe('diagnostic_trend');
    expect(JSON.stringify(snap)).not.toContain('P0301');

    const hint = _buildPromptForTest();
    expect(hint).toContain('geçmiş arıza kaydı');
    expect(hint).not.toContain('P0301');
  });

  it('serbest metin izinli konu kimliği DEĞİLDİR', () => {
    for (const bad of ['P0301', 'motor çok ısındı', '', 'Bunu hatırlat', 42, null, {}]) {
      expect(isCompanionTopicId(bad)).toBe(false);
      expect(topicLabelTr(bad)).toBeNull();
      expect(buildTopicHintLine(bad, 'fresh')).toBeNull();
    }
    for (const ok of COMPANION_TOPIC_PRIORITY) expect(isCompanionTopicId(ok)).toBe(true);
  });

  it('ipucu satırı bounded', () => {
    for (const t of COMPANION_TOPIC_PRIORITY) {
      for (const f of ['fresh', 'aging'] as const) {
        expect(buildTopicHintLine(t, f)!.length).toBeLessThanOrEqual(TOPIC_HINT_MAX_CHARS);
      }
      expect(buildTopicHintLine(t, 'expired')).toBeNull();
    }
  });
});

/* ── 7. Belirsiz zamir → eylem YOK, netleştirme ŞART ───────── */

describe('7 — "bunu sonra hatırlat" otomatik eylem ÜRETMEZ', () => {
  it('aktif konu VARKEN bile netleştirme gerekir (konu eylem yetkisi VERMEZ)', () => {
    OBD.engineTemp = HOT;
    _buildPromptForTest();
    expect(getActiveTopicSnapshot().topic).toBe('engine_temperature');

    const r = evaluateDemonstrativeRequest('bunu sonra hatırlat');
    expect(r.ambiguous).toBe(true);
    expect(r.needsClarification).toBe(true);            // ← eylem YOK
    expect(r.clarificationText).toContain('motor sıcaklığı');
    expect(r.clarificationText).toMatch(/\?$/);         // soru sorar
  });

  it('konu yokken de netleştirme ister (genel soru)', () => {
    const r = evaluateDemonstrativeRequest('şunu kaydet');
    expect(r.needsClarification).toBe(true);
    expect(r.clarificationText).not.toBeNull();
  });

  it('zamir VAR ama eylem fiili YOK → belirsizlik sayılmaz', () => {
    expect(resolveDemonstrativeReference('bunu anlamadım').needsClarification).toBe(false);
    expect(resolveDemonstrativeReference('onu sevdim').ambiguous).toBe(false);
  });
});

/* ── 8. Normal bağımsız sorular ESKİ davranışla ────────────── */

describe('8 — bağımsız sorular eski davranışı korur', () => {
  it('açık nesneli komutta netleştirme İSTENMEZ', () => {
    for (const t of [
      'yarın saat sekizde lastik kontrolünü hatırlat',
      'evi navigasyona kaydet',
      'sesi ayarla',
      '',
    ]) {
      expect(evaluateDemonstrativeRequest(t).needsClarification, t).toBe(false);
    }
  });

  it('konu ipucu prompt\'un DİĞER bölümlerini bozmaz', () => {
    OBD.engineTemp = HOT;
    _buildPromptForTest();
    const p = _buildPromptForTest();
    expect(p).toContain('yol arkadaşısın');            // kişilik omurgası duruyor
    expect(p).toContain('SÜRÜCÜNÜN MEVCUT DURUMU');    // araç bağlamı duruyor
  });
});

/* ── Saf katman sözleşmesi ─────────────────────────────────── */

describe('saf katman — selectActiveTopic', () => {
  it('bayrak yoksa null (uydurma konu YOK)', () => {
    expect(selectActiveTopic(null)).toBeNull();
    expect(selectActiveTopic({})).toBeNull();
    expect(selectActiveTopic({ fuelLevel: false })).toBeNull();
  });

  it('öncelik sırası deterministik', () => {
    expect(selectActiveTopic({ engineTemperature: true, fuelLevel: true })).toBe('engine_temperature');
    expect(selectActiveTopic({ diagnosticTrend: true, batteryCharge: true })).toBe('diagnostic_trend');
    expect(selectActiveTopic({ fuelLevel: true, batteryCharge: true })).toBe('fuel_level');
    expect(selectActiveTopic({ batteryCharge: true })).toBe('battery_charge');
  });

  /* TTL UYDURULMADI: tur ölçüsü MAX_HISTORY_TURNS'ten (8 = 4 kullanıcı + 4 model)
     türetildi — modelin görebildiği kullanıcı turu sayısı. */
  it('TOPIC_MAX_TURN_AGE mevcut MAX_HISTORY_TURNS deseninden türetilir', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'companion', 'companionChatProvider.ts'), 'utf-8');
    const m = src.match(/const MAX_HISTORY_TURNS = (\d+)/);
    expect(m).not.toBeNull();
    expect(TOPIC_MAX_TURN_AGE).toBe(Number(m![1]) / 2);   // 8 / 2 = 4 kullanıcı turu
  });
});

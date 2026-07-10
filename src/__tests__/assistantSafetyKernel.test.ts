/**
 * assistantSafetyKernel.test.ts — Companion Safety Kernel & Response Verifier (PR-A).
 *
 * Kilitler: kritik durumda PRE-GATE online'ı engeller (hararet/yağ/fren/şanzıman/
 * şarj/tanı/uykululuk) · driveSafe/severity kararı korunur · POST-GATE yanlış
 * rahatlatma/telemetri çelişkisi/sızıntıyı değiştirir · kritik olmayan geçer ·
 * sürüşte kısaltma / parkta uzun · fail-closed · girdi mutate edilmez · mevcut
 * güvenlik şablonları/klipleri kullanılır · buildSafetyContext fail-soft + canlı wiring.
 *
 * SAF fonksiyonlar (evaluatePreGate/verifyResponse) enjekte edilen bağlamla test
 * edilir (mock GEREKMEZ). buildSafetyContext testleri için OBD/DTC/tanı mock'lanır;
 * bilişsel/reverse gerçek zustand store'larından sürülür.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ── buildSafetyContext canlı kaynak mock'ları (yalnız o testler için) ── */
const OBD = vi.hoisted(() => ({ engineTemp: 88, batteryVoltage: 13.8, throwOnSub: false }));
vi.mock('../platform/obdService', () => ({
  onOBDData: (cb: (d: Record<string, unknown>) => void) => {
    if (OBD.throwOnSub) throw new Error('obd patladı');
    cb({ engineTemp: OBD.engineTemp, batteryVoltage: OBD.batteryVoltage });
    return () => {};
  },
}));
const DTC = vi.hoisted(() => ({ codes: [] as { code: string }[] }));
vi.mock('../platform/dtcService', () => ({
  onDTCState: (cb: (s: { codes: { code: string }[] }) => void) => {
    cb({ codes: DTC.codes });
    return () => {};
  },
}));
const DIAG = vi.hoisted(() => ({ map: {} as Record<string, { severity: string; driveSafe: boolean }> }));
vi.mock('../platform/diagnosticKnowledgeEngine', () => ({
  diagnoseDtc: (code: string) => DIAG.map[code] ?? { severity: 'info', driveSafe: true },
}));

import {
  evaluatePreGate,
  verifyResponse,
  buildSafetyContext,
  SAFETY_TEMPLATES,
  type SafetyContext,
} from '../platform/assistant/assistantSafetyKernel';
import { useCognitiveStore } from '../store/useCognitiveStore';
import { useSystemStore } from '../store/useSystemStore';

beforeEach(() => {
  OBD.engineTemp = 88; OBD.batteryVoltage = 13.8; OBD.throwOnSub = false;
  DTC.codes = []; DIAG.map = {};
  useCognitiveStore.getState().setMode('IMMERSIVE');
  useSystemStore.getState().setReverse(false);
});

/* ══════════════ PRE-GATE — kritik durumlar online'ı engeller ══════════════ */
describe('PRE-GATE', () => {
  it('kritik hararet → online engellenir + şablon', () => {
    const r = evaluatePreGate({ engineOverheat: true });
    expect(r.allowOnline).toBe(false);
    expect(r.safetyTemplateId).toBe('engine_overheat');
    expect(r.deterministicResponse).toBe(SAFETY_TEMPLATES.engine_overheat.text);
    expect(r.severity).toBe('critical');
    expect(r.driveSafe).toBe(false);
  });

  it('yağ basıncı kritik → online engellenir', () => {
    const r = evaluatePreGate({ oilPressureCritical: true });
    expect(r.allowOnline).toBe(false);
    expect(r.safetyTemplateId).toBe('oil_pressure_critical');
  });

  it('fren sistemi kritik → online engellenir', () => {
    const r = evaluatePreGate({ brakeSystemCritical: true });
    expect(r.allowOnline).toBe(false);
    expect(r.safetyTemplateId).toBe('brake_system_critical');
  });

  it('şanzıman + şarj kritik → online engellenir', () => {
    expect(evaluatePreGate({ transmissionOverheat: true }).allowOnline).toBe(false);
    expect(evaluatePreGate({ chargingSystemCritical: true }).safetyTemplateId).toBe('charging_system_critical');
  });

  it('driveSafe=false KORUNUR → online engellenir + service_required', () => {
    const r = evaluatePreGate({ diagnosticDriveSafe: false });
    expect(r.allowOnline).toBe(false);
    expect(r.driveSafe).toBe(false);
    expect(r.safetyTemplateId).toBe('service_required');
  });

  it('severity=critical KORUNUR → online engellenir + critical', () => {
    const r = evaluatePreGate({ diagnosticSeverityCritical: true });
    expect(r.allowOnline).toBe(false);
    expect(r.severity).toBe('critical');
  });

  it('uykululuk kritik → online engellenir', () => {
    expect(evaluatePreGate({ drowsinessCritical: true }).safetyTemplateId).toBe('drowsiness_critical');
  });

  it('reverse aktif → online engellenir (kısa erteleme, arıza değil)', () => {
    const r = evaluatePreGate({ reverseActive: true });
    expect(r.allowOnline).toBe(false);
    expect(r.severity).toBe('none');
    expect(r.deterministicResponse).toBe(SAFETY_TEMPLATES.reverse_attention.text);
  });

  it('cognitive >= PROTECTION → online engellenir AMA yerel şablon YOK (offline\'a düşer)', () => {
    const r = evaluatePreGate({ cognitiveModeRank: 3 });
    expect(r.allowOnline).toBe(false);
    expect(r.deterministicResponse).toBeNull();
    expect(r.reason).toBe('cognitive_protection');
  });

  it('kritik olmayan bağlam → online GEÇER', () => {
    expect(evaluatePreGate({}).allowOnline).toBe(true);
    expect(evaluatePreGate({ cognitiveModeRank: 1, reverseActive: false, diagnosticDriveSafe: true }).allowOnline).toBe(true);
  });

  it('fail-closed dostu: null/undefined bağlam throw ETMEZ (güvenli varsayım: geçer)', () => {
    expect(() => evaluatePreGate(undefined)).not.toThrow();
    expect(evaluatePreGate(null).allowOnline).toBe(true);
  });

  it('girdi bağlamı MUTATE edilmez', () => {
    const ctx: SafetyContext = { engineOverheat: true };
    const snap = JSON.stringify(ctx);
    evaluatePreGate(ctx);
    expect(JSON.stringify(ctx)).toBe(snap);
  });
});

/* ══════════════ POST-GATE / Response Verifier ══════════════ */
describe('POST-GATE / verifyResponse', () => {
  it('kritik durumda online cevap TAMAMEN atılır → deterministic', () => {
    const pg = verifyResponse('Motor iyi görünüyor, güvenle devam edebilirsin.', { engineOverheat: true }, { isDriving: true });
    expect(pg.action).toBe('replaced');
    expect(pg.reason).toBe('critical_state_override');
    expect(pg.response).toBe(SAFETY_TEMPLATES.engine_overheat.text);
  });

  it('telemetri çelişkisi (hararet var → "motor normal") reddedilir', () => {
    const pg = verifyResponse('Merak etme, motor sıcaklığı gayet normal.', { engineOverheat: true });
    expect(pg.action).toBe('replaced'); // kritik override zaten yakalar
  });

  it('driveSafe=false + yanlış rahatlatma → service_required ile değişir', () => {
    // Kritik-severity DEĞİL ama driveSafe=false: PRE zaten bloklar; verifier de değiştirir.
    const pg = verifyResponse('Sorun yok, rahatça gidebilirsin.', { diagnosticDriveSafe: false });
    expect(pg.action).toBe('replaced');
    expect(pg.response).toBe(SAFETY_TEMPLATES.service_required.text);
  });

  it('kritik olmayan durumda normal cevap GEÇER (mutate yok)', () => {
    const text = 'İyiyim, sen nasılsın?';
    const pg = verifyResponse(text, {});
    expect(pg.action).toBe('passed');
    expect(pg.response).toBe(text);
  });

  it('gizli/ham bağlam sızıntısı (VIN/koordinat/JSON) → güvenli genel yanıt', () => {
    expect(verifyResponse('Aracın VIN\'i 1HGCM82633A004352 imiş.', {}).reason).toBe('context_leak');
    expect(verifyResponse('Konumun 41.0082, 28.9784 civarı.', {}).reason).toBe('context_leak');
    expect(verifyResponse('İşte veri: {"fuel": 23}', {}).reason).toBe('context_leak');
  });

  it('sürüşte uzun cevap KISALTILIR', () => {
    const long = 'Bu çok uzun bir cevap. '.repeat(20); // ~460 char
    const pg = verifyResponse(long, {}, { isDriving: true });
    expect(pg.action).toBe('truncated');
    expect(pg.response.length).toBeLessThanOrEqual(200);
  });

  it('park halinde daha uzun cevap KABUL edilir', () => {
    const mid = 'Bu orta uzunlukta bir cevap. '.repeat(8); // ~232 char < 400
    const pg = verifyResponse(mid, {}, { isDriving: false });
    expect(pg.action).toBe('passed');
  });

  it('geçersiz girdi throw ETMEZ (fail-soft)', () => {
    expect(() => verifyResponse(undefined as unknown as string, {})).not.toThrow();
  });
});

/* ══════════════ Şablonlar — mevcut doğrulanmış klipler ══════════════ */
describe('SAFETY_TEMPLATES', () => {
  it('mevcut ses klipleri referanslı (public/voice envanteri)', () => {
    expect(SAFETY_TEMPLATES.engine_overheat.clipId).toBe('safety-overheat');
    expect(SAFETY_TEMPLATES.oil_pressure_critical.clipId).toBe('safety-battery-oil');
    expect(SAFETY_TEMPLATES.charging_system_critical.clipId).toBe('safety-battery-oil');
  });

  it('hiçbir şablon belirsiz "devam edebilirsiniz" rahatlatması içermez', () => {
    for (const t of Object.values(SAFETY_TEMPLATES)) {
      expect(/güvenle devam|sorun yok|önemli değil/i.test(t.text)).toBe(false);
      expect(t.text.length).toBeLessThanOrEqual(120); // kısa
    }
  });
});

/* ══════════════ buildSafetyContext — canlı wiring + fail-soft ══════════════ */
describe('buildSafetyContext', () => {
  it('normal veri → boş/güvenli bağlam (online açık)', () => {
    const ctx = buildSafetyContext();
    expect(ctx.engineOverheat).toBeUndefined();
    expect(ctx.chargingSystemCritical).toBeUndefined();
    expect(evaluatePreGate(ctx).allowOnline).toBe(true);
  });

  it('OBD hararet >= 118°C → engineOverheat true (canlı eşik)', () => {
    OBD.engineTemp = 125;
    expect(buildSafetyContext().engineOverheat).toBe(true);
  });

  it('OBD hararet geçerli aralık dışı (>130) → yanlış-pozitif YOK', () => {
    OBD.engineTemp = 500;
    expect(buildSafetyContext().engineOverheat).toBeUndefined();
  });

  it('12V voltaj < 11.8 → chargingSystemCritical true', () => {
    OBD.batteryVoltage = 11.2;
    expect(buildSafetyContext().chargingSystemCritical).toBe(true);
  });

  it('reverse store aktif → reverseActive true', () => {
    useSystemStore.getState().setReverse(true);
    expect(buildSafetyContext().reverseActive).toBe(true);
  });

  it('cognitive PROTECTION → modeRank yansır', () => {
    useCognitiveStore.getState().setMode('PROTECTION');
    expect(buildSafetyContext().cognitiveModeRank).toBeGreaterThanOrEqual(3);
  });

  it('aktif DTC driveSafe=false → diagnosticDriveSafe false (tanı motorundan)', () => {
    DTC.codes = [{ code: 'P0300' }];
    DIAG.map = { P0300: { severity: 'critical', driveSafe: false } };
    const ctx = buildSafetyContext();
    expect(ctx.diagnosticDriveSafe).toBe(false);
    expect(ctx.diagnosticSeverityCritical).toBe(true);
  });

  it('OBD kaynağı throw ederse fail-soft (bağlam yine döner, çökme yok)', () => {
    OBD.throwOnSub = true;
    expect(() => buildSafetyContext()).not.toThrow();
    const ctx = buildSafetyContext();
    expect(ctx.engineOverheat).toBeUndefined(); // OBD okunamadı → sinyal yok
  });
});

/**
 * validationFieldSprint.test.ts — SAHA HAZIRLIK kilitleri (Trafic + iCar3 + telefon).
 *
 * Kilitlenen davranışlar:
 *  1. KAYIT PANELE BAĞLI DEĞİL — panel kapanınca oturum SİLİNMEZ (kök saha hatası).
 *  2. Kontrol listesi fail-closed: bilinmeyen adım kabul edilmez.
 *  3. Timeout/kurtarma sayaçları MONOTONİK — bounded pencere yüzünden azalamaz.
 *  4. Validation Summary tek çağrıda üretilir, KIRPILMAZ ve ham VIN/MAC taşımaz.
 *  5. JSON rapor kontrol listesi beyanını taşır.
 */
/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import validationViewSrc from '../components/debug/ValidationModeView.tsx?raw';
import {
  FIELD_CHECKLIST,
  checklistByPhase,
  checklistProgress,
  isChecklistId,
} from '../platform/validation/validationChecklist';
import {
  MAX_SESSION_MS,
  _resetValidationRecorderForTest,
  getValidationSnapshot,
  isSessionExpired,
  isValidationActive,
  recordObdMetrics,
  recordPerfCounters,
  setChecklistDone,
  startValidationSession,
  stopValidationSession,
} from '../platform/validation/validationRecorder';
import { evaluateValidation } from '../platform/validation/validationVerdict';
import { buildValidationSummaryText } from '../platform/validation/validationSummary';
import { buildValidationReport, serializeValidationReport } from '../platform/validation/validationExport';

beforeEach(() => { _resetValidationRecorderForTest(); });
afterEach(()  => { _resetValidationRecorderForTest(); });

/* ── 1) Oturum panele bağlı değil ──────────────────────────────────────────── */

describe('SAHA KÖK KİLİDİ — kayıt panele bağlı olmamalı', () => {
  it('durdurulan oturumun verisi rapor için OKUNABİLİR kalır', () => {
    startValidationSession();
    recordObdMetrics({ pidCount: 24, dtcCount: 2 });
    stopValidationSession();

    const snap = getValidationSnapshot();
    expect(snap.active).toBe(false);
    expect(snap.obd.pidCount).toBe(24);      // veri KAYBOLMADI
    expect(snap.obd.dtcCount).toBe(2);
  });

  it('YAPISAL: panel bileşeni unmount cleanup\'ında kaydı DURDURMAZ', () => {
    // Kök hata buydu: `return () => { stopValidationCollector(); }` → sekme
    // değiştirmek tüm saha oturumunu siliyordu. Desen geri gelirse bu kilit düşer.
    expect(validationViewSrc).not.toMatch(/return\s*\(\s*\)\s*=>\s*\{\s*stopValidationCollector\(\)/);
    // Durdurma YALNIZ açık kullanıcı eylemiyle olmalı.
    expect(validationViewSrc).toContain('handleStop');
    expect(validationViewSrc).toContain('KAYDI DURDUR');
  });

  it('unutulmuş oturum için MUTLAK tavan vardır ve taze oturumda dolmamıştır', () => {
    expect(MAX_SESSION_MS).toBeGreaterThan(60 * 60 * 1_000);   // ≥1 saat: saha turu sığar
    startValidationSession();
    expect(isSessionExpired()).toBe(false);
    stopValidationSession();
    expect(isSessionExpired()).toBe(false);                    // durmuş oturum "expired" değil
  });
});

/* ── 2) Kontrol listesi ────────────────────────────────────────────────────── */

describe('validationChecklist — fail-closed beyan', () => {
  it('liste boş değil ve her adım tek bir faza aittir', () => {
    expect(FIELD_CHECKLIST.length).toBeGreaterThan(0);
    const ids = FIELD_CHECKLIST.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);               // id çakışması yok
    const grouped = checklistByPhase().reduce((n, g) => n + g.items.length, 0);
    expect(grouped).toBe(FIELD_CHECKLIST.length);             // sessiz kayıp yok
  });

  it('bilinmeyen adım kimliği REDDEDİLİR', () => {
    expect(isChecklistId(FIELD_CHECKLIST[0]!.id)).toBe(true);
    expect(isChecklistId('uydurma_adim')).toBe(false);
    expect(checklistProgress(['uydurma_adim']).done).toBe(0); // ilerleme şişirilemez
  });

  it('işaretleme yalnız kayıt AÇIKKEN kabul edilir', () => {
    const id = FIELD_CHECKLIST[0]!.id;
    setChecklistDone(id, true);                                // oturum yok
    expect(getValidationSnapshot().checklistDone).toHaveLength(0);

    startValidationSession();
    setChecklistDone(id, true);
    expect(getValidationSnapshot().checklistDone).toContain(id);
    setChecklistDone(id, false);
    expect(getValidationSnapshot().checklistDone).not.toContain(id);
  });

  it('yeni oturum kontrol listesini SIFIRLAR', () => {
    startValidationSession();
    setChecklistDone(FIELD_CHECKLIST[0]!.id, true);
    startValidationSession();
    expect(getValidationSnapshot().checklistDone).toHaveLength(0);
  });
});

/* ── 3) Monotonik sayaçlar ─────────────────────────────────────────────────── */

describe('recordPerfCounters — bounded kaynak yüzünden AZALAMAZ', () => {
  it('sayaç yalnız yukarı güncellenir', () => {
    startValidationSession();
    recordPerfCounters(3, 2);
    expect(getValidationSnapshot().perf.timeoutCount).toBe(3);

    // Kaynak (reconnectHistory) yalnız son N kaydı tutar → ham değer düşebilir.
    recordPerfCounters(1, 1);
    expect(getValidationSnapshot().perf.timeoutCount).toBe(3);   // rapor YALAN söylemez
    expect(getValidationSnapshot().perf.recoveryCount).toBe(2);

    recordPerfCounters(5, 4);
    expect(getValidationSnapshot().perf.timeoutCount).toBe(5);
  });
});

/* ── 4) Validation Summary ─────────────────────────────────────────────────── */

describe('buildValidationSummaryText — tek dokunuş insan-okur özet', () => {
  it('tüm bölümleri içerir ve KIRPILMAZ', () => {
    startValidationSession();
    recordObdMetrics({ pidCount: 24, dtcCount: 0, vinPresent: true, vinMasked: 'VF1**************' });
    setChecklistDone(FIELD_CHECKLIST[0]!.id, true);

    const snap = getValidationSnapshot();
    const text = buildValidationSummaryText(snap, evaluateValidation(snap), 1_700_000_000_000);

    for (const section of ['SAHA DOĞRULAMA ÖZETİ', 'TESTLER', 'OBD', 'PERFORMANS', 'MAVİ', 'SAHA ADIMLARI']) {
      expect(text).toContain(section);
    }
    expect(text.length).toBeGreaterThan(240);          // alan-bazlı 240 tavanı UYGULANMADI
    expect(text).toContain('[X]');                      // işaretli adım görünür
    expect(text).toContain('ölçülmedi');                // dürüstlük dili korunur
  });

  it('ham VIN / MAC / koordinat ÖZETE de sızmaz', () => {
    startValidationSession();
    recordObdMetrics({ adapterName: 'iCar3', adapterAddrMasked: 'AA:BB:CC:DD:EE:FF' });
    const snap = getValidationSnapshot();
    const text = buildValidationSummaryText(snap, evaluateValidation(snap), 0);

    // İKİ maskeleyici vardır ve ikisi de kabul edilebilir:
    //  - obdDiagnosticRecorder.maskMac → 'AA:BB:**:**:**:FF' (ilk iki oktet açık)
    //  - export gizlilik kapısı        → 'AA:**:**:**:**:FF' (yalnız ilk oktet açık)
    // Burada HAM MAC verildiği için ikinci (daha sıkı) kapı devreye girer.
    expect(text).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(text).toContain('AA:**:**:**:**:FF');
  });

  it('boş oturumda bile ASLA throw etmez', () => {
    const snap = getValidationSnapshot();
    expect(() => buildValidationSummaryText(snap, evaluateValidation(snap), 0)).not.toThrow();
  });
});

/* ── 5) JSON rapor beyanı taşır ────────────────────────────────────────────── */

describe('buildValidationReport — kontrol listesi beyanı', () => {
  it('işaretli adımlar rapora girer', () => {
    startValidationSession();
    const id = FIELD_CHECKLIST[0]!.id;
    setChecklistDone(id, true);

    const snap = getValidationSnapshot();
    const json = serializeValidationReport(
      buildValidationReport(snap, evaluateValidation(snap), { generatedAtWallMs: 1 }),
    );
    expect(JSON.parse(json).checklistDone).toContain(id);
  });

  it('eski/eksik şekilli snapshot fail-soft işlenir (throw YOK)', () => {
    const legacy = { ...getValidationSnapshot() } as Record<string, unknown>;
    delete legacy.checklistDone;
    expect(() => buildValidationReport(
      legacy as never, evaluateValidation(getValidationSnapshot()), {},
    )).not.toThrow();
  });

  it('kayıt kapalıyken oturum ASLA kendiliğinden başlamaz (fail-closed)', () => {
    expect(isValidationActive()).toBe(false);
    setChecklistDone(FIELD_CHECKLIST[0]!.id, true);
    recordPerfCounters(9, 9);
    const snap = getValidationSnapshot();
    expect(snap.active).toBe(false);
    expect(snap.checklistDone).toHaveLength(0);
    expect(snap.perf.timeoutCount).toBe(0);
  });
});

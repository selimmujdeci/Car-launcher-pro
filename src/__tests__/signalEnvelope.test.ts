/**
 * OBD-OS-F4-2 — Sinyal Zarfı + Confidence.
 *
 * EN KRİTİK KİLİT: "0 değer" ≠ "no-data". Bunları karıştırmak teşhisin en sinsi hatasıdır:
 * okunamayan yağ basıncını "0" sanıp alarm çalmak, ya da bilinmeyen hızı "0" sanıp
 * araç hareket halindeyken ECU'ya yazmaya izin vermek.
 */
import { describe, it, expect } from 'vitest';
import {
  wrapSignal, isDecisionGrade, isZero,
  SIGNAL_STALE_MS, SIGNAL_DEAD_MS,
} from '../platform/obd/signalEnvelope';

const NOW = 1_700_000_000_000;
const fresh = (raw: number | null | undefined, over = {}) =>
  wrapSignal({ raw, source: 'obd', unit: 'km/h', updatedAt: NOW - 100, nowMs: NOW, ...over });

describe('OBD-OS-F4-2 — "0" ile "no-data" ASLA karışmaz', () => {
  it('🔒 KİLİT: gerçek 0 → valid, değer 0, güven TAM (sıfır bir DEĞERDİR)', () => {
    const s = fresh(0);
    expect(s.state).toBe('valid');
    expect(s.value).toBe(0);
    expect(s.confidence).toBe(1);
    expect(isZero(s)).toBe(true);
  });

  it('🔒 KİLİT: veri yok (null/NaN) → no_data, value null — "0" DEĞİL', () => {
    for (const raw of [null, undefined, NaN]) {
      const s = fresh(raw as number | null | undefined);
      expect(s.state).toBe('no_data');
      expect(s.value).toBeNull();          // ← 0 olarak sızmıyor
      expect(s.confidence).toBe(0);
      expect(isZero(s)).toBeNull();        // "sıfır mı?" → BİLİNMİYOR
    }
  });

  it('🔒 KİLİT: -1 (OBD "desteklenmiyor" konvansiyonu) → unsupported, value null', () => {
    const s = fresh(-1);
    expect(s.state).toBe('unsupported');
    expect(s.value).toBeNull();
    expect(isZero(s)).toBeNull();
  });

  it('🔒 KİLİT: gerçekten negatif olabilen sinyalde -1 "desteklenmiyor" SAYILMAZ', () => {
    // Yakıt trim / ateşleme avansı / ortam sıcaklığı negatif olabilir. Bu bayrak olmadan
    // geçerli -5°C sessizce "desteklenmiyor" olurdu = veri kaybı.
    const s = wrapSignal({
      raw: -5, source: 'obd', unit: '°C', updatedAt: NOW - 100, nowMs: NOW,
      negativeMeansUnsupported: false, min: -40, max: 215,
    });
    expect(s.state).toBe('valid');
    expect(s.value).toBe(-5);
  });

  it('hiç ölçülmedi (updatedAt=0) → no_data', () => {
    const s = wrapSignal({ raw: 42, source: 'obd', unit: 'km/h', updatedAt: 0, nowMs: NOW });
    expect(s.state).toBe('no_data');
    expect(s.value).toBeNull();
  });
});

describe('OBD-OS-F4-2 — confidence KANITTAN (tazelikten) türer', () => {
  it('taze sinyal → güven 1', () => {
    expect(fresh(60).confidence).toBe(1);
  });

  it('bayatlamış sinyal → güven DÜŞER (değer korunur, ama karar için zayıf)', () => {
    const s = wrapSignal({
      raw: 60, source: 'obd', unit: 'km/h',
      updatedAt: NOW - (SIGNAL_STALE_MS + 3_000), nowMs: NOW,
    });
    expect(s.state).toBe('stale');
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThan(1);
    expect(s.value).toBe(60);             // fail-soft: değer atılmaz, İŞARETLENİR
  });

  it('ölü sinyal (çok eski) → güven 0', () => {
    const s = wrapSignal({
      raw: 60, source: 'obd', unit: 'km/h',
      updatedAt: NOW - (SIGNAL_DEAD_MS + 1), nowMs: NOW,
    });
    expect(s.state).toBe('stale');
    expect(s.confidence).toBe(0);
  });

  it('fiziksel sınır dışı → suspect + düşük güven (değer korunur)', () => {
    const s = wrapSignal({
      raw: 700, source: 'obd', unit: 'km/h', updatedAt: NOW - 100, nowMs: NOW, min: 0, max: 300,
    });
    expect(s.state).toBe('suspect');
    expect(s.confidence).toBeLessThan(0.5);
    expect(s.value).toBe(700);
  });

  it('mock kaynak → güven ÇOK DÜŞÜK (sahte veri karar için kanıt sayılmaz)', () => {
    const s = fresh(60, { source: 'mock' });
    expect(s.state).toBe('valid');
    expect(s.confidence).toBeLessThan(0.5);
    expect(isDecisionGrade(s)).toBe(false);
  });
});

describe('OBD-OS-F4-2 — isDecisionGrade (fail-closed karar kapısı)', () => {
  it('taze + geçerli → karar alınabilir', () => {
    expect(isDecisionGrade(fresh(0))).toBe(true);    // 0 bile KARAR VERİLEBİLİR bir değerdir
  });

  it('no_data / unsupported / suspect / stale → karar alınamaz', () => {
    expect(isDecisionGrade(fresh(null))).toBe(false);
    expect(isDecisionGrade(fresh(-1))).toBe(false);
    expect(isDecisionGrade(wrapSignal({
      raw: 700, source: 'obd', unit: 'km/h', updatedAt: NOW - 100, nowMs: NOW, min: 0, max: 300,
    }))).toBe(false);
    expect(isDecisionGrade(wrapSignal({
      raw: 60, source: 'obd', unit: 'km/h', updatedAt: NOW - SIGNAL_DEAD_MS, nowMs: NOW,
    }))).toBe(false);
  });
});

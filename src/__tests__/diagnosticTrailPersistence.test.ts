/**
 * diagnosticTrailPersistence.test.ts — tanısal olay izinin KALICILIĞI (#125).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. İz diske yazılır ve "restart" sonrası geri yüklenir (oturumlar arası hafıza).
 *  2. eMMC koruması: 30 sn penceresi dolmadan İKİNCİ yazma DENENMEZ.
 *  3. Bozuk/şişmiş/PII riskli kayıt REDDEDİLİR — sahte damga/tür UYDURULMAZ.
 *  4. Disk hatası izi çalışmaz hâle GETİRMEZ (RAM tamponu devam eder).
 *  5. Boş iz diske YAZILMAZ (gereksiz yazma yok).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pushTrail } from '../platform/diagnosticTrailCore';
import {
  persistDiagnosticTrail,
  loadPreviousDiagnosticTrail,
  getPreviousDiagnosticTrail,
  getDiagnosticTrail,
  _resetDiagnosticTrailForTest,
  MAX_PERSISTED,
  TRAIL_PERSIST_DEBOUNCE_MS,
} from '../platform/diagnosticTrail';
import { safeGetRaw, safeSetRaw, safeFlushAll } from '../utils/safeStorage';

const KEY = 'caros-diagnostic-trail-prev';

beforeEach(() => {
  _resetDiagnosticTrailForTest();
  safeFlushAll();
  localStorage.clear();
});

describe('tanısal iz kalıcılığı — yaz / geri yükle', () => {
  it('iz diske yazılır ve RESTART sonrası geri yüklenir', () => {
    pushTrail('mode', 'sürüşe geçildi');
    pushTrail('obd', 'OBD kaynak: none → ble');

    expect(persistDiagnosticTrail(true)).toBe(true);
    expect(safeGetRaw(KEY)).toBeTruthy();

    // "Restart": RAM tamponu sıfırlanır ama DİSK kaydı korunur.
    const onDisk = safeGetRaw(KEY)!;
    _resetDiagnosticTrailForTest();
    safeSetRaw(KEY, onDisk);
    safeFlushAll();

    expect(loadPreviousDiagnosticTrail()).toBe(2);
    const prev = getPreviousDiagnosticTrail();
    expect(prev.map((e) => e.label)).toEqual(['sürüşe geçildi', 'OBD kaynak: none → ble']);

    // Birleşik okuma önceki oturumu DA içerir (tek zaman çizgisi).
    pushTrail('boot', 'boot başladı');
    const merged = getDiagnosticTrail().map((e) => e.label);
    expect(merged).toContain('sürüşe geçildi');
    expect(merged).toContain('boot başladı');
  });

  it('eMMC koruması: 30 sn penceresi dolmadan İKİNCİ yazma denenmez', () => {
    pushTrail('mode', 'ilk olay');
    expect(persistDiagnosticTrail()).toBe(true);      // ilk yazma serbest
    pushTrail('mode', 'ikinci olay');
    expect(persistDiagnosticTrail()).toBe(false);     // pencere içinde → yazma YOK
    expect(TRAIL_PERSIST_DEBOUNCE_MS).toBe(30_000);

    // immediate (kapanış yolu) pencereyi ATLAR — kapanış olayları kaybolmasın.
    expect(persistDiagnosticTrail(true)).toBe(true);
  });

  it('boş iz diske YAZILMAZ (gereksiz yazma yok)', () => {
    expect(persistDiagnosticTrail(true)).toBe(false);
    expect(safeGetRaw(KEY)).toBeNull();
  });

  it('diske en fazla MAX_PERSISTED olay yazılır (bounded)', () => {
    for (let i = 0; i < MAX_PERSISTED + 30; i++) pushTrail('action', `olay ${i}`);
    persistDiagnosticTrail(true);

    const parsed = JSON.parse(safeGetRaw(KEY)!) as unknown[];
    expect(parsed.length).toBeLessThanOrEqual(MAX_PERSISTED);
    // EN YENİLER tutulur (halka tavanı 80 → son olay 'olay 79').
    const labels = (parsed as { label: string }[]).map((e) => e.label);
    expect(labels[labels.length - 1]).toBe(`olay ${MAX_PERSISTED + 29}`);
  });

  it('bozuk / şişmiş / sahte kayıt REDDEDİLİR — damga ve tür UYDURULMAZ', () => {
    safeSetRaw(KEY, JSON.stringify([
      { ts: 1, kind: 'mode', label: 'geçerli' },
      { ts: 0, kind: 'mode', label: 'damgasız' },        // ts geçersiz → atılır
      { ts: 2, kind: 'uydurma', label: 'bilinmeyen tür' }, // tür geçersiz → atılır
      { ts: 3, kind: 'mode' },                            // label yok → atılır
      { ts: 4, kind: 'action', label: 'x'.repeat(500), detail: 'y'.repeat(900) }, // kırpılır
      null, 'metin', 42,                                  // çöp → atılır
    ]));
    safeFlushAll();

    expect(loadPreviousDiagnosticTrail()).toBe(2);
    const prev = getPreviousDiagnosticTrail();
    expect(prev[0].label).toBe('geçerli');
    expect(prev[1].label.length).toBeLessThanOrEqual(80);
    expect(prev[1].detail!.length).toBeLessThanOrEqual(160);
  });

  it('bozuk JSON / disk hatası izi ÇALIŞMAZ hâle getirmez (fail-soft)', () => {
    safeSetRaw(KEY, '{bozuk json');
    safeFlushAll();
    expect(() => loadPreviousDiagnosticTrail()).not.toThrow();
    expect(loadPreviousDiagnosticTrail()).toBe(0);
    expect(getPreviousDiagnosticTrail()).toEqual([]);

    // RAM tamponu etkilenmez.
    pushTrail('error', 'disk bozuk ama iz sürüyor');
    expect(getDiagnosticTrail().map((e) => e.label)).toContain('disk bozuk ama iz sürüyor');
  });

  it('yazma throw etse bile persist sessizce false döner (çökme YOK)', () => {
    pushTrail('mode', 'olay');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => persistDiagnosticTrail(true)).not.toThrow();
    spy.mockRestore();
  });
});

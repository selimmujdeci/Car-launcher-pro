/**
 * evidenceInputGuard.test.ts — kütük #497 madde 2 kilitleri.
 *
 * KURAL: **bilinmeyen girdi sessizce yutulmaz.** `default` dalları (#497 madde 1)
 * çökmeyi engelledi ama düşüş SESSİZDİ; sessiz düşüş şu ikisini ayırt edilemez
 * kılıyordu: "bilgimiz yok" ile "kanıt geldi ama ANLAYAMADIK". İkincisi bir
 * ARIZA sinyalidir (şema sürüklenmesi · bozuk veri · sürüm farkı).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateEvidenceInput, readUnknownInputStats, _resetUnknownInputStatsForTest,
  UNKNOWN_INPUT_FIELDS,
} from '../platform/reasoning/core/evidenceInputGuard';
import type { AiEvidence } from '../platform/fleet/aiEvidence';

const NOW = 1_700_000_000_000;

function good(over: Partial<AiEvidence> = {}): Partial<AiEvidence> {
  return {
    category: 'FUEL', source: 'BLACKBOX', severity: 'INFO',
    provenance: 'MEASURED', state: 'ACTIVE', ...over,
  };
}

beforeEach(() => { _resetUnknownInputStatsForTest(); });

describe('kabul — geçerli girdi sayaç ARTIRMAZ', () => {
  it('tam geçerli kanıt kabul edilir', () => {
    const r = validateEvidenceInput(good(), NOW);
    expect(r.accepted).toBe(true);
    expect(r.rejectedField).toBeNull();
    expect(readUnknownInputStats().totalRejected).toBe(0);
  });

  it('kabul edilen girdi son-red zamanını KİRLETMEZ', () => {
    validateEvidenceInput(good(), NOW);
    expect(readUnknownInputStats().lastRejectedAtMs).toBeNull();
  });
});

describe('red — her alan ayrı ayrı yakalanır ve SAYILIR', () => {
  it('bilinmeyen kategori reddedilir ve sayılır', () => {
    const r = validateEvidenceInput(good({ category: 'NOPE' as never }), NOW);
    expect(r.accepted).toBe(false);
    expect(r.rejectedField).toBe('category');
    const s = readUnknownInputStats();
    expect(s.totalRejected).toBe(1);
    expect(s.byField.category).toBe(1);
    expect(s.lastRejectedAtMs).toBe(NOW);
  });

  it('beş alanın her biri kendi sayacını artırır', () => {
    validateEvidenceInput(good({ category: 'X' as never }), NOW);
    validateEvidenceInput(good({ source: 'X' as never }), NOW);
    validateEvidenceInput(good({ severity: 'X' as never }), NOW);
    validateEvidenceInput(good({ provenance: 'X' as never }), NOW);
    validateEvidenceInput(good({ state: 'X' as never }), NOW);
    const s = readUnknownInputStats();
    expect(s.totalRejected).toBe(5);
    for (const f of UNKNOWN_INPUT_FIELDS) {
      expect(s.byField[f], `alan sayacı artmadı: ${f}`).toBe(1);
    }
  });

  it('kaynak bazında sayılır — "hangi kaynaktan" görünür', () => {
    validateEvidenceInput(good({ source: 'TELEMETRY', category: 'X' as never }), NOW);
    validateEvidenceInput(good({ source: 'TELEMETRY', category: 'Y' as never }), NOW);
    validateEvidenceInput(good({ source: 'DEEP_SCAN', category: 'Z' as never }), NOW);
    const s = readUnknownInputStats();
    expect(s.bySource['TELEMETRY']).toBe(2);
    expect(s.bySource['DEEP_SCAN']).toBe(1);
  });

  it('kaynağın KENDİSİ tanınmıyorsa SOURCE_UNKNOWN altında sayılır', () => {
    // Uydurma kaynak adı üretilmez.
    validateEvidenceInput(good({ source: 'GIZLI_MODUL' as never }), NOW);
    const s = readUnknownInputStats();
    expect(s.bySource['SOURCE_UNKNOWN']).toBe(1);
    expect(s.bySource['GIZLI_MODUL']).toBeUndefined();
  });

  it('null / undefined girdi reddedilir (çökmez)', () => {
    expect(validateEvidenceInput(null, NOW).accepted).toBe(false);
    expect(validateEvidenceInput(undefined, NOW).accepted).toBe(false);
    expect(readUnknownInputStats().totalRejected).toBe(2);
  });

  it('eksik alan reddedilir — yarım kanıt kabul EDİLMEZ', () => {
    // Kategorisi olmayan gözlem hangi niyete hizmet ettiğini bilemez.
    const r = validateEvidenceInput({ source: 'BLACKBOX' }, NOW);
    expect(r.accepted).toBe(false);
    expect(r.rejectedField).toBe('category');
  });

  it('yanlış TİP reddedilir (sayı/nesne/dizi)', () => {
    for (const bad of [42, {}, [], true]) {
      _resetUnknownInputStatsForTest();
      expect(validateEvidenceInput(good({ category: bad as never }), NOW).accepted)
        .toBe(false);
      expect(readUnknownInputStats().totalRejected).toBe(1);
    }
  });
});

describe('gizlilik — DEĞER hiçbir yerde saklanmaz', () => {
  it('reddedilen değer istatistikte GEÇMEZ', () => {
    const secret = 'VIN_WF0AXXGAJA1234567';
    validateEvidenceInput(good({ category: secret as never }), NOW);
    const dump = JSON.stringify(readUnknownInputStats());
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain('VIN');
    // Yalnız sayı ve alan adı taşınır.
    expect(readUnknownInputStats().totalRejected).toBe(1);
  });

  it('okuma ucu KOPYA döner — dışarıdan mutasyon sayacı bozamaz', () => {
    validateEvidenceInput(good({ category: 'X' as never }), NOW);
    const s = readUnknownInputStats() as { totalRejected: number };
    s.totalRejected = 9999;
    expect(readUnknownInputStats().totalRejected).toBe(1);
  });

  it('kaynak kanıtı: modül DEĞER saklamıyor', () => {
    // `rejectedValue` benzeri bir alan eklenirse bu kilit düşer.
    const src = readFileSync(
      join(process.cwd(),
        'src', 'platform', 'reasoning', 'core', 'evidenceInputGuard.ts'), 'utf8') as string;
    expect(src).not.toMatch(/rejectedValue|lastValue|sampleValue/);
  });
});

describe('sözleşme', () => {
  it('doğrulayıcı SAFTIR — Date.now çağırmaz (zaman dışarıdan verilir)', () => {
    const src = readFileSync(
      join(process.cwd(),
        'src', 'platform', 'reasoning', 'core', 'evidenceInputGuard.ts'), 'utf8') as string;
    const codeOnly = src.split('\n')
      .filter((l) => { const t = l.trimStart(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
      .join('\n');
    expect(codeOnly).not.toContain('Date.now');
    expect(codeOnly).not.toContain('setInterval');
    expect(codeOnly).not.toContain('setTimeout');
  });

  it('sayaç tavanı vardır — teşhis aracı sonsuz büyümez', () => {
    const src = readFileSync(
      join(process.cwd(),
        'src', 'platform', 'reasoning', 'core', 'evidenceInputGuard.ts'), 'utf8') as string;
    expect(src).toContain('COUNTER_CEILING');
  });
});

/**
 * carosLabAiExplorers.test.tsx — CAROS LAB · Bellek Gezgini + Bilgi Tabanı
 * Gezgini KİLİTLERİ.
 *
 * ANA İLKE: bu iki ekran ÜRÜNDE ÇALIŞAN motorları gözler ve o motorlara
 * DOKUNMAZ. En kritik kilit GİZLİLİKTİR: bellek kayıtları kullanıcı metni,
 * bilgi tabanı kaydı HAM VIN taşır — ikisi de LAB'a geçemez.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  buildMemoryFields, deriveMemoryVerdict, countByOrigin, oldestStampMs,
  memoryVerdictTone, type AiMemoryFieldsInput,
} from '../platform/devtools/aiMemoryModel';
import {
  buildKnowledgeFields, buildVehicleFields, deriveKnowledgeVerdict,
  summarizeKnowledge, isConfirmed, knowledgeVerdictTone,
} from '../platform/devtools/knowledgeBaseModel';
import type { KnowledgeVehicleShape } from '../platform/devtools/knowledgeBaseSources';
import { MemoryExplorerScreen } from '../components/devtools/screens/MemoryExplorerScreen';
import { KnowledgeExplorerScreen } from '../components/devtools/screens/KnowledgeExplorerScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { isMaskedVin } from '../platform/privacy/vinMask';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = 1_700_000_000_000;

function memInput(over: Partial<AiMemoryFieldsInput> = {}): AiMemoryFieldsInput {
  return {
    shortTerm: [],
    shortTermCapacity: 8,
    preferenceCount: 0,
    vehicleFactCount: 0,
    vehicleHistoryWired: true,
    confidentVehicleFactCount: 0,
    maxTextLength: 160,
    minVehicleFactConfidence: 0.5,
    budgetMaxRecords: 10,
    budgetMaxLongTerm: 6,
    budgetMaxShortTerm: 4,
    budgetMaxChars: 800,
    nowMs: NOW,
    ...over,
  };
}

function veh(over: Partial<KnowledgeVehicleShape> = {}): KnowledgeVehicleShape {
  return {
    fingerprintPrefix: 'abc123def456',
    vinMasked: 'WVW**************',
    protocol: '6',
    profileHint: 'vag',
    pidCount: 12, didCount: 3, ecuCount: 4,
    totalDiscoveries: 40, totalConnections: 2,
    confidence: 0.72,
    firstSeenMs: NOW - 86_400_000,
    lastSeenMs: NOW - 3_600_000,
    firmwareCount: 1,
    supportedModes: ['01', '22'],
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) BELLEK — GİZLİLİK (en kritik)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('memoryExplorer › gizlilik', () => {
  it('kaynak katmanının çıktı tipinde İÇERİK ALANI YOKTUR', () => {
    const src = stripComments(read('src/platform/devtools/aiMemorySources.ts'));
    // `MemoryRecordShape` yalnız origin + atMs taşımalı; `text` alanı OLMAMALI.
    const shape = src.slice(
      src.indexOf('export interface MemoryRecordShape'),
      src.indexOf('export interface AiMemoryRawSnapshot'),
    );
    expect(shape).not.toMatch(/\btext\b/);
    expect(shape).toMatch(/origin/);
    expect(shape).toMatch(/atMs/);
  });

  it('metin uzunluğu/özeti/hash\'i bile TAŞINMAZ', () => {
    const src = stripComments(read('src/platform/devtools/aiMemorySources.ts'));
    expect(src).not.toMatch(/\.text\.length/);
    expect(src).not.toMatch(/slice\(0/);
    expect(src).not.toMatch(/hash|digest/i);
  });

  it('alanların hiçbiri kayıt metni ÜRETMEZ', () => {
    const fields = buildMemoryFields(memInput({
      shortTerm: [
        { origin: 'session', atMs: NOW - 1000 },
        { origin: 'user_preference', atMs: NOW - 5000 },
      ],
    }));
    for (const f of fields) {
      // Değerler yalnız sayı/oran/etiket olmalı; serbest metin GELMEMELİ.
      expect(f.value.length, f.id).toBeLessThan(80);
    }
  });

  it('ekran gizlilik beyanını AÇIKÇA basar', () => {
    const html = renderToStaticMarkup(<MemoryExplorerScreen />);
    expect(html).toContain('İÇERİK GÖSTERİLMEZ');
    expect(html).toContain('data-testid="mem-privacy"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) BELLEK — DÜRÜSTLÜK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('memoryExplorer › dürüstlük', () => {
  it('"okunamadı" ile "0 kayıt" AYRIDIR', () => {
    expect(deriveMemoryVerdict({ shortTerm: null, capacity: 8 })).toBe('UNAVAILABLE');
    expect(deriveMemoryVerdict({ shortTerm: [], capacity: 8 })).toBe('EMPTY');

    const f = buildMemoryFields(memInput({ shortTerm: null }))
      .find((x) => x.id === 'st-count');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/KARIŞTIRILMAZ/);
  });

  it('tampon dolduğunda AT_CAPACITY (en eski kayıt düşüyor)', () => {
    const full = Array.from({ length: 8 }, () => ({ origin: 'session' as const, atMs: NOW }));
    expect(deriveMemoryVerdict({ shortTerm: full, capacity: 8 })).toBe('AT_CAPACITY');
    expect(memoryVerdictTone('AT_CAPACITY')).toBe('warn');
  });

  it('araç geçmişi otoritesi BAĞLI DEĞİLSE 0 bir ÖLÇÜM SAYILMAZ', () => {
    const f = buildMemoryFields(memInput({ vehicleHistoryWired: false, vehicleFactCount: 0 }))
      .find((x) => x.id === 'veh-facts');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/ÖLÇÜM DEĞİLDİR/);
  });

  it('otorite bağlıyken 0 GEÇERLİ bir cevaptır', () => {
    const f = buildMemoryFields(memInput({ vehicleHistoryWired: true, vehicleFactCount: 0 }))
      .find((x) => x.id === 'veh-facts');
    expect(f?.klass).toBe('OBSERVED');
    expect(f?.value).toBe('0');
  });

  it('damgasız kayıtta yaş HESAPLANMAZ', () => {
    expect(oldestStampMs([{ origin: 'session', atMs: 0 }])).toBeNull();
    const f = buildMemoryFields(memInput({ shortTerm: [{ origin: 'session', atMs: 0 }] }))
      .find((x) => x.id === 'st-oldest');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/HESAPLANMAZ/);
  });

  it('köken dağılımı yalnız SINIF ve ADET verir', () => {
    const counts = countByOrigin([
      { origin: 'session', atMs: NOW },
      { origin: 'session', atMs: NOW },
      { origin: 'vehicle_history', atMs: NOW },
    ]);
    expect(counts).toEqual({ session: 2, vehicle_history: 1 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) BİLGİ TABANI — GİZLİLİK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('knowledgeExplorer › gizlilik', () => {
  it('ham VIN kaynak katmanından GEÇMEZ (katı maske kullanılır)', () => {
    const src = stripComments(read('src/platform/devtools/knowledgeBaseSources.ts'));
    expect(src).toMatch(/maskVinStrict/);
    // Ham alanı doğrudan çıktıya yazan bir satır OLMAMALI.
    expect(src).not.toMatch(/vin:\s*r\.vin/);
    expect(src).not.toMatch(/vinMasked:\s*r\.vin\b/);
  });

  it('gösterilen VIN GERÇEKTEN maskelidir', () => {
    const f = buildVehicleFields(veh(), NOW).find((x) => x.label === 'VIN (maskeli)');
    expect(f).toBeDefined();
    expect(isMaskedVin(f!.value), 'ham VIN sızdı').toBe(true);
  });

  it('VIN maskelenemezse ham değer DEĞİL, KAYNAK YOK gösterilir', () => {
    const f = buildVehicleFields(veh({ vinMasked: null }), NOW)
      .find((x) => x.label === 'VIN');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/ASLA gösterilmez/);
  });

  it('parmak izi yalnız ÖN EK olarak taşınır', () => {
    const f = buildVehicleFields(veh(), NOW).find((x) => x.label === 'Parmak izi');
    expect(f?.value).toBe('abc123def456');
    expect(f?.value.length).toBeLessThanOrEqual(12);
  });

  it('ECU adres listesi ve firmware dizeleri ADET olarak taşınır', () => {
    const src = stripComments(read('src/platform/devtools/knowledgeBaseSources.ts'));
    expect(src).toMatch(/firmwareCount/);
    expect(src).not.toMatch(/firmwareVersions:\s*\[/);
    expect(src).not.toMatch(/discoveredEcus:/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) BİLGİ TABANI — ZERO-TRUST HÜKMÜ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('knowledgeExplorer › hüküm', () => {
  it('TEK gözlemli profil KANIT SAYILMAZ', () => {
    expect(isConfirmed(veh({ totalConnections: 1 }))).toBe(false);
    expect(isConfirmed(veh({ totalConnections: 2 }))).toBe(true);
    expect(deriveKnowledgeVerdict({
      vehicles: [veh({ totalConnections: 1 })], maxRecords: 8,
    })).toBe('UNCONFIRMED');
  });

  it('tavan dolduğunda AT_CAPACITY, DOĞRULANMIŞ\'ı EZER', () => {
    const full = Array.from({ length: 8 }, (_, i) =>
      veh({ fingerprintPrefix: `fp${i}`, totalConnections: 5 }));
    expect(deriveKnowledgeVerdict({ vehicles: full, maxRecords: 8 })).toBe('AT_CAPACITY');
    expect(knowledgeVerdictTone('AT_CAPACITY')).toBe('warn');
  });

  it('"okunamadı" ile "hiç araç öğrenilmedi" AYRIDIR', () => {
    expect(deriveKnowledgeVerdict({ vehicles: null, maxRecords: 8 })).toBe('UNAVAILABLE');
    expect(deriveKnowledgeVerdict({ vehicles: [], maxRecords: 8 })).toBe('EMPTY');

    const f = buildKnowledgeFields({ vehicles: null, maxRecords: 8, nowMs: NOW })[0];
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toMatch(/KARIŞTIRILMAZ/);
  });

  it('güven %100 GÖSTERİLMEZ (1\'e ulaşmaz sözleşmesi)', () => {
    const f = buildVehicleFields(veh({ confidence: 0.72 }), NOW)
      .find((x) => x.label === 'Güven');
    expect(f?.value).toBe('%72');
    expect(f?.note).toMatch(/ASLA ulaşmaz/);
  });

  it('özet adetleri doğru toplanır', () => {
    const s = summarizeKnowledge([
      veh({ fingerprintPrefix: 'a', pidCount: 10, didCount: 2, ecuCount: 3, totalConnections: 1 }),
      veh({ fingerprintPrefix: 'b', pidCount: 5, didCount: 1, ecuCount: 2, totalConnections: 4 }),
    ]);
    expect(s).toEqual({
      vehicleCount: 2, confirmedCount: 1, totalPids: 15, totalDids: 3, totalEcus: 5,
    });
  });

  it('damgasız kayıtta son görülme yaşı HESAPLANMAZ', () => {
    const f = buildVehicleFields(veh({ lastSeenMs: 0 }), NOW)
      .find((x) => x.label === 'Son görülme');
    expect(f?.klass).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) KATALOG BAĞI + YAN ETKİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('aiExplorers › katalog ve yan etki', () => {
  it('iki araç da AVAILABLE ve gerçek ekran eşlemesi var', () => {
    for (const id of ['memory-explorer', 'knowledge-explorer'] as const) {
      expect(getCarosLabTool(id)?.status, id).toBe('AVAILABLE');
      expect(renderAvailableTool(id), id).not.toBeNull();
      expect(getCarosLabTool(id)?.note).not.toMatch(/^Ekran yok/);
    }
  });

  it('iki ekran da render olur', () => {
    expect(renderToStaticMarkup(<MemoryExplorerScreen />)).toContain('BELLEK GEZGİNİ');
    expect(renderToStaticMarkup(<KnowledgeExplorerScreen />)).toContain('BİLGİ TABANI GEZGİNİ');
  });

  it('bilgi tabanı ekranı öğrenme motorunu BAŞLATMAZ', () => {
    const src = stripComments(read('src/platform/devtools/knowledgeBaseSources.ts'))
      + stripComments(read('src/components/devtools/screens/KnowledgeExplorerScreen.tsx'));
    expect(src).not.toMatch(/startVehicleKnowledgeBase/);
    expect(src).not.toMatch(/\.save\(|\.remove\(|\.clear\(/);
  });

  it('bellek katmanı hafızaya YAZMAZ', () => {
    const src = stripComments(read('src/platform/devtools/aiMemorySources.ts'))
      + stripComments(read('src/components/devtools/screens/MemoryExplorerScreen.tsx'));
    expect(src).not.toMatch(/rememberShortTerm|clearShortTermMemory/);
  });

  it('saf modeller I/O · timer · Date.now İÇERMEZ', () => {
    for (const p of ['src/platform/devtools/aiMemoryModel.ts',
                     'src/platform/devtools/knowledgeBaseModel.ts']) {
      const src = stripComments(read(p));
      expect(src, p).not.toMatch(/Date\.now\(/);
      expect(src, p).not.toMatch(/setInterval|setTimeout/);
    }
  });

  it('ekranlar TIMER kurmaz ve unmount sonrası setState yapmaz', () => {
    for (const p of ['src/components/devtools/screens/MemoryExplorerScreen.tsx',
                     'src/components/devtools/screens/KnowledgeExplorerScreen.tsx']) {
      const src = read(p);
      expect(src, p).not.toMatch(/setInterval\(/);
      expect(src, p).toContain('mountedRef');
      expect(src, p).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
    }
  });
});

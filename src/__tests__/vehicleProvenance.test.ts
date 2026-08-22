/**
 * vehicleProvenance.test.ts — V-12 Digital Twin provenance KİLİTLERİ.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * Vizyon belgesi kendi beyanıyla *"`UnifiedVehicleStore` gerçek Digital Twin
 * değildir — yalnız anlık sinyal aynasıdır; provenance eksiktir"* diyordu.
 * Ölçüm doğruladı: `gpsSource` DIŞINDA hiçbir sinyalde kaynak izi YOKTU.
 *
 * Kilitler dört şeyi korur:
 *  (A) Defterin kendi sözleşmesi (sahte yaş yok, bilinmeyen anahtar büyütmez)
 *  (B) HOT-PATH güvenliği (tahsis yok, anahtar eklenmez, damga yama başına)
 *  (C) Mağazanın damgayı GERÇEKTEN bastığı
 *  (D) Üç durumun (AKIYOR/BAYAT/HİÇ YAZILMADI) AYRI kaldığı
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  stampProvenance, getProvenance, getProvenanceSnapshot,
  _resetProvenanceForTest, PROVENANCE_KEYS,
} from '../platform/vehicleDataLayer/vehicleProvenance';
import {
  buildProvenanceRows, deriveProvenanceState, deriveProvenanceVerdict,
  buildProvenanceFields, PROVENANCE_FRESH_MS,
} from '../platform/devtools/provenanceModel';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = 1_700_000_000_000;

/* ══════════════════════════════════════════════════════════════════════════
 * A) DEFTER SÖZLEŞMESİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vehicleProvenance › defter', () => {
  beforeEach(() => { _resetProvenanceForTest(); });

  it('damga kaynağı, damgayı ve yazım sayısını kaydeder', () => {
    stampProvenance('speed', 'fused', NOW);
    stampProvenance('speed', 'fused', NOW + 100);
    const e = getProvenance('speed')!;
    expect(e.source).toBe('fused');
    expect(e.updatedAt).toBe(NOW + 100);
    expect(e.writes).toBe(2);
  });

  it('HİÇ yazılmamış sinyalde yaş HESAPLANMAZ — sahte 56 yıl YOK', () => {
    const rows = getProvenanceSnapshot(NOW);
    const speed = rows.find((r) => r.key === 'speed')!;
    expect(speed.updatedAt).toBe(0);
    expect(speed.ageMs).toBeNull();     // `NOW - 0` DEĞİL
    expect(speed.writes).toBe(0);
  });

  it('BİLİNMEYEN anahtar sözlüğü BÜYÜTMEZ (hidden-class kararlılığı)', () => {
    const before = getProvenanceSnapshot(NOW).length;
    stampProvenance('boyle-bir-sinyal-yok', 'obd', NOW);
    expect(getProvenanceSnapshot(NOW).length).toBe(before);
    expect(getProvenance('boyle-bir-sinyal-yok')).toBeNull();
  });

  it('yazılmış sinyalde yaş DOĞRU hesaplanır ve negatif olamaz', () => {
    stampProvenance('rpm', 'obd', NOW);
    expect(getProvenanceSnapshot(NOW + 3_000).find((r) => r.key === 'rpm')!.ageMs).toBe(3_000);
    /* Saat geriye sıçrarsa negatif yaş ÜRETİLMEZ. */
    expect(getProvenanceSnapshot(NOW - 5_000).find((r) => r.key === 'rpm')!.ageMs).toBe(0);
  });

  it('bilinmeyen anahtar okuması THROW ETMEZ', () => {
    expect(() => getProvenance('yok')).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) HOT-PATH GÜVENLİĞİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vehicleProvenance › hot-path güvenliği', () => {
  const src = stripComments(read('src/platform/vehicleDataLayer/vehicleProvenance.ts'));

  it('yazma yolunda TAHSİS YOK — kayıt YERİNDE değiştirilir', () => {
    const fn = src.slice(src.indexOf('export function stampProvenance'), src.indexOf('export function getProvenance'));
    expect(fn).toMatch(/e\.source = source/);
    expect(fn).toMatch(/e\.writes \+= 1/);
    /* Yeni nesne kurmak 3 Hz'de çöp üretirdi. */
    expect(fn).not.toMatch(/\{\s*source:/);
  });

  it('defter kendi `Date.now()`unu ÇAĞIRMAZ — damga dışarıdan gelir', () => {
    expect(src).not.toMatch(/Date\.now\(/);
  });

  it('sözlük BAŞLANGIÇTA tüm anahtarlarla kurulur', () => {
    expect(PROVENANCE_KEYS.length).toBeGreaterThan(10);
    const rows = getProvenanceSnapshot(NOW);
    expect(rows.length).toBe(PROVENANCE_KEYS.length);
  });

  it('mağaza damgayı YAMA BAŞINA bir kez alır, alan başına DEĞİL', () => {
    const store = stripComments(read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts'));
    /* Her `dirty` bloğunda tek bir `_pAt` üretilmeli. */
    const perPatch = store.match(/const _pAt = Date\.now\(\);/g) ?? [];
    expect(perPatch.length).toBeGreaterThanOrEqual(3);   // vehicle · gps · can
    /* `stampProvenance(..., Date.now())` deseni HOT-PATH'te yasak. */
    expect(store).not.toMatch(/stampProvenance\([^)]*Date\.now\(\)\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) MAĞAZA DAMGAYI GERÇEKTEN BASIYOR
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vehicleProvenance › mağaza kablosu', () => {
  const store = stripComments(read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts'));

  it('üç yazma yolu da damgalanır', () => {
    expect(store).toMatch(/stampProvenance\('speed', 'fused'/);
    expect(store).toMatch(/stampProvenance\('location', 'gps'/);
    expect(store).toMatch(/stampProvenance\(k, 'can'/);
  });

  it('`speed` HARMANLANMIŞ işaretlenir — tek üreticiye indirgenmez', () => {
    /* "obd" demek yalan olurdu: hız birden çok kaynaktan füzyonlanıyor. */
    expect(store).not.toMatch(/stampProvenance\('speed', 'obd'/);
    expect(store).not.toMatch(/stampProvenance\('speed', 'can'/);
  });

  it('`odometer` TÜRETİLMİŞ işaretlenir — doğrudan ölçüm değil', () => {
    expect(store).toMatch(/stampProvenance\('odometer', 'derived'/);
  });

  it('değer alanları DEĞİŞTİRİLMEDİ — çok-sistemli refactor YOK', () => {
    /* Provenance PARALEL bir defterdir; alanlar sarmalanmadı. */
    expect(store).toMatch(/speed:\s+number \| null;/);
    expect(store).not.toMatch(/speed:\s*\{\s*value/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) ÜÇ DURUM AYRI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vehicleProvenance › üç durum ayrı', () => {
  it('hiç yazılmamış → NEVER (BAYAT DEĞİL)', () => {
    expect(deriveProvenanceState({ key: 'x', source: 'unknown', updatedAt: 0, writes: 0, ageMs: null }))
      .toBe('NEVER');
  });

  it('taze yazım → FLOWING', () => {
    expect(deriveProvenanceState({ key: 'x', source: 'obd', updatedAt: NOW, writes: 1, ageMs: 1_000 }))
      .toBe('FLOWING');
  });

  it('eski yazım → STALE', () => {
    expect(deriveProvenanceState({
      key: 'x', source: 'obd', updatedAt: NOW, writes: 1, ageMs: PROVENANCE_FRESH_MS + 1,
    })).toBe('STALE');
  });

  it('hüküm: hiçbiri akmıyorsa "twin boş" der', () => {
    const rows = buildProvenanceRows([
      { key: 'a', source: 'unknown', updatedAt: 0, writes: 0, ageMs: null },
    ]);
    expect(deriveProvenanceVerdict(rows)).toBe('NO_SIGNALS');
  });

  it('hüküm: bir kısmı akıyorsa KISMİ', () => {
    const rows = buildProvenanceRows([
      { key: 'a', source: 'obd', updatedAt: NOW, writes: 1, ageMs: 100 },
      { key: 'b', source: 'unknown', updatedAt: 0, writes: 0, ageMs: null },
    ]);
    expect(deriveProvenanceVerdict(rows)).toBe('PARTIAL');
  });

  it('okunamadıysa "sinyal yok" ile KARIŞTIRILMAZ', () => {
    expect(deriveProvenanceVerdict(null)).toBe('UNAVAILABLE');
    expect(buildProvenanceFields({ rows: null, nowMs: NOW })[0].note).toMatch(/KARIŞTIRILMAZ/);
  });

  it('her kaynak için dürüstlük notu vardır', () => {
    const rows = buildProvenanceRows([
      { key: 'speed', source: 'fused', updatedAt: NOW, writes: 1, ageMs: 10 },
      { key: 'odometer', source: 'derived', updatedAt: NOW, writes: 1, ageMs: 10 },
    ]);
    expect(rows[0].note).toMatch(/HARMANLANMIŞ/);
    expect(rows[1].note).toMatch(/HESAPLANMIŞ/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E) LAB EKRANI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vehicleProvenance › LAB ekranı', () => {
  it('katalog AVAILABLE ve gerçek ekran eşlemesi var', async () => {
    const { getCarosLabTool } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');
    expect(getCarosLabTool('signal-provenance')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('signal-provenance')).not.toBeNull();
  });

  it('saf model I/O · timer · Date.now İÇERMEZ', () => {
    const m = stripComments(read('src/platform/devtools/provenanceModel.ts'));
    expect(m).not.toMatch(/Date\.now\(/);
    expect(m).not.toMatch(/setInterval|setTimeout/);
  });

  it('ekran TIMER kurmaz ve sinyal YAZMAZ', () => {
    const scr = read('src/components/devtools/screens/ProvenanceScreen.tsx');
    expect(scr).not.toMatch(/setInterval\(/);
    expect(scr).toContain('mountedRef');
    expect(stripComments(scr)).not.toMatch(/stampProvenance|_resetProvenanceForTest/);
  });
});

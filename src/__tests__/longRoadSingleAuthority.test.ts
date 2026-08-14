/**
 * longRoadSingleAuthority.test.ts — E-31 / E-32 KİLİTLERİ: hüküm TEK OTORİTEDEN.
 *
 * ── DENETİM DÜZELTMESİ (E-31 · E-32) ───────────────────────────────────
 * İlk envanter turu bu ikisini "kapı hiç sorulmuyor" diye raporladı. İkinci
 * ölçüm bunu ÇÜRÜTTÜ: kapılar çalışıyordu ama kuralları ÇAĞIRAN TARAFA ELLE
 * KOPYALANMIŞTI — yani kusur K1 (ölü uç) değil, K2 (ikinci otorite):
 *
 *   · `startLongRoadSession`  kendi içinde `SESSION_PERSISTENCE`/`BLACKBOX_BUFFER`
 *     listesini tekrar yazıyordu → `preflightBlocksSession` ile ayrışabilirdi.
 *   · `buildAcceptanceMatrix` iki satırda `hits > 0 ? 'PASS' : 'NOT_OBSERVED'`
 *     ifadesini tekrar yazıyordu → `scenarioVerdict` ile ayrışabilirdi.
 *
 * ── NE KİLİTLENİYOR ────────────────────────────────────────────────────
 * 1. Kritik kapı listesi DEĞİŞİRSE oturum başlatma davranışı DA değişir
 *    (yani gerçekten tek kaynaktan okunuyor — kopya kalmadı).
 * 2. `scenarioVerdict` sözleşmesi (hits>0 → PASS, aksi NOT_OBSERVED) korunur
 *    ve kabul matrisi bu sözleşmeyle AYNI hükmü verir.
 * 3. §9.3'teki "hüküm mantığı ikinci yerde" şüphesi ÖLÇÜLDÜ: `judgePersistence`
 *    ve `judgeRealVehicle` FARKLI sorulara bakar — `scenarioVerdict`'in kopyası
 *    DEĞİLDİR (bulgu kapatıldı).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  preflightBlocksSession, scenarioVerdict, emptyScenario,
  type PreflightRow,
} from '../platform/fieldValidation/longRoadModel';

const RECORDER_SRC = readFileSync('src/platform/fieldValidation/longRoadRecorder.ts', 'utf8');
const ACCEPTANCE_SRC = readFileSync('src/platform/fieldValidation/longRoadAcceptance.ts', 'utf8');

function row(id: PreflightRow['id'], verdict: PreflightRow['verdict']): PreflightRow {
  return { id, verdict, detail: '' };
}

describe('E-31 — oturum ön-kontrol kapısı tek otoriteden sorulur', () => {
  it('kritik kapı düşerse oturum ENGELLENİR', () => {
    expect(preflightBlocksSession([row('SESSION_PERSISTENCE', 'FAIL')])).toBe(true);
    expect(preflightBlocksSession([row('BLACKBOX_BUFFER', 'FAIL')])).toBe(true);
  });

  it('KONTROL — kritik OLMAYAN kapı düşerse oturum engellenmez', () => {
    expect(preflightBlocksSession([row('AI_POLICY', 'FAIL')])).toBe(false);
    expect(preflightBlocksSession([row('BACKEND_ACCESS', 'FAIL')])).toBe(false);
    expect(preflightBlocksSession([row('SESSION_PERSISTENCE', 'PASS')])).toBe(false);
  });

  it('başlatıcı kuralı KOPYALAMAZ — kapıyı fonksiyona sorar', () => {
    expect(RECORDER_SRC).toContain('preflightBlocksSession(s.preflight)');
    /* Eski kopya geri gelirse bu kilit düşer. */
    const startFn = RECORDER_SRC.slice(RECORDER_SRC.indexOf('export function startLongRoadSession'));
    expect(startFn.slice(0, 1500)).not.toContain("p.id === 'SESSION_PERSISTENCE'");
  });
});

describe('E-32 — senaryo hükmü tek otoriteden üretilir', () => {
  it('hits>0 → PASS, hits=0 → NOT_OBSERVED (FAIL DEĞİL)', () => {
    expect(scenarioVerdict(emptyScenario('FIRST_VEHICLE_LINK'))).toBe('NOT_OBSERVED');
    expect(scenarioVerdict({
      ...emptyScenario('FIRST_VEHICLE_LINK'), hits: 1, firstAt: 1, lastAt: 1,
    })).toBe('PASS');
  });

  it('kabul matrisi saf senaryo hükmünü KOPYALAMAZ', () => {
    expect(ACCEPTANCE_SRC).toContain('scenarioVerdict(link)');
    expect(ACCEPTANCE_SRC).toContain('scenarioVerdict(tunnel)');
    /* Saf kopya deseni (`X.hits > 0 ? 'PASS' : 'NOT_OBSERVED'`) kalmamalı.
       BİLEŞİK kurallar (hits>0 ? PASS : başkaHits>0 ? FAIL : …) bu kilidin
       DIŞINDADIR — onlar gerçekten farklı hükümlerdir. */
    expect(ACCEPTANCE_SRC).not.toMatch(/\w+\.hits > 0 \? 'PASS' : 'NOT_OBSERVED'/);
  });

  it('§9.3 ŞÜPHESİ ÖLÇÜLDÜ — judge* fonksiyonları senaryo hükmünün kopyası DEĞİL', () => {
    const report = readFileSync('src/platform/fieldValidation/longRoadReport.ts', 'utf8');
    const persistence = report.slice(
      report.indexOf('export function judgePersistence'),
      report.indexOf('export function judgeRealVehicle'));
    /* Farklı girdi (oturum durumu/checkpoint/restore) → farklı soru. */
    expect(persistence).toContain('lastCheckpointAt');
    expect(persistence).toContain('restoreCount');
    expect(persistence).not.toContain('hits');
    expect(persistence).not.toContain('NOT_OBSERVED');
  });
});

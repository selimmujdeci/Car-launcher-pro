/**
 * P0-NAV-20 — NAVİGASYON ARIZA / KURTARMA TABLOSU (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * NAV-20'nin en sert şartı ÖLÇÜLDÜ ve DOĞRULANDI:
 *   *"OBD kopması navigasyonu gereksiz yere öldürmemeli. GPS ve navigation
 *     authority OBD'den bağımsız kalmalı."*
 * `routingService` ve `navigationService` OBD katmanından **HİÇBİR ŞEY import
 * ETMİYOR**; hız `UnifiedVehicleStore`dan (füzyonlanmış) gelir. OBD'ye dokunan
 * tek yer `navigation/guardian/**`tır ve bilinçli olarak bir PORT ardında
 * yalıtılmıştır.
 *
 * Ölçülen boşluk: her arıza sınıfı için AYRI dürüst hüküm VARDI ama
 * **"navigasyon şu an genel olarak ne hâlde"** sorusunun tek cevabı YOKTU.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MATRIX_FIX_STALE_MS,
  buildNavFailureMatrix,
  type NavFailureAxis, type NavFailureMatrixInput,
} from '../platform/navigation/core/navFailureMatrixModel';

const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/* ── Fikstür: her şey sağlıklı, aktif navigasyon ─────────────────────────── */

const base: NavFailureMatrixInput = {
  navActive: true,
  gpsUsable: true,
  fixAgeMs: 400,
  gpsDecisionGrade: true,
  online: true,
  searchVerdict: 'RESULTS',
  routeChainOutcome: 'PRIMARY_SUCCESS',
  geometryIntegrity: 'VALID',
  progressVerdict: 'PLAUSIBLE',
  rerouteHealth: 'HEALTHY',
  routeRequestPending: false,
};

const m = (over: Partial<NavFailureMatrixInput> = {}) =>
  buildNavFailureMatrix({ ...base, ...over });

const axis = (mx: ReturnType<typeof m>, a: NavFailureAxis) =>
  mx.axes.find((x) => x.axis === a);

/* ══════════════════════════════════════════════════════════════════════════
   1) OBD BAĞIMSIZLIĞI — NAV-20'NİN EN SERT ŞARTI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-20 › navigasyon OBD’den bağımsızdır', () => {
  it('🔒 rota ve navigasyon otoriteleri OBD import ETMEZ', () => {
    for (const f of ['platform/routingService.ts', 'platform/navigationService.ts']) {
      const code = rd(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, `${f} OBD import ediyor`).not.toMatch(/from '.*obdService'/);
      expect(code, `${f} OBD yöneticisi import ediyor`).not.toMatch(/OBDManager/);
    }
  });

  it('🔒 arıza tablosunun GİRDİSİNDE OBD ALANI YOKTUR', () => {
    /* Buraya bir OBD alanı eklemek, bağımsızlığı sessizce kırardı. */
    const src = rd('platform/navigation/core/navFailureMatrixModel.ts');
    const iface = src.match(/export interface NavFailureMatrixInput \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(iface.length, 'girdi arayüzü bulunamadı').toBeGreaterThan(0);
    expect(iface.toLowerCase(), 'OBD alanı girdiye sızmış').not.toMatch(/\bobd\b/);
  });

  it('🔒 tablo OBD katmanından hiçbir şey import etmez', () => {
    const src = rd('platform/navigation/core/navFailureMatrixModel.ts');
    expect(src).not.toMatch(/from '.*obd/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) EKSEN HÜKÜMLERİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-20 › eksen hükümleri', () => {
  it('hepsi sağlıklıysa genel hüküm SAĞLIKLI', () => {
    const mx = m();
    expect(mx.overall).toBe('HEALTHY');
    expect(mx.worstAxis).toBeNull();
    expect(mx.summary).toContain('sağlıklı');
  });

  it('GPS yoksa eksen ÇÖKER', () => {
    const mx = m({ gpsUsable: false });
    expect(axis(mx, 'GPS')?.state).toBe('FAILED');
    expect(mx.overall).toBe('FAILED');
    expect(mx.worstAxis).toBe('GPS');
  });

  it('BAYAT fix bir arıza değil BEKLEYİŞTİR (tünel · köprü altı)', () => {
    /* Bir sonraki fix gelince kendiliğinden düzelir → `RECOVERING`. */
    const mx = m({ fixAgeMs: MATRIX_FIX_STALE_MS + 1 });
    expect(axis(mx, 'GPS')?.state).toBe('RECOVERING');
    expect(mx.overall).toBe('RECOVERING');
  });

  it('ÇEVRİMDIŞI olmak bir ÇÖKME DEĞİLDİR', () => {
    /* Cihaz-içi POI ve çevrimdışı graf çalışmaya devam eder. */
    const mx = m({ online: false });
    expect(axis(mx, 'NETWORK')?.state).toBe('DEGRADED');
    expect(axis(mx, 'NETWORK')?.state).not.toBe('FAILED');
  });

  it('DÜZ HAT devredeyse rota sağlayıcı ekseni ÇÖKMÜŞTÜR', () => {
    /* Düz hat gerçek rota DEĞİLDİR — "çalışıyor" demek yalan olurdu. */
    const mx = m({ routeChainOutcome: 'DEGRADED_STRAIGHT_LINE' });
    expect(axis(mx, 'ROUTE_PROVIDER')?.state).toBe('FAILED');
    expect(mx.overall).toBe('FAILED');
  });

  it('YEDEK kurtardıysa çalışıyor ama DEGRADE', () => {
    const mx = m({ routeChainOutcome: 'FALLBACK_SUCCESS' });
    expect(axis(mx, 'ROUTE_PROVIDER')?.state).toBe('DEGRADED');
  });

  it('rota isteği UÇUYORSA eksen DÜZELİYOR sayılır', () => {
    const mx = m({ routeRequestPending: true, routeChainOutcome: 'ALL_FAILED' });
    expect(axis(mx, 'ROUTE_PROVIDER')?.state).toBe('RECOVERING');
  });

  it('GERÇEK geri dönüş bir ARIZA DEĞİLDİR (sürücünün kararı)', () => {
    const mx = m({ progressVerdict: 'REAL_BACKTRACK' });
    expect(axis(mx, 'PROGRESS')?.state).toBe('HEALTHY');
  });

  it('kanıtsız geri kayma DEGRADE eder', () => {
    expect(axis(m({ progressVerdict: 'IMPLAUSIBLE_BACKWARD' }), 'PROGRESS')?.state)
      .toBe('DEGRADED');
    expect(axis(m({ progressVerdict: 'IMPLAUSIBLE_FORWARD' }), 'PROGRESS')?.state)
      .toBe('DEGRADED');
  });

  it('reroute AÇLIĞI eksen çökmesidir', () => {
    const mx = m({ rerouteHealth: 'STARVED' });
    expect(axis(mx, 'REROUTE')?.state).toBe('FAILED');
  });

  it('çözümleme hatası arama eksenini ÇÖKERTİR (KOD kusuru)', () => {
    expect(axis(m({ searchVerdict: 'PARSE_FAILURE' }), 'SEARCH')?.state).toBe('FAILED');
  });

  it('arama zaman aşımı DÜZELİYOR sayılır (tekrar denenebilir)', () => {
    expect(axis(m({ searchVerdict: 'TIMEOUT' }), 'SEARCH')?.state).toBe('RECOVERING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) DÜRÜSTLÜK KURALLARI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-20 › dürüstlük', () => {
  it('navigasyon SÜRMÜYORKEN rota eksenleri hakkında hüküm VERİLMEZ', () => {
    /* Rota yokken "rota bozuk" demek uydurmadır. */
    const mx = m({ navActive: false });
    for (const a of ['ROUTE_PROVIDER', 'GEOMETRY', 'PROGRESS', 'REROUTE'] as const) {
      expect(axis(mx, a)?.state, a).toBe('UNKNOWN');
      expect(axis(mx, a)?.why).toContain('navigasyon sürmüyor');
    }
    /* GPS ve AĞ eksenleri yine anlamlıdır. */
    expect(axis(mx, 'GPS')?.state).toBe('HEALTHY');
  });

  it('kanıt yoksa "sağlıklı" VARSAYILMAZ', () => {
    const mx = m({
      searchVerdict: null, routeChainOutcome: null,
      geometryIntegrity: null, progressVerdict: null, rerouteHealth: null,
      online: null,
    });
    for (const a of ['SEARCH', 'ROUTE_PROVIDER', 'GEOMETRY', 'PROGRESS', 'REROUTE', 'NETWORK'] as const) {
      expect(axis(mx, a)?.state, a).toBe('UNKNOWN');
    }
    expect(mx.overall).toBe('UNKNOWN');
  });

  it('genel hüküm EN KÖTÜ eksene eşittir', () => {
    /* Bir eksen çökmüşken "iyi" demek sürücüye yalan söylemektir. */
    const mx = m({ online: false, rerouteHealth: 'STARVED' });
    expect(mx.overall).toBe('FAILED');
    expect(mx.worstAxis).toBe('REROUTE');
  });

  it('DEGRADED, RECOVERING’den DAHA KÖTÜDÜR', () => {
    /* "Düzeliyor" beklenebilir; "kusurlu ama çalışıyor" kalıcı bir eksikliktir. */
    const mx = m({ fixAgeMs: MATRIX_FIX_STALE_MS + 1, online: false });
    expect(mx.overall).toBe('DEGRADED');
    expect(mx.worstAxis).toBe('NETWORK');
  });

  it('her eksen bir GEREKÇE taşır (sessiz hüküm YOK)', () => {
    for (const a of m().axes) {
      expect(a.why.length, a.axis).toBeGreaterThan(0);
    }
  });

  it('tanınmayan hüküm UNKNOWN’a düşer (çökmez)', () => {
    const mx = m({
      searchVerdict: 'YENI_BIR_SEY', routeChainOutcome: 'BASKA_SEY',
      geometryIntegrity: 'X', progressVerdict: 'Y', rerouteHealth: 'Z',
    });
    for (const a of ['SEARCH', 'ROUTE_PROVIDER', 'GEOMETRY', 'PROGRESS', 'REROUTE'] as const) {
      expect(axis(mx, a)?.state, a).toBe('UNKNOWN');
    }
  });

  it('tablo YENİ ÖLÇÜM YAPMAZ (saf toplayıcı)', () => {
    const src = rd('platform/navigation/core/navFailureMatrixModel.ts');
    expect(src, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(src, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(src, 'zaman okuma').not.toMatch(/Date\.now\s*\(/);
    expect(src, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('kanıt LAB ekranına taşınır', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain("id: 'fm-overall'");
    expect(model).toContain("id: 'fm-axes'");
    expect(model).toMatch(/_fm === null \|\| _fm\.axes\.length === 0/);
  });
});

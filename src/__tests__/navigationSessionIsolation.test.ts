/**
 * P0-NAV-18 — NAVİGASYON OTURUMU / BAYAT VERİ YALITIMI (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * Yalıtımın ÇEKİRDEĞİ zaten kuruluydu ve **bu tur onu YENİDEN KURMADI**:
 *   · `beginRouteRequest` uçuştaki isteği `SUPERSEDED` işaretler
 *   · `_commitRoute` `isCurrentRequest` kapısından geçmeyen yanıtı REDDEDER
 *     → **"route A istenir → route B istenir → A geç gelir"** senaryosu kapalı
 *   · `setRerouteContext` / `clearRerouteContext` fix · sapma makinesi ·
 *     istek defteri · ilerleme defterini sıfırlar
 *   · ses kuyruğu `oturum:rotaRevizyonu` anahtarıyla temizlenir
 *
 * Ölçülen SIZINTI: **geometri kanıtı oturumlar arasında YAŞIYORDU.** Yeni bir
 * hedef seçildikten SONRA ama yeni rota gelmeden ÖNCE, LAB **önceki
 * yolculuğun geometrisini "uygulanan geometri" diye gösteriyordu.**
 * (Bu kusur P0-NAV-11'de bu turun kendisi tarafından eklenmişti ve
 * P0-NAV-18 denetiminde yakalandı.)
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getCommittedGeometry, getRejectedGeometryEvidence,
  measureGeometry, recordCommittedGeometry, recordRejectedGeometry,
  resetRouteGeometryEvidence,
} from '../platform/navigation/core/routeGeometryModel';
import {
  getProgressLedger, judgeProgress, recordProgressJudgement, resetProgressLedger,
} from '../platform/navigation/core/routeProgressLedger';

const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

beforeEach(() => {
  resetRouteGeometryEvidence();
  resetProgressLedger();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) GEOMETRİ KANITI OTURUMA BAĞLIDIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-18 › geometri kanıtı yalıtımı', () => {
  const commit = (rev: number) => recordCommittedGeometry({
    requestId: rev, providerLabel: 'srv-a', integrity: 'VALID',
    metrics: measureGeometry([[34.86, 36.91], [34.87, 36.92]]),
    flaws: [], startDistanceM: 5, endDistanceM: 8,
    routeRevision: rev, atMs: 1_700_000_000_000,
  });

  it('yeni oturum ESKİ geometriyi TAŞIMAZ', () => {
    commit(1);
    expect(getCommittedGeometry()).not.toBeNull();

    resetRouteGeometryEvidence();          // ← yeni hedef

    /* "Henüz rota yok" demek, önceki rotayı göstermekten DAHA DÜRÜSTTÜR. */
    expect(getCommittedGeometry()).toBeNull();
  });

  it('reddedilen aday kanıtı da oturumla düşer', () => {
    recordRejectedGeometry({
      requestId: 1, providerLabel: 'srv-a', candidateIndex: 0,
      integrity: 'INVALID', metrics: measureGeometry([]), flaws: ['EMPTY'],
      failedCheckIds: ['GEOMETRY'], atMs: 1,
    });
    expect(getRejectedGeometryEvidence().total).toBe(1);

    resetRouteGeometryEvidence();

    const snap = getRejectedGeometryEvidence();
    expect(snap.total).toBe(0);
    expect(snap.recent).toEqual([]);
  });

  it('ÜRÜN bu sıfırlamayı gerçekten çağırır (yalnız test değil)', () => {
    /* "Motor var, besleyen yok" kusurunu kapatan kilit: sıfırlama fonksiyonu
       ürünün oturum sınırlarından ÇAĞRILMALIDIR. */
    const r = rd('platform/routingService.ts');
    const calls = r.match(/resetRouteGeometryEvidence\(\);/g) ?? [];
    expect(calls.length, 'oturum sıfırlaması eksik').toBeGreaterThanOrEqual(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) İLERLEME KANITI OTURUMA BAĞLIDIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-18 › ilerleme kanıtı yalıtımı', () => {
  it('eski rotanın sıçraması yeni oturuma YAZILMAZ', () => {
    const jump = judgeProgress({
      prevRemainingM: 10_000, remainingM: 7_000, elapsedMs: 1_000,
      speedKmh: 90, headingDeltaDeg: 3, matchState: 'MATCHED', confidence: 0.9,
      prevRouteRevision: 1, routeRevision: 1,
    });
    recordProgressJudgement(jump, {
      prevRemainingM: 10_000, remainingM: 7_000, elapsedMs: 1_000,
      speedKmh: 90, headingDeltaDeg: 3, matchState: 'MATCHED', confidence: 0.9,
      prevRouteRevision: 1, routeRevision: 1,
    }, 1);
    expect(getProgressLedger().maxForwardJumpM).toBe(3_000);

    resetProgressLedger();

    const led = getProgressLedger();
    expect(led.maxForwardJumpM).toBeNull();
    expect(led.totalSamples).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) BAYAT YANIT YENİ ROTAYI EZEMEZ — YAPISAL KİLİT
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-18 › A istendi, B istendi, A geç geldi', () => {
  it('uçuştaki istek SUPERSEDED işaretlenir', () => {
    const m = rd('platform/navigation/core/routeRequestLedger.ts');
    expect(m).toMatch(/if \(_current && _current\.outcome === 'PENDING'\)/);
    expect(m).toContain("outcome: 'SUPERSEDED'");
  });

  it('bayat yanıt UYGULANMAZ ve kaydı düşer', () => {
    const r = rd('platform/routingService.ts');
    /* `_commitRoute` ilk işi güncellik kapısı olmalı. */
    expect(r).toMatch(/if \(!isCurrentRequest\(reqId\)\) \{\s*\n\s*recordStaleRejected\(reqId\);/);
    /* Düz hat yolunda da güncellik SON ana kadar denetlenir. */
    const straightGuards = r.match(/if \(!isCurrentRequest\(reqId\)\) \{/g) ?? [];
    expect(straightGuards.length, 'güncellik kapısı zayıflamış').toBeGreaterThanOrEqual(3);
  });

  it('rota uygulaması ATOMİKTİR (geometri ve süre birlikte yazılır)', () => {
    /* Yarım uygulanmış rota = yeni geometri + eski süre → ETA saçmalar. */
    const r = rd('platform/routingService.ts');
    expect(r).toMatch(/SÜRE MODELİ ATOMİK DEVRALINIR/);
    expect(r).toMatch(/routeRevision:\s+rev,\s*\n\s*durationRevision:\s+rev,/);
  });

  it('yeni hedef oturum numarasını ARTIRIR ve istek sahipliğini düşürür', () => {
    const n = rd('platform/navigationService.ts');
    expect(n).toMatch(/_sessionId \+= 1;\s*\n\s*_routeClaim = null;/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) SES KUYRUĞU OTURUMA BAĞLIDIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-18 › ses kuyruğu yalıtımı', () => {
  it('rota kimliği değişince söylenmiş maskesi TEMİZLENİR', () => {
    /* Taşınırsa yeni rotanın ilk manevrası hiç seslendirilmez — eski kodda
       gerçekten yaşanmış kusur. */
    const r = rd('platform/navigation/voiceGuidanceRuntime.ts');
    expect(r).toMatch(/const routeKey = `\$\{input\.sessionId\}:\$\{input\.routeRevision\}`;/);
    expect(r).toMatch(/if \(routeKey !== _routeKey\) \{[\s\S]{0,200}?_spoken = new Map\(\);/);
  });

  it('manevra kimliği oturum VE revizyon içerir', () => {
    const m = rd('platform/navigation/core/voiceGuidanceModel.ts');
    expect(m).toMatch(/return `\$\{sessionId\}:\$\{routeRevision\}:\$\{stepIndex\}`/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) OTURUM SINIRINDA SIFIRLANAN HER DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-18 › oturum sınırı sözleşmesi', () => {
  it('oturum sınırında TÜM navigasyon defterleri sıfırlanır', () => {
    /* Yeni bir defter eklenip bu listeye eklenmezse, sahada eski yolculuğun
       verisi yenisinde "güncel" gibi görünür — bu kilit onu yakalar. */
    const r = rd('platform/routingService.ts');
    const ctx = r.match(/export function setRerouteContext[\s\S]{0,900}?\n\}/)?.[0] ?? '';
    expect(ctx.length, 'setRerouteContext bulunamadı').toBeGreaterThan(0);
    for (const fn of [
      'initialOffRoute',
      'resetRouteRequestLedger',
      'resetProgressLedger',
      'resetRouteGeometryEvidence',
    ]) {
      expect(ctx, `${fn} oturum sınırında çağrılmıyor`).toContain(fn);
    }
    expect(ctx, 'son fix taşınıyor').toMatch(/_lastFix\s+= null;/);
  });

  it('navigasyon durdurulduğunda da aynı defterler sıfırlanır', () => {
    const r = rd('platform/routingService.ts');
    const ctx = r.match(/export function clearRerouteContext[\s\S]{0,900}?\n\}/)?.[0] ?? '';
    expect(ctx.length, 'clearRerouteContext bulunamadı').toBeGreaterThan(0);
    for (const fn of [
      'resetRouteRequestLedger', 'resetProgressLedger', 'resetRouteGeometryEvidence',
    ]) {
      expect(ctx, `${fn} durdurmada çağrılmıyor`).toContain(fn);
    }
  });
});

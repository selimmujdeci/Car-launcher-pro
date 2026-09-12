/**
 * P0-NAV-19 — NAVİGASYON PERFORMANSI + İSTEK BÜTÇESİ (ÖLÇÜM TURU KİLİDİ).
 *
 * ── ÖLÇÜLEN TABLO (2026-08-24, koddan) ────────────────────────────────────
 * NAV-19 bir ÖLÇÜM turudur ("yeni özellik ekleme"). Ölçüm sonucu:
 *
 *   · **Zamanlayıcı disiplini SAĞLAM.** Tüm navigasyon yolunda `setInterval`
 *     YALNIZ BİR TANE (`navigationSessionRuntime._drTimer` — ölü hesap
 *     beslemesi, 1 Hz, YALNIZ GPS fix'i yokken) ve ÜÇ yerde `clearInterval`.
 *     Guardian kendi timer'ını KURMAZ (runtimeManager çarkını kullanır).
 *     → **Bu turda timer EKLENMEDİ.**
 *   · **Gecikmeler ZATEN ölçülü:** arama zinciri · rota isteği yaşam döngüsü
 *     (sapma→yanıt→uygulama→ilk talimat) · sağlayıcı başına süre.
 *   · **Yinelenen istekler ZATEN kapalı:** `claimRouteRequest` +
 *     `suppressedDuplicateCount` + hıza bağlı throttle penceresi.
 *
 * Ölçülen TEK boşluk: **sıcak yolun KENDİ maliyeti hiç ölçülmüyordu.**
 * Düşük-uçlu head unit'te "harita takılıyor" şikâyeti gelince bakılacak bir
 * sayı YOKTU.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TICK_COST_WINDOW,
  getNavTickCost, getNavTickCostSnapshot,
  recordNavTickCost, resetNavTickCost,
} from '../platform/navigation/core/navTickCostModel';

const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

beforeEach(() => { resetNavTickCost(); });

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖLÇÜM SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-19 › tick maliyeti ölçümü', () => {
  it('ölçüm yoksa `null` — sahte 0 ms YASAK', () => {
    const st = getNavTickCost('MAP_MATCH');
    expect(st.samples).toBe(0);
    expect(st.p50Ms).toBeNull();
    expect(st.p95Ms).toBeNull();
    expect(st.maxMs).toBeNull();
  });

  it('medyan ve %95 ölçülür', () => {
    for (let i = 1; i <= 100; i++) recordNavTickCost('MAP_MATCH', i);
    const st = getNavTickCost('MAP_MATCH');
    expect(st.samples).toBe(100);
    expect(st.p50Ms ?? 0).toBeGreaterThanOrEqual(45);
    expect(st.p50Ms ?? 0).toBeLessThanOrEqual(55);
    expect(st.p95Ms ?? 0).toBeGreaterThanOrEqual(90);
    expect(st.maxMs).toBe(100);
  });

  it('pencere SABİT boyutludur ama ÖMÜR BOYU sayaç ve tepe korunur', () => {
    recordNavTickCost('MAP_MATCH', 9_999);          // erken bir tepe
    for (let i = 0; i < TICK_COST_WINDOW + 50; i++) recordNavTickCost('MAP_MATCH', 1);
    const st = getNavTickCost('MAP_MATCH');
    expect(st.samples).toBe(TICK_COST_WINDOW);       // pencere taşmaz
    expect(st.total).toBe(TICK_COST_WINDOW + 51);    // toplam kaybolmaz
    /* Pencereden düşmüş olsa bile ömür boyu tepe HATIRLANIR — sahada bir kez
       yaşanan 10 saniyelik donma görünmez olmamalıdır. */
    expect(st.maxMs).toBe(9_999);
  });

  it('iki aşama AYRI ölçülür (yavaşlık NEREDE sorusu)', () => {
    recordNavTickCost('MAP_MATCH', 5);
    recordNavTickCost('PROGRESS_TICK', 40);
    const s = getNavTickCostSnapshot();
    expect(s.mapMatch.maxMs).toBe(5);
    expect(s.progressTick.maxMs).toBe(40);
  });

  it('geçersiz ölçüm yok sayılır (kayıt bozulmaz)', () => {
    for (const bad of [NaN, Infinity, -1]) recordNavTickCost('MAP_MATCH', bad);
    expect(getNavTickCost('MAP_MATCH').samples).toBe(0);
  });

  it('kayıt yolu THROW ETMEZ', () => {
    expect(() => recordNavTickCost(
      'BOGUS' as unknown as 'MAP_MATCH', 5,
    )).not.toThrow();
  });

  it('yeni oturum eski rotanın maliyetini TAŞIMAZ', () => {
    recordNavTickCost('MAP_MATCH', 50);
    expect(getNavTickCost('MAP_MATCH').maxMs).toBe(50);
    resetNavTickCost();
    expect(getNavTickCost('MAP_MATCH').maxMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ÖLÇÜMÜN KENDİSİ UCUZ OLMALI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-19 › ölçüm maliyeti', () => {
  it('sıcak yolda TAHSİS ve SIRALAMA yapılmaz', () => {
    const m = rd('platform/navigation/core/navTickCostModel.ts');
    const rec = m.match(/export function recordNavTickCost[\s\S]{0,700}?\n\}/)?.[0] ?? '';
    expect(rec.length, 'kayıt fonksiyonu bulunamadı').toBeGreaterThan(0);
    expect(rec, 'sıcak yolda sıralama').not.toMatch(/\.sort\(/);
    expect(rec, 'sıcak yolda dizi tahsisi').not.toMatch(/\.push\(|\.slice\(|\[\]/);
    /* Sabit boyutlu tipli dizi kullanılmalı. */
    expect(m).toContain('Float64Array');
  });

  it('percentil YALNIZ okuma anında hesaplanır', () => {
    const m = rd('platform/navigation/core/navTickCostModel.ts');
    const get = m.match(/export function getNavTickCost\([\s\S]{0,800}?\n\}/)?.[0] ?? '';
    expect(get).toMatch(/\.sort\(/);
  });

  it('model SAFTIR ve TIMER KURMAZ', () => {
    const m = rd('platform/navigation/core/navTickCostModel.ts');
    expect(m, 'timer kurulmuş').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'zaman okuma').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ÖLÇÜLEN DİSİPLİN KİLİTLENİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-19 › runtime disiplini', () => {
  it('🔒 navigasyon yolunda TEK `setInterval` vardır', () => {
    /* Bu kilit "polling artırarak çözme" refleksini kapatır. Yeni bir
       interval eklenirse burada DÜŞER ve gerekçesi tartışılır. */
    const files = [
      'platform/routingService.ts',
      'platform/navigationService.ts',
      'platform/navigation/navigationSessionRuntime.ts',
      'platform/navigation/voiceGuidanceRuntime.ts',
      'platform/navigation/navMarkerMotionRuntime.ts',
      'platform/navigation/cameraFollowAuthority.ts',
    ];
    let intervals = 0;
    for (const f of files) {
      /* Yorumları soy — kilit YORUMU değil KODU sayar. */
      const code = rd(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      intervals += (code.match(/setInterval\s*\(/g) ?? []).length;
    }
    expect(intervals, 'navigasyon yoluna yeni interval eklenmiş').toBe(1);
  });

  it('🔒 tek interval ÜÇ yerde kapatılır (sızıntı yok)', () => {
    const r = rd('platform/navigation/navigationSessionRuntime.ts');
    const clears = r.match(/clearInterval\(_drTimer\)/g) ?? [];
    expect(clears.length, 'DR timer temizliği azalmış').toBeGreaterThanOrEqual(2);
    /* Aynı timer İKİ KEZ kurulamaz (çift tick = çift maliyet). */
    expect(r).toMatch(/if \(_drTimer !== null\) return;/);
  });

  it('🔒 yinelenen rota isteği kapısı KORUNUYOR', () => {
    const n = rd('platform/navigationService.ts');
    expect(n).toContain('claimRouteRequest');
    const r = rd('platform/routingService.ts');
    expect(r).toContain('recordSuppressedDuplicate');
  });

  it('🔒 sıcak yol ölçümü ÜRÜNDE bağlı (yalnız test değil)', () => {
    const r = rd('platform/routingService.ts');
    expect(r).toMatch(/recordNavTickCost\('MAP_MATCH'/);
    expect(r).toMatch(/recordNavTickCost\('PROGRESS_TICK'/);
    /* Ölçüm hata hâlinde bile yazılmalı → `finally`. */
    expect(r).toMatch(/\} finally \{\s*\n\s*recordNavTickCost\('PROGRESS_TICK'/);
  });

  it('🔒 maliyet LAB ekranına taşınır', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain("id: 'tc-match'");
    expect(model).toContain("id: 'tc-tick'");
    /* Ölçüm yoksa sahte 0 DEĞİL, UNAVAILABLE. */
    expect(model).toMatch(/_tc === null \|\| _tc\.mapMatch\.samples === 0/);
  });
});

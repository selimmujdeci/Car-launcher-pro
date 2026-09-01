/**
 * P0-NAV-14 — ETA OTORİTESİ + SIÇRAMA KONTROLÜ (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * ETA **TEK yerde HESAPLANIYOR** (`etaModel` → `navigationService`) ve bu
 * DOĞRUYDU: kaynak ayrımı (`ROUTE_MODEL` · `DEGRADED_FALLBACK` · düz hat),
 * düzeltme çarpanı (ham · hız-kapılı · zaman-sınırlı), süre revizyonu
 * eşleşmesi ve `etaJumpLedger` hepsi mevcuttu. **Bu tur ETA motorunu YENİDEN
 * KURMADI.**
 *
 * Ölçülen boşluk GÖSTERİM tarafındaydı: **aynı sayı DÖRT yüzeyde FARKLI
 * güven kuralıyla gösteriliyordu.**
 *   · `TripSummary`   → `honesty.etaTrustworthy` kontrol eder  ✔
 *   · `SplitScreen`   → `nav.etaSeconds ?? route.totalDurationSeconds` ✘
 *   · `MiniMapWidget` → yalnız "sayı var mı"                    ✘
 *   · `HorizonLayout` → yalnız `etaSeconds > 0`                 ✘
 *
 * Yani motor "bu ETA'ya GÜVENME" dediğinde üç yüzey yine de sayı gösteriyor,
 * `SplitScreen` ayrıca sağlayıcının HAM toplam süresini varış saati gibi
 * sunuyordu. Ham süre bir ETA DEĞİLDİR — bir rota özelliğidir.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { decideEtaDisplay } from '../platform/navigation/core/navigationHonestyModel';
import type { EtaState } from '../platform/navigation/core/etaModel';

const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
   1) TEK KURAL
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-14 › ETA gösterim kararı', () => {
  it('ROUTE_MODEL: sayı gösterilir ve YAKLAŞIK DEĞİLDİR', () => {
    const d = decideEtaDisplay(600, 'ROUTE_MODEL');
    expect(d.showNumber).toBe(true);
    expect(d.seconds).toBe(600);
    expect(d.approximate).toBe(false);
  });

  it('DEGRADED_FALLBACK: sayı gösterilir ama YAKLAŞIKTIR', () => {
    const d = decideEtaDisplay(600, 'DEGRADED_FALLBACK');
    expect(d.showNumber).toBe(true);
    expect(d.approximate).toBe(true);
    expect(d.reason).toContain('yaklaşık');
  });

  it('motorun GÜVENMEDİĞİ her durumda sayı GİZLENİR (fail-closed)', () => {
    const untrusted: readonly EtaState[] = [
      'UNKNOWN', 'STALE', 'INSUFFICIENT_ROUTE_DATA', 'NOT_NAVIGATING',
    ] as unknown as readonly EtaState[];
    for (const st of untrusted) {
      const d = decideEtaDisplay(600, st);
      expect(d.showNumber, `${st} sayı gösteriyor`).toBe(false);
      expect(d.seconds, `${st} sayı taşıyor`).toBeNull();
    }
  });

  it('sıfır / negatif / geçersiz ETA bir VARIŞ İDDİASI değildir', () => {
    for (const v of [0, -1, NaN, Infinity, null, undefined]) {
      const d = decideEtaDisplay(v as number | null, 'ROUTE_MODEL');
      expect(d.showNumber, `${v} gösteriliyor`).toBe(false);
    }
  });

  it('karar SAYI ÜRETMEZ — yalnız motorun değerini geçirir', () => {
    const d = decideEtaDisplay(1234, 'ROUTE_MODEL');
    expect(d.seconds).toBe(1234);   // dönüştürme/yuvarlama YOK
  });

  it('gerekçe her zaman doludur (sessiz gizleme YOK)', () => {
    for (const st of ['ROUTE_MODEL', 'DEGRADED_FALLBACK', 'UNKNOWN'] as EtaState[]) {
      expect(decideEtaDisplay(600, st).reason.length).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) TÜM YÜZEYLER AYNI KAPIDAN GEÇER
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-14 › yüzey ayrışması kapatıldı', () => {
  it('DÖRT ETA yüzeyi de tek karar fonksiyonunu kullanır', () => {
    /* İki yüzeyin ayrışması bu deponun tekrar eden saha kusurudur
       (#332 · #547 · P0-NAV-06/1 · P0-NAV-07). */
    for (const f of [
      'components/split/SplitScreen.tsx',
      'components/map/MiniMapWidget.tsx',
      'components/themes/HorizonLayout.tsx',
    ]) {
      expect(rd(f), `${f} ETA kapısını kullanmıyor`).toContain('decideEtaDisplay');
    }
    /* TripSummary aynı kuralı `honesty.etaTrustworthy` üzerinden uygular —
       ikisi de `_etaTrustworthy` fonksiyonuna dayanır (tek tanım). */
    expect(rd('components/map/hud/TripSummary.tsx')).toContain('honesty.etaTrustworthy');
  });

  it('SAĞLAYICININ HAM SÜRESİ artık ETA yerine geçirilmiyor', () => {
    /* Ölçülen kusur: `nav.etaSeconds ?? route.totalDurationSeconds`.
       Ham toplam süre bir ETA DEĞİLDİR — sürücüye yalan söylemektir. */
    /* Yorumları SOY — kilit YORUMU değil KODU denetler. (Kusurun kendisi
       dosyadaki açıklamada anılıyor; onu eşleştirmek yanlış alarm olurdu.) */
    const split = rd('components/split/SplitScreen.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(split, 'ham rota süresi hâlâ ETA yerine geçiriliyor')
      .not.toMatch(/etaSeconds \?\? route\.totalDurationSeconds/);
    /* Varış saati YALNIZ karar fonksiyonunun verdiği saniyeden kurulmalı. */
    expect(split).toMatch(/decideEtaDisplay\(nav\.etaSeconds, readEtaStateSafe\(\)\)/);
  });

  it('güven kuralı TEK yerde tanımlıdır (kopya eşik yok)', () => {
    const m = rd('platform/navigation/core/navigationHonestyModel.ts');
    const defs = m.match(/function _etaTrustworthy/g) ?? [];
    expect(defs.length, 'birden fazla güven tanımı').toBe(1);
    /* `decideEtaDisplay` o TEK tanımı kullanmalı, kendi kopyasını değil. */
    expect(m).toMatch(/if \(!_etaTrustworthy\(etaState\)\)/);
  });

  it('ETA durumu okuması THROW ETMEZ (yüzey çökmez)', () => {
    const nav = rd('platform/navigationService.ts');
    expect(nav).toMatch(/export function readEtaStateSafe\(\)/);
    expect(nav).toMatch(/try \{ return _lastEtaVerdict\.state; \} catch \{ return 'UNKNOWN'; \}/);
  });

  it('okuma başarısızsa sayı GİZLENİR — gösterilmez (fail-closed)', () => {
    /* `readEtaStateSafe` hata hâlinde `UNKNOWN` döner; `decideEtaDisplay`
       `UNKNOWN`da sayıyı GİZLER. Zincirin fail-closed olduğu budur. */
    expect(decideEtaDisplay(600, 'UNKNOWN' as EtaState).showNumber).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) MEVCUT SIÇRAMA DEFTERİ KORUNUYOR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-14 › ETA sıçrama defteri korunuyor', () => {
  it('sıçrama sebepleri AYRIŞTIRILMIŞ hâlde durur', () => {
    /* NAV-14 ETA değişiminin nedeninin kanıtta olmasını ister; defter bunu
       zaten yapıyor ve bu tur ona DOKUNULMADI. */
    const m = rd('platform/navigation/core/etaJumpLedger.ts');
    expect(m).toContain('remainingDistanceM');
    expect(m, 'revizyon ekseni kaybolmuş').toMatch(/routeRevision|Revision/);
  });

  it('düz hat ETA\'sı ASLA rota modeli gibi sunulmaz', () => {
    const r = rd('platform/routingService.ts');
    expect(r).toMatch(/routeDurationSource:\s*'STRAIGHT_LINE_ESTIMATE'/);
    expect(r).toMatch(/durationIntegrityState:\s*'MISSING'/);
  });
});

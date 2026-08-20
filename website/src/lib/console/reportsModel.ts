/**
 * RAPOR MODELİ — filo sağlık zaman serisi (#662).
 *
 * Saf: I/O YOK. "Şimdi" ve pencere DAİMA parametredir.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 * Bu seri bir ÖLÇÜM DEĞİL, TÜRETİMDİR: geçmişteki araç sağlığı hiçbir yerde
 * saklanmıyor; elimizdeki tek kanıt olay/bildirim günlüğüdür. Seri bu yüzden
 * "kaç araç kritikti" DEMEZ — "o gün kaç kritik/uyarı OLAYI düştü" der ve
 * ekranda `TÜRETİLDİ` olarak etiketlenir. İkisini karıştırmak, olmayan bir
 * ölçümü varmış gibi göstermektir.
 *
 * Günlük kova sınırları YEREL güne göre kurulur (kullanıcı takvimi neyse o).
 */

import type { DecisionEvent } from './consoleSources';

export interface DayBucket {
  /** Kovanın yerel gün başlangıcı (epoch ms). */
  readonly at: number;
  /** `YYYY-MM-DD`. */
  readonly key: string;
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Son `days` günü kovalara böler. Olay olmayan gün de kovada DURUR (sıfır
 * gerçek bir gözlemdir: "o gün olay düşmedi"), ama pencere dışına taşan
 * olaylar sessizce eklenmez.
 */
export function bucketByDay(
  events: readonly DecisionEvent[],
  now: number,
  days = 14,
): DayBucket[] {
  const todayStart = startOfLocalDay(now);
  const buckets: DayBucket[] = [];
  const index = new Map<string, number>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const at = todayStart - i * DAY_MS;
    const key = dayKey(at);
    index.set(key, buckets.length);
    buckets.push({ at, key, critical: 0, warning: 0, info: 0 });
  }

  const windowStart = todayStart - (days - 1) * DAY_MS;
  for (const e of events) {
    if (e.at <= 0 || e.at < windowStart) continue;
    const slot = index.get(dayKey(e.at));
    if (slot === undefined) continue;
    const b = buckets[slot];
    buckets[slot] = {
      ...b,
      critical: b.critical + (e.severity === 'critical' ? 1 : 0),
      warning:  b.warning  + (e.severity === 'warning'  ? 1 : 0),
      info:     b.info     + (e.severity === 'info'     ? 1 : 0),
    };
  }

  return buckets;
}

/** İki serinin ortak tavanı — katlar aynı ölçekte olsun (karşılaştırılabilirlik). */
export function sharedMax(buckets: readonly DayBucket[]): number {
  let max = 0;
  for (const b of buckets) {
    if (b.critical > max) max = b.critical;
    if (b.warning > max) max = b.warning;
  }
  return max;
}

export interface SeriesTotals {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
  readonly days: number;
  /** Serinin hiç olayı yok mu — "veri yok" ile "hepsi sıfır" ayrı gösterilsin. */
  readonly empty: boolean;
}

export function totals(buckets: readonly DayBucket[]): SeriesTotals {
  let critical = 0, warning = 0, info = 0;
  for (const b of buckets) { critical += b.critical; warning += b.warning; info += b.info; }
  return { critical, warning, info, days: buckets.length, empty: critical + warning + info === 0 };
}

/** Kısa gün etiketi — `12.08`. */
export function shortDayLabel(at: number): string {
  const d = new Date(at);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

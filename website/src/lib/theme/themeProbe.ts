/**
 * themeProbe — araçtan gelen ÖLÇÜMÜN saf doğrulama katmanı (PWA).
 *
 * Stüdyo overlay'i kutuları buradan geçmiş veriyle çizer. Saf tutulmasının
 * sebebi: "dokunduğum yer hangi bileşen" sorusunun cevabı testle kilitlenebilsin.
 *
 * ZERO-TRUST: iframe'den gelen mesaj güvenilmez veridir. Kayıt defterinde
 * OLMAYAN kimlik, sayı olmayan koordinat ve sıfır/negatif boyutlu kutu
 * DÜŞÜRÜLÜR — ekranda hayalet dokunma alanı oluşmaz.
 */

import { getThemeComponent, type ThemeComponentInfo } from './themeComponentRegistry';

export interface ProbeItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Ham mesaj yükü → çizilebilir kutular. Hiçbir girdide throw etmez. */
export function sanitizeProbeItems(raw: unknown): ProbeItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProbeItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    if (getThemeComponent(o.id) === null) continue;      // hayalet kimlik
    if (seen.has(o.id)) continue;                        // yinelenen kutu
    if (!finite(o.x) || !finite(o.y) || !finite(o.w) || !finite(o.h)) continue;
    if (o.w <= 0 || o.h <= 0) continue;                  // dokunulamaz kutu
    seen.add(o.id);
    out.push({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h });
  }
  return out;
}

/**
 * Dokunulan kutunun hangi bileşen ve hangi EKRAN olduğunu çözer.
 * Stüdyo bunu "ekranı seç + editörü aç" için kullanır → bileşen listesinden
 * seçimle BİREBİR aynı yol (iki farklı seçim mantığı YOK).
 */
export function resolveProbeSelection(componentId: string): ThemeComponentInfo | null {
  return getThemeComponent(componentId);
}

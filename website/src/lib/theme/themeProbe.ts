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
  /**
   * Aynı kimliğin KAÇINCI örneği (0 tabanlı). Bir tema kuralı ekranda birden
   * çok düğüme iner (ayar kartları, menü öğeleri, dock butonları); overlay
   * her birini ayrı dokunma alanı olarak çizer, ama hepsi AYNI kimliği açar.
   */
  index: number;
}

/**
 * Bir kimlikten kabul edilen en çok kutu sayısı.
 *
 * NEDEN SINIR VAR: ölçüm iframe'den gelir ve güvenilmez veridir; sınırsız
 * kutu, overlay'de binlerce düğüm üretip arayüzü kilitleyebilirdi. 24, ayarlar
 * sayfasındaki en kalabalık listeyi (kategori menüsü + kartlar) rahatça
 * karşılar.
 */
export const MAX_BOXES_PER_ID = 24;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Ham mesaj yükü → çizilebilir kutular. Hiçbir girdide throw etmez.
 *
 * ── ÇOKLU ÖRNEK (2026-08-18) ────────────────────────────────────────────────
 * Eskiden aynı kimlikten YALNIZ İLK kutu kabul ediliyordu (`seen`). Sonuç:
 * ayarlar sayfasında bir kart türüne dokunulabiliyor, aynı türün ekrandaki
 * diğer 9 örneği ise dokunulamaz kalıyordu — kullanıcı bunu *"ayarlarda
 * istediğim yeri düzenleyemiyorum"* diye tarif etti. Artık her örnek kendi
 * kutusunu alır; hepsi aynı kimliğin düzenleyicisini açar (tek kural, tek
 * stil — ekranda "bu stil aynı türdeki tüm öğelere iner" diye YAZAR).
 */
export function sanitizeProbeItems(raw: unknown): ProbeItem[] {
  if (!Array.isArray(raw)) return [];
  const count = new Map<string, number>();
  const out: ProbeItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    if (getThemeComponent(o.id) === null) continue;      // hayalet kimlik
    if (!finite(o.x) || !finite(o.y) || !finite(o.w) || !finite(o.h)) continue;
    if (o.w <= 0 || o.h <= 0) continue;                  // dokunulamaz kutu
    const n = count.get(o.id) ?? 0;
    if (n >= MAX_BOXES_PER_ID) continue;                 // sınırlı: overlay kilitlenmesin
    count.set(o.id, n + 1);
    out.push({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, index: n });
  }
  return out;
}

/** Ekranda kaç FARKLI bileşen kimliği ölçüldü (kutu sayısı değil). */
export function distinctProbeIds(items: readonly ProbeItem[]): number {
  return new Set(items.map((i) => i.id)).size;
}

/**
 * Dokunulan kutunun hangi bileşen ve hangi EKRAN olduğunu çözer.
 * Stüdyo bunu "ekranı seç + editörü aç" için kullanır → bileşen listesinden
 * seçimle BİREBİR aynı yol (iki farklı seçim mantığı YOK).
 */
export function resolveProbeSelection(componentId: string): ThemeComponentInfo | null {
  return getThemeComponent(componentId);
}

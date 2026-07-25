/**
 * carosLabClipboard.ts — pano yazımı, üç kademeli fail-soft.
 *
 * SAHA GERÇEĞİ (K24 / eski head unit WebView'ları): `navigator.clipboard` çoğu zaman
 * YOKTUR — güvensiz bağlam (http://) veya izin reddi. Bu yüzden tek yola güvenilmez:
 *   1) Capacitor Clipboard  → native, en güvenilir (APK'da)
 *   2) navigator.clipboard  → modern tarayıcı / güvenli bağlam
 *   3) textarea + execCommand('copy') → eski WebView son çare
 * Üçü de düşerse `'failed'` döner ve ÇAĞIRAN seçilebilir metin gösterir — sessiz
 * "kopyalandı" YALANI YASAK (mevcut InspectorPanel deseninin aynısı).
 */

export type ClipboardRoute = 'native' | 'async' | 'legacy' | 'failed';

export async function copyTextFailSoft(text: string): Promise<ClipboardRoute> {
  if (typeof text !== 'string' || text.length === 0) return 'failed';

  // 1) Native (yalnız APK'da; web'de import maliyeti oluşmasın diye dinamik)
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
      return 'native';
    }
  } catch { /* sıradaki yola düş */ }

  // 2) Modern async API
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'async';
    }
  } catch { /* sıradaki yola düş */ }

  // 3) Eski WebView son çare
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', 'readonly');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const done = document.execCommand('copy');
    document.body.removeChild(ta);
    if (done) return 'legacy';
  } catch { /* düştü */ }

  return 'failed';
}

/** Kullanıcıya gösterilecek dürüst sonuç metni. */
export function describeClipboardRoute(route: ClipboardRoute, chars: number): string {
  const boyut = `${chars.toLocaleString('tr-TR')} karakter`;
  switch (route) {
    case 'native': return `Panoya kopyalandı (native) · ${boyut}`;
    case 'async':  return `Panoya kopyalandı · ${boyut}`;
    case 'legacy': return `Panoya kopyalandı (eski WebView yolu) · ${boyut}`;
    default:       return `Pano kullanılamadı — metin aşağıda, elle seçip kopyalayın · ${boyut}`;
  }
}

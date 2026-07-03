/**
 * appRegistry.ts — Sesli asistanın "X uygulamasını aç" komutu için isim→uygulama
 * çözümleyici. React'siz (platform-saf) tutulur: appDiscovery (hook) her uygulama
 * listesi değiştiğinde setAppIndex ile buraya güncel listeyi yazar; commandExecutor
 * ve intentEngine resolveAppByName ile React ağacına dokunmadan çözer.
 *
 * Neden ayrı modül: intentEngine/commandExecutor "platform-saf" — React import
 * etmemeli. appDiscovery useApps() hook'u React'e bağımlı; bu modül yalnız veriyi
 * (AppItem[]) tutar, böylece iki katman da temiz kalır.
 */

import { ALL_APPS, type AppItem } from '../data/apps';

// Modül düzeyi anlık uygulama listesi (native keşfedilenler dahil). Başlangıçta
// küratörlü liste — native tarama tamamlanınca setAppIndex ile genişler.
let _index: AppItem[] = [...ALL_APPS];

/** appDiscovery.useApps merged listeyi buraya yazar (her değişimde). Boşsa küratörlü. */
export function setAppIndex(apps: AppItem[]): void {
  _index = apps.length > 0 ? apps : [...ALL_APPS];
}

/** @internal testler için — anlık listeyi okur. */
export function getAppIndex(): readonly AppItem[] {
  return _index;
}

/** Türkçe normalize: küçük harf + aksan sadeleştirme + alfanümerik dışı → boşluk. */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Komut gürültüsü — beyin appName'i temiz vermezse ("kamera uygulamasını aç")
// eşleşmeyi bozmasın diye atılır. Uygulama adlarında bu kelimeler geçmez.
const STOPWORDS = new Set([
  'uygulamasini', 'uygulamasi', 'uygulamayi', 'uygulama', 'uygulamalar',
  'ac', 'acar', 'acsana', 'baslat', 'goster', 'misin', 'lutfen',
]);

function stripStop(n: string): string {
  const kept = n.split(' ').filter((w) => w && !STOPWORDS.has(w));
  return kept.join(' ').trim();
}

/**
 * Sesli/serbest bir uygulama adını en olası yüklü uygulamaya çözer.
 * ASR ekiyle gelse bile ("kamerayı", "hesap makinesini") gövde eşleşmesiyle bulur.
 * Eşleşme yeterince güçlü değilse null (çağıran dürüstçe "bulamadım" der — sahte
 * onay yok).
 *
 * @param spoken Ham/normalize edilmemiş uygulama adı ("kamera", "radyoyu", "whatsapp")
 */
export function resolveAppByName(spoken: string): AppItem | null {
  const raw = norm(spoken);
  const q = stripStop(raw) || raw;
  if (!q || q.length < 2) return null;

  let best: AppItem | null = null;
  let bestScore = 0;

  for (const app of _index) {
    const nName = norm(app.name);
    const nId   = norm(app.id.replace(/^native-/, ''));
    let score = 0;

    if (q === nName || q === nId) {
      score = 1000; // tam eşleşme
    } else if (nName && (q.includes(nName) || nName.includes(q))) {
      // Gövde eşleşmesi: ekli sorgu ("kamerayi" ⊃ "kamera") veya kısaltma.
      // Daha uzun örtüşme daha güvenilir.
      const overlap = Math.min(q.length, nName.length);
      if (overlap >= 3) score = 500 + overlap;
    } else {
      // Çok kelimeli ad ("hesap makinesi") — token örtüşme oranı.
      const qt = new Set(q.split(' '));
      const nt = nName.split(' ').filter(Boolean);
      const hit = nt.filter((w) => w.length >= 3 && qt.has(w)).length;
      if (hit > 0 && nt.length > 0) score = 100 * (hit / nt.length) + hit;
    }

    if (score > bestScore) { bestScore = score; best = app; }
  }

  // Eşik: zayıf/tek-harf token örtüşmelerini ele (yanlış uygulama açmaktansa
  // "bulamadım" demek daha dürüst — sahte onay yasağıyla tutarlı).
  return bestScore >= 100 ? best : null;
}

/* Paylaşım için sade statik sayfa: editör yok, yetenek yok, script yok.
   Kareler vektör (SVG) kalır — büyütünce bozulmaz. */
import { readFileSync, writeFileSync } from 'node:fs';

const KARE = [
  ['Main', 904, 406, 'Sürüş — gündüz', 'Kuşdili Cd. üzerinde, 830 m sonra sola Kurbağalıdere Cd.'],
  ['NavNight', 904, 406, 'Sürüş — gece', 'Aynı sahne, gece paleti: yerel yol tonla değil genişlikle geri çekilir.'],
  ['Maneuver', 904, 406, 'Manevra yaklaşımı', '120 m kala kamera alçalır, şerit rehberi açılır; geçersiz şerit söner ama silinmez.'],
  ['Browse', 904, 406, 'Keşif — gündüz', 'Rota yokken kuş bakışı; sol hedef kartları, tek ray, konum şeridi.'],
  ['BrowseNight', 904, 406, 'Keşif — gece', 'Kadıköy · D100 kavşağı · Kurbağalıdere.'],
  ['MiniMap', 440, 210, 'Mini harita widget', 'Ana ekranda seyrederken 440×210.'],
];

const govde = (ad) => {
  const h = readFileSync('_f_' + ad + '.html', 'utf8');
  return h.slice(h.indexOf('<div style="'), h.lastIndexOf('</body>'));
};

const bolum = ([ad, w, h, baslik, alt]) => `
<section>
  <h2>${baslik}</h2>
  <p>${alt}</p>
  <div class="cerceve" style="max-width:${w}px;aspect-ratio:${w}/${h};">
    <div class="olcek" style="width:${w}px;height:${h}px;--w:${w};">${govde(ad)}</div>
  </div>
</section>`;

writeFileSync('caros-nav-galeri.html', `<title>CarOS Navigasyon Kareleri</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap">
<style>
  :root { --ink:#12161e; --dim:#5b626d; --line:rgba(12,18,28,0.13); --bg:#f4f2ee; --panel:#ffffff; }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --ink:#f0ebe0; --dim:#9aa0aa; --line:rgba(255,240,210,0.15); --bg:#14171c; --panel:#1c2027; } }
  :root[data-theme="dark"] { --ink:#f0ebe0; --dim:#9aa0aa; --line:rgba(255,240,210,0.15); --bg:#14171c; --panel:#1c2027; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font-family:Archivo,'Helvetica Neue',Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  main { max-width:960px; margin:0 auto; padding:38px 20px 72px; }
  header h1 { font-size:27px; font-weight:700; letter-spacing:-0.5px; margin:0 0 8px; }
  header p { font-size:14.5px; line-height:1.62; color:var(--dim); margin:0 0 6px; max-width:660px; }
  .kunye { display:flex; flex-wrap:wrap; gap:7px; margin:20px 0 6px; }
  .kunye span { font-size:11.5px; font-weight:600; padding:5px 11px; border-radius:999px;
                border:1px solid var(--line); color:var(--dim); }
  section { margin-top:46px; }
  section h2 { font-size:17px; font-weight:700; margin:0 0 5px; letter-spacing:-0.2px; }
  section p { font-size:13.5px; line-height:1.6; color:var(--dim); margin:0 0 14px; max-width:660px; }
  .cerceve { width:100%; overflow:hidden; border-radius:16px; border:1px solid var(--line);
             background:var(--panel); }
  .olcek { transform-origin:0 0; }
  footer { margin-top:56px; padding-top:22px; border-top:1px solid var(--line);
           font-size:12.5px; line-height:1.7; color:var(--dim); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
</style>
<main>
<header>
  <h1>CarOS Navigasyon Kareleri</h1>
  <p>Bu kareler çizilmedi, <strong>ölçüldü</strong>. Her çizgi gerçek vektör karodan geliyor:
     OpenFreeMap planet (OpenMapTiles şeması, z14), <code>@mapbox/vector-tile</code> ile çözüldü,
     Web Mercator'dan yerel metreye çevrildi, rota yönüne döndürüldü ve gerçek bir pinhole
     kamerayla projekte edildi.</p>
  <p>Sahne: <strong>Kadıköy, İstanbul</strong> — 29.0300 E, 40.9900 K. Sokak adları
     <code>transportation_name</code> katmanından okundu; manevra rota geometrisinden hesaplandı.</p>
  <div class="kunye">
    <span>2363 yol</span><span>1617 ad</span><span>380 bina</span><span>156 su</span>
    <span>783 yeşil</span><span>pitch 60° · F 692 · FOV 66°</span><span>904 × 406</span>
  </div>
</header>
${KARE.map(bolum).join('')}
<footer>
  Harita verisi © OpenStreetMap katkıcıları (ODbL). Karo servisi OpenFreeMap.
  Archivo fontu OFL. Bu bir tasarım incelemesidir; gerçek araç doğrulaması yapılmamıştır.
</footer>
</main>
<script>
  // Dar ekranda kareyi ölçekle — kırpma yok, yatay kaydırma yok.
  const uygula = () => document.querySelectorAll('.cerceve').forEach((c) => {
    const i = c.firstElementChild, w = +i.style.getPropertyValue('--w');
    i.style.transform = 'scale(' + Math.min(1, c.clientWidth / w) + ')';
  });
  addEventListener('resize', uygula); uygula();
</script>`);
console.log('caros-nav-galeri.html yazıldı');

# NAV-VISUAL — sürüş koridoru ölçümleri (2026-09-09)

Bu dizin **ürün kodunu ölçen** araçları ve ölçüm çıktılarını taşır. Sahneler
sentetik DEĞİLDİR: üretim stili (`src/platform/mapStyleBuilders.ts`) gerçek
OpenMapTiles karolarıyla headless WebGL'de çalıştırılır, ekran pikseli okunur.

## Kurulum (türetilmiş dosyalar commit EDİLMEZ)

```bash
npx rolldown src/platform/mapStyleBuilders.ts --format esm \
  --file field-runs/nav-visual-20260909/style.mjs
sed -i 's|import\.meta\.env|(globalThis.__VITE_ENV__ ?? {})|g' \
  field-runs/nav-visual-20260909/style.mjs
# rota ölçümü için ayrıca:
npx rolldown src/platform/map/core/routeWidthModel.ts --format esm \
  --file field-runs/nav-visual-20260909/routeWidth.mjs
```

## Araçlar

| Dosya | Ölçtüğü |
|-------|---------|
| `ink-probe.mjs` | Mürekkep bütçesi — hangi yol katmanı ekranda kaç parlak piksel harcıyor (tek katman gizlenerek, tek değişkenli) |
| `minor-sweep.mjs` | Yerel gövde GENİŞLİK süpürmesi (elenen aday: −%11) |
| `opacity-sweep.mjs` | Yerel gövde OPAKLIK süpürmesi (seçilen: 0,62 → parlak −%26, orta bant +%61) |
| `hue-check.mjs` | Geri çekilen yolun EKRAN rengi — amber/sepya kayması denetimi |
| `camera-sweep.mjs` | pitch × çapa × FOV → ileri görüş (m) · karo yükü · mürekkep |
| `mini-pitch.mjs` | Aynı kamera eğrisi 440×210 mini yüzeyde |
| `label-probe.mjs` | Zoom bandına göre ekranda GERÇEKTEN çizilen etiket sayısı |
| `housenumber-probe.mjs` | Kapı numarası eşiği ↔ ölçülen sürüş zoom bandı |
| `route-dominance.mjs` | Rota baskınlığı — rota piksel oranı ve rota/basemap luminans |
| `scene.mjs` | Referans sahneler (once/ = düzeltme ÖNCESİ kareler) |
| `sky-probe.mjs` · `tile-load-probe.mjs` | Gök/ufuk kadraj eşiği ve karo maliyeti |

## Ana bulgular

- **Yerel ağ**: gece z15,5'te ekranın %10,4'ü parlak; paylar primary %34,3 ·
  **minor %26,6** · motorway %5,7 → en alt sınıf en üst sınıfın 4,7 katı.
- **Kamera**: şehir sürüş zoom'unda ileri görüş **193 m** (50 km/sa'te 14 sn).
  `pitch 44 · çapa 0,65` ile **373 m**, karo yükü değişmeden.
- **Kapı numarası**: eşik 17 iken 30 km/sa'lik sürüşte (z17,5) ekranda 40
  etiketin 31'i kapı numarasıydı. Eşik 18,4 → aynı sahne 9 etikete indi.
- **Gök (`sky`)**: MapLibre 4.7.1'de ufuk yalnız pitch **>68,6°**'de kadraja
  girer; sürüş bandında ölü stildir (denendi, geri alındı).
- **Rota**: baskınlık ölçüldü — rota/basemap luminans **2,01×**, rota piksel
  %2,03. Kusur bulunmadı; rota otoritesine DOKUNULMADI.

`once/` — düzeltme öncesi kareler (üzerine yazılmaz).

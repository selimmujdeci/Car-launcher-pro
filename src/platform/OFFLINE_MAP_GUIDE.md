# Çevrimdışı Harita — Geliştirici Rehberi

> **Bu belge 2026-08-22'de baştan yazıldı (V-18).**
> Önceki sürüm mimari çekirdek olarak `offlineMapService.ts` ve `tileLoader.ts`
> adlı **iki dosyayı anlatıyordu; ikisi de repoda hiç yoktu.** İçindeki her
> `import` örneği derlenmeyecek koddu. Aşağıdaki her modül ve fonksiyon adı
> yazım anında repoda **doğrulanmıştır**.

---

## Mimarinin özeti

Çevrimdışı harita **tek bir servis değildir**; dört katmanın iş bölümüdür:

| Katman | Dosya | Sorumluluk |
|--------|-------|-----------|
| Kaynak seçimi | `src/platform/mapSourceManager.ts` | Hangi harita kaynağı etkin, ağ var mı, stil nasıl kurulur |
| Protokol | `src/platform/mapProtocols.ts` | MapLibre'ın karo/glif isteklerini yakalar |
| Karo önbelleği | `src/core/storage/CacheLRUManager.ts` | Cache Storage üzerinde LRU + koridor koruması |
| Toplu indirme | `src/platform/offlineTileDownloader.ts` | Bölge/alan ön yüklemesi |

Ek: `src/platform/map/vectorTileTemplate.ts` (canlı TileJSON'dan karo URL şablonu),
`public/serviceWorker.js` (uygulama kabuğu önbelleği).

> **Karolar VEKTÖRDÜR.** İndirme yolu da vektör karo çeker; raster yolu
> kaldırılmıştır (V-07). Raster varsayan bir kod yazma.

---

## 1) Kaynak yönetimi — `mapSourceManager.ts`

Açılışta bir kez kurulur; protokolleri de o kaydeder:

```ts
import {
  initializeMapSources, getMapSources, getActiveMapSource,
  setActiveMapSource, hasOfflineMapData, getMapSourceStatus,
} from '@/platform/mapSourceManager';

await initializeMapSources();          // protokolleri de kaydeder
const sources = getMapSources();
setActiveMapSource(sources[0].id);
```

- `hasOfflineMapData()` — çevrimdışı veri **var mı** (varlık sorusu; "hazır mı" değil).
- `getMapSourceStatus()` — etkin kaynak, mod ve ağ durumunun tek okuması.
- `detachNetworkListeners()` — **teardown'da çağır**; ağ dinleyicileri sızdırmasın
  (zero-leak kuralı).

Stil kurucuları ayrı dışa açıktır: `buildVectorStyle` · `buildRoadStyle` ·
`buildSatelliteStyle` · `buildHybridStyle`.

---

## 2) Protokoller — `mapProtocols.ts`

MapLibre'a iki özel protokol kaydedilir:

```ts
import {
  registerSmartTileProtocol, registerGlyphCacheProtocol,
  unregisterProtocols, resetProtocolHits,
} from '@/platform/mapProtocols';
```

- `registerSmartTileProtocol()` — karo isteklerini önbellek üzerinden geçirir.
  `initializeMapSources()` bunu **zaten çağırır**; ikinci kez çağırma.
- `registerGlyphCacheProtocol()` — yazı tipi glifleri (etiketler ağsız da çizilsin).
- `unregisterProtocols()` — harita örneği yok edilirken çağrılmalıdır.

---

## 3) Karo önbelleği — `CacheLRUManager`

Tekil örnek: `cacheLRUManager`. Depolama Cache Storage'dır (`caros-tiles-v1`).

```ts
import { cacheLRUManager } from '@/core/storage/CacheLRUManager';

cacheLRUManager.init();                       // açılışta
const stats = cacheLRUManager.getCacheStats();// hits · misses · hitRate · totalBytes · tileCount
await cacheLRUManager.warmUrls(urls);         // önden ısıt
await cacheLRUManager.hasTile(url);           // GERÇEKTEN önbellekte mi
cacheLRUManager.markCorridorProtected(keys);  // rota koridorunu LRU'dan koru
cacheLRUManager.clearCorridorProtection();
await cacheLRUManager.clearAll();             // { deleted, freedBytes }
cacheLRUManager.dispose();                    // teardown
```

**Neden `hasTile()` var:** bir karonun "indirildi" sayılması, sayaçların artmış olması
DEĞİLDİR. Bir kez transfer edilmiş `ArrayBuffer`'ın **0 baytlık karo** olarak
önbelleğe yazılması sahada yaşandı (kütük #614). İndirme başarısını **depodan
okuyarak** doğrula, sayaçtan değil.

**Koridor koruması** rota üzerindeki karoların LRU tarafından atılmasını engeller —
navigasyon sırasında tünelden çıkınca harita boş kalmasın diye.

---

## 4) Toplu indirme — `offlineTileDownloader.ts`

```ts
import {
  TILE_PRESETS, getTilesForPreset, estimateTileCount, estimateSizeMB,
  buildAreaPreset, getDownloadState, subscribeDownloadState,
} from '@/platform/offlineTileDownloader';

const preset = TILE_PRESETS[0];
const mb = estimateSizeMB(preset);             // kullanıcıya ÖNCE maliyeti göster
const unsub = subscribeDownloadState((s) => { /* idle|downloading|paused|done|error|cancelled */ });
```

`buildAreaPreset(...)` haritada seçilen alandan hazır kalıp üretir.
`getDownloadState()` anlık durumu senkron okur; abonelikten dönen fonksiyonu
**unmount'ta çağırmayı unutma**.

---

## 5) Karo URL şablonu — `map/vectorTileTemplate.ts`

Şablon **sabit yazılmaz**, canlı TileJSON'dan çözülür:

```ts
import { resolveVectorTileTemplate, tileUrlFrom, extractVersionHint }
  from '@/platform/map/vectorTileTemplate';
```

`extractVersionHint(url)` sağlayıcı sürümünü ayıklar — sağlayıcı şemayı
değiştirdiğinde eski önbellek sessizce yanlış karo servis etmesin diye.

---

## Sık yapılan hatalar

1. **Sayaçtan sonuç çıkarmak.** "3.000 karo indirildi" bir başarı kanıtı değildir;
   `hasTile()` ile depodan doğrula.
2. **Raster varsaymak.** Ürün vektör çiziyor; raster yolu kaldırıldı.
3. **Temizlik atlamak.** `detachNetworkListeners()` · `unregisterProtocols()` ·
   `cacheLRUManager.dispose()` ve abonelik iptalleri **zorunludur**.
4. **`initializeMapSources()` sonrası protokolleri yeniden kaydetmek.**
5. **Boş önbelleği "çevrimdışı hazır" saymak.** `hasOfflineMapData()` varlık sorar;
   yeterlilik sormaz.

## Lisans

Harita verisi OpenStreetMap tabanlıdır → uygulamada **`© OpenStreetMap katkıcıları`**
atıfı **zorunludur** (ODbL).

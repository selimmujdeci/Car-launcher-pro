# ADR — ÇEVRİMDIŞI ROTA MOTORU (ön-karar, 2026-08-11)

> **DURUM: ÖN-ADR — KARAR VERİLMEDİ, KOD YAZILMADI.**
> Bu belge seçenekleri, ölçütleri ve lisans sınırlarını sabitler. Motor seçimi
> gerçek head unit'te **ölçüm** yapılmadan kesinleşmez (§6 Kabul Kapısı).
>
> Vizyon bağlamı: `docs/CAROS_PRO_VIZYONU.md` §7.9 **Katman 4**.
> Ölçülmüş açık: **G15** (`docs/archive/NAV_FIELD_GAPS_2026-08-05.md`) — çevrimdışı rota
> motoru YOK; ağ kesilince rehberlik tamamen düşüyor.

---

## 1. NEDEN ZORUNLU (konfor değil, satış koşulu)

CarOS Pro **aftermarket ve OEM head unit'lere gömülü** satılır. O cihazlarda:

- **Veri paketi yoktur.** SIM yok, tethering kullanıcının insafında.
- **Ağ garanti değildir.** Tünel, kırsal, sınır geçişi, roaming kapalı.
- **Rehberlik düşerse ürün ölür.** Sürücü yolun ortasında yönsüz kalır.

Bugünkü davranış (ölçülmüş): ağ yokken rota **hiç kurulamıyor**; düz-hat tahmini
devreye giriyor ve o da gerçek rota gibi sunulmuyor (doğru davranış) — ama sonuç
**rehberlik yok**.

Bu yüzden çevrimdışı rota, P0 sınıfı bir **satış koşuludur**.

---

## 2. LİSANS SINIRI (pazarlıksız — CLAUDE.md ticari kural)

Ürün **ticari olarak satılır ve kapalı kaynak dağıtılır**. Bu, motor seçimini
lisans düzeyinde daraltır:

| Motor | Lisans | Ticari gömme | Karar |
|---|---|---|---|
| **Valhalla** | **MIT** | ✅ serbest | **ADAY** |
| **GraphHopper (core)** | **Apache-2.0** | ✅ serbest (atıf gerekir) | **ADAY** |
| **OSRM** | **BSD-2-Clause** | ✅ serbest | **ADAY (şartlı)** |
| **BRouter** | **GPL-3.0** | ❌ copyleft — türev açma zorunluluğu | **ELENDİ** |
| **Graphhopper Directions API** | ticari SaaS | ❌ ağ gerektirir (amacı bozar) | **ELENDİ** |

> ⚠️ **GPL/AGPL/LGPL ELENİR** — istisna yok. Motor ne kadar iyi olursa olsun,
> kapalı kaynak ticari dağıtımı engelleyen lisans **değerlendirmeye alınmaz**.

**Veri lisansı ayrı bir konudur:** üç motor da **OpenStreetMap** verisiyle çalışır
→ **ODbL**. Bu, ürüne iki yükümlülük getirir:

1. **Atıf zorunlu:** `© OpenStreetMap katkıcıları` — harita görünen her yerde.
2. **Türev veritabanı paylaşımı:** OSM verisini **işleyip dağıtıyorsak** (tile/graph
   paketi), üretilen türev veritabanı ODbL kapsamındadır. Uygulama kodu etkilenmez
   (produced work), ama **veri paketinin kendisi** ODbL şartlarına tabidir.
   → Paket, ODbL beyanıyla dağıtılır; bu **kabul edilmiş** bir maliyettir.

---

## 3. MOTOR KARŞILAŞTIRMASI (ölçülmedi — literatür + mimari okuma)

> ⚠️ Aşağıdaki sayılar **tahmini büyüklük sınıflarıdır**, bu projede ÖLÇÜLMEMİŞTİR.
> Kesin değerler §6'daki kabul kapısında gerçek cihazda ölçülecektir.

| Ölçüt | Valhalla | GraphHopper | OSRM |
|---|---|---|---|
| Dil / çalışma | C++ · JNI | Java · JVM (Android doğal) | C++ · JNI |
| Veri yapısı | **tile** (parça parça yüklenir) | CH/LM graph (bütün bölge) | CH/MLD (bütün bölge) |
| Bellek profili | **düşük** (tile bazlı) | orta | **yüksek** (RAM'e graph) |
| Kısmi bölge yükleme | ✅ doğal | ⚠️ bölge bazlı | ⚠️ bölge bazlı |
| Araç profili (kamyon/yükseklik/ağırlık) | ✅ güçlü | ✅ güçlü | ⚠️ sınırlı |
| Android entegrasyon olgunluğu | orta (JNI köprüsü gerekir) | **yüksek** (saf Java yolu var) | düşük (mobil hedefi değil) |
| Yeniden rota (reroute) maliyeti | düşük | düşük | düşük |

**İlk eğilim (karar DEĞİL):** düşük-uç head unit (Mali-400 sınıfı, sınırlı RAM)
hedefliyorsak **tile tabanlı Valhalla** mimari olarak daha uygun; ama **JNI
köprüsü + build zinciri** maliyeti var. **GraphHopper**, Android'de daha hızlı
ayağa kalkar (saf Java) ama bölge graph'ı bütün olarak yüklenir.

Kabul kapısı bu ikisini **aynı cihazda** ölçmeden karar verilmez.

---

## 4. VERİ PAKETİ — PID PACK DESENİ

Rota verisi **koda gömülmez, PAKET olarak taşınır** (PID Pack / RulePack ile aynı
desen). Yeni bölge eklemek **kod değişikliği gerektirmez**.

Her paket şu alanları **zorunlu** taşır:

```
RoutingPack {
  packId        : "tr-central-2026-08"      // kayıt kimliği
  region        : "TR-06,TR-42,TR-33"       // kapsanan iller
  sourceRef     : "OSM planet 2026-08-01"   // VERİNİN KAYNAĞI (tarih dahil)
  license       : "ODbL-1.0"                // veri lisansı — BEYAN ZORUNLU
  attribution   : "© OpenStreetMap katkıcıları"
  engine        : "valhalla-3.x" | "graphhopper-9.x"
  engineLicense : "MIT" | "Apache-2.0"
  builtAt       : 1786...                   // paketin üretildiği an
  sizeBytes     : 412_336_128
  checksum      : "sha256:..."              // bozuk paket REDDEDİLİR
  confidence    : "OFFICIAL" | "COMMUNITY" | "DERIVED"
}
```

**Güven sınıfı (`confidence`)** — 8 Kapı'nın 1. kapısı (doğru mu?):

| Sınıf | Anlamı | Kullanım |
|---|---|---|
| `OFFICIAL` | Resmî kaynak (KGM · belediye) | tam güven |
| `COMMUNITY` | OSM topluluk verisi | varsayılan; kullanıcıya "topluluk verisi" denir |
| `DERIVED` | Bizim türettiğimiz (ör. kısıt çıkarımı) | **karar üretebilir ama uyarı taşır** |

**Kurallar:**
- **Checksum tutmayan paket REDDEDİLİR** (bozuk graph = uydurma rota).
- **Lisans alanı boş paket YÜKLENMEZ** — beyansız veri ticari riski taşır.
- Paket **süresi geçmiş** olabilir (`builtAt` eski) → rota yine hesaplanır ama
  **"harita verisi N ay eski"** bilgisi taşınır; sessizce güncel sayılmaz.

---

## 5. DAĞITIM ŞEKLİ (üç seçenek — karar verilmedi)

| Seçenek | Artı | Eksi |
|---|---|---|
| **A. APK'ya gömülü** | ağ hiç gerekmez · ilk açılışta hazır | APK dev büyür (~+400 MB), Play/OEM sınırları, bölge sabit |
| **B. İlk kurulumda indir** | APK küçük · bölge seçilebilir | **ilk kurulum ağ ister** — OEM senaryosunda garanti değil |
| **C. Üretici tarafından yüklenir** (SD/eMMC imaj) | OEM'e uygun · bölge üreticide | bizim kontrolümüz dışında · sürüm kayması riski |

**Eğilim (karar DEĞİL):** OEM satışı için **C + A karması** — çekirdek/dar bölge
gömülü (her koşulda çalışan asgari kapsam), geniş bölge üretici imajından. B tek
başına OEM sözünü karşılamaz.

---

## 6. KABUL KAPISI (ölçülmeden karar YOK)

Motor seçimi ancak şu ölçümler **gerçek head unit'te** yapıldıktan sonra kesinleşir:

1. **Soğuk rota süresi:** 300 km'lik şehirlerarası rota, uygulama yeni açılmışken
   **< 5 s** hesaplanmalı.
2. **Reroute süresi:** rotadan çıkışta yeni rota **< 2 s** (sürücü bekleyemez).
3. **Bellek tavanı:** rota hesabı sırasında ek RSS **< 200 MB** (Mali-400 sınıfı
   cihazda tüm uygulama bütçesi düşünülerek).
4. **Depolama:** hedef bölge paketi **< 500 MB**.
5. **Isınma:** 30 dakikalık sürüşte reroute'lar dahil termal kısıtlamaya girmemeli
   (`AdaptiveRuntimeManager` tier düşürmemeli).
6. **Doğruluk:** aynı 10 rota için çevrimdışı sonuç, çevrimiçi sağlayıcıyla
   **mesafede %5**, **sürede %15** içinde olmalı — daha büyük sapma "rota uydurdu"
   sınıfıdır.

**Hiçbiri ölçülmeden motor seçilmez.** Ölçüm yapılırsa sonuçlar kütüğe 🔴 madde
olarak girer ve bu ADR "ön-" ekini kaybeder.

---

## 7. AÇIK SORULAR (bu belge CEVAPLAMIYOR)

- Tile/graph üretimi **bizde mi** yapılacak (build zinciri + depolama maliyeti)
  yoksa hazır paket mi kullanılacak?
- Harita **karosu** (görsel tile) ile **rota grafiği** ayrı paketler mi? Bugün karo
  tarafında ayrı bir ticari engel var: **G11 / karo kaynağı lisansı**.
- Türkiye dışı bölgeler için paket stratejisi (OEM ihracat senaryosu).
- Çevrimdışı **arama** (geocoding) bu ADR'nin kapsamı DIŞINDADIR — ayrı karar
  gerektirir (bkz. Nominatim/Overpass BYOK notları).

---

## 8. BU ADR'NİN DURUMU

**ÖN-ADR.** Karar verilmedi, kod yazılmadı, motor seçilmedi. Bağlayıcı olan tek
şey **§2 lisans sınırıdır**: GPL/AGPL/LGPL motorlar değerlendirmeye alınmaz ve
ODbL atıf yükümlülüğü kabul edilmiştir.

Sıra kuralı (§7.0) gereği bu iş **G1 (konum kanıt otoritesi) kütükte 🟢 olmadan
başlatılmaz** — çevrimdışı rota motoru, bayat konum üzerine kurulursa aynı
hataları çevrimdışında tekrarlar.

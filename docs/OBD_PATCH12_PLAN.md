# Patch 12 Planı — Üretici-Özel PID Katmanı (UDS Mode 22 / ISO-TP)

> Durum: PLAN (2026-07-05). Uygulama Patch 11 commit'lendikten sonra başlar.
> Dal: `feat/obd-core-v2`. Uygulayıcı: caros-obd-canbus ajanı, iki aşamada.
> Hedef: Car Scanner'ın "marka-özel veri" hendeğinin ALTYAPISINI kurmak —
> veritabanını kopyalamadan (lisans kuralı), kendi keşif aracımızla doldurarak.

---

## Neden / Ne değil

Standart OBD (Mode 01) şanzıman yağı sıcaklığı, DPF doluluk/rejenerasyon, pil
hücre voltajı, enjektör düzeltmeleri gibi verileri VEREMEZ — bunlar üretici-özel
UDS DID'lerinde (Mode 22 ReadDataByIdentifier) yaşar. Car Scanner'ın gücü yıllarca
kitle-kaynaklı topladığı marka profilleridir; **o listeler kopyalanamaz**
(ticari satış kuralı + telif). Bizim yolumuz: (1) boru hattını kur, (2) ISO 14229
standardındaki kesin-kamu DID'lerle başla, (3) sahada kendi keşif aracımızla genişlet.

**Kapsam dışı (bilinçli):** K-line/KWP2000 araçlar (Mode 22 orada farklı — yalnız
CAN/ISO 15765-4), security access (27) gerektiren DID'ler, yazma servisleri (2E),
aktüatör testleri (31). Yalnız OKUMA.

---

## 12A — Native: ECU adresleme + Mode 22 okuma (OBDManager/ElmProtocol)

1. **Header yönetimi:** `ATSH <tx>` (istek header'ı, örn. 7E0 motor / 7E1 şanzıman)
   + `ATCRA <rx>` (yanıt filtresi, örn. 7E8). 11-bit öncelikli; 29-bit v2.
   - **Header-restore garantisi:** üretici-özel sorgu bloğu bittiğinde header
     VARSAYILANA döner (ATSH boş/ATCRA kapalı) — sızarsa standart poll bozulur.
     Kuyruk üzerinden atomik blok: `withEcuHeader(tx, rx, işlem)` deseni; işlem
     exception atsa bile finally'de restore. Mevcut ElmCommandQueue USER önceliği.
2. **`readDid(tx, rx, did)`:** `22 <DID>` gönder; yanıt `62 <DID> <data...>`.
   - ISO-TP çok-çerçeveli yanıt: ELM327 CAN'de akış kontrolünü kendi yapar;
     "0:","1:" segment birleştirme MEVCUT (Mode 03 parser'ı) — jenerikleştir.
   - **Negatif yanıtlar (7F 22 XX):** `31` requestOutOfRange → DID desteklenmiyor
     (kalıcı işaretle, bir daha sorma); `78` responsePending → BEKLE-devam et
     (timeout'u uzat, yeni yanıtı bekle — atlanırsa yavaş ECU'lar kaybedilir);
     `33` security → desteklenmiyor say (kapsam dışı). Diğerleri → hata.
3. BleObdManager'a aynı API aynalanır (BLE kullanıcıları da alsın).
4. Plugin: `readObdDid({tx, rx, did})` → ham hex data (akıllı iş TS'te).

## 12B — TS: Profil formatı + manufacturerPidService

1. **`VehicleDidProfile` şeması** (JSON, `src/platform/obd/profiles/`):
   ```
   { brand, note, source,            // source ZORUNLU: kamu doküman referansı
     ecus:  [{ id, name, tx, rx }],
     dids:  [{ did, ecu, name(TR), unit, bytes, min, max, category,
               decode: { fn: 'linear'|'temp40'|'ab'|'pct'|..., a?, b? } }] }
   ```
   - **Keyfi formül DSL'i / eval YOK** — `decode.fn` önceden tanımlı, test edilmiş
     çözücü adı + katsayılar (`value = fn(bytes)*a + b`). V8 dostu: profil
     yüklenirken Map'e derlenir, hot-path'te alokasyon yok.
   - Şema doğrulayıcı: geçersiz profil YÜKLENMEZ (dürüst hata) — ileride
     kullanıcı/OTA profili gelebileceği için giriş güvenliği şart.
2. **`manufacturerPidService.ts`** — extendedPidService'in kardeşi, aynı felsefe:
   `watchDid/getDidValue/isDidSupported/getSupportedDids`; talep-güdümlü, izleyici
   yokken SIFIR maliyet; 7F-31 alan DID kalıcı "desteklenmiyor". Polling standart
   EXTENDED turuna EKLENMEZ — kendi seyrek turu (üretici verileri yavaş değişir,
   2-5s yeter) ve yalnız izleyici varken.
3. **querySensor köprüsü:** sensorQueryService alias tablosuna profil DID'leri de
   katılır (profil yüklüyse "şanzıman yağı kaç derece?" cevaplanabilir olur).

## 12C — Başlangıç profili + saha keşif aracı

1. **Kesin-kamu başlangıç seti:** ISO 14229-1 standart DID'leri — F190 (VIN),
   F187 (yedek parça no), F18C (ECU seri no), F195 (yazılım versiyonu) vb.
   Bunlar TÜM UDS araçlarında standarttır, lisans riski sıfır; boru hattının
   uçtan uca kanıtı olarak mükemmel (VIN'i hem 0902 hem F190'dan okuyup
   karşılaştırmak = doğrulama).
2. **Renault/Dacia profili:** yalnız kamu dokümantasyonuyla doğrulanabilen
   DID'ler; doğrulanamıyorsa profile GİRMEZ (uydurma formül > hiç veri'den
   kötüdür). Başlangıçta küçük olması kabul — büyütecek olan keşif aracı.
3. **DID keşif aracı (expert ekranı):** kullanıcı ECU + DID aralığı seçer
   (örn. 7E0, 2200-22FF), araç taranır, ham yanıtlar kaydedilir/dışa aktarılır.
   Bu, crowd-data hendeğini KENDİ verimizle kazmanın mekanizması: Selim'in
   Dacia'sında çalıştırılır → gelen ham veriler + bilinen gösterge değerleriyle
   eşleştirilerek profil büyütülür. Tarama USER önceliğinde, iptal edilebilir,
   ilerleme göstergeli; DoS gibi davranmasın diye DID'ler arası kısa bekleme.

## 12D — Test + minimal UI

- **Kilitler** (`obdCoreV2.patch12.uds.test.ts`): header-restore (exception
  yolunda dahil), 7F-31/33/78 ayrımı (78'de bekle-devam), ISO-TP birleştirme,
  şema doğrulama (bozuk profil reddi), decode fn tablosu, watchDid sıfır-boşta,
  querySensor DID köprüsü, F190 VIN ↔ 0902 VIN eşitlik yolu.
- **UI:** SensorPanel'e "Marka verileri" bölümü (profil + destek varsa görünür);
  keşif aracı expert/ayarlar ekranına. Büyük tasarım işi YOK.

---

## Uygulama sırası ve doğrulama

| Aşama | İçerik | Ajan görevi |
|-------|--------|-------------|
| 1 | 12A + 12B (altyapı + servis + testler) | caros-obd-canbus #1 |
| 2 | 12C + 12D (profil + keşif aracı + UI) | caros-obd-canbus #2 |

Her aşama sonunda ana oturumda: tam suite + `tsc` + vite build +
`compileDebugJavaWithJavac`; yeşilse atomik commit (12A+B tek, 12C+D tek).

**En büyük risk (dürüst):** cihazsız doğrulanamaz — ISO-TP/header davranışı
adaptör klonuna göre değişir; ELM'in `ATSH` sonrası `ATCRA`'sız davranışı
adaptörden adaptöre farklıdır. Saha testi K24 + WiFi ELM327'yi bekler.
İkinci risk: yavaş ECU'ların 0x78 pending zinciri gerçek araçta sürpriz
üretebilir. Üçüncü: T507 Dacia'da adb yok — keşif aracı çıktısının cihaz
ÜSTÜNDEN dışa aktarılabilir olması şart (dosya paylaş/QR).

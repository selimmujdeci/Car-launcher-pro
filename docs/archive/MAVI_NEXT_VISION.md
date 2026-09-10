# MAVI NEXT — Uzun Vadeli Ürün Vizyonu (OEM++)

> **Belge türü:** Ürün vizyonu (kod değil). Mavi'nin uzun vadeli ne olacağını tanımlar.
> **Durum:** Canlı belge · Yön tayin eder, gerçeklik durumu tayin ETMEZ.
> **Kaynak gerçekliği:** Bir modülün burada yazması var olduğu anlamına gelmez —
> özellik durumu `docs/CAROS_PRO_VIZYONU.md` capability defterinde, saha kanıtı
> `docs/DEVICE_VALIDATION_LEDGER.md` kütüğünde belirlenir.
> **Mimari "nasıl":** `docs/COMPANION_AI_ARCHITECTURE.md` (Yol Arkadaşı tasarım atası) ·
> `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` (katmanlar/motorlar).
> **Omurga:** Mavi Core Faz-1/2/3 (lifecycle · typed action registry · safety gate ·
> bounded context · multi-action engine · SHADOW→TAKEOVER).
> **Son güncelleme:** 2026-07-20

---

## 0. Bu Belge Ne Değildir

Bu bir pazarlama yazısı veya özellik listesi değildir. Burada tarif edilen deneyim, o
deneyimin bugün var olduğu anlamına gelmez. Bu belge Mavi'nin **hedefini** çizer; her
adım ayrı ayrı kod + test + saha kanıtıyla hak edilir. "8 Kapı" sözleşmesine tabidir:
bir sinyali okumak değil, ondan güvenli **karar** üretmek başarıdır.

---

## 1. Amaç

Mavi yalnızca bir sesli asistan olmayacak. Mavi; **aracın, uygulamanın, yolculuğun ve
sürücünün ortak yapay zekâ merkezi** olacak.

> **Kuzey yıldızı:** Kullanıcı araç kullanırken mümkün olduğunca ekrana dokunmayacak.
> Dokunarak yapılabilen **güvenli** her işlem, sesle de yapılabilecek.

Mavi'nin amacı: dikkat dağıtmamak · güvenliği artırmak · yolculuğu kolaylaştırmak ·
aracı anlamak · kullanıcıyı tanımak.

---

## 2. Tasarım Felsefesi

Hiçbir OEM birebir kopyalanmayacak. Aşağıdaki sistemlerin **yalnız güçlü yönleri** analiz
edilip üzerine çıkılacak:

- Mercedes MBUX · BMW Intelligent Personal Assistant · Tesla · Rivian ·
  Android Automotive · Google Assistant · Apple CarPlay · Audi MMI · Volvo Google Built-in

**Hedef seviye:** OEM'e ulaşmak değil → **OEM+**, hatta **OEM++**. Amaç rakipleri
kopyalamak değil, birçok konuda onları aşan bir deneyim sunmaktır. Her yeni özellikten
önce dünyadaki en iyi OEM çözümü analiz edilir, güçlü yönü alınır, üzerine CAROS PRO'ya
özgü yenilik eklenir.

---

## 3. Temel Tasarım İlkeleri

### 3.1 Proaktif Yapay Zekâ İlkesi

Mavi hiçbir zaman yalnızca verilen komutu yerine getiren bir sesli asistan olmayacaktır.

Mavi'nin temel görevi, kullanıcının gerçek amacını anlayarak, güvenlik, gizlilik ve
kullanıcı onayı sınırları içinde en uygun çözümü önermek ve gerektiğinde proaktif olarak
yardımcı olmaktır.

Mavi;

- yalnızca sorulara cevap veren değil,
- yalnızca komut uygulayan değil,
- doğru zamanda doğru öneriyi sunabilen,
- gerektiğinde sessiz kalmayı bilen,
- sürüş güvenliğini her zaman öncelik kabul eden,

bir Yapay Zekâ Yol Arkadaşı olacaktır.

Bu nedenle Mavi;

- kullanıcı davranışını anlayabilir,
- yolculuğu analiz edebilir,
- aracı analiz edebilir,
- çevresel koşulları değerlendirebilir,
- riskleri önceden fark edebilir,

ancak kullanıcının açık onayı olmadan güvenli sınırların dışına çıkan hiçbir işlemi
gerçekleştirmez.

Mavi'nin amacı kullanıcı adına karar vermek değildir.

Mavi'nin amacı, kullanıcıya daha iyi karar verebilmesi için en doğru bilgiyi, en doğru
zamanda ve en güvenli şekilde sunmaktır.

### 3.2 Mavi'nin Altın Kuralları (değişmeyen anayasa)

1. Önce güvenlik, sonra konfor.
2. Kullanıcı istemeden kritik işlem yapma.
3. Bilmediğini uydurma; emin değilsen bunu açıkça söyle.
4. Mümkün olan en az dikkat dağıtacak şekilde iletişim kur.
5. Tekrarlayan işleri otomatikleştir, ancak kullanıcı kontrolünü elinden alma.
6. Her öneriyi kullanıcının bağlamına göre kişiselleştir.
7. Gizlilik varsayılan olarak korunur; kullanıcı verisi kullanıcıya aittir.
8. Dokunmatik ve sesli kullanım aynı altyapıyı (Action Registry) paylaşır.
9. Her yeni özellik, gerçek sürüş güvenliğine katkı sağlamalıdır.
10. Amaç yalnızca aracı yönetmek değil; sürücüyü, aracı ve yolculuğu birlikte daha
    güvenli, daha verimli ve daha keyifli hâle getirmektir.

> Bu 10 madde Mavi'nin anayasasıdır: yıllar sonra bile değişmez. Yeni bir özellik bu
> maddelerden herhangi biriyle çelişiyorsa, özellik değil ilke kazanır → özellik yeniden
> tasarlanır.

---

## 4. Mavi Modülleri

Sekiz modülün tamamı **tek ortak Action Registry** ve tek safety gate üzerinden çalışır;
dokunmatik ve ses aynı altyapıyı kullanır (çift kod yolu yok).

### 4.1 DRIVE AI — uygulama & araç kontrolü
Uygulamayı yönetir, ekranları açar, ayarları değiştirir, araç verilerini okur, **güvenli**
komutları yürütür.
> *"Mavi canlı verileri aç." · "Mavi OBD taraması başlat." · "Mavi karanlık temaya geç."*

### 4.2 VEHICLE AI — araç zekâsı
Aracı analiz eder, arıza yorumlar, bakım tahmini yapar, ECU davranışını öğrenir,
**Vehicle DNA** oluşturur. (Mevcut AI Usta / VerdictEngine / VehicleMemory üzerine oturur.)
> *"Bu arıza ciddi mi?"*

### 4.3 TRIP AI — yolculuk zekâsı
Yolculuk ve mola planlar, gezilecek yer önerir, rota optimize eder.
> *"Yol üzerinde tarihi yerler var mı?" · "En fazla 20 dakika sapalım."*

### 4.4 LOCAL GUIDE AI — yerel rehber
Şehirleri, tarihi yerleri anlatır; yöresel yemek ve kültürel bilgi verir.
> *"Balıklıgöl neden önemli?"*

### 4.5 FAMILY AI — aile modu
Çocuk dostu mola, oyun alanı, bebek bakım noktası, aile restoranı önerir.
> *"Çocuklarla uygun mola verelim."*

### 4.6 TRAVEL AI — keşif modu
Kamp alanları, seyir noktaları, doğa yürüyüşleri, fotoğraf noktaları, gizli keşif yerleri.

### 4.7 SAFETY AI — güvenlik hakemi
Riskli işlemleri engeller, sürüş sırasında dikkat dağıtmaz, gerektiğinde onay ister.
(AiSafetyGate / CognitiveStore PROTECTION·CRITICAL üzerine oturur.)

### 4.8 LEARNING AI — öğrenen Mavi
Zamanla öğrenir: sevilen restoranlar, sık gidilen şehirler, mola alışkanlığı, sürüş tarzı,
favori rotalar. **Tamamı kullanıcı izniyle.**

---

## 5. Yol Arkadaşı Modu

Uzun yolda Mavi **gerektiğinde** konuşur — gereksiz asla:

> *"45 dakikadır mola vermedin." · "15 dakika sonra güzel bir seyir noktası var." ·
> "Önümüzde yağmur başlayacak." · "Yakıt seviyene göre bir istasyonda durmanı öneriyorum." ·
> "Bu bölgede meşhur bir restoran var."*

**Altın kural:** Sessizlik her zaman önceliktir. Proaktiflik bir bütçedir, bir hak değil.

---

## 6. Akıllı Tatil Planı

Kullanıcı: *"Mavi yarın Kaş'a gidiyoruz."* → Mavi gece boyunca hazırlık yapabilir.

Analiz edilecekler: hava durumu · trafik · yol çalışmaları · yakıt · mola ihtiyacı ·
çocuk durumu · kamp alanları · gezilecek yerler · restoranlar · gün batımı saatleri.
Sabah **özet** verir.

---

## 7. Yolculuk Deneyimi

Mavi sadece navigasyon değil, yolculuğu **yönetir**:

> *"Balıklıgöl rotana yalnızca 12 dakika ekliyor." · "Bu restoran bugün kapalı." ·
> "Şelaleye gitmeni öneriyorum." · "Bu yol bugün yoğun." ·
> "İstersen alternatif hazırlayabilirim."*

---

## 8. Sesli Uygulama (Voice-First)

Uygulamada **güvenli** olan her işlem sesle yapılabilecek: ekran açma · rapor açma ·
canlı veri · geçmiş kayıtlar · ayarlar · tema · profil · destek.

Hepsi **ortak Action Registry** üzerinden çalışır. Dokunmatik ve ses aynı altyapıyı
kullanır → tek doğruluk kaynağı, tek safety gate, çift bakım yükü yok.

---

## 9. Güvenlik (pazarlıksız)

Mavi, kullanıcının **açık onayı olmadan** ASLA:
- rota değiştirmez,
- araç ayarı değiştirmez,
- ECU işlemi yapmaz.

Bu, mimarinin HARD_FORBIDDEN sınıfıyla ve Safety-First invaryantıyla birebir örtüşür;
vizyon bu sınırı gevşetemez.

---

## 10. Gizlilik

- **BYOK öncelikli** — her müşteri kendi anahtarı; merkezî/gömülü API anahtarı **yok**.
- **Minimum veri.** Ham ses **saklanmaz**.
- Kullanıcı istediğinde tüm öğrenilen bilgiler **silinebilir**.

Lisans/ToS kuralıyla uyumlu: merkezî anahtar yasağı ticari satış için zorunlu.

---

## 11. En Büyük Hedef

CAROS PRO bir OBD uygulaması **olmayacak**. Bir navigasyon uygulaması **olmayacak**.
Bir sesli asistan **olmayacak**.

**CAROS PRO; Araç + Sürücü + Yolculuk + Yapay Zekâ birleşiminden oluşan yeni nesil bir
Vehicle Intelligence Platform olacak.**

---

## 12. Bu Vizyonu Gerçeğe Bağlayan Kurallar

1. Bir modülün burada yazması, var olduğu anlamına gelmez — durum `CAROS_PRO_VIZYONU.md`
   defterinde, saha kanıtı `DEVICE_VALIDATION_LEDGER.md` kütüğünde.
2. Her yeni yetenek **8 Kapı**dan geçer: sadece göstermek yeterli değil; doğrula +
   yorumla + öngör + güvenle karar ver.
3. Her katman **bütçeli + hibrit** (DeviceTier); ağır analiz hot-path'e girmez.
4. Proaktif konuşma bir bütçedir; sessizlik varsayılandır.
5. Rıza olmadan dış işlem yok, ham ses yok, merkezî anahtar yok.
6. Test yeşili + tsc temiz bir modülü "hazır" YAPMAZ — saha kanıtı şart.

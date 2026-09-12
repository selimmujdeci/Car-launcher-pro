# CAROS PRO — SÖZLÜK

> Proje içi terminolojinin **tek doğruluk kaynağı**. Amaç: terimin anlamını koddan veya
> eski raporlardan yeniden çıkarmak zorunda kalmamak. Uzun mimari açıklama burada
> **yapılmaz** — otoriter belgeye işaret edilir (`docs/workspace/00_START_HERE.md` §C).
>
> **HEDEF ≠ MEVCUT.** Yalnız vizyonda olan bir şey burada "mevcut özellik" gibi
> tanımlanmaz; satırda açıkça `HEDEF` veya `VİZYON` yazar. Depoda hiç geçmeyen terimler
> (ör. "Dark Code") sözlüğe alınmamıştır.

| Terim | CAROS PRO'daki kesin anlamı | Karıştırma |
|---|---|---|
| CAROS PRO | Araç içi Android Vehicle OS / tanı platformu (`com.cockpitos.pro`). Bugün **son kullanıcı ürünü değil** (FAZ A). | Bir "launcher" ile |
| Arabam Cebimde | Aracın telefondaki kontrol merkezi. Bugün `website/src/app/(pwa)/kumanda` altındaki PWA. | Ayrı bir mobil uygulama ile |
| Mavi | Sürücüyle konuşan sesli yardımcı katman. Uzun vadeli **HEDEF**: tek karar otoritesi. Bugün ağırlıkla gölge modda. | "Aracın tüm kararlarını veren AI" ile |
| CAROS LAB | Uygulama içi geliştirici/tanı laboratuvarı. **Salt-okunur**: aktif komut göndermez. | Ayar ekranı veya son kullanıcı paneliyle |
| Vehicle Intelligence | Sinyali doğrulayıp yorumlayan, öngören ve karar üreten katman hedefi ("8 Kapı"). | Ham telemetri gösterimiyle |
| Digital Twin | Aracın yazılımdaki durum ikizi. Durum: **İSKELET** (provenance/kimlik/history yok). | Çalışan bir 3D model ile |
| Zero-Trust Telemetry | Hiçbir aftermarket sinyal doğru varsayılmaz; her sinyal güven + kanıt ister. | "Sinyali şifrele" ile |
| Fail-Closed | Kanıt yoksa ilerleme durur; bilinmeyen **`false` sayılmaz**, `null`/`UNKNOWN` kalır. | Fail-Safe ile |
| Fail-Soft / Fail-Safe | Bir alt sistem düşse bile UI ve diğer akışlar çalışmaya devam eder. | Fail-Closed ile (o **durdurur**, bu **sürdürür**) |
| Shadow (gölge) | Mavi kararı üretir ve kaydeder ama **gerçek eylemi yürütmez**. | Devre dışı olmakla |
| Takeover | Mavi'nin gerçek yürütmeyi devralması. Bugün yalnız `TAKEOVER_ELIGIBLE = {media.next}`. | "Mavi her şeyi yapabilir" ile |
| Wired / Aktif | Kod var **ve** üretim akışına bağlı. Sadece dosyanın varlığı "aktif" demek değildir. | "Dosya mevcut" ile |
| Field Validation | Özelliğin **gerçek araçta** ölçülmesi. Test yeşili + `tsc` temiz buna eşit DEĞİLDİR. | CI/unit test başarısıyla |
| Device Validation Ledger | `docs/DEVICE_VALIDATION_LEDGER.md` — saha durumunda **mutlak otorite**. | Vizyon belgesindeki durum tablosuyla |
| 🔴 | Kütükte "cihazda test edilmedi / bekliyor". | "Hatalı" ile |
| 🟢 | Kütükte "gerçek cihazda doğrulandı". | "Test yeşil" ile |
| ❌ | Kütükte "cihazda denendi ve **düştü**" — geri dönüş gerekir. | 🔴 ile |
| NOT DEVICE VALIDATED | Kütük satır etiketi: kod hazır, saha kanıtı yok. | "Çalışmıyor" ile |
| Durum seviyeleri | Vizyon belgesinde: `YOK · İSKELET · ENTEGRE · DOĞRULANDI · SAHADA DOĞRULANDI`. | `ÜRÜN HAZIR` alanıyla (o ayrı ve altı koşullu) |
| OBSERVED / DERIVED / UNAVAILABLE / STALE | `sessionInspectorModel` gözlem sözleşmesi: ölçüldü / türetildi / yok / bayat. | Yeni bir telemetri sistemi kurmakla |
| OBD-II | Standart araç tanı arayüzü (On-Board Diagnostics II). | Araca özel OEM CAN hattıyla |
| ELM327 | Yaygın OBD-II adaptör yonga/komut seti (`AT` komutları). | Protokolün kendisiyle |
| KWP2000 | Eski araçlarda kullanılan tanı protokolü (ISO 14230). Trafic/Doblo sınıfı. | UDS ile |
| UDS | Modern birleşik tanı servisleri protokolü (ISO 14229). | KWP2000 ile |
| ISO-TP | Çok-çerçeveli mesajları CAN üstünde taşıyan taşıma katmanı (ISO 15765-2). | Uygulama protokolüyle (UDS/KWP) |
| NRC | Negative Response Code — ECU'nun isteği reddetme gerekçe baytı. | Bağlantı hatasıyla |
| ECU | Elektronik kontrol ünitesi (motor, ABS, gövde…). | Head unit ile |
| PID | Parameter ID — standart OBD-II veri kimliği (hız, RPM…). | DID ile |
| DID | Data Identifier — üretici/UDS'e özel veri kimliği (VIN, üretim verisi…). | PID ile |
| DTC | Diagnostic Trouble Code — arıza kodu (`P0128` gibi). | Arızanın kök nedeniyle |
| Deep Scan | Derin ECU tarama alt sistemi (`src/platform/deepScan/`). Kontak doğrulanmadan **başlamaz**. | Hızlı DTC okumasıyla |
| Transport Ready | Native bağlantı tutamacı duruyor ve link canlı. | Session Ready ile |
| Session Ready | ECU oturumu kurulmuş, sorgu kabul ediliyor. | Transport Ready ile |
| Data Fresh | **Adaptif** pencere içinde yeni veri geldi. | `isStale` ile |
| isStale | **MUTLAK** 4 sn donma bayrağı. `dataFresh` ile aynı şey değildir; birleştirilmez. | Data Fresh ile |
| Data Gate | Ham trafiğin/verinin akışa girmesini denetleyen kapı (CAROS LAB'da gözlenir). | Ağ geçidi (gateway) ile |
| SAB | `SharedArrayBuffer`. Kod **repoda mevcut ve korunuyor** (worker'larda zero-copy yolu), ama üretimde `crossOriginIsolated = false` olduğu için **bilinçli olarak kullanılmıyor**; her yol JSON fallback ile çalışır. Hata değildir (DEC-017); ileride yeniden değerlendirilebilir. | Bozuk/ölü kod sanmakla · "kullanılıyor" varsaymakla |
| DeviceTier | Donanım sınıfı; her zekâ katmanı bu bütçeye abone (`AdaptiveRuntimeManager`). | Tema/görsel kalite ayarıyla |
| Hot-path | 3 Hz hız/RPM akışı. Yeni katman buraya **girmez**. | Genel render döngüsüyle |
| VCOMP | `VehicleCompute.worker.ts` — hız/odometre/geofence hesabını yapan worker; görev kimliği öneki. | Ana thread hesaplarıyla |
| TMR | Triple Modular Redundancy — odometre 3 kopyada tutulur, medyan ile onarılır (`_odoTMR`). | Yedekleme/backup ile |
| BYOK | Bring Your Own Key — her müşteri kendi AI anahtarını girer; gömülü anahtar yok. | Ücretsiz AI ile |
| Battery Protection | **MEVCUT / ACTIVE.** 12V voltaj izleyip 4 seviyede (NORMAL→WARN→DEEP_SLEEP→EMERGENCY_SHUTDOWN) runtime güç tavanı düşüren servis; boot'ta koşulsuz kayıtlı. Voltajı yalnız OBD'den alır → adaptör yoksa seviye geçişi olmaz. | Uyku/gözetim modlarının uygulandığı anlamına **gelmez** |
| Smart Surveillance | **VİZYON — kodda karşılığı YOK.** Kontak kapandıktan sonra sınırlı/kontrollü izleme hedefi. | Battery Protection ile — o ayrı ve mevcut bir katmandır |
| Continuous Surveillance | **VİZYON — kodda karşılığı YOK.** Uzun süreli sürekli izleme hedefi; güç bütçesi sözleşmesi olmadan **yasak**. | Varsayılan/mevcut mod sanmakla |

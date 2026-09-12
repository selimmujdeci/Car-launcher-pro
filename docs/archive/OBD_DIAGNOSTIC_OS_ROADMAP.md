# OBD DİAGNOSTİK OS — YAPILACAKLAR (YAŞAYAN LİSTE)

> Kaynak mimari: sohbet "Vehicle Diagnostic OS" tasarımı (bkz. denetim raporu).
> Hedef: Car Scanner'ın okuduğu her şeyi okuyup üstüne **doğrula + yorumla + öngör + karar ver**.
> Bu dosya TEK GERÇEK KAYNAKTIR — bir görev yapıldıkça kutucuğu işaretle ve ledger durumunu güncelle.
> Son güncelleme: 2026-07-14 · Branch: `feat/w5-obd-pr1-native-handshake`

## Durum lejantı
- `[ ]` başlanmadı · `[~]` devam ediyor · `[x]` kod tamam + test yeşil
- Ledger: 🔴 cihazda test edilmedi · 🟡 kısmi cihaz kanıtı · 🟢 gerçek araçta doğrulandı · ❌ cihazda düştü
- Boyut: S (küçük) · M (orta) · L (büyük)
- Bir görev "tamam" SAYILMAZ: kutucuk `[x]` OLSA BİLE ledger 🟢 olana kadar "çalışıyor" diye sunulmaz (CLAUDE.md saha doğrulama yasası).

## İlerleme özeti
| Faz | Toplam | Tamam | Ledger 🟢 |
|-----|:--:|:--:|:--:|
| FAZ 0 — Güvenilirlik & Yanlış-güven (P0/P1) | 6 | 6 | 3 |
| FAZ 1 — Standart OBD Tamlığı | 5 | 5 | 0 |
| FAZ 2 — Çoklu-ECU Keşif & Tarama | 4 | 4 | 0 |
| FAZ 3 — UDS / Profesyonel Protokol | 6 | 5 (+1 gereksiz→kapandı) | 0 |
| FAZ 4 — Premium+ (Zekâ & Servis Fonksiyonları) | 5 | 5 | 0 |
| **TOPLAM** | **26** | **25 (+1 kapandı)** | **3** |

> # ✅ TÜM FAZLAR KOD OLARAK TAMAM (25/26 + 1 gereksiz→kapatıldı)
> Tam suite **4074 yeşil (235 dosya)** · tsc + lint + Java derlemesi temiz · **commit YOK**.
> Taze APK: `C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk` (73 MB, 2026-07-15 00:26).
>
> ## 🔴 AMA: CİHAZ BORCU BÜYÜK — 25 maddeden yalnız **3'ü** 🟢
> **Doğrulandı (2026-07-14 Doblo/CAN, CDP-over-adb):** F0-2 (ısrarlı timeout sonrası
> `obd:lastProtocol='7'` KORUNDU) · F0-4 (CAN regresyonu YOK — 92 s kesintisiz akış) ·
> F0-1 (verdi "DENETLENEN TÜM MODLAR TEMİZ" — kapsam-farkında).
> **Kısmi 🟡:** F0-3 · F0-5 (regresyon yok, ama mekanizmaları tetiklenmedi).
> **Hiç test edilmedi 🔴:** FAZ 1'in 5'i · FAZ 2'nin 4'ü · FAZ 3'ün 5'i · FAZ 4'ün 5'i · F0-6.
>
> ## ⚠️ YARINKİ SEANSTA İLK TEST EDİLECEK ŞEY (en yüksek risk)
> **Tam tarama sonrası ana ekrana dön → hız/RPM/coolant HÂLÂ AKIYOR MU?**
> Çoklu-ECU probu `ATH1` (başlıklar açık) ve UDS extended session açıyor. `ATH0` restore
> veya header temizliği bozulursa **standart poll parser'ı SESSİZCE bozulur** → tüm canlı
> veri ölür. Akmıyorsa FAZ 2/3 geri alınır. Kod bunu koruyor (`HeaderRestoreException`,
> doğrulamalı+retry'li ATH0) ama **sahada kanıtlanmadı**.
>
> ## Araçsız kapatılamayan borç (Doblo'da üretilemiyor)
> F0-6 (DTC'li araç) · F1-2 (MIL yanan araç) · F1-3 (freeze frame'li araç) · F2-3 (ABS/airbag
> arızalı araç) · F3-1 (üretici kodlu araç) · F3-3 + F0-4'ün KWP kazancı (**Trafic — araç
> kullanıcıda değil** → Abbas/uzaktan "Tanı Gönder" raporuyla).
>
> ## FAZ 4'te bilinçli olarak YAPILMAYANLAR (dürüstlük notu)
> - **F4-5:** native yazma (UDS 0x2E/0x31/0x27) YAZILMADI — yalnız 7 kapılı KARAR modeli var.
>   Kapıyı cihazda kanıtlamadan yazma kodu eklemek, "araca zarar vermem" sözünü riske atardı.
> - **F4-2/F4-3/F4-4:** modeller hazır ve test edildi, ama canlı telemetriye / kalıcı depolamaya
>   BAĞLANMADI (entegrasyon ayrı PR — performans + saha doğrulaması ister).
> - **F3-2 (ISO-TP):** gereksiz olduğu için yazılmadı (ELM327 donanımda yapıyor) — gerekçe maddede.

---

## FAZ 0 — GÜVENİLİRLİK & YANLIŞ-GÜVEN KAPATMA (önce bu; küçük atomik)

> Amaç: kullanıcıya yanlış "temiz"/"bağlı" demeyi bitir + Trafic/KWP bağlantı kararlılığı.
> Mevcut çalışan CAN davranışı BOZULMADAN.

- [x] **OBD-OS-F0-1 · Fail-Closed "Temiz" Verdisi** — 🔴 — S — *kod tamam, cihaz bekliyor*
  - Kapsam: `DTCPanel` büyük "SİSTEM TEMİZ" verdisi tüm DENENEN modların (03/07/0A) başarı+boş olmasına bağlansın; herhangi biri hata/timeout/atlanmış → "Kısmi tarama — kesin değil" + kapsam rozeti.
  - Kapsam dışı: yeni ECU/servis (FAZ 2).
  - Dosya: `src/components/obd/DTCPanel.tsx`, (opsiyonel) yeni `verdictModel.ts`.
  - Kabul (kod): Mode03 boş + Mode07 dolu → "temiz" GÖSTERİLMEZ. Birim testi.
  - Kabul (cihaz): pending kodlu araçta ekran "temiz" DEMEZ.
  - **YAPILDI (2026-07-14):** Saf `src/platform/obd/dtcVerdict.ts` (`computeDtcVerdict` — clean/issues/inconclusive/not_scanned, fail-closed: bulgu>belirsizlik>temiz). `readAllDTCs` artık `completeness{stored/pending/permanent: ok|failed|unsupported}` döner (`dtcService.ts`). `DTCPanel` verdi + MIL/pending/permanent/düşen-okuma kanıtıyla boş-durum bloğunu değiştiriyor. Testler: `src/__tests__/dtcVerdict.test.ts` (12 kilit) + patch11 güncellendi. **33 yeni/ilgili + 129 regresyon yeşil, tsc temiz.** Commit YOK.
  - **KALAN (cihaz kabulü):** gerçek araçta pending/kalıcı kodlu veya MIL yanan durumda ekran "SİSTEM TEMİZ" DEMEMELİ → 🟢'ye taşı.

- [x] **OBD-OS-F0-2 · Öğrenilmiş Protokolü Timeout'ta Koru** — 🔴 — S — *kod tamam, cihaz bekliyor*
  - Kapsam: `_noteLearnedProtocolTimeout` timeout'ta protokolü SİLMESİN; yalnız `UNABLE_TO_CONNECT` + araç-fingerprint değişiminde sil.
  - Dosya: `src/platform/obdService.ts` (~937), `obdStorage.ts`.
  - Kabul (kod): taze session + learned='5' + 2 timeout → protokol KORUNUR (regresyon testi).
  - Kabul (cihaz): Trafic 10 soğuk açılış → `protocolActive='5'` kalır, dakikalarca-takılma=0.
  - **YAPILDI (2026-07-14):** Kalıcı `obd:lastProtocol` artık timeout'ta SİLİNMEZ. Israrlı timeout (2-strike, yalnız öğrenilmiş protokol zorlanırken + bu oturumda hiç bağlanılmamışken) → yeni `_learnedProtocolBypassed` ile **yalnız o oturumda** bypass → ATSP0-otomatik. Aynı düzeltme adaptör-değişimi yolunda da uygulandı (`clearObdProtocol()` iki çağrı yerinden de kalktı; import düştü). **Fingerprint yerine ATDPN-üzerine-yazma:** araç gerçekten değiştiyse ATSP0 doğru protokolü bulur, başarıdaki `saveObdProtocol(ATDPN)` önbelleği kendiliğinden tazeler → ayrı fingerprint anahtarı gerekmedi. Araç-değişimi kurtarması (Doblo→Trafic sonsuz "Bağlanıyor…") bypass ile KORUNDU. Testler: `obdService.test.ts` 3b kilidi yeni doğru davranışa güncellendi (kalıcı kayıt `'7'` KALIR + sonraki deneme `protocol` göndermez = ATSP0); 3c flaky-araç kilidi korundu. **Tam suite 3911 yeşil, tsc temiz.** Ledger #67.
  - **KALAN (cihaz kabulü):** Trafic'te 10 soğuk açılış → kayıt silinmiyor + `protocolActive='5'`, takılma=0 → 🟢.

- [x] **OBD-OS-F0-3 · Handshake→DISCOVERY Önceliği + DataGate Ayrıştırma** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: handshake/keşif `POLL_FAST`i preempt etmesin (yeni DISCOVERY < POLL_FAST); ilk çekirdek PID handshake'ten bağımsız aksın. Data-gate handshake bitene kadar açlık çekmesin.
  - Dosya: `ElmCommandQueue.java` (öncelik enum), `OBDManager.java`/`BleObdManager.java` (handshake submit önceliği), `obdService.ts` (gate).
  - Kabul (cihaz): yavaş KWP'de `data_gate_loss` reconnect = 0.
  - **YAPILDI (2026-07-14):** Öncelik enum'u `USER > POLL_FAST > DISCOVERY > POLL_SLOW`. **Ama öncelik TEK BAŞINA yetmiyordu:** handshake (VIN + 6 bitmap bloğu, en kötü ~10 sn) TEK atomik görevdi ve ELM327 senkron olduğu için ÇALIŞAN görev kesilemez → hot-path yine aç kalırdı. Bu yüzden zincir ADIM ADIM kuyruğa bölündü: `ElmProtocol.performHandshakeRaw(HandshakeStepRunner)` — her ELM komutu ayrı DISCOVERY görevi, aralarına POLL_FAST girebiliyor. Zincir mantığı (süreklilik-bit disiplini) TEK yerde kaldı, iki manager'da kopyalanmadı. TS data-gate zaten handshake'i `await` etmiyordu (fire-and-forget) → açlığın kaynağı native kuyruktu, TS değişikliği gerekmedi. Java derlemesi temiz + regresyon kasasına yapısal kilit (enum sırası + adım-adım submit + USER'a dönüş yasağı). Ledger #69.
  - **KALAN (cihaz kabulü):** yavaş KWP araçta handshake sürerken hız/RPM AKMAYA DEVAM etmeli; `data_gate_loss` reconnect = 0 → 🟢.

- [x] **OBD-OS-F0-4 · Protokol-Sınıfı Timeout Profili + KWP Keep-Alive** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: `ProtocolProfile` tablosu (CAN/KWP/ISO9141/J1850 → connect/gate/read/keep-alive). KWP/ISO9141'de idle tester-present.
  - Kapsam dışı: CAN değerleri birebir korunur.
  - Dosya: `obdRetryPolicy.ts`, `ElmInitSequencer.java`, `OBDManager.java` (keep-alive).
  - Kabul (cihaz): KWP connect başarı oranı ↑; 5 dk idle sonrası ilk PID < 2s.
  - **YAPILDI (2026-07-14):** Yeni `src/platform/obd/protocolProfile.ts` — `classifyProtocol` (ATSP → can/kwp/iso9141/j1850/unknown) + sınıf başına `{connectTimeoutMs, dataGateTimeoutMs, staleThresholdMs}`. **CAN ve BİLİNMEYEN değerleri mevcut `obdRetryPolicy` sabitleriyle BİREBİR aynı** (test kilidi) — bilinmeyende pencere UZATILMAZ, yoksa yanlış transport'ta BLE↔classic fallback'i gecikirdi. KWP 25/18/18 sn · ISO9141 28/20/20 sn (10.4 kbit/s seri hat + 5-baud init CAN penceresine sığmıyordu). `obdService` connect/data-gate/stale pencerelerini profilden alıyor. **Native (`ElmInitSequencer.applyProtocolProfile`):** yalnız yavaş seri protokolde `ATST FF` (yanıt penceresi ~1020 ms; varsayılan ~200 ms KWP ECU'suna yetmiyor → erken NO DATA = yanlış-negatif PID keşfi) + `ATSW 92` (ELM327 yerleşik ISO/KWP wakeup ≈2.9 sn, KWP P3max 5 sn ALTINDA → poll seyrekleşse/dursa bile oturum düşmez = keep-alive). CAN/J1850'de HİÇBİR komut gönderilmez. `obdProtocolProfile.test.ts` (12 kilit) + Java derlemesi temiz. Ledger #70.
  - **KALAN (cihaz kabulü):** Trafic/KWP'de connect başarı oranı ↑; 5 dk idle (park) sonrası ilk PID < 2 sn → 🟢.

- [x] **OBD-OS-F0-5 · Tek Reconnect Otoritesi** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: native `attemptReconnect` sürerken TS stale-watchdog/reconnect askıya alınsın (çift-motor çakışması bitsin).
  - Dosya: `obdService.ts`, `OBDManager.java` (durum bildirimi).
  - Kabul (kod): reconnect sırasında paralel tur başlamaz (birim/entegrasyon).
  - **YAPILDI (2026-07-14):** **Kök neden sanılandan kötüydü:** `CarLauncherPlugin.onStatusChanged` state'e BAKMADAN her bildirime `reason:"link_lost"` damgası vuruyordu. Native `attemptReconnect()` önce `"reconnecting"` der → TS bunu KOPMA sanıp paralel tur açıyor (native'in kurmakta olduğu soketi kapatıyor); dahası native reconnect BAŞARILI olunca (`"connected"`) bile TS link kaybı sanıp az önce iyileşen bağlantıyı yeniden kuruyordu. Köprü artık state'e göre reason üretiyor: `native_reconnecting` (TS: karışma) · `native_reconnected` (TS: izlemeye dön) · `link_lost` (gerçek kopma → TS otoritesi). TS'te `_nativeReconnectInFlight` bayrağı reconnect tetikleyen ÜÇ yolu da kapatıyor (status listener + stale watchdog + data-gate). FAIL-SAFE: 60 sn guard — native sonuç bildirmezse otorite TS'e döner (sonsuz askıda kalma yok). Native "bağlandı" dese de zero-trust: data-gate yeniden kurulur (PID akmıyorsa TS yine kopar). `obdReconnectAuthority.test.ts` (6 kilit; "gerçek kopma → TS reconnect eder" testi kablonun sahte-pozitif olmadığını kanıtlıyor) + regresyon kasasına yapısal kilit. Ledger #71.
  - **KALAN (cihaz kabulü):** araçta BT/soket kopmasında tek reconnect motoru çalışmalı (paralel tur/kararsız döngü YOK) → 🟢.

- [x] **OBD-OS-F0-6 · Mode 04 Clear WriteGate (güvenlik)** — 🔴 — S — *kod tamam, cihaz bekliyor*
  - Kapsam: DTC silme hız=0 (+mümkünse motor durumu) + açık onay kapısı ardında; salt-okuma vaadi kod düzeyinde `WriteGate` ile zorlanır.
  - Dosya: `dtcService.ts`, (yeni) `obd/writeGate.ts`, `SafetyBrain`.
  - Kabul (kod): hız>0 iken clear reddedilir (test).
  - Kabul (cihaz): seyir halinde "HAFIZAYI TEMİZLE" çalışmaz.
  - **YAPILDI (2026-07-14):** Saf `src/platform/obd/writeGate.ts` — `evaluateDtcClearGate`, FAIL-CLOSED kapı sırası: `not_connected` → `stale_data` (telemetri >3 sn eski → "hız 0" iddiası KANIT sayılmaz) → `speed_unknown` (−1/NaN ≠ sıfır) → `vehicle_moving` (≥1 km/h) → `not_confirmed`. Motor çalışıyor BLOKLAMAZ ama `engine_running` advisory üretir (ECU kodu anında yeniden yazabilir — kullanıcı şaşırmasın). **Kapı kanıtı ÇAĞIRANDAN ALINMAZ:** `clearDTCCodes` hızı/tazeliği `getOBDDataSnapshot()` ile OBD servisinden kendi okur → çağıran "hız 0" diye yalan söyleyemez; çağırandan gelen tek şey `confirmed`. `DTCPanel` iki-aşamalı onay ("HAFIZAYI TEMİZLE" → "ONAYLA — KALICI SİL") + ne silineceğinin uyarısı (readiness/muayene) + kapı reddi mesajı. **SESLİ ASİSTAN DA KAPIDAN GEÇER:** `commandExecutor.CLEAR_DTC_CODES` seyir halinde ECU'ya yazamaz ve artık SAHTE ONAY vermiyor (silinmediyse "silindi" DEMİYOR, kapının sebebini söylüyor). Testler: `obdWriteGate.test.ts` (15 kilit — saf karar + "reddedilince native `clearDTC` ÇAĞRILMIYOR" zorlama kilidi) + regresyon kasasına 1 yapısal kilit. **Tam suite 3928 yeşil, tsc + lint temiz.** Ledger #68.
  - **KALAN (cihaz kabulü):** seyir halinde (>1 km/h) "HAFIZAYI TEMİZLE" ECU'ya YAZMAMALI; duran araçta iki-aşamalı onayla silme çalışmalı → 🟢.

---

## FAZ 1 — STANDART OBD TAMLIĞI

> Amaç: SAE J1979 standart kapsamını tamamla; canlı veri ve muayene doğruluğu.

- [x] **OBD-OS-F1-1 · Kalan Standart PID'ler** — 🔴 — M — *ZATEN YAPILMIŞTI (roadmap hatası düzeltildi)*
  - Kapsam: MAF(10), motor yükü(04), O2/lambda(24-2B), rail basıncı(23), EGR(2C/2D), DPF(7A-7C), ambient(46), runtime(1F), distance-since-clear(31), time-with-MIL(4D). Formül TS `StandardPidRegistry` (tek doğruluk kaynağı).
  - Dosya: `obd/StandardPidRegistry.ts`, `ElmProtocol.readPidRaw` (zaten jenerik), sanitize bounds.
  - Kabul (cihaz): en az MAF+motor yükü canlı gelir.
  - **BULGU (2026-07-14):** Bu madde YANLIŞ VARSAYIMLA yazılmış — istenen PID'lerin **tamamı `StandardPidRegistry`'de zaten tanımlı** (04 · 10 · 1F · 23 · 24-2B · 2C/2D · 31 · 46 · 4D + 7C DPF; 7A/7B fark basıncı iç yapı belirsizliği yüzünden BİLİNÇLİ dışarıda). `SensorPanel.WATCH_PIDS` de MAF('10') ve motor yükü('04') dahil 12 PID'i zaten izliyor. **Yazılacak yeni kod YOK** — gereksiz kod eklenmedi.
  - **KALAN (cihaz kabulü):** Doblo seansında panel "SENSÖRLER OKUNUYOR… (araç desteği keşfediliyor)" aşamasındayken adb bağlantısı düştü → MAF+motor yükü DEĞER akışı gözlenemedi. Tek gerçek iş bu doğrulama (hafızadaki "extended değer dolumu" açığı ile aynı şey).

- [x] **OBD-OS-F1-2 · MIL/DTC Tutarlılık Uyarısı** — 🔴 — S — *kod tamam, cihaz bekliyor*
  - Kapsam: PID01 `mil=true` veya `dtcCount>0` ama Mode03 boş → "üretici kodu olabilir, motor ECU'da onaylı kod yok" uyarısı (Car Scanner farkının erken sinyali).
  - Dosya: `DTCPanel.tsx`/verdict modeli, `StandardPidEnums.ts`.
  - Kabul (cihaz): MIL yanan araçta uyarı görünür.
  - **YAPILDI (2026-07-14):** `computeDtcVerdict` artık `advisories: DtcAdvisory[]` döndürüyor. `mil_without_codes`: ECU arıza bildiriyor (MIL yanıyor ve/veya PID01 sayacı>0) AMA standart modların (03/07/0A) HİÇBİRİNDE kod yok → arıza üretici-özel tabanda (UDS 0x19). ZERO-TRUST: MIL/sayaç okunamadıysa (null) uyarı UYDURULMAZ; standart modda kod varsa uyarı ÜRETİLMEZ (tutarsızlık yok). `DTCPanel` uyarı kutusu: "Kod yok sonucuna güvenmeyin — üretici protokolüyle derin tarama gerekir." FAZ 3 (UDS 0x19) işine doğrudan köprü. Testler: `dtcVerdict.test.ts` +6 kilit. Ledger #72.
  - **KALAN (cihaz kabulü):** MIL yanan ama standart kod vermeyen araçta uyarı GÖRÜNMELİ → 🟢.

- [x] **OBD-OS-F1-3 · Tam Freeze Frame** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: FF PID setini 7 sabit yerine PID01 destekli tüm sete genişlet; UDS snapshot (0x19-06) FAZ 3'e bırak.
  - Dosya: `dtcService.ts` (FREEZE_FRAME_PIDS), `ElmProtocol.readFreezeFramePidRaw`.
  - Kabul (cihaz): FF'li araçta ≥5 PID okunur.
  - **YAPILDI (2026-07-14):** Saf `selectFreezeFramePids(supported)` — kanıt (Mode 01 bitmap keşfi, `getSupportedPids()`) VARSA teşhis-değeri sıralı `FREEZE_FRAME_PRIORITY` listesinden yalnız DESTEKLENENLER seçilir; kanıt YOKSA mevcut statik 7'li taban AYNEN (fail-soft, regresyonsuz — kör genişleme yasak: desteklenmeyen her PID ~200 ms NO-DATA bekletir). **BÜTÇE TAVANI `MAX_FREEZE_FRAME_PIDS=16`** (Mali-400 kuralı: 60+ PID sormak taramayı 12+ sn'ye çıkarırdı); tavan kesse bile çekirdek bağlam (devir/hız/coolant/yük) korunur. Genişleme: yakıt trim (06-09), lambda (44), ateşleme avansı (0E), MAF (10), baro (33), ECU voltajı (42), yakıt (2F), mutlak yük (43), runtime (1F), ambient (46), yağ (5C), tüketim (5E). Testler: `freezeFrameSelection.test.ts` (7 kilit). Ledger #72.
  - **KALAN (cihaz kabulü):** FF'li araçta ≥5 PID okunmalı (taban 7'yi aşan genişleme gözlenmeli) → 🟢.

- [x] **OBD-OS-F1-4 · Scan-Completeness Modeli + UI** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: hangi mod/ECU denendi/başardı/atladı → `scanCompleteness` telemetriye + UI rozeti ("Motor ECU ✓ · … okunamadı").
  - Dosya: yeni `obd/scanReport.ts`, `DTCPanel.tsx`, tanı raporu payload.
  - Kabul (kod): kısmi taramada coverage<1 raporlanır.
  - **YAPILDI (2026-07-14):** Saf `obd/scanReport.ts` — `buildScanReport()` → `{modes[], coverage 0..1, complete, failedCount, unsupportedCount, summary}`. **DÜRÜST COVERAGE:** `unsupported` (araçta o mod HİÇ yok — ör. Mode 0A, 2010 öncesi) kapsam kaybı DEĞİLDİR → paydaya girmez (aksi halde eski araçta coverage sonsuza dek <1 kalır, rozet gürültüye dönerdi); yalnız GERÇEK hata/timeout coverage'ı düşürür — ama desteklenmeyen mod kullanıcıya AYRICA söylenir. `DTCPanel`'de kapsam rozeti: yüzde + mod başına çip (`✓` / `okunamadı` / `desteklenmiyor`) + tek satır özet. Testler: `scanReport.test.ts` (7 kilit). ⚠️ Telemetriye (tanı raporu payload) EKLENMEDİ — ayrı küçük PR. Ledger #72.
  - **KALAN (cihaz kabulü):** kısmi taramada rozet %<100 ve düşen mod adını göstermeli → 🟢.

- [x] **OBD-OS-F1-5 · J1850 (VPW/PWM) Protokol Döngüsü** — 🔴 — S — *kod tamam, test aracı yok*
  - Kapsam: PROTOCOL_CYCLE'a ATSP1/ATSP2 ekle (eski Amerikan araçları).
  - Dosya: `obdService.ts` (PROTOCOL_CYCLE ~923), `ProtocolProfile`.
  - Kabul (cihaz): J1850 araçta bağlantı (varsa test aracı) — yoksa kod+birim.
  - **YAPILDI (2026-07-14):** `PROTOCOL_CYCLE` = `[auto, '6', '5', '4', '3', '7', '1', '2']` — J1850 PWM('1')/VPW('2') eklendi (1996-2004 Ford/GM). SIRA: en nadir SONDA (yaygın aracı geciktirmesin). `protocolProfile.ts`'te j1850 timeout profili (20/14/14 sn) zaten tanımlıydı. Kilit: `freezeFrameSelection.test.ts` içinde döngü kilidi (mevcut adaylar düşmesin + J1850 CAN'den sonra). **Kabul: J1850 test aracı YOK → cihaz doğrulaması yapılamaz; kod+birim ile kapanır.**

---

## FAZ 2 — ÇOKLU-ECU KEŞİF & TARAMA (Car Scanner farkının kalbi)

> Amaç: tek-ECU'dan tam-araç taramasına geçiş.

- [x] **OBD-OS-F2-1 · ECU Discovery Service** — 🔴 — L — *kod tamam, cihaz bekliyor*
  - Kapsam: fonksiyonel prob (ATH1 ile 0100/0900 yanıt adresleri) + fiziksel prob (7E0-7EF, 29-bit) + profil-güdümlü (fingerprint→FleetKB) → `VehicleTopology`.
  - Dosya: yeni `obd/EcuDiscoveryService.ts` + native prob desteği (`ElmProtocol`), `CarLauncherPlugin`.
  - Kabul (cihaz): çok-ECU araçta ≥2 ECU envanterde (zero-trust: yalnız kanıtlı).
  - **YAPILDI (2026-07-14):** Native `ElmProtocol.probeEcusRaw()` — `ATH1` (başlıklar AÇIK) + `0100` FONKSİYONEL adrese (7DF). ISO 15765-4: bu isteği araçtaki HER OBD ECU'su yanıtlar ve her yanıt KENDİ header'ını taşır → **tek komutla envanter** (kör 7E0-7EF adres taraması GEREKMEDİ). **HEADER RESTORE ZORUNLU:** ATH1 açık kalırsa standart poll parser'ı her yanıtta beklenmedik header görür → TÜM PID akışı sessizce bozulur; bu yüzden ATH0 doğrulanır, bir kez retry edilir, yine olmazsa `HeaderRestoreException` (sessiz yanlış veri > açık hata). DISCOVERY önceliği (F0-3 dersi: keşif hot-path'i preempt etmez). Saf TS `obd/ecuDiscovery.ts`: `parseEcuProbe` — 11-bit (7E8→7E0) + 29-bit (18DAF1xx→18DAxxF1), **boşluklu VE boşluksuz (ATS0) yanıt** (sahada bir kez ısıran `_hexTokens` dersi), çok-frame dedup, ELM gürültü filtresi. **ZERO-TRUST:** yalnız yanıt veren adres envantere girer; rol tahmini SADECE standartla garanti olanda (`7E8`=Motor/ECM), gerisi `unknown` (7E1 "şanzıman" DİYE UYDURULMAZ — araç-özel). `VehicleTopology.probedAt=null` → "keşif çalışmadı" ≠ "ECU yok" (fail-closed). Testler: `ecuDiscovery.test.ts` (11 kilit). Ledger #73.
  - **KALAN (cihaz kabulü):** çok-ECU araçta ≥2 ECU envanterde görünmeli; Doblo'da bile ≥1 (motor) → 🟢.

- [x] **OBD-OS-F2-2 · EcuRouter + Çok-Komut Atomik Blok** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: her teşhis isteğini doğru ECU+protokole yönlendir; header set→N komut→restore atomik (mevcut `withEcuHeader` tek-komut hâlinin çok-komut genişletmesi).
  - Dosya: yeni `obd/EcuRouter.ts`, `ElmProtocol.withEcuHeader` genişletme, `SessionScheduler`.
  - Kabul (kod): yanlış ECU'ya sızıntı yok (test).
  - **YAPILDI (2026-07-14):** **Yeni `EcuRouter.ts` GEREKMEDİ** — mevcut `withEcuHeader(tx, rx, Callable)` zaten çok-komutludur (`action` içinde N komut çalışır, header set→N komut→restore TEK atomik kuyruk görevinde; `finally` restore garantili, `HeaderRestoreException` sessiz yutmaz). Gereksiz soyutlama eklenmedi. Yönlendirme TS'te `multiEcuScan` içinde: her istek ECU'nun KENDİ tx/rx'iyle gider. **SIZINTI KİLİDİ:** bir ECU'nun kodu yalnız kendi kaydına yazılır — `multiEcuScan.test.ts` bunu doğrudan test ediyor (7E1'in C1234'ü 7E0'a sızmıyor).
  - **KALAN (cihaz kabulü):** çoklu-ECU taraması sonrası standart poll (hız/RPM) REGRESYONSUZ sürmeli (header restore gerçekten çalışıyor mu) → 🟢.

- [x] **OBD-OS-F2-3 · ECU-Başına DTC (Mode 03/07)** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: `DtcService` her keşfedilen ECU'da Mode03/07; DTC provenance (ecu.role) etiketli.
  - Dosya: `dtcService.ts`, `EcuRouter`.
  - Kabul (cihaz): ABS-arızalı araçta ABS DTC'si (kod tabanı FAZ 3'te DF eşleşir).
  - **YAPILDI (2026-07-14):** Native `ElmProtocol.readDtcsFromEcu(tx, rx, mode)` — mevcut `readDTCs`/`readPendingDTCs`/`readPermanentDTCs` **parse'ı AYNEN yeniden kullanır**, yalnız `withEcuHeader` ile SARAR (kopya parse yazılmadı). Mode 03/07/0A üçü de ECU-başına. Plugin: `readDtcFromEcu({tx, rx, mode})` → `{codes, supported}`; `supported:false` = ECU o modu bilmiyor (hata DEĞİL). TS `EcuDtc` provenance taşır: `{code, ecuLabel, ecuTxHeader, mode}` → kod HANGİ ECU'dan geldiği KAYBOLMAZ. Testler: `multiEcuScan.test.ts` (8 kilit; router sızıntı kilidi dahil). Ledger #73.
  - **KALAN (cihaz kabulü):** motor DIŞI bir ECU'dan kod okunmalı (ABS/airbag arızalı araç gerekir; Doblo temizse bu madde 🔴 kalır) → 🟢.

- [x] **OBD-OS-F2-4 · Deep Vehicle Scan Orkestrasyonu** — 🔴 — M — *kod tamam, cihaz bekliyor*
  - Kapsam: "Tam Araç Taraması" akışı — Discovery→ECU başına DTC/FF→Verdict. Cold-path/DeviceTier bütçesine abone.
  - Dosya: mevcut Deep Scan orchestrator entegrasyonu, `verdictEngine`.
  - Kabul (cihaz): tam tarama tamamlanır, coverage doğru raporlanır.
  - **YAPILDI (2026-07-14):** `obd/multiEcuScan.ts` — `runFullVehicleScan()` = keşif → ECU başına 03/07/0A. **FAIL-SOFT:** bir ECU/mod düşerse tarama DURMAZ, o okuma `failedReads`'e sayılır → kısmi tarama "temiz" DEMEZ (F0-1/F1-4 ile aynı fail-closed felsefe). **BÜTÇE:** `MAX_SCAN_ECUS=8`; tavan aşılırsa **sessiz kırpma YOK** → `skippedEcus` raporlanır (11-bit'te adres uzayı zaten 8; tavan asıl 29-bit geniş uzayda anlamlı). `DTCPanel`'e "Araç ECU'ları" bölümü bağlandı: ECU başına durum (temiz / N kod / okunamadı) + **motor DIŞI ECU kodları ayrı listeleniyor** (bugüne kadar HİÇ görünmüyorlardı) + kısmilik uyarısı. Keşif çalışmadıysa bölüm HİÇ gösterilmez ("bakılmadı" ≠ "ECU yok"). Ledger #73.
  - **KALAN (cihaz kabulü):** tam tarama tamamlanmalı, "N ECU tarandı" doğru olmalı, tarama sonrası canlı veri akışı bozulmamalı → 🟢.

---

## FAZ 3 — UDS / PROFESYONEL PROTOKOL

> Amaç: üretici DTC + güvenilir çok-frame + KWP tam yığın.

- [x] **OBD-OS-F3-1 · UDS Mode 0x19 ReadDTCInformation** — 🔴 — L — *kod tamam, cihaz bekliyor*
  - Kapsam: 0x19-02 (statusMask), 0x19-0A (supported), status-byte ayrımı (active/pending/confirmed/testFailed). Renault DF vb.
  - Dosya: `ElmProtocol` (UDS engine), `dtcService`, DTC modeli status alanı.
  - Kabul (cihaz): Renault'da DF kodu Car Scanner ile eşleşir.
  - **YAPILDI (2026-07-14):** Native `readUdsDtcsRaw(statusMask)` → `19 02 FF`; ham hex TS'e ("5902" soyulmuş), ayrıştırma `obd/udsDtc.ts`'te (tek kaynak). **STATUS BAYTI = F3-1'in asıl kazancı:** Mode 03 "kod var" der; UDS **aktif mi (testFailed) · onaylı mı (confirmed) · bekleyen mi** ayırır + **FTB (Failure Type Byte)** verir (Mode 03'te bu bayt YOKTUR). 3-bayt DTC → SAE J2012 kodu; ham baytlar KORUNUR (FleetKB/DF eşlemesi için). **ÇOKLU-ECU TARAMASINA BAĞLANDI:** her ECU'da standart modlardan SONRA 0x19 denenir; `fromUds:true` etiketiyle ayrışır. **DEDUPE:** aynı kod hem Mode 03 hem UDS'te varsa TEK KEZ listelenir (yalancı "iki arıza" yasak). Fail-soft: ECU 0x19'u bilmiyorsa (NRC 0x11/0x12/0x31) hata SAYILMAZ. **F1-2'nin "MIL yanıyor ama standart kod yok" uyarısının somut cevabı budur.** Testler: `udsDtc.test.ts` (12) + `multiEcuScan.test.ts` (+4). Ledger #74.
  - **KALAN (cihaz kabulü):** Renault/üretici kodlu araçta DF kodu görünmeli ve Car Scanner ile eşleşmeli → 🟢.

- [~] **OBD-OS-F3-2 · ISO-TP Stack (reassembly + flow control)** — 🔴 — L — *YENİDEN DEĞERLENDİRİLDİ: bu mimaride yazılımsal stack GEREKSİZ*
  - Kapsam: SF/FF/CF, FC üretimi (BS/ST), sequence doğrulama, out-of-order/missing tespiti; STN donanımsal / klon yazılımsal (AdapterCapabilities).
  - **BULGU (2026-07-14):** **ELM327 ISO-TP katmanını DONANIMDA yapıyor** — SF/FF/CF birleştirme ve flow-control (ATCFC, varsayılan AÇIK) adaptörün işi. Bizim gördüğümüz zaten birleştirilmiş gövdedir (`splitResponseBodies` + `readDid`/`udsRequest` çok-satır birleştirme mevcut ve sahada çalışıyor: VIN, uzun DTC listeleri, DID yanıtları eksiksiz geliyor). Yazılımsal ISO-TP yalnız **ham CAN modunda** (ATMA/monitor, ELM'in ISO-TP motoru BYPASS edilerek) gerekir — o mod bu üründe kullanılmıyor. **Yazmak = ELM327'nin işini ikinci kez yapmak** (risk: çift birleştirme → bozuk gövde). Kalan gerçek risk (klon adaptörde flow-control güvenilmezliği) **F3-5 ile kanıta bağlandı** (`AdapterCapabilities.flowControl`).
  - **KARAR:** yazılımsal ISO-TP stack YAZILMADI (gereksiz kod eklenmedi). Madde açık bırakıldı: **ham-CAN modu (F4/CAN sniff) gündeme gelirse** yeniden değerlendirilecek. Kabul ölçütü ("uzun VIN/DTC/DID eksiksiz gelir") zaten sahada 🟢 gözlemlendi (VIN + 19 PID + DTC listeleri).

- [x] **OBD-OS-F3-3 · KWP2000 Engine (tam)** — 🔴 — M — *kod tamam, cihaz bekliyor (Trafic)*
  - Kapsam: ISO 14230-4 fast/slow init, ReadDTCByStatus(0x18), keyword/checksum farkındalığı, tester-present.
  - Dosya: `ElmProtocol` KWP dalı, `ProtocolProfile`.
  - Kabul (cihaz): Trafic'te KWP DTC + kararlı oturum.
  - **YAPILDI (2026-07-14):** Native `readKwpDtcsRaw()` → `18 00 FF 00` (ReadDTCByStatus, filtre yok/tüm gruplar). **UDS 0x19'un KWP KARŞILIĞI** — KWP araçlar (Trafic, eski Doblo, çoğu 2000-2008 Avrupa aracı) 0x19'u TANIMAZ, üretici kodları 0x18'de yaşar. Saf `obd/kwpDtc.ts`: **KWP DTC 2 BAYTTIR (UDS'te 3)** → ayrı çözücü; UDS çözücüsünü KWP gövdesine uygulamak tüm listeyi kaydırırdı (sessiz veri bozulması — test bu sınırı açıkça kilitliyor). Kod dönüşümü (SAE J2012) UDS ile ORTAK; ham baytlar DF eşlemesi için korunur. `count` alanına körü körüne güvenilmez (gerçek kayıtlar sayılır). **fast/slow init + tester-present F0-4'te yapıldı** (`ATST FF` + `ATSW 92` = ELM327 yerleşik KWP wakeup, P3max altında → oturum düşmez). Testler: `kwpDtc.test.ts` (7). Ledger #74.
  - **KALAN (cihaz kabulü):** Trafic'te KWP DTC okunmalı + oturum kararlı kalmalı (**araç kullanıcıda değil** — Abbas/uzaktan doğrulama) → 🟢.

- [x] **OBD-OS-F3-4 · UDS Session/TesterPresent (0x10/0x3E)** — 🔴 — S — *kod tamam, cihaz bekliyor*
  - Kapsam: extended session aç + keep-alive; gelişmiş servisler için önkoşul.
  - Dosya: `ElmProtocol` UDS engine.
  - Kabul (kod): session açma/kapama testi.
  - **YAPILDI (2026-07-14):** `openExtendedSession()` → `10 03` (ExtendedDiagnosticSession), olumlu yanıt `50 03`. **F3-1 İÇİN ZORUNLU ÇIKTI:** bazı ECU'lar 0x19'u varsayılan oturumda vermez → `NRC 0x7E/0x7F/0x22/0x24`. Bunları "desteklenmiyor" saymak üretici kodlarını okunamaz kılardı (Car Scanner'ın açtığı oturumu biz açmazsak aynı araçta "göremiyor" olurduk). Yeni `NrcAction.SESSION_REQUIRED` → extended session aç → aynı isteği **TEK KEZ** tekrarla (sonsuz session→retry döngüsü yasak); açıldıktan sonra hâlâ reddediliyorsa servis gerçekten yok. **TesterPresent (0x3E) GEREKMEDİ:** oturum + istek AYNI atomik kuyruk görevinde ardışık çalışıyor → ECU'nun S3 zaman aşımı (≈5 sn) penceresine hiç girilmiyor. Fail-soft: oturum açılamazsa mevcut sonuca dönülür.
  - **KALAN (cihaz kabulü):** oturum gerektiren ECU'da 0x19 başarılı okunmalı → 🟢.

- [x] **OBD-OS-F3-5 · Adapter Identity & Capability Probe** — 🔴 — S — *kod tamam, cihaz bekliyor*
  - Kapsam: ATI/AT@1/STDI → gerçek ELM/STN/klon + `AdapterCapabilities` (flow-control, ATCP, throughput).
  - Dosya: `ElmInitSequencer`, yeni `AdapterCapabilities`.
  - Kabul (cihaz): STN vs klon doğru sınıflanır.
  - **YAPILDI (2026-07-14):** Native `probeAdapterIdentityRaw()` → `ATI` + `AT@1` + `STDI` ham (fail-soft, prob asla patlamaz). Saf `obd/adapterCapability.ts` → `stn` | `elm327` | `clone` | `unknown`. **ZERO-TRUST:** yetenek ETİKETTEN değil DAVRANIŞTAN çıkar — "ELM327 v1.5" yazan adaptörlerin ÇOĞU klondur ve ATCP/ATCFC'yi taşımaz; klonu gerçek sanmak desteklenmeyen komut → SESSİZ başarısızlık demektir. Kanıt sırası: STDI yanıtı → STN · anlamlı AT@1 → gerçek ELM327 · ATI "ELM" diyor ama kimlik komutları sessiz → **KLON** (etiket yalan) · hiçbiri → `unknown`. **FAIL-CLOSED:** klon/unknown'da `extendedAddressing=false`, `flowControl=false` (yetenek VARSAYILMAZ). Testler: `adapterCapability.test.ts` (7). Ledger #74. ⚠️ Henüz init akışına/teşhis raporuna BAĞLANMADI (ayrı küçük PR — sınıflandırıcı hazır).
  - **KALAN (cihaz kabulü):** mevcut BLE dongle doğru sınıflanmalı (muhtemelen `clone`) → 🟢.

- [x] **OBD-OS-F3-6 · Genişletilmiş NRC Sınıflandırma** — 🔴 — S — *kod tamam*
  - Kapsam: 0x12/13/21/22/24/31/33/35/36/37/78 NRC'leri ayrı ele al (generic IOException yerine anlamlı durum).
  - Dosya: `ElmResponseParser`/`ElmProtocol.readDid`, TS sınıflandırma.
  - Kabul (kod): NRC birim testleri.
  - **YAPILDI (2026-07-14):** `readDid`'in NRC/ISO-TP/pending disiplini **ortak `udsRequest()` motoruna** çıkarıldı (kopya mantık yok; `readDid` + `readUdsDtcsRaw` + `readKwpDtcsRaw` hepsi onun üstünde). `classifyNrc()` → **UNSUPPORTED** (0x11/0x12/0x31/0x33 — kalıcı, bir daha sorma) · **RETRY** (0x21 busy + 0x78 pending — bekle) · **SESSION_REQUIRED** (0x7E/0x7F/0x22/0x24 — extended session aç) · **FATAL** (anlamlı mesajla). **KAZANÇ:** eskiden 0x31/0x33/0x78 DIŞINDAKİ HER NRC generic IOException'a düşüyordu — "ECU meşgul, tekrar dene" (0x21) ile "ECU bu servisi hiç bilmiyor" (0x11) AYNI kefeye giriyordu; biri boşuna vazgeçmeye, diğeri boşuna beklemeye yol açıyordu. `describeNrc()` ISO 14229-1 açıklamaları (uydurma mesaj yok).

---

## FAZ 4 — PREMIUM+ (ZEKÂ & SERVİS FONKSİYONLARI)

> Amaç: Vehicle Brain tam devrede + servis fonksiyonları (güvenlik-kapılı).

- [x] **OBD-OS-F4-1 · Verdict Engine (fail-closed, tam)** — 🔴 — M — *kod tamam, UI'da canlı*
  - Kapsam: CLEAN|ISSUES|INCONCLUSIVE + scanCompleteness + findings + predictions + actions; Root Cause V2 çok-ECU beslemesi (PR-9 subsystem yayılımı).
  - Dosya: yeni `obd/verdictEngine.ts`, Root Cause V2 entegrasyonu, IncidentCenter.
  - **YAPILDI (2026-07-15):** `buildVehicleVerdict()` — F0-1 DTC verdisi + F1-4 kapsam + F1-2 MIL tutarsızlığı + F2 çoklu-ECU + F3-1 UDS kodlarını TEK karara bağlar. Seviye: `not_scanned|clean|attention|critical|inconclusive` (fail-closed: bulgu > belirsizlik > temiz). **CONFIDENCE KANITTAN TÜRER (sabit OLAMAZ):** mod kapsamı × ECU kapsamı × keşif yapıldı mı. ECU keşfi çalışmadıysa güven **0.6 ile TAVANLANIR** (yalnız motor ECU'sunu gördük — araç geneli hakkında konuşma hakkımız sınırlı); okunamayan ECU, bütçe nedeniyle atlanan ECU, düşen mod → güven DÜŞER. `confidenceReason` şeffaf gerekçe verir. **HER FINDING KANITA BAĞLI** (`evidence` boş olamaz — uydurma bulgu yasak; test bunu kilitliyor). **AKSİYON ÜRETİMİ (8. kapı):** kritik kod → "Servise başvurun" (P1) · MIL tutarsızlığı → "Üretici protokolüyle derin tarama" (P2, F3'e köprü) · UDS kodu → "Üretici kodları bulundu" (P2) · tarama boşluğu → "Taramayı tekrarlayın" (P3). **DTCPanel'de canlı** (verdi + güven + gerekçeli aksiyon kartı). Testler: `verdictEngine.test.ts` (15). Ledger #75.

- [x] **OBD-OS-F4-2 · SignalEnvelope + Confidence Modeli** — 🔴 — M — *kod tamam*
  - Kapsam: her sinyal provenance+confidence+freshness+state (valid/suspect/no_data/unsupported); "0 değer"≠"no-data" ayrımı.
  - Dosya: `obdSanitizer` → confidence motoru, `obdTypes`, fusion köprüsü.
  - **YAPILDI (2026-07-15):** `obd/signalEnvelope.ts` — `wrapSignal()` her sinyali zarfa sarar: `{value, state, confidence, source, updatedAt, ageMs, unit}`. **EN KRİTİK KAZANÇ — "0" ≠ "no-data":** gerçek sıfır (araç duruyor → hız 0) `valid`+`value:0`; veri yok → `no_data`+**`value:null`** (0 olarak SIZMAZ). Bunları karıştırmak teşhisin en sinsi hatasıdır (okunamayan yağ basıncını "0" sanıp alarm çalmak, ya da bilinmeyen hızı "0" sanıp ECU'ya yazmaya izin vermek). `isZero()` → `boolean|null` (bilinmiyorsa **null**, "sıfır değil"). OBD `-1 = desteklenmiyor` konvansiyonu opsiyonel (`negativeMeansUnsupported`) — gerçekten negatif olabilen sinyallerde (yakıt trim, ateşleme avansı, ortam sıcaklığı) kapatılır, yoksa geçerli −5°C sessizce "desteklenmiyor" olurdu. **Confidence tazelikten türer** (taze=1 → 3 sn sonra lineer düşüş → 15 sn'de 0); mock kaynak 0.1 (sahte veri karar için kanıt sayılmaz). `isDecisionGrade()` fail-closed karar kapısı. Testler: `signalEnvelope.test.ts` (12). ⚠️ Henüz `obdService` hot-path'ine BAĞLANMADI (ayrı PR — model hazır, entegrasyon performans testi ister). Ledger #75.

- [x] **OBD-OS-F4-3 · Prediction Motoru** — 🔴 — M — *kod tamam*
  - Kapsam: coolant/voltaj/DPF trend öngörüsü ("5 dk sonra overheat", "marş riski"). Cold-path/düşük frekans.
  - Dosya: Digital Twin + yeni prediction katmanı.
  - **YAPILDI (2026-07-15):** `obd/predictionEngine.ts` — en küçük kareler doğrusal regresyon (**kasıtlı BASİT**: cold-path'te birkaç aritmetik işlem, tahsis yok → Mali-400 bütçesi; ve AÇIKLANABİLİR: "son 60 sn'de +2.1°C/dk" gerekçesi kullanıcıya gösterilebilir). Kurallar: **overheat** (110°C, 10 dk ufuk, kritik) · **battery_drain** (11.8 V, marş riski) · **oil_pressure_drop** (100 kPa, kritik). **EN ÖNEMLİ KURAL — EMİN DEĞİLSEK SUSARIZ:** yetersiz örneklem (<5) → tahmin YOK · zayıf uyum (R² < 0.6 = gürültü) → tahmin YOK · yanlış yön (soğuyan motorda "overheat" demez) → YOK · ufuk dışı (60 dk sonra varacaksa henüz uyarmaz) → YOK · zaten eşik aşılmışsa bu ÖNGÖRÜ değil mevcut durumdur → YOK. Yanlış-pozitif bir "aşırı ısınma" uyarısı, hiç uyarmamaktan DAHA ZARARLIDIR (kullanıcı bir daha hiçbir uyarıya inanmaz). `confidence = R²` (sabit değil). Testler: `predictionEngine.test.ts` (13). ⚠️ Henüz canlı telemetriye BAĞLANMADI (motor hazır; besleme ayrı PR). Ledger #75.

- [x] **OBD-OS-F4-4 · FleetKB Öğrenme (araç haritası)** — 🔴 — L — *kod tamam*
  - Kapsam: marka/model→ECU haritası, DF kod tabanı, DID profili öğren; sonraki araca hazır gel. Ticari-lisans temiz kaynaklar (CLAUDE.md).
  - Dosya: `vehicleKnowledgeBase`, `manufacturerIntelligenceEngine`, fingerprint.
  - **YAPILDI (2026-07-15):** `obd/fleetKb.ts` — araçtan öğren, sonraki sefere hazır gel (vizyon: Tesla kendi aracını TANIR; biz bilmediğimiz araçta ÖĞRENİRİZ). `buildFingerprint()`: VIN varsa VIN (en güçlü), yoksa ECU adresleri + PID sayısı imzası; **kanıt yoksa fingerprint YOK → öğrenme YAPILMAZ** (yanlış araca yanlış profil yüklemek, hiç yüklememekten KÖTÜDÜR). **⚠️ ZERO-TRUST — MODÜLÜN EN ÖNEMLİ KURALI: hafızadaki bilgi İDDİADIR, KANIT DEĞİLDİR.** Öğrenilen topoloji poll/teşhis kararlarını DOĞRUDAN beslemez; yalnız "nereye bakacağımızı" söyler, bulgular yine CANLI KANITLA doğrulanır. ECU artık yanıt vermiyorsa hafızadan DÜŞER (`learnProfile` birleştirmez, DEĞİŞTİRİR — **araca inanırız, hafızaya değil**). `profileConfidence` gözlemle artar ama **1'e ASLA ulaşmaz** (araç her an değişebilir). `diffProfile()` → **araç değişimi tespiti** (hiç ortak ECU yok → başka araç; sahada yaşanan dongle Doblo→Trafic vakasının teşhis karşılığı); araç hiç yanıt vermiyorsa "değişti" DENMEZ (bağlantı sorunu olabilir — kanıt yok, suçlama yok). Ticari lisans temiz: veri KULLANICININ KENDİ ARACINDAN gelir, 3. taraf veri seti gömülmez. Testler: `fleetKbServiceGate.test.ts` (F4-4: 10). ⚠️ Kalıcı depolama BAĞLANMADI (saf model hazır). Ledger #75.

- [x] **OBD-OS-F4-5 · Adaptation/Actuator/ServiceFn (çok-kapılı yazma)** — 🔴 — L — *KAPI tamam, native yazma BİLİNÇLİ YAZILMADI*
  - Kapsam: UDS 0x22/0x2E oku (yaz kapılı), 0x31 RoutineControl (DPF rejen/servis reset) — hız=0+motor+onay+rıza+security kapıları.
  - Dosya: yeni `obd/AdaptationService.ts`/`ActuatorService.ts`, `WriteGate`, `SecurityAccess(0x27)`.
  - Kabul: her yazma çok-kapı geçmeden çalışmaz (test + cihaz).
  - **YAPILDI (2026-07-15):** `obd/serviceFunctions.ts` — **7 KAPI** (hepsi geçilmeli, fail-closed): (1) bağlantı canlı · (2) telemetri taze · (3) araç duruyor · (4) **motor durumu rutine UYGUN** (DPF rejenerasyonu motor ÇALIŞIR ister; servis reset motor DURUR ister; rpm bilinmiyorsa **fail-closed RED**) · (5) kullanıcı onayı · (6) **rutin bu araçta DESTEKLİ olduğu KANITLANDI mı** (bilinmiyor ≠ destekli → RED) · (7) **bilgilendirilmiş rıza** — riski GÖRMEDEN verilen onay, onay DEĞİLDİR (her rutinin `risk` metni ZORUNLU; test boş risk metnini yasaklıyor). İlk 1-3+5 F0-6 `WriteGate` ile ORTAK (kanıt yine OBD servisinden okunur, çağıranın iddiası değil). Rutinler: DPF rejenerasyon (egzoz 600°C riski açıkça yazılı) · servis aralığı sıfırlama · gaz kelebeği adaptasyonu. **⚠️ NATIVE YAZMA (UDS 0x2E/0x31/0x27) BİLİNÇLİ OLARAK YAZILMADI:** kapı ve model ÖNCE, yazma SONRA. Kapıyı cihazda kanıtlamadan yazma kodu eklemek, ürünün "araca zarar vermem" sözünü riske atardı. Testler: `fleetKbServiceGate.test.ts` (F4-5: 10). Ledger #75.

---

## PR-OBD-KWP-1 — KWP Acquisition Yolu (2026-07-15, roadmap-sonrası ek faz)

> Trafic sahası kök nedenleri: (1) Mode 22/DID yolu CAN adresleme VARSAYIYORDU → KWP hattında
> COMM_ERROR fırtınası; (2) KWP üretici verisinin gerçek kapısı Servis 21 HİÇ yoktu;
> (3) NO_DATA dönen extended PID'ler sonsuza dek yeniden sorgulanıyordu (ATST FF sonrası
> tur başına ~1 sn × 39 PID israfı); (4) üç ayrı değer deposu tek veri gerçeği sunmuyordu.

- [x] **KWP-1a · Native KWP adresleme** — 🔴 — `withEcuHeader`: boş tx = header'a DOKUNMA
  (varsayılan oturum — KWP'de en olası başarı yolu) · 6 hane = KWP 3-bayt ATSH (ATCRA yok,
  restore protokole göre C133F1/686AF1, HeaderRestoreException disiplini korunur).
- [x] **KWP-1b · Servis 21 (ReadDataByLocalIdentifier)** — 🔴 — `readDataById('21', lid)`
  ortak udsRequest motorunda (NRC/pending/session TEK yerde); plugin `readObdDid.service`
  parametresi; `openExtendedSession` protokol-farkındalı (KWP: 10 81 → 10 C0; CAN: 10 03).
- [x] **KWP-1c · Profil protokol kapısı + Trafic profili** — 🔴 — `VehicleDidProfile.protocols`
  (CAN profilleri `['can']` işaretlendi → KWP hattında sorgulanmaz, `PROTOCOL_MISMATCH`
  kanıtı); yeni `renaultTraficKwpProfile` (kwp/iso9141, varsayılan-oturum adresleme,
  YALNIZ ISO 14229-1 kimlik DID'leri — DDT2000 kopyalanmaz, LID'ler keşifle kanıtlanacak);
  `didDiscoveryService` Servis 21 LID taraması (salt-okuma, kullanıcı tetiklemeli).
- [x] **KWP-1d · Extended NO_DATA öğrenme (demotion)** — 🔴 — native `ExtendedNoDataTracker`:
  3 ardışık NO_DATA/7F → oturum-içi turdan düşer (OK sayaç sıfırlar; TIMEOUT/ERROR NÖTR —
  yanlış-negatif öğrenme yasak); demote anında TEK `obdExtendedPidStatus` olayı → TS
  `getPidStatus()`='no_data' → Canlı Test "VERMİYOR" rozeti + `obdDeep.extended.unavailable`.
- [x] **KWP-1e · signalHub (tek otoriter okuma yüzeyi)** — 🔴 — `readSignal('speed'|'pid:5C'|
  'did:F190')` → SignalEnvelope (0≠no_data · unsupported/no_data/stale/valid kanıtla ayrışır ·
  provenance+confidence); depolar TAŞINMADI (hot-path'e sıfır dokunuş), pull-tabanlı.
- Kabul (cihaz, Trafic): core akış kesintisiz · `mode22.decision` PROTOCOL_MISMATCH yerine
  gerçek sorgu sonucu · Servis 21 keşfinde ≥1 pozitif LID (varsa) · NO_DATA 39'lusu ~2 tur
  sonra turdan düşer ve Canlı Test gerçek nedeni gösterir · KWP oturumu kararlı.

## Nasıl güncelliyoruz (iş akışı)
1. Bir göreve başlarken kutucuğu `[~]` yap.
2. Kod tamam + `npm run test` yeşil + `tsc` temiz olunca `[x]` yap (ledger 🔴 kalır).
3. Gerçek araçta kabul ölçütü gözlenince ledger'ı 🟢 yap + `docs/DEVICE_VALIDATION_LEDGER.md`'ye işle.
4. Cihazda düşerse ❌ + kısa kök-neden notu.
5. Her güncellemede üstteki "İlerleme özeti" tablosunu tazele.

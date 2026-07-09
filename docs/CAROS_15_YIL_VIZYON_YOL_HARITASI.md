# CAROS PRO — 15 Yıllık Vizyon & Ana Teknik Yol Haritası

> **Konum:** "Head Unit pazarının Tesla'sı" — kopya değil; **daha güvenli, modüler,
> akıllı, açık ve uzun ömürlü** aftermarket Vehicle Intelligence OS.
> **Bu belge:** 2026-07-08 kod-tabanlı denetim. Acımasız, dürüst, abartısız.
> Tahmin yok — her yargı `src/`, `website/`, `supabase/`, `android/`, `.github/` kanıtına dayanır.

---

## 1) 15 YILLIK VİZYON

**Nihai hedef:** Belirli bir markaya bağlı olmayan (Tesla kendi aracını tanır; CAROS
**bilinmeyen yüzlerce marka/modeli öğrenir**), aftermarket + OEM-agnostik, **fonksiyonel
güvenlik seviyesinde güvenilir**, uzaktan güncellenebilen, uygulama ekosistemi olan bir
**araç işletim sistemi**. Donanım satmıyoruz; **her head unit'i akıllı yapan yazılım katmanı**.

**Dünyada nereye ulaşabilir:** 3. taraf head unit üreticilerine gömülü OS · aftermarket
kurulum pazarı (yüz milyonlarca eski araç) · filo SaaS · OEM'lere beyaz-etiket cockpit.
Gerçekçi tavan: "araçların Android'i" değil ama **"aftermarket cockpit'lerin de-facto
zeki katmanı"** — özellikle EU/TR/MENA/Güney Asya'daki OEM-dışı devasa araç parkı.

**Kullanıcı kitleleri ve CAROS'un onlara vaadi:**

| Kitle | Vaat | Bugünkü hazırlık |
|---|---|---|
| Son kullanıcı (bireysel) | Akıllı, güvenli, güzel cockpit + telefon uzaktan kumanda | **En olgun** (~65%) |
| Filo | Canlı takip, sürücü skoru, bakım, rapor | Çekirdek var, rapor/skor **yok** (~25%) |
| Kurumsal | RBAC, panel, SLA, API | RBAC var; API/SLA **yok** |
| Kamu | Öncelikli rota, merkezi komuta, vardiya | **Hiç yok** (marketing) |
| OEM üreticiler | Beyaz-etiket cockpit + SDK | **Hiç yok** (SDK/plugin yok) |
| Yetkili servis / Servisler | DTC teşhis, bakım geçmişi, uzaktan tanı | DTC var (37 kod), servis-portalı **yok** |
| Araç üreticileri | Derin araç entegrasyonu | Aftermarket zorunluluğu = derin entegrasyon **yok** |
| Yedek parça sektörü | Parça-öneri, arıza→parça eşleme | **Hiç yok** |

**Sonuç:** Vizyon net ve savunulabilir; ama bugün ürün **bireysel son-kullanıcıya** hitap
edecek olgunlukta, **kurumsal/OEM/kamu** katmanları büyük ölçüde **vaat aşamasında**.

---

## 2) BUGÜNKÜ DURUM (kod-temelli)

### Tamamlanmış (gerçek, kanıtlı)
OBD-II/DTC okuma · tünel modu/DR (`gps/fusionCore`) · sesli asistan (offline **Vosk TR**
modeli `android/.../assets/vosk-model-tr`) · intent app-kontrolü · TTS · mola önerisi ·
medya (Android MediaController) · GPS · uzaktan komut (lock/unlock, **AES-256-GCM + ECDH
P-256 E2E**, nonce-replay) · RBAC (driver/admin/super_admin, JWT claim) · realtime konum
(Supabase) · FCM push · bakım değerlendirme · web panel çekirdeği (Supabase) · OTA v1
(APK indirme/kurulum state machine) · tema/layout motoru · **152 unit + 11 e2e test + CI**.

### Yarım
Offline harita (indirme motoru var, veri yok) · offline routing (kod var, `routing-graph.bin`
yok) · trafik (HERE/TomTom **BYOK**) · yakıt seviyesi (OBD 0x2F kaldırıldı → raw-CAN, araç-bağımlı) ·
CAN kapı/far (head-unit-özel, bazı bit-düzenleri "belirsiz") · Diagnostic AI (**37** DTC,
web "200+" diyor) · i18n (i18next **kurulu** ama içerik Türkçe-only) · OTA (telemetri yok) ·
EV (veri modeli var: SoC/charging/motorPower; araç-bağımlı besleme).

### Hiç başlamamış
PDF rapor · 90-gün geçmiş · public REST API/SDK · sürücü puanlama · yakıt maliyet ·
Android Auto/CarPlay projeksiyon · plugin/marketplace · developer platform · bulut backup/sync ·
3. taraf crash-reporting/APM · vardiya/kargo/müşteri-bildirim/öncelikli-rota/merkezi-komuta ·
ADAS/DMS · fonksiyonel güvenlik sertifikasyonu · KVKK/GDPR consent akışı.

### Teknik borçlar
- **Debug/güvenlik bayrakları shippable build'de** (adb-enable, port 8899) — satışa gitmemeli.
- **Migration history boşlukları** (025/026 supabase history'ye yazılmamış — memory).
- **SAB (SharedArrayBuffer) prod'da pasif** + entegrasyon yarım (audit #0).
- **Mock fallback panelde** (`GeofenceAlertsPanel` Supabase yoksa demo üretir).
- **Placeholder UI** (`dashboard/settings` defaultValue, kaydetmez).
- **Cihaz-doğrulama açığı**: birçok özellik test-yeşil ama `DEVICE_VALIDATION_LEDGER`'da 🔴.

### En büyük mimari riskler
1. **Zero-trust telemetri (çekirdek değer aftermarket'ta güvenilmez):** OBD/CAN araç ve
   head-unit'e göre kırılıyor (K24/Hiworld/NWD/Renault). Fragmantasyon en büyük risk.
2. **Alan gözlemlenebilirliği yok:** 3. taraf crash-reporting/APM yok → sahadaki head
   unit filosunda hataları göremezsin. 15 yıl ölçekte ölümcül.
3. **OTA = self-hosted APK sideload:** yönetilen güncelleme kanalı/Play Services yok;
   OEM filoya güvenli dağıtım kanıtlanmadı.
4. **Tek dil (Türkçe):** "dünya çapında" hedefiyle çelişir (altyapı var, içerik yok).
5. **Tek backend (Supabase):** OEM/multi-tenant ölçeği, veri egemenliği kanıtlanmadı.
6. **Ekosistem yok (plugin/SDK):** monolit; Tesla/Android Automotive uygulama
   ekosistemiyle yarışamaz.
7. **Fonksiyonel güvenlik / siber uyum yok:** ISO 26262 (ASIL), UN R155/R156 — OEM'e
   girmek için zorunlu; bugün hiç yok.
8. **Pazarlama ürünün önünde** (ayrı denetim: `WEB_URUN_UYUM_BACKLOG.md`) — hukuki/güven riski.

---

## 3) EKSİK ÖZELLİK LİSTESİ (hiçbir kategori atlanmadı)

| Kategori | Durum | Not (kanıt) |
|---|---|---|
| UI | ✅ 75% | Zengin, çok temalı; bazı yerler placeholder |
| Backend | 🟡 55% | Supabase + RLS gerçek; rapor/API/retention yok |
| OBD | 🟡 65% | Gerçek; yakıt PID kaldırıldı, araç-bağımlı |
| CAN | 🟡 55% | Gerçek ama head-unit-özel, bazı bit belirsiz |
| AI | 🟡 55% | Companion (Gemini/Groq BYOK) + Vosk; DTC 37 |
| Navigasyon | 🟡 60% | Render/tünel/DR gerçek; offline routing verisi yok |
| Offline | 🟡 40% | İndirme motoru var, veri paketlenmemiş |
| PWA | ✅ 65% | Pairing/remote/theme-studio prod'da |
| Web Panel | 🟡 50% | Supabase-bağlı; settings placeholder, rapor yok |
| Firebase | 🟡 | FCM push gerçek; başka Firebase servisi yok |
| Supabase | ✅ 65% | RLS/RPC/realtime/migrations gerçek |
| Android/Head Unit | 🟡 60% | Native plugin zengin; head-unit fragmantasyonu |
| Performans | 🟡 65% | DeviceTier/adaptive/thermal/JIT; düşük-uçta ~7fps |
| Güvenlik | ✅ 75% | AES-256-GCM, ECDH E2E, PIN, zero-trust |
| Test | ✅ 70% | 152 unit + 11 e2e + regresyon kasası + CI |
| CI/CD | 🟡 45% | lint→test→build; **APK build/e2e/deploy yok** |
| Analytics | 🔴 20% | Custom telemetry var; ürün-analitiği yok |
| Crash Reporting | 🔴 25% | crashLogger + remoteLog; **APM/Crashlytics yok** |
| Monitoring | 🔴 25% | Superadmin panel var; filo-ölçek gözlem yok |
| Localization | 🟡 30% | i18next kurulu, içerik Türkçe-only |
| Accessibility | 🟡 40% | Web WCAG düzeltildi; araç-app a11y sınırlı |
| Plugin sistemi | 🔴 0% | Yok |
| OTA | 🟡 45% | v1 var; telemetri/managed-channel yok |
| Araç profilleri | ✅ 60% | vehicleProfileService/vehicleIdentity gerçek |
| OEM entegrasyonları | 🔴 5% | Aftermarket-only; OEM SDK yok |
| Akıllı bakım | ✅ 55% | maintenanceBrain/maintenanceService gerçek |
| Tahmine dayalı bakım | 🟡 35% | Digital-twin/prediction vizyonu var, sığ |
| Sürücü güvenliği | 🟡 55% | safetyService/reverse/radar/hazard gerçek; DMS yok |
| Enerji yönetimi | 🟡 30% | EV telemetri var; enerji-optimizasyon UI yok |
| EV desteği | 🟡 40% | Veri modeli var; şarj ekranı/planlama yok |
| Android Auto/CarPlay | 🔴 0% | Projeksiyon entegrasyonu yok |
| Sesli asistan | ✅ 60% | Offline Vosk + companion; olgunluk sınırlı |
| Widget sistemi | 🟡 40% | Sabit home widget'ları; kullanıcı-kompoze yok |
| API | 🔴 10% | Yalnız iç Next uçları |
| SDK | 🔴 0% | Yok |
| Developer Platform | 🔴 0% | Yok |
| Marketplace | 🔴 0% | Yok |
| Tema sistemi | ✅ 70% | Çoklu tema + Theme Studio + layout motoru |
| Yedekleme | 🔴 20% | Cihaz-içi key yedek; bulut backup yok |
| Senkronizasyon | 🔴 25% | Realtime var; ayar/profil bulut-sync yok |
| Veri gizliliği | 🟡 45% | RLS/zero-leak; KVKK/consent akışı yok |

---

## 4) TAM BİTMEYEN ÖZELLİKLER

- **UI hazır / backend eksik:** dashboard/settings, filo raporları, alert paneli (mock fallback), sürücü skoru ekranı.
- **Backend hazır / UI eksik:** OTA telemetri, geofence olayları (kısmen), bakım verisi (panelde yok).
- **Mock çalışan:** `GeofenceAlertsPanel` (Supabase yoksa), OBD mock (env-gated, prod kapalı).
- **Demo çalışan:** MockDashboard (web görsel), bazı superadmin simülatörleri (ChaosSimulator).
- **Araç-bağımlı çalışan:** CAN sinyalleri (kapı/far), yakıt (raw-CAN), EV telemetri, TPMS (görsel-only).
- **Riskli kod:** debug adb/port 8899 bayrakları, SAB pasif entegrasyon, migration history boşlukları.
- **Refactor gerekli:** 4+ donanım-tespit birleştirmesi (kısmen yapıldı), offline veri pipeline (üretim script'i ayrı), i18n içerik ekstraksiyonu.
- **Production-hazır DEĞİL:** OTA managed-channel, crash-reporting, enterprise rapor/API, offline routing verisi, KVKK akışı, satış-öncesi debug bayrak temizliği.

---

## 5) 15 YILLIK YOL HARİTASI (fazlar)

> Her faz: **Amaç · Hedef · Kullanıcı katkısı · Teknik gereksinim · Riskler · Bağımlılık · Zorluk**

### Faz 1 (0–6 ay) — DÜRÜSTLÜK & PRODUCTION SAĞLAMLIK
- **Amaç:** Vaat↔ürün yalanını kapat, satılabilir sağlam çekirdek.
- **Hedef:** `WEB_URUN_UYUM_BACKLOG` P0'ları; debug bayrak temizliği; migration history; cihaz-doğrulama turu.
- **Katkı:** Güven; satışa uygun dürüst ürün.
- **Teknik:** DTC 37↔metin hizası, TPMS etiketle, enterprise metin hizası, adb/8899 kaldır, ledger 🔴→🟢.
- **Riskler:** Kapsam kayması. **Bağımlılık:** yok. **Zorluk:** Düşük-Orta.

### Faz 2 (6–12 ay) — GÖZLEMLENEBİLİRLİK & OTA
- **Amaç:** Sahadaki filoyu görebilmek + güvenli güncelleme.
- **Hedef:** 3. taraf crash-reporting/APM (self-host: Sentry/GlitchTip), OTA managed-channel + telemetri, ürün analitiği.
- **Katkı:** Hataları kullanıcıdan önce görmek; hızlı düzeltme.
- **Teknik:** remoteLog→APM köprüsü, ota_event pipeline, privacy-safe event şeması.
- **Riskler:** Head unit'lerde Play Services yokluğu. **Bağımlılık:** Faz 1. **Zorluk:** Orta.

### Faz 3 (12–18 ay) — OFFLINE & NAVİGASYON TAMAMLAMA
- **Amaç:** "Çevrimdışı-öncelikli" vaadini gerçek yap.
- **Hedef:** routing-graph üretim pipeline'ı + bölge paketleme, offline POI, offline TR haritası ön-paketli.
- **Katkı:** İnternetsiz gerçek navigasyon (head unit'lerin çoğu SIM'siz).
- **Teknik:** osmium/graph-exporter CI job, tile/graph CDN + indirme UX, DR iyileştirme.
- **Riskler:** Depolama/lisans (ODbL atıf). **Bağımlılık:** Faz 2 (dağıtım). **Zorluk:** Orta-Yüksek.

### Faz 4 (18–30 ay) — ENTERPRISE/FİLO GERÇEK
- **Amaç:** Kurumsal vaatleri koda çevir.
- **Hedef:** Filo raporları + PDF, sürücü puanlama, yakıt maliyet, 90-gün retention, bakım→panel, alert (mock kaldır).
- **Katkı:** Ödeyen kurumsal müşteri.
- **Teknik:** trip→Supabase sync, rapor motoru, retention job, RLS multi-tenant.
- **Riskler:** Multi-tenant veri izolasyonu. **Bağımlılık:** Faz 2. **Zorluk:** Yüksek.

### Faz 5 (2.5–4 yıl) — PLATFORM: API + SDK + i18n
- **Amaç:** Kapalı üründen açık platforma.
- **Hedef:** Public REST API + token, çok-dilli içerik (i18next ekstraksiyon), developer dokümanı.
- **Katkı:** Entegrasyon (yedek parça/servis), global pazar.
- **Teknik:** API gateway, string ekstraksiyon + çeviri boru hattı, versiyonlama.
- **Riskler:** API güvenliği/rate-limit. **Bağımlılık:** Faz 4. **Zorluk:** Yüksek.

### Faz 6 (4–6 yıl) — EKOSİSTEM: Plugin + Marketplace + Tema pazarı
- **Amaç:** 3. tarafların üzerine inşa edebileceği katman.
- **Hedef:** Güvenli plugin runtime (izole), marketplace, imzalı eklentiler.
- **Katkı:** Ağ etkisi; OEM/geliştirici çekimi.
- **Teknik:** Sandbox/izin modeli, imza doğrulama, review pipeline.
- **Riskler:** Güvenlik yüzeyi. **Bağımlılık:** Faz 5 (SDK). **Zorluk:** Çok Yüksek.

### Faz 7 (5–8 yıl) — OEM & FONKSİYONEL GÜVENLİK
- **Amaç:** OEM'e beyaz-etiket girebilmek.
- **Hedef:** ISO 26262 (ASIL-B hedef), UN R155/R156 siber uyum, OEM SDK, deterministik güvenlik katmanı.
- **Katkı:** Fabrika-hattı entegrasyonu; ölçek sıçraması.
- **Teknik:** Güvenlik-kritik yolu ayır (hard-real-time), sertifikasyon süreci, denetim izi.
- **Riskler:** Maliyet/süre çok yüksek; ekip yetkinliği. **Bağımlılık:** Faz 1-6. **Zorluk:** Aşırı.

### Faz 8 (7–10 yıl) — TAHMİNE DAYALI ZEKÂ & DMS
- **Amaç:** "8 Kapı" vizyonunu tam gerçekleştir.
- **Hedef:** Digital Twin + predictive maintenance, sürücü izleme (DMS kamera), edge-LLM copilot.
- **Katkı:** Arıza öncesi uyarı, güvenlik, kişisel asistan.
- **Teknik:** On-device model runtime, sensör füzyonu, gizlilik-öncelikli veri.
- **Riskler:** Donanım/gizlilik. **Bağımlılık:** Faz 2 (veri), Faz 5. **Zorluk:** Çok Yüksek.

### Faz 9 (9–12 yıl) — BAĞLANTILI ARAÇ & V2X
- **Amaç:** Araçlar arası + altyapı bağlamı.
- **Hedef:** V2X sinyalleri, akıllı şarj/V2G (EV), topluluk trafik/hazard ağı.
- **Zorluk:** Aşırı; standart/regülasyon bağımlı.

### Faz 10 (12–15 yıl) — SDV & OTONOM-HAZIR KATMAN
- **Amaç:** Software-defined vehicle çağına uyum.
- **Hedef:** Zonal mimariye köprü, ADAS-hazır HMI, sürekli-teslimat OTA, veri-egemenliği.
- **Zorluk:** Aşırı; sektör dönüşümüne bağlı.

---

## 6) DÜNYA STANDARTLARIYLA KARŞILAŞTIRMA (CAROS eksikleri)

| Rakip | CAROS'un onda olup CAROS'ta OLMAYAN |
|---|---|
| **Tesla** | OTA-at-scale, uçtan-uca OEM entegrasyon, ADAS/otonom, uygulama-in-house ekosistem, süper-şarj/enerji ağı |
| **Android Automotive (AAOS)** | Uygulama ekosistemi (Play), Google Assistant, sertifikalı OEM entegrasyon, sistem-seviyesi API'ler |
| **Android Auto (projeksiyon)** | Telefon projeksiyonu, geniş uygulama uyumu, kablosuz bağlantı |
| **Apple CarPlay** | Ekosistem, Siri, iPhone entegrasyonu, UX tutarlılığı/sertifikasyon |
| **AOSP Automotive** | Alt-katman OS kontrolü, VHAL (Vehicle HAL) standardı, multi-display |
| **MBUX (Mercedes)** | Olgun sesli asistan, doğal dil, premium HMI, derin araç kontrolü |
| **BMW iDrive** | Donanım-yazılım eşleşmesi, gesture, jenerasyonel olgunluk |
| **Volvo (AAOS)** | Güvenlik-odak, OEM güven, sertifikasyon |
| **Rivian** | Dikey entegrasyon, kendi SDV mimarisi, OTA |
| **NIO** | NOMI asistan, batarya-değişim ekosistemi, topluluk |
| **Xiaomi Auto** | Donanım-ekosistem entegrasyonu (IoT), ölçek |
| **Huawei HarmonyOS** | Dağıtık cihaz ekosistemi, kendi çekirdek/OS, ölçek |
| **OpenAuto Pro** | Olgun AA/CarPlay projeksiyon (bu CAROS'ta hiç yok) |

**CAROS'un TEK üstünlüğü (kimsede yok):** **marka-agnostik aftermarket zekâ** — bilinmeyen
araçları öğrenip eski/OEM-dışı devasa araç parkına akıllı cockpit getirmek. Strateji bunu
büyütmeli; OEM'lerle kafa kafaya HMI yarışına girmek değil.

---

## 7) GELECEĞİN TEKNOLOJİLERİ (15 yıl) — CAROS'a eklenmeli mi?

| Teknoloji | Eklenmeli? |
|---|---|
| Software-Defined Vehicle (SDV) / zonal mimari | ✅ Uzun vade zorunlu (Faz 10) |
| Edge/on-device LLM copilot | ✅ Vizyonla birebir (Faz 8) |
| ADAS entegrasyon / sensör füzyonu | 🟡 Aftermarket sınırlı; HMI tarafı evet |
| DMS (sürücü izleme kamerası) | ✅ Güvenlik farklılaştırıcı (Faz 8) |
| V2X / V2G | 🟡 Standart olgunlaşınca (Faz 9) |
| OTA-everything + sürekli teslimat | ✅ Zorunlu (Faz 2) |
| Siber güvenlik (UN R155/R156) | ✅ OEM için zorunlu (Faz 7) |
| Fonksiyonel güvenlik (ISO 26262) | ✅ OEM için zorunlu (Faz 7) |
| Dijital twin / predictive maintenance | ✅ Çekirdek vizyon (Faz 8) |
| AR-HUD | 🟡 Donanım bağımlı |
| Biyometrik / kişiselleştirme profil bulutu | ✅ (Faz 5-8) |
| EV akıllı şarj / rota-menzil planlama | ✅ (Faz 3-4) |
| Generatif AI cockpit asistanı | ✅ Zaten companion temeli var |
| Veri gizliliği / egemenlik (KVKK/GDPR) | ✅ Zorunlu (Faz 1-5) |
| Blockchain/araç-cüzdan | ❌ Şimdilik gereksiz |

---

## 8) NİHAİ HEDEF — "Head Unit'lerin Tesla'sı" için OLMAZSA OLMAZLAR

1. **Sahada gözlemlenebilirlik** (crash/APM/analytics) — bugün yok.
2. **OTA-at-scale, managed, güvenli** — bugün sideload.
3. **Fonksiyonel güvenlik + siber uyum** (ISO 26262 / R155 / R156) — bugün yok.
4. **Çok-dilli, global-hazır** — bugün Türkçe-only.
5. **Uygulama ekosistemi (SDK + plugin + marketplace)** — bugün monolit.
6. **Bulut backend ölçeği + multi-tenant + veri egemenliği** — kanıtlanmadı.
7. **OEM SDK / beyaz-etiket** — yok.
8. **Gerçek offline-öncelik** (veri paketli) — veri yok.
9. **Sertifikalı güvenilirlik** (MTBF, saha kütüğü, fail-soft kanıtı) — kısmi.
10. **Kanıtlanmış cihaz-doğrulama** (test-yeşil ≠ çalışır) — ledger açığı kapatılmalı.

---

## 9) GERÇEK ÜRÜN OLGUNLUĞU (yüzde)

| Alan | % | Gerekçe (kod) |
|---|---|---|
| Araç Uygulaması | **68** | Zengin, gerçek; cihaz-doğrulama açığı + araç-bağımlılık |
| OBD | **65** | Gerçek okuma; yakıt PID kaldırıldı |
| CAN | **50** | Gerçek ama head-unit-özel, bit belirsiz |
| AI | **52** | Companion BYOK + Vosk; DTC 37 |
| Navigasyon | **58** | Render/tünel gerçek; offline routing verisi yok |
| Web | **50** | Supabase gerçek; rapor/API/settings eksik |
| PWA | **63** | Prod'da; theme-studio/remote gerçek |
| Enterprise | **25** | RBAC var; rapor/skor/API/retention yok |
| Offline | **38** | Motor var, veri yok |
| Güvenlik | **72** | AES-256-GCM/ECDH/PIN/RLS; sertifika yok |
| Performans | **62** | Adaptive/thermal/JIT; düşük-uç zorlanıyor |
| Mimari | **58** | Sofistike ama SAB pasif, entegrasyon yarım |
| Test | **68** | 152 unit + 11 e2e + CI; APK/e2e-CI yok |
| **Production Readiness** | **40** | Debug bayrak, ledger 🔴, crash-reporting yok, migration boşluk |
| **GENEL ÜRÜN** | **~52** | Güçlü bireysel çekirdek; kurumsal/global/ekosistem katmanı ham |

---

## 10) ACIMASIZ ÖZET

CAROS PRO, bir kişinin/küçük ekibin ürettiği **olağanüstü hırslı ve teknik olarak
etkileyici** bir bireysel araç-cockpit yazılımı. Kripto, offline STT, adaptive performans,
zero-trust telemetri gibi alanlarda **gerçekten ileri**. **Ama bugün "araç işletim sistemi"
değil, çok yetenekli bir launcher+asistan.**

"Head Unit'lerin Tesla'sı" olmak için eksik olan şey **özellik değil, platform disiplinidir:**
gözlemlenebilirlik, OTA-ölçek, fonksiyonel güvenlik, çok-dillilik, ekosistem (SDK/plugin),
multi-tenant backend ve **pazarlamayı ürünün gerisinde tutma dürüstlüğü**. Genel olgunluk
**~%52** — güçlü bir çekirdek, ham bir platform.

**En kritik tek gerçek:** Kod kalitesi vizyona yetişiyor; **süreç ve ölçek altyapısı
yetişmiyor.** 15 yıl yaşayacaksa sıradaki savaş yeni özellik değil — **gözlemlenebilirlik,
güvenlik-sertifikasyonu ve ekosistem.** Faz 1-2 (dürüstlük + gözlemlenebilirlik) bugün
başlamazsa, üstüne konan her özellik görülemeyen bir zeminde birikir.

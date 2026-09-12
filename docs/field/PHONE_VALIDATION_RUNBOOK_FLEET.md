# TELEFON DOĞRULAMA RUNBOOK — FİLO / ÇEVRİMDIŞI / SAHİPLİK DEVRİ

**Tarih:** 2026-07-29 · **Kapsam:** Android telefon (head unit DEĞİL)
**Sözleşme kaynağı:** `website/src/lib/validation/phoneValidationScenarios.ts`
**Kilit testleri:** `website/src/__tests__/phoneValidationContract.test.ts`

---

## 🔴 BU BELGE NE DEĞİLDİR

Bu **head unit doğrulaması değildir.** Aşağıdaki senaryolar telefonda koşulsa
bile şu kararlar **YASAKTIR**: `OEM_VALIDATED` · `HEAD_UNIT_VALIDATED` ·
`PRODUCTION_READY` · `FLEET_OFFLINE_COMPLETE`.

Sözleşme bunu makine düzeyinde zorlar: `validateRun()` head-unit gerektiren bir
senaryoya `PASS` yazılmasını **reddeder** (`HEAD_UNIT_REQUIRED`), ve kanıtsız
`PASS` kabul edilmez (`EVIDENCE_MISSING`). Bu kurallar testle kilitlidir.

**Şu an durum: hiçbir senaryo koşulmadı → `phoneValidated = false`.**
Bu belge koşum için hazırlık; sonuç değil.

---

## 0. Ön hazırlık

| Gereksinim | Not |
|---|---|
| Android telefon | Chrome / PWA kurulabilir |
| İki test hesabı | A ve B — P6, P10, P11, P12 için ZORUNLU |
| Bir şirket + en az iki üye | admin + member/observer |
| En az iki araç | biri bireysel, biri şirket |
| Yerel/staging backend | **production KULLANILMAZ** |
| CAROS LAB erişimi | `/dashboard/fleet/lab` |

> ⚠️ Gerçek kullanıcı verisi kullanılmaz. Test hesapları ve test araçları şart.

### Ölçüm noktaları

Neredeyse tüm kanıtlar tek ekrandan okunur: **`/dashboard/fleet/lab`**
(salt-okunur; hiçbir işlem tetiklemez). Paneller:

- **Çevrimdışı Kuyruk** — boyut, engellenen, çakışma, bozuk kayıt
- **Hesap İzolasyonu & Kuşak** — hesap bağı, yabancı hesap reddi, şema reddi,
  senkron kuşağı, bayat sonuç reddi
- **Realtime & Boşluk Tespiti** — durum, kuşak, revizyonlar, boşluk sayaçları,
  eşitleme denemesi/başarısı, bayat olay reddi
- **Çevrimdışı Politika** — hangi işlem çevrimdışı yapılabilir

---

## 1. Senaryolar (P1–P15)

Her senaryo için: **ön koşul → adımlar → beklenen → YASAKLI → kanıt**.
Yasaklı olaylardan biri gözlenirse senaryo **FAIL**'dir; "büyük ölçüde çalıştı"
diye PASS yazılmaz.

### P1 — Çevrimdışı düşük riskli güncelleme kuyruğa alınır
1. Uçak modunu aç.
2. Filo adını değiştir.
3. `/dashboard/fleet/pending` aç.

**Beklenen:** bildirimde **"Sunucu onaylayana kadar tamamlanmış sayılmaz"**;
bekleyen sayısı +1. **YASAK:** "Kaydedildi"/"Tamamlandı" yazması.
**Kanıt:** `UI_TEXT` + `LAB_SNAPSHOT`.

### P2 — Çevrimdışı güvenlik işlemi REDDEDİLİR
1. Uçak modunu aç.
2. Bir üyenin rolünü değiştirmeyi dene.
3. Sahiplik devri başlatmayı dene.

**Beklenen:** **"Bu işlem için internet bağlantısı gerekli"**.
**YASAK:** bekleyen sayısının artması, işlemin kaydedilmiş görünmesi.
**Kanıt:** `UI_TEXT` + `LAB_SNAPSHOT`.

### P3 — Reconnect'te senkron TEK KEZ çalışır
1. Kuyrukta bekleyen işlemle uçak modunu kapat.
2. Uygulamayı öne al, LAB'ı yenile.

**Beklenen:** işlem sunucuda **bir kez** uygulanmış.
**YASAK:** aynı işlemin sunucuda iki kez görünmesi.
**Kanıt:** `LAB_SNAPSHOT` + `SERVER_STATE`.

### P4 — Revizyon boşluğu TESPİT EDİLİR
1. Uçak modunu aç.
2. **Başka bir cihazdan** filoda 2–3 değişiklik yap.
3. Uçak modunu kapat, LAB · Realtime oku.

**Beklenen:** `Boşluk şüphesi` ve `Doğrulanmış boşluk` artar; `Son boşluk sebebi` dolu.
**YASAK:** snapshot alınmadan `LIVE` olunması.
**Kanıt:** `LAB_SNAPSHOT`.

### P5 — Uzlaştırma bitmeden "güncel" DENMEZ
Ağı kes/aç, ara durumları gözle.
**Beklenen:** `SUSPECTED_GAP → RESYNCING → RECONCILING → LIVE`.
**YASAK:** `RESYNCING` sırasında "Canlı — veriler güncel".
**Kanıt:** `LAB_SNAPSHOT` + `SCREENSHOT`.

### P6 — Hesap izolasyonu
A ile çevrimdışı işlem sırala → çıkış → B ile gir.
**Beklenen:** B'de bekleyen 0; LAB'da **"Kuyruk hesap kapsamına bağlı = EVET"**.
**YASAK:** A'nın işleminin B'de görünmesi.
**Kanıt:** `LAB_SNAPSHOT` + `SCREENSHOT`.

### P7 — Çıkışta aktif senkron iptal
Senkron başlarken çıkış yap, yeniden gir.
**Beklenen:** `Bayat sonuç reddi` artar; yeni oturum temiz.
**YASAK:** çıkıştan sonra kuyruk durumunun değişmesi.

### P8 — Süreç ölümünden sonra güvenli yükleme
Uygulamayı zorla kapat, yeniden aç.
**Beklenen:** kesintiye uğrayan işlem yeniden denenebilir durumda.
**YASAK:** "başarılı" sayılması veya kuyruğun sessizce boşalması.

### P9 — Bozuk kayıt karantinası
`caros.fleet.queue.*` değerini boz, uygulamayı aç.
**Beklenen:** `Bozuk kayıt (karantina)` artar; uygulama **çökmez**.

### P10 — Üyelik kaldırılınca temizlik
Member filoyu görüntülerken admin onu çıkarsın.
**Beklenen:** filo araçları listelenmez, dürüst bilgilendirme.
**YASAK:** eski araçların görünmeye devam etmesi, komut butonlarının aktif kalması.

### P11 — Devir sonrası eski sahibin önbelleği
A devri başlat → B kabul et → A'da yenile.
**Beklenen:** A'da araç yok/düzenlenemez; sunucuda eski `vehicle_pairings` kaydı **yok**.
**YASAK:** A'nın aracı düzenleyebilmesi veya konumunu görebilmesi.
**Kanıt:** `SCREENSHOT` + `SERVER_STATE` + `LAB_SNAPSHOT`.

### P12 — Bayat realtime bildirimi
A ile bağlan, hızlıca B'ye geç.
**Beklenen:** `Bayat olay reddi` artar.
**YASAK:** B ekranında A'nın aracının belirmesi (bir an bile).

### P13 — Reconnect fırtınası sınırlı
Uçak modunu 10 kez hızlıca aç/kapat.
**Beklenen:** `Eşitleme denemesi` artar ama **sınırlı**; arayüz donmaz.
**YASAK:** sınırsız artış, uygulamanın yanıt vermemesi.

### P14 — LAB gizliliği
LAB'daki tüm panelleri oku.
**YASAK (herhangi biri FAIL'dir):** e-posta · eşleştirme kodu · transfer anahtarı ·
araç konumu · ham payload · tam kullanıcı kimliği.
**Kanıt:** `SCREENSHOT`.

### P15 — Çakışma dürüstlüğü
Çakışma üret, `/dashboard/fleet/conflicts` aç.
**Beklenen:** düz Türkçe açıklama; seçenekler arasında **"zorla devral" YOK**.
**YASAK:** ham SQL/teknik hata metni.

---

## 2. Head unit gerektiren alanlar (BLOCKED — telefonda PASS YAZILAMAZ)

| # | Alan |
|---|---|
| H1 | Kontak (ignition) yaşam döngüsü |
| H2 | Head-unit süreç yönetimi ve önbellek davranışı |
| H3 | Üretici WebView / Android sürüm farklılıkları |
| H4 | Araç içi ağ değişimleri (OEM modem/hotspot) |
| H5 | Fiziksel cihaz eşleştirme (araçta kod üretimi) |
| H6 | Düşük donanım (Mali-400) altında filo ekranı performansı |
| H7 | Direksiyon tuşları / araç komut entegrasyonu |
| H8 | Gerçek sürüş sırasında çevrimdışı→çevrimiçi geçişi |

Bunlar `BLOCKED_HEAD_UNIT` olarak kaydedilir. `PASS` yazma girişimi
sözleşme tarafından reddedilir.

---

## 3. Sonuç kaydı

Kayıt **makine tarafından doğrulanır**; üç kapı vardır ve üçü de testle kilitli:

| Kapı | Reddetme kodu |
|---|---|
| Bilinmeyen senaryo | `UNKNOWN_SCENARIO` |
| Head-unit senaryosuna PASS | `HEAD_UNIT_REQUIRED` |
| Eksik kanıt türü | `EVIDENCE_MISSING` |
| **Cihaz bağlamı eksik** | `DEVICE_CONTEXT_MISSING` |

```ts
import {
  getValidationCollector, type ScenarioRun,
} from '@/lib/validation/phoneValidationScenarios';

const run: ScenarioRun = {
  scenarioId: 'P1',
  result: 'PASS',
  evidence: ['UI_TEXT', 'LAB_SNAPSHOT'],     // senaryonun istediği TÜM türler
  note: 'bildirimde "tamamlanmış sayılmaz" ibaresi görüldü',
  device: {                                   // PASS için ZORUNLU
    model: 'Xiaomi 22101316G',
    androidVersion: '13',
    appBuild: 'local-<git-sha>',
  },
  startedAt: Date.now(),
  completedAt: Date.now(),
  observedEvents: ['kuyruğa COMPANY_UPDATE eklendi'],
  observedUi: ['Sunucu onaylayana kadar tamamlanmış sayılmaz'],
  evidenceRef: 'evidence/P1-lab.png',
};

getValidationCollector().record(run);   // geçersizse EKLENMEZ, sebebi döner
```

`summarize(runs)` yalnız **15/15 kanıtlı + cihaz bağlamlı PASS** olduğunda
`phoneValidated: true` döner. Tek bir `NOT_RUN` bile varsa `false` —
"çoğu geçti" doğrulama sayılmaz.

### Her senaryo için doldurulacak alanlar

`scenarioId · device.model · device.androidVersion · device.appBuild ·
startedAt · completedAt · preconditions (runbook'tan) · actual steps ·
expectedEvents (sözleşmeden) · observedEvents · expectedUi · observedUi ·
evidence (tür listesi) · evidenceRef · result · failureCode · note`

### LAB'da görünen

`/dashboard/fleet/lab` → **Telefon Doğrulama** paneli: toplam · geçen ·
düşen · koşulmayan · bloklu · kanıt eksiksizliği · son derleme.
**Cihaz modeli, Android sürümü, not ve kanıt dosya yolu LAB'a TAŞINMAZ**
(`toLabExport` redaksiyon uygular; testle kilitli).

---

## 4. Yerel derleme (yayın YOK)

```bash
# Web/PWA yolu — telefonda tarayıcıdan açılır
cd website && npm run build && npm run start   # yerel sunucu

# Derleme kimliği (device.appBuild alanına yazılacak)
git rev-parse --short HEAD
```

Bu runbook **yayın yapmaz**: APK/AAB üretimi, store yüklemesi ve
production'a bağlanma kapsam **dışıdır**. Backend olarak yalnız yerel/geçici
ortam kullanılır; production'a bağlanılırsa senaryo `BLOCKED_STAGING`
olarak işaretlenir, PASS yazılmaz.

---

## 5. Şu anki sonuç

**Hiçbir senaryo koşulmadı.** `phoneValidated = false`,
`lastBuild = null`, 15 senaryo `NOT_RUN`.

Bu belge koşum için hazırlıktır; sonuç değildir. Telefon erişimi olan
oturumda P1–P15 koşulup kanıt toplanana kadar **`PHONE_VALIDATED` yazılamaz**.

# 🚗 NAV-CORE-P0 — SÜRÜŞ GÜNÜ CHECKLIST (tek sayfa)

> Kural: **ölçülmeyen PASS yazılmaz.** Her senaryo kendi kaydını üretir.
> Kayıt yoksa sonuç `NOT_RUN`'dır.

## 0 · KALKIŞ ÖNCESİ (5 dk, araç durur hâlde)

```bash
adb devices                                    # cihaz görünüyor mu
adb shell dumpsys package com.cockpitos.pro | findstr lastUpdateTime
```
- [ ] `lastUpdateTime` **bugünkü** build mi? Değilse **DUR** → yeniden kur (aşağıda).
- [ ] Telefon şarjda, ekran uyku kapalı, mobil veri **açık**.
- [ ] OBD bağlı (P0-5 hız yorumu için) — bağlı değilse kaydet, GPS hızı kullanılacak.

```bash
adb shell pidof com.cockpitos.pro                       # <PID>
adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
```
- [ ] CAROS LAB → **Araç → Navigation Core** açılıyor mu?
- [ ] Hüküm **NAVİGASYON YOK**, `Yerel OSRM hazırlığı` = *YEREL OSRM YOK (bir daha denenmez)*.

**Taze kurulum gerekirse:**
```bash
set NODE_ENV=development & set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
npm run test && npm run build && npm run compat:verify && npx cap sync android
node scripts/gradle-build.mjs clean assembleDebug
adb install -r C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk
```

---

## 1 · HER SENARYODA

```bash
node scripts/nav-field-record.mjs P0-1        # sür → Ctrl+C
node scripts/nav-field-analyze.mjs field-runs/nav-P0-1-<zaman>.jsonl
```
Kaydedici **hedef seçmeden ÖNCE** başlatılır, senaryo bitince durdurulur.

---

## 2 · SENARYOLAR (öncelik sırasıyla)

### ⭐ P0-1 — YENİDEN ROTA *(en kritik, ilk bunu yap)*
- [ ] Hedef seç → navigasyonu başlat → **ilk dönüşü bilerek kaçır** (güvenli yerde)
- [ ] Ölç: `Sapma → ilk yeni talimat` **≤ 12 sn** → PASS
- [ ] Ayrıca: `Reddedilen bayat yanıt` **artmamalı**, `Bastırılan tekrar` **< 3**
- [ ] Yeni rota konuşulmaya başladı mı? (eski rotanın sesi susmalı)

### ⭐ P0-2 — VARIŞ *(3.6× birim düzeltmesinin TEK kanıtı)*
- [ ] Hedefe kadar git, **son 100 m'yi yavaş** ilerle
- [ ] **ARRIVED tetiklendiği MESAFEYİ not et** — ayırt edici budur:
  - **~20 m'de tetiklendi** → birim düzeltmesi **çalışıyor** (soft trigger)
  - **yalnız <5 m'de tetiklendi** → soft trigger bloke; sebep **hayalet hız (#362)**, birim düzeltmesi değil
  - **hiç tetiklenmedi** → `FAIL`
- [ ] 5 sn sonra navigasyon otomatik kapandı mı? ETA sıfırlandı mı?

### P0-3 — MAP MATCHING
- [ ] Servis yolu / paralel yol olan bölgede sür
- [ ] `MATCHED oranı` **≥ %95** · `yanal medyan` **< 15 m** · `JUMP_REJECTED` düz yolda **0**
- [ ] Araç servis yoluna **atlamamalı** (LAB'da `mm-state` = EŞLEŞTİ kalmalı)

### P0-4 — YAKIN MANEVRALAR
- [ ] 100–200 m arayla iki dönüşü olan rota
- [ ] `YOL-BOYU oranı` **≥ %95** · `çapa çözülemeyen` **0** · `adım GERİ gitti` **0**
- [ ] İkinci yönlendirme zamanında geldi mi? Aynı manevra **iki kez söylenmemeli**

### P0-5 — DÜŞÜK HIZ TRAFİK
- [ ] 0–10 km/h'de ilerle
- [ ] `bu sırada YENİ rota` **0** olmalı · ETA sıçraması olmamalı
- [ ] ⚠️ **#362 hayalet hız** bu senaryoyu kirletir — LAB'da `hız` alanı 0 km/h'de
      sıçrıyorsa kaydet, sonucu ona göre yorumla

---

## 3 · SÜRÜŞ SIRASINDA GÖZLE (LAB'a bakmadan)
- [ ] Anons **erken** mi geliyor? ("daha 50 m var" hissi) → P0-4 kusuru
- [ ] Şerit paneli çıkıyor mu? **Çıkıyorsa** gerçek şerit verisi var demektir (not al)
- [ ] Dönel kavşakta **"N. çıkıştan ayrılın"** duyuldu mu, yoksa genel ifade mi?
- [ ] Rota **saçma bir yerden** başladı mı? (ters şeride yapışma → `EARLY_UTURN`)

---

## 4 · DÖNÜŞTE (araç durduktan sonra)
- [ ] LAB → Navigation Core → **TÜMÜNÜ KOPYALA** → her senaryo için ayrı kaydet
- [ ] Ekran görüntüsü: `adb exec-out screencap -p > docs/evidence/<senaryo>.png`
- [ ] `nav-field-analyze.mjs` çıktılarını `docs/archive/REAL_VEHICLE_VALIDATION_REPORT.md`'ye işle
- [ ] Kütük **#364–#372** maddelerini 🔴 → 🟢 / ❌ olarak taşı (kanıtla birlikte)

---

## 5 · GÜVENLİK
- Sürüş sırasında **telefona dokunma** — tüm ölçüm otomatik toplanıyor.
- Dönüş kaçırma senaryosu **trafiği tehlikeye atmayacak** bir yerde yapılır.
- Kayıt dosyası **ham koordinat içerir** (kişisel veri) — paylaşmadan önce temizle.

---

## 6 · KAYIT ALINAMAZSA
| Belirti | Yapılacak |
|---|---|
| `__CAROS_NAV_FIELD__ yok` | dev build değil → §0'daki taze kurulumu yap |
| CDP bağlanmıyor | `adb forward` PID'i değişmiştir → `pidof` ile yenile |
| Kaydedici hata döngüsü | uygulama yeniden başlamıştır → kaydediciyi yeniden başlat |
| LAB kartı açılmıyor | `VITE_ENABLE_DEBUG_PANEL=true` yok → `.env.production.local` kontrol |

> **En kötü durumda bile:** LAB sayaçları oturum boyunca birikir. Kaydedici
> çalışmasa dahi sürüş sonunda LAB → **TÜMÜNÜ KOPYALA** kısmi kanıt üretir.

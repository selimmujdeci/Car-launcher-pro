# CarOS Pro — PROJECT MEMORY (uzun vadeli mimari kararlar)

> Buraya yalnız **kalıcı kararlar ve tradeoff'lar** yazılır. Oturum özeti YAZILMAZ
> (o `SESSION.md`'dedir). Her karar: **Ne + Neden + Tradeoff** formatında.

---

## Neden Zero-Trust Telemetry

**Ne:** Hiçbir aftermarket sinyal doğru varsayılmaz; her sinyal confidence + kanıt ister.
**Neden:** Tesla yalnız kendi aracını tanır (garantili OEM verisi). Biz yüzlerce bilinmeyen
marka/modeli öğreniriz → veri güvenilmez. Yanlış sinyalle karar vermek, hiç karar vermemekten kötü.
**Tradeoff:** Daha çok "unknown" durumu; UI'da eksik gösterim riski. Kabul: eksik ama doğru > dolu ama yanlış.

---

## Neden Fail-Closed Ignition

**Ne:** Ignition kaynağı yoksa `ignitionConfirmed = null`; RPM/voltaj/OBD'den kontak ÇIKARSANMAZ.
**Neden:** Yanlış "kontak açık" varsayımı aktif tarama/sorgu tetikleyip aracı/ECU'yu rahatsız edebilir,
batarya çeker, güvenlik riski doğurur. Kanıtsız aktifleşme zero-trust'ı bozar.
**Tradeoff:** Gerçek ignition kaynağı bağlanana dek aktif fazlar `waiting_for_ignition`'da bloke.
Kabul: aktivasyon gecikmesi < yanlış aktivasyon riski.

---

## Neden Platform Core aşamalı (foundation → wiring → aktivasyon)

**Ne:** Deep Scan / Capability / HAL / Event Bus önce PASİF foundation olarak eklendi (#44–#52),
sonra runtime wiring ile boot'a bağlandı (W2–W5), aktivasyon en sona bırakıldı.
**Neden:** Big-bang aktivasyon stabilite invaryantlarını (fail-soft, zero-leak) tek seferde riske atar.
Her katman izole + test edilebilir + geri alınabilir olmalı (Atomic PR + No Big Bang).
**Tradeoff:** Çok sayıda PR + uzun aktivasyon zinciri. Kabul: kontrollü evrim > hızlı ama kırılgan.

---

## Neden EventBus tek sahipli singleton

**Ne:** Tek `appEventBus`; bus'ın kendi start/stop API'si YOK, Kernel DI ile `publisher` olarak TÜKETİR.
**Neden:** İki bus = sessiz veri kaybı (publish sessizce null'a düşer, abone hiç görmez). Owner ≠ consumer
ayrımı, sahipliğin tek yerde kalmasını garanti eder. Boot başına tek bus doğrulandı.
**Tradeoff:** DI kablolaması karmaşık. Kabul: sessiz kayıp riskini sıfırlar.

---

## Neden Ownership: paylaşılan singleton dispose EDİLMEZ

**Ne:** Wiring dosyaları oluşturdukları nesneyi sahiplenir; paylaşılan runtime/persistence/ignition/bus'ı
yalnız referans alır → LIFO shutdown'da dispose ETMEZ.
**Neden:** Paylaşılan kaynağı bir consumer kapatırsa diğer consumer'lar için sessizce ölür.
`OwnedOrchestrator` tipi `start()/run()` göstermez → compile-time "tarama başlatmaz" garantisi.
**Tradeoff:** Tip modeli daha katı/ayrıntılı. Kabul: compile-time güvenlik > runtime sürpriz.

---

## Neden Confidence modeli (8 Kapı)

**Ne:** Her sinyal doğru→önemli→bildirilmeli→twin→fusion→prediction→intent→action kapılarından geçer.
**Neden:** "Bir PID eklemek başarı değildir, ondan anlam üretmek başarıdır." Gösterim ≠ zekâ.
Tesla'dan daha akıllı olmak = doğrula + yorumla + öngör + karar ver.
**Tradeoff:** Her sinyal için daha çok işlem/tasarım. Kabul: vizyonun kendisi bu.

---

## Neden SAB/COI prod'da KAPALI

**Ne:** `crossOriginIsolated = false`; COEP bilinçli kaldırıldı (vite.config.ts).
**Neden:** COEP, shipped YouTube iframe + çapraz-köken müzik/radyo akışlarını bozar. Native header
enjeksiyonu da yok. Fallback fail-soft kanıtlı.
**Tradeoff:** SAB hot-path prod'da pasif. Kabul: medya çalışması > SAB kazancı. Kör COOP/COEP patch YASAK.

---

## Neden BYOK (gömülü AI anahtarı yok)

**Ne:** Her müşteri kendi AI anahtarını girer; uygulamaya merkezi/gömülü anahtar konmaz.
**Neden:** Gömülü anahtar dist+APK'ya literal sızar (fatura + ToS + satış riski). Ticari satış blocker.
**Tradeoff:** Kullanıcı kurulumu bir adım daha uzun. Kabul: satılabilirlik > kolaylık.

---

## Neden Performans-Uyarlanabilir Hibrit

**Ne:** Tüm katmanlar açık ama DeviceTier bütçesine abone; güvenlik-kritik her tier'da, ağır analiz idle'da.
**Neden:** Mali-400 / low-end head unit'lerde hot-path'i (3Hz hız/RPM) şişirmek FPS'i düşürür, termal artar.
Feda edilen zekâ değil, yalnız gösterimdir.
**Tradeoff:** Katman başına bütçe muhasebesi. Kabul: düşük-uçta bile güvenli + akıllı çalışır.

---

## Driver DNA / Prediction / Assistant Context — neden en sona

**Ne:** Zekâ katmanları Platform Core (HAL/Capability/EventBus/Deep Scan) LIVE olmadan aktive edilmez.
**Neden:** Bu katmanlar füzyonlu, doğrulanmış sinyale bağımlı. Zemin (zero-trust veri) olmadan tahmin
= çöp içeri çöp dışarı. Bağımlılık sırası korunmalı (roadmap sabit).
**Tradeoff:** Gecikmiş "wow" özellikler. Kabul: sağlam temel > erken ama güvenilmez zekâ.

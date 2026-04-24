# ⚠️ Kritik Riskler ve Varoluşsal Tehditler (Brutal Truths)

Bu belge, projenin "havalı" görünen yüzünün arkasındaki sert mühendislik ve iş gerçeklerini listeler. Her geliştirme adımında bu riskler göz önünde bulundurulmalıdır.

## 1. Mimari İllüzyon (Web vs. Metal)
- **Tespit:** Aracın kritik fonksiyonlarını (kilit, alarm vb.) JavaScript tabanlı bir Web Framework'üne emanet etmek, otomotiv dünyasında kabul edilemez bir risk seviyesidir.
- **Tehdit:** İnternet gecikmesi, tarayıcı çökmesi veya JS hataları durumunda araç kontrol dışı kalabilir.

## 2. Merkezi Güvenlik Zafiyeti (The "Master Key" Risk)
- **Tespit:** Tüm araçların komut hattı tek bir Supabase `anon_key` ve merkezi sunucuya bağlı.
- **Tehdit:** Merkezi bir hack durumunda dünyadaki tüm araçların aynı anda saldırıya uğrama riski mevcuttur. Uçtan uca (E2E) şifreleme şarttır.

## 3. Finansal Kara Delik (Scaling Costs)
- **Tespit:** 20Hz veri akışı ve her saniye canlı WebSocket bağlantısı, kullanıcı sayısı arttığında katlanılamaz bulut maliyetleri üretir.
- **Tehdit:** Uygulama popülerleştikçe, maliyetler geliri aşabilir. "Veri Savurganlığı" mimarisi değiştirilmelidir.

## 4. Donanım Duvarı (The Hardware Gap)
- **Tespit:** Yazılımda duran "Lock/Unlock" butonları, gerçek dünyada karmaşık CAN-BUS protokolleri ve donanım modülleri gerektirir.
- **Tehdit:** Yazılım mükemmel olsa bile, fiziksel araç entegrasyonu (Hardware Bridge) olmadan proje bir simülasyondan öteye geçemez.

## 5. Rekabet ve Kullanılabilirlik (The Apple/Google Factor)
- **Tespit:** Android Auto ve CarPlay, milyar dolarlık yatırımlarla pürüzsüz bir deneyim sunuyor.
- **Tehdit:** Kullanıcıyı bu devlerin ekosisteminden koparacak "vazgeçilmez" ve "kusursuz" bir neden sunulmazsa, proje sadece bir heves olarak kalacaktır.

## 6. Güç Yönetimi ve Akü Sağlığı
- **Tespit:** Sürekli aktif kalan WebSocket ve GPS, araç aküsünü (12V) park halindeyken bitirme potansiyeline sahiptir.
- **Tehdit:** "Arabam Cebimde" olsun derken, sabah çalışmayan bir arabayla karşılaşan kullanıcı sadakatini kaybeder.

---
**Durum:** Kritik Uyarı (Critical Awareness)
**Son Gözden Geçirme:** 24 Nisan 2026

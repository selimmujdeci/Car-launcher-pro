# Üretici PID/DID Verisi — Yasal Kaynak Haritası

> Tarih: 2026-07-05 · Araştırma: ana oturum (web-doğrulamalı) · Hukuki danışmanlık DEĞİLDİR;
> lansman öncesi lisans denetiminde bu belge girdi olarak kullanılır.
> İlke (CLAUDE.md ticari lisans kuralı): lisans doğrulanmadan HİÇBİR veri gömülmez;
> kopyala-değiştir türev eserdir, İHLALDİR — kapı baştan kapalı.

## Karar tablosu

| Kaynak | Lisans (doğrulandı) | Karar | Not |
|--------|--------------------|-------|-----|
| Kendi keşif aracımız (didDiscoveryService, 12C) | Bizim | ✅ BİRİNCİL | Her kullanıcı potansiyel katkıcı; katkı onayı + kendi katkı lisansımız tasarlanacak |
| ISO 14229 / SAE J1979 standart tanımları | Standart (uygulama serbest) | ✅ KULLANIMDA | universalUdsProfile zaten bundan |
| **OVMS3** (openvehicles) | **MIT** ✅ | ✅ KULLAN (atıfla) | **Gerçek Renault Zoe UDS DID'leri var** (ör. 0x2002 SOC, 0x2006 odometre, ECU 0x7EC; Zoe Ph2 poller ayrı dosya). MIT → ticari kullanım + kapalı kaynak OK; "Açık Kaynak Lisansları" ekranına atıf eklenir. Dikkat: repo içi 3. parti bileşenlerin kendi lisansları var — yalnız MIT kapsamındaki araç modülü tablolarından alınır, dosya bazında lisans başlığı kontrol edilir |
| **opendbc** (comma.ai) | **MIT** ✅ | ✅ KULLANILABİLİR ama Renault YOK | dbc/ klasöründe Renault/Dacia/Zoe dosyası yok (doğrulandı). Diğer markalara açılırken birincil CAN kaynağı |
| **CanZE** (fesch) | **GPLv3** ⚠️ | ❌ GÖMME — yalnız REFERANS | Copyleft: kod da veri tabloları da ürüne giremez. Tek tek gerçeklerin (fact) bağımsız doğrulaması için yol gösterici olabilir: CanZE'den "şu DID şu olabilir" ipucu al → KENDİ aracında keşif aracıyla DOĞRULA → kendi ölçümünü kaydet (kaynak: kendi ölçümün olur) |
| **AB 2018/858 RMI** (tip onay tüzüğü) | Yasal HAK | ✅ B2B KAPISI | Üretici, bağımsız operatörlere OBD + tamir/bakım bilgisini **ayrımsız, makine-okur** (ISO 18541) vermek ZORUNDA; ABAD 2023 kararı ek şart koyamayacağını netleştirdi. Renault RMI portalına ücretli abonelik = tamamen meşru veri kaynağı. Satın alınan dokümantasyondan öğrenilen formül = kaynaklı gerçek |
| Car Scanner / Torque DB'leri | Tescilli | ❌ ASLA | Türev/kopya dahil. Kanarya giriş riski ayrıca yakalatır |
| DDT2000/DDT4All, PyRen veri dosyaları | Sızıntı kökenli | ❌ ASLA | Kökeni belirsiz veri = lisanssız veri |
| Wikipedia "OBD-II PIDs" sayfası | CC BY-SA | ⚠️ DİKKAT | Tek tek gerçekler serbest; metin/tablo yapısını kopyalamak share-alike tetikler — tabloyu kopyalama, gerçeği al kaynağıyla yaz |
| Forum/topluluk ipuçları | — | ⚠️ İPUCU | Tek başına yeterli değil; keşif aracıyla kendi ölçümünle doğrulanmadan profile girmez |

## Neden "kopyala-değiştir" yok (özet)

1. Değiştirilmiş kopya = türev eser; ihlal kalkar sanılır, kalkmaz.
2. Tek formül fact'tir (korunmaz) ama derlemenin bütünü korunur: AB sui generis
   veritabanı hakkı + TR FSEK Ek m.8 (veritabanı yapımcısı) + ABD derleme telifi/ToS.
3. Kanarya (sahte) girişler kopyayı kanıtlar.
4. B2B satışta IP garantisi/denetim var — tek şüpheli kaynak satışı zehirler.

## Eylem planı

1. **[hemen]** OVMS3 Renault modüllerinden (MIT, dosya başlığı teyitli) Zoe/EV
   DID'lerini `profiles/`e taşı — her DID'e `source:` alanında OVMS3 commit
   linki; "Açık Kaynak Lisansları" ekranına OVMS3 MIT atıfı. (Duster ICE için
   doğrudan fayda sınırlı — ama Renault EV kapsaması + boru hattı kanıtı.)
2. **[saha]** Duster'da keşif aracıyla 22xx taraması (12D ekranı hazır) —
   CanZE/forum İPUÇLARIYLA yönlendirilmiş, kendi ölçümümüzle kaynaklı.
3. **[tasarım]** Uygulama-içi katkı akışı: kullanıcı keşif sonucu paylaşımına
   açık onay + katkı lisansı metni (CLA benzeri; veri havuzunun sahibi biz,
   katkıcıya atıf) — Filo/bulut dalgasıyla birleşir.
4. **[B2B, gerektiğinde]** Renault RMI portal aboneliği (2018/858 hakkı) —
   belirli bir formül resmî kaynaktan gerektiğinde.
5. **[lansman öncesi]** `npx license-checker --summary` + bu tablo üzerinden
   veri kökeni denetimi.

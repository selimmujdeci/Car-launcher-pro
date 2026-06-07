# Vosk Türkçe Offline STT Modeli — Kurulum

Head unit'lerde internet **yoktur**; sesli asistan tamamen offline Vosk ile çalışır.
Model **57 MB binary** olduğu için **git'e alınmaz** (repo temiz kalır). Gerektiğinde
fetch script ile indirilir ve SHA256 manifest ile doğrulanır.

## Hızlı kurulum

```bash
# Mirror adresinizi verip indirin (.zip veya .tar.gz):
VOSK_MODEL_URL=https://<mirror>/vosk-model-tr.tar.gz npm run fetch:vosk

# Model zaten yerindeyse script sadece doğrular (idempotent), indirme yapmaz:
npm run fetch:vosk
```

İndirilen model şuraya yerleşir: `android/app/src/main/assets/vosk-model-tr/`
(Bu yol `.gitignore`'da; APK/AAB build'i modeli buradan paketler.)

## Doğrulama (SHA256)

- Bütünlük `scripts/vosk-model-tr.sha256` manifest'ine göre **dosya-başına SHA256**
  ile kontrol edilir. Eksik/bozuk dosya → script hata verir (exit 1).
- Manifest, doğrulanmış modelin (uuid `caros-vosk-model-tr-0.3-20260605b`) birebir
  içeriğini pinler.

## Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|----------|---------|----------|
| `VOSK_MODEL_URL` | indirme için evet | Kendi mirror'ınızın `.zip`/`.tar.gz` adresi |
| `VOSK_MODEL_SHA256` | hayır | Verilirse indirilen **arşivin** SHA256'sı da kontrol edilir |

## Neden kendi mirror?

Model caros'a özel **repackage**'dır (small-tr-0.3 tabanlı, standart Vosk yapısına
taşınmış). Upstream alphacephei zip'i **farklı yapıdadır**; manifest doğrulaması ona
karşı geçmez. Bu yüzden indirme kaynağı, bu repackage'i barındıran kendi
mirror/sürüm deponuz olmalıdır.

## Lisans

Vosk + Türkçe model **Apache-2.0** → ticari satış/gömme serbest. Uygulamadaki
"Açık Kaynak Lisansları" ekranına Vosk atıfı eklenmelidir.

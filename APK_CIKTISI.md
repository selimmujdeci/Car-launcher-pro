# APK Çıktısı — Caros Pro

## İmzalı Release APK Bilgileri

| Alan | Değer |
|------|-------|
| Keystore dosyası | `carospro-release.jsk` |
| Şifre | `Miles369258` |
| Alias | `carlauncher_key` |
| APK çıktı klasörü | `C:\Temp\carlauncher\app\build\outputs\apk\release` |

## Release APK Build Adımları

```bash
# 1. Web varlıklarını derle
npm run build

# 2. Capacitor ile Android'e sync et
npx cap sync android

# 3. Android Studio'da release build al
# Build > Generate Signed Bundle / APK > APK
# Keystore bilgilerini yukarıdan gir
```

## Gradle ile Komut Satırından Build

```bash
cd C:\Temp\carlauncher
./gradlew assembleRelease
```

APK çıktısı: `C:\Temp\carlauncher\app\build\outputs\apk\release\app-release.apk`

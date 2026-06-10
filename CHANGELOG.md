# Changelog — CarOS Pro

> Format: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) · Sürümleme: SemVer.
> Tek sürüm kaynağı: `version.properties` (`npm run release:bump` ile artırılır).
> Her release'te: [Unreleased] altındaki maddeler yeni sürüm başlığına taşınır,
> commit'lenir ve `git tag v<VERSION_NAME>` atılır. Tag'siz APK/AAB dağıtılmaz.

## [Unreleased]

### Added
- Release/sürüm disiplini: `version.properties` tek kaynak, `release:bump` /
  `release:apk` / `release:aab` script'leri, CHANGELOG süreci.

## [1.0.0] — 2026-06-10

İlk satılabilir sürüm adayı (baseline). Bu tarihten önceki geçmiş için git
log'a bakın; bundan sonra her kullanıcıya görünür değişiklik buraya yazılır.

- BLE + Classic hibrit OBD transport (V-LINK/iCar dual-mode)
- K24 + Hiworld CANBUS köprüsü (K24CanBridge, McuEventSniffer)
- Offline navigasyon (MapLibre + OSRM + A* worker), offline Vosk TR STT
- Uzaktan komut E2E güvenlik zinciri (P0 triage düzeltmeleri — cihaz doğrulaması bekliyor)
- Mali-400 GPU performans Faz 1

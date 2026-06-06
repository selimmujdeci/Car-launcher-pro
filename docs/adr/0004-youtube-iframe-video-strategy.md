# ADR 0004 — YouTube / Video Stratejisi (Piped + Gömülü Video Revert)

## Status

Kabul edildi. **Gömülü YouTube video REVERT edildi**; mevcut strateji **audio/stream
odaklı**. Video özelliği **ertelendi** (`PROJECT_STATE.md`, `ARCHITECTURE_DATAFLOW.md` §6).

## Context

YouTube içeriğine erişim **Piped** (YouTube proxy) üzerinden sağlanıyor. İki problem:

1. **Public Piped instance'larının çoğu ölü.** Sağlık zamanla değişiyor; tam ölü
   (DNS/connection-refused) instance'lar aramayı kilitliyordu.
2. **Gömülü YouTube video** denendi ama geri alındı — head unit (Mali-400) düşük güçlü
   donanımda video decode + iframe maliyeti uygun değildi.

## Decision

**Audio/stream odaklı, paralel-yarışan çoklu instance + gömülü video yok.**

- `pipedProvider.ts` `INSTANCES` listesi (`pipedProvider.ts:22-28`): 5 aday instance.
  **Yalnızca `https://api.piped.private.coffee` canlı doğrulanmış** (yorum: "200 +
  CORS:*"); diğerleri 502/aday (kavin.rocks, leptons.xyz, reallyaweso.me, lunar.icu).
  Instance'lar paralel yarışır (`_tryInstances`); ölü instance canlıyı bloklamaz.
  Sticky instance: çalışan instance bir sonraki çağrıda önce denenir
  (`pipedProvider.ts:39-45`). Per-instance timeout: arama 6s, stream 9s (:36-37).
  > Not: Liste 5 elemanlı, **canlı doğrulanmış tek nokta** private.coffee. (2026-06-06'da
  > PROJECT_STATE.md + ARCHITECTURE_DATAFLOW.md bu gerçekle hizalandı.)
- **Gömülü YouTube video REVERT:** `carosMediaLayer.ts` içinde `_playYouTubeLight`
  **YOK** (grep boş); yalnızca standart `playYouTube` var (`carosMediaLayer.ts:32, 203`).
- **YouTube debug/probe flag YOK.** `YT_DEBUG_PROBE` ve benzeri bir iframe/video probe
  mekanizması kod tabanında **bulunamadı** (grep boş, hem `src/` hem native). Video
  ertelendiği için kontrol edilecek bir probe flag'i yok.

## Consequences

- (+) Ölü instance'lar aramayı kilitlemiyor (paralel yarış + sticky).
- (+) Düşük güçlü head unit'te video decode yükü yok (audio/stream odaklı).
- (−) **Tek nokta arıza riski:** canlı doğrulanmış tek instance private.coffee düşerse
  YouTube arama/stream çöker. Kalıcı çözüm (alternatif kaynak / yerel proxy / graceful
  fallback) **netleşmemiş** (`ROADMAP.md` — **Belirsiz**, hedeflenen çözüm yok).
- (−) Video oynatma yok; gelecekte istenirse yeni ADR ile yeniden değerlendirilir.

## Links & affected files

- `src/platform/media/pipedProvider.ts:22-28` (INSTANCES), `:36-37` (timeout), `:39-45` (sticky)
- `src/platform/media/carosMediaLayer.ts:32, 203` (playYouTube; `_playYouTubeLight` YOK)
- `ARCHITECTURE_DATAFLOW.md` §6 (YouTube / Medya Mimarisi)
- `ROADMAP.md` (Piped tek-instance riski — çözüm Belirsiz)
- YouTube debug probe flag: **Belirsiz / kodda bu adla yok**

# Katkı Kuralları — CarOS Pro

> Bu dosya kural **kopyalamaz**, referans verir. Çalışma kurallarının tek sahibi
> [`CLAUDE.md`](CLAUDE.md)'dir; çelişki olursa `CLAUDE.md` geçerlidir.

## Çalışma ilkesi

**En küçük güvenli değişikliği yap. Değişikliğin riski kadar doğrula.**

- Tek PR = tek problem. İlgisiz refactor/cleanup/rename karıştırma.
- Kök neden bulunmadan fix yazma; semptomu gizleyerek bug kapatma.
- Mevcut kanonik authority'yi koru; ikinci truth store / scheduler / recovery motoru kurma.
- Kanıtlanmamış veriyi `0`, `success` veya `current` gibi göstermek yasaktır
  (`UNKNOWN / UNAVAILABLE / STALE` kullan).

## Değişiklik öncesi

1. Problemi sahiplenen dosyayı, doğrudan bağımlılıklarını ve ilgili testleri oku.
2. Gerekiyorsa yalnız ilgili domain belgesini oku (`docs/` tablosu: `CLAUDE.md` §3).
3. Belge ile kod çelişirse **kod ve test sonucu esastır**.

## Doğrulama

- Targeted test + `npx tsc --noEmit` + yalnız değişen dosyalarda lint.
- Authority/safety sınırına dokunduysan ilgili guard testlerini de çalıştır.
- Full suite / production build yalnız faz kapanışında; `npm run apk:safe` yalnız
  release sürecinde (`docs/operations/RELEASE_CHECKLIST.md`).
- Testlerin yeşil olması cihaz doğrulaması değildir. Gerçek cihaz kanıtı
  `docs/DEVICE_VALIDATION_LEDGER.md` içine işlenir.

## Belge kuralı

- Yeni Markdown oluşturmak varsayılan olarak yasaktır.
- Görev/rapor/handoff/checkpoint belgesi **üretilmez**; mevcut kanonik belge güncellenir.
- Yeni belge yalnız kalıcı sözleşme/ADR/güvenlik/operasyon/public API için veya açık
  talep üzerine açılır. Mimari karar için: `docs/adr/NNNN-baslik.md`.

## Commit ve PR

- Küçük, atomik commit; kapsamı `git diff` ile doğrula.
- Başka oturumun kirli dosyalarını staging'e alma, geri alma.
- PR açıklaması Türkçe: ne değişti, kök neden, hangi doğrulama çalıştırıldı, açık risk.

# CAROS PRO — CLAUDE OTURUM GİRİŞ KAPISI

> **Güncel Claude oturum giriş sırasının tek sahibi bu belgedir.**

## A. Bu belgenin otoritesi

- Bu dosya Claude Code oturumlarının **tek başlangıç kapısıdır**.
- **Global çalışma kuralının tek sahibi `CLAUDE.md`'dir.** Bu belge yalnız oturum giriş
  sırasını ve göreve özel otorite tablosunu tanımlar; ikinci bir anayasa değildir.
- **Belge ile kod çelişirse çalışan kod ve test sonucu esastır.** Belge kanıt değildir.
- **Sohbet geçmişi repository'deki doğrulanmış durumun yerine geçmez.** Bir şey konuşulduysa
  ama repoda kaydı yoksa, kayıtlı sayılmaz.

## B. Zorunlu okuma sırası

1. `docs/workspace/00_START_HERE.md` — bu dosya
2. `docs/workspace/01_STATE.md` — projenin güncel durumu
3. `docs/workspace/05_GLOSSARY.md` — terimlerin kesin anlamı (önce dili öğren)
4. `docs/workspace/02_DECISIONS.md` — verilmiş kararlar; yeniden tartışma
5. `docs/workspace/03_DEBT.md` — açık teknik borçlar; yeniden keşfetme
6. `docs/workspace/04_MAP.md` — hangi modül gerçekten bağlı, hangisi gölge/vizyon
7. `CLAUDE.md` — **tek global çalışma kuralı** (eski AI anayasası arşivde:
   `docs/archive/AI.md` — otorite değildir, yalnız tarihsel kayıttır)
8. Aktif göreve özel otoriter belge(ler) — aşağıdaki tablodan seç
9. İlgili kod ve testler
10. Git çalışma ağacı ve ilgili geçmiş

## C. Göreve özel otorite tablosu

| Görev alanı | Otoriter belge |
|---|---|
| Güncel proje durumu | `docs/workspace/01_STATE.md` |
| Ürün vizyonu ve özellik durumları | `docs/CAROS_PRO_VIZYONU.md` |
| Saha doğrulaması (**mutlak otorite**) | `docs/DEVICE_VALIDATION_LEDGER.md` |
| Araç zekâsı mimarisi | `docs/architecture/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` |
| Navigasyon mimarisi | `docs/navigation/NAVIGATION_ARCHITECTURE_SPEC_v3.md` |
| Mavi (asistan) mimarisi | `docs/mavi/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` |
| Müzik/medya mimarisi | `docs/music/CAROS_MUSIC_ARCHITECTURE_SPEC_v1.md` |
| Resmî mimari kararlar | `docs/adr/` |
| Güvenlik sözleşmeleri | `docs/security/` |
| Operasyon / release | `docs/operations/` |

Tabloda olmayan bir belge otorite değildir; ona dayanarak durum ilan etme.

## D. Yasaklar

Yeni oturum **şunları yapmaz**:

- Repository'ye zaten kaydedilmiş bağlamı kullanıcıdan yeniden istemek.
- Tamamlanmış bir görevi yeniden uygulamak.
- `01_STATE.md` §Aktif Görev'i kontrol etmeden başka bir işe başlamak.
- `docs/archive/` altındaki eski durum/devir/rapor belgelerini (ör.
  `docs/archive/PROJECT_STATE.md`, `docs/archive/HANDOFF.md`) güncel kabul etmek.
- Görev/rapor/handoff/checkpoint için yeni Markdown üretmek (`CLAUDE.md` §3).
- Çalışma ağacındaki mevcut değişiklikleri sahiplenmek, bozmak veya revert etmek.
- Kanıt olmadan mimari, aktiflik veya çalışma durumu ilan etmek.
- Test yeşilini cihaz/araç doğrulaması gibi sunmak.
- Kendiliğinden commit atmak.

## E. Devralma özeti (kod değiştirmeden önce)

Belgeleri okuduktan sonra, **koda dokunmadan önce** kısa bir özet ver:

- mevcut teknik durum
- aktif görev
- son doğrulamalar (test/tsc/lint — sayı varsa sayıyla)
- açık blokajlar
- çalışma ağacında **önceden var olan** değişiklik kümeleri
- korunacak mimari sınırlar

Bu özet **onay istemek için değildir** — bağlamın doğru yüklendiğini göstermek içindir.
Özetten sonra doğrudan işe başla.

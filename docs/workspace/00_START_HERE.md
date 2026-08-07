# CAROS PRO — CLAUDE OTURUM GİRİŞ KAPISI

> **Güncel Claude oturum giriş sırasının tek sahibi bu belgedir.**

## A. Bu belgenin otoritesi

- Bu dosya Claude Code oturumlarının **tek başlangıç kapısıdır**.
- `CONTRIBUTING.md §0`, `HANDOFF.md §1` ve `docs/project/MASTER_PROMPT.md` içindeki eski
  "buradan başla" talimatları **güncel oturum sırasını belirlemez**. O belgeler henüz
  düzeltilmedi; bilinen ve kayıtlı bir dokümantasyon borcudur (bkz. `01_STATE.md`).
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
7. `AI.md` — yürütme kuralları (**çakışmada mutlak öncelikli**)
8. `CLAUDE.md` — proje anayasası
9. Aktif göreve özel otoriter belge(ler) — aşağıdaki tablodan seç
10. İlgili kod ve testler
11. Git çalışma ağacı ve ilgili geçmiş

## C. Göreve özel otorite tablosu

| Görev alanı | Otoriter belge |
|---|---|
| Güncel proje durumu | `docs/workspace/01_STATE.md` |
| Ürün vizyonu ve özellik durumları | `docs/CAROS_PRO_VIZYONU.md` |
| Araç zekâsı mimarisi | `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` |
| Saha doğrulaması (**mutlak otorite**) | `docs/DEVICE_VALIDATION_LEDGER.md` |
| Mavi vizyonu | `docs/MAVI_NEXT_VISION.md` |
| Companion AI mimarisi | `docs/COMPANION_AI_ARCHITECTURE.md` |
| Resmî mimari kararlar | `docs/adr/` |
| Geliştirici platformu (FAZ A) | `docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md` |

Tabloda olmayan bir belge otorite değildir; ona dayanarak durum ilan etme.

## D. Yasaklar

Yeni oturum **şunları yapmaz**:

- Repository'ye zaten kaydedilmiş bağlamı kullanıcıdan yeniden istemek.
- Tamamlanmış bir görevi yeniden uygulamak.
- `01_STATE.md` §Aktif Görev'i kontrol etmeden başka bir işe başlamak.
- Eski tarihli durum belgelerini (`PROJECT_STATE.md`, `HANDOFF.md`, `PROGRESS.md`,
  `SYSTEM_MAP.md`, `MEMORY.md`, `docs/project/PROJECT_STATUS.md`,
  `docs/project/SESSION.md`) güncel kabul etmek.
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

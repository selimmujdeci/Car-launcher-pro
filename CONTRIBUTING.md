# CONTRIBUTING — CarOS Pro (CockpitOS)

> Bu proje üzerinde çalışan her ajan/geliştirici için süreç kuralları.
> Tüm yanıtlar Türkçe (CLAUDE.md dil kuralı). Komut/flag adları İngilizce kalır.
> Bu dosya `CLAUDE.md` ve `AI.md`'ye **referans verir, kurallarını KOPYALAMAZ** —
> çakışmada o dosyalar mutlak önceliklidir.

---

## 0. İşe Başlamadan Önce (zorunlu okuma sırası)

`HANDOFF.md` §1'deki sırayı izle:

1. `CLAUDE.md` — proje kuralları, dil kuralı, onay-isteme kuralı, automotive/V8
   standartları, lisans kuralı. Diğer her şeyi OVERRIDE eder.
2. `AI.md` — STABILIZATION MODE; atomik patch; multi-system refactor yasak.
   Çakışmada **mutlak öncelik**.
3. `PROJECT_STATE.md` — şu an neredeyiz (branch, son commit, build/test, bekleyen iş).
4. `ROADMAP.md` — ne yapıldı / ne yapılacak / ne YAPILMAMALI.
5. `ARCHITECTURE.md` (manifesto) + `ARCHITECTURE_DATAFLOW.md` (somut veri akışı).
6. `HANDOFF.md` — devir notları.

**İşe başlamadan `PROJECT_STATE.md` + `HANDOFF.md` mutlaka okunur.** Bunlar olmadan
mevcut durum (kirli çalışma ağacı, commit edilmemiş native iş, saha testi bekleyenler)
bilinemez ve yanlış varsayımlar üretilir.

---

## 1. Analiz Önce, Kod Sonra

- Kök neden bulunmadan fix yazma. Semptom ≠ kök neden (`HANDOFF.md` §7, `AI.md` CORE RULE).
- Dosya/fonksiyon/satır iddialarını **yazmadan önce kod tabanından doğrula** (Grep/Read).
  Bu dosyalar (PROJECT_STATE/HANDOFF/ARCHITECTURE_DATAFLOW) da böyle yazıldı.
- "Emin değilim" durumunda **Belirsiz** yaz; uydurma.

---

## 2. Küçük Branch, Küçük Commit, Karıştırma Yok

- **Küçük, odaklı branch'ler** kullan. Tek bir mantıksal iş = tek branch.
- **Küçük, atomik commit'ler** at (`AI.md` PATCH RULES: edit only necessary files,
  prefer single file, no unrelated changes).
- **Aynı commit'te ilgisiz değişiklikleri karıştırma.**

  **Örnek (bu projede uygulandı):** Faz 1 performans commit'i (`2fbbd57`)
  **hunk-seçimli** yapıldı — yalnızca GPU performans hunk'ları (`theme.css` tam +
  `MainLayout.tsx`'in 3 GPU hunk'ı) commit edildi. `safeStorage` refactor ve
  `setTheme` day/night eşlemesi **bilinçli olarak commit dışı** bırakıldı, ayrı bir
  commit'e ait olduğu için unstaged (`M`) tutuldu (`PROJECT_STATE.md` Çalışma Ağacı).
  Aynı dosyada (MainLayout.tsx) iki farklı işin hunk'ları olsa bile ayrı commit'lenir.

---

## 3. STABILIZATION MODE Sınırları

`AI.md` gereği şu an aktif: **No new features · No UI redesign · No big refactor ·
One bug = one fix.**

- Multi-system refactor **yasak**. Tek seferde tek sistem.
- Partial logic / broken state transition / missing cleanup **bırakma** (`AI.md` NEVER LEAVE).
- `ROADMAP.md` "ŞİMDİ YAPILMAMASI Gereken İşler" listesine uy (Faz 3 polish, blackBox
  10Hz değişimi, copyleft/NC bağımlılık vb.).

---

## 4. Build/Test Geçmeden "Tamamlandı" Deme

- `AI.md` REQUIRED AFTER PATCH: `npx tsc --noEmit` (ya da `npm run build`).
- İlgili testler (`npm test`) ve gerekirse `npm run lint` geçmeli.
- Native değişiklikte `gradlew compileDebugJavaWithJavac`.
- CLAUDE.md LOCAL SCOPE INTEGRITY §8: **Build success alone is not proof.** Gerçek
  özellik davranışı kullanıcı isteğiyle eşleşmeli. Saha testi gereken iş (OBD/BLE/Vosk)
  cihazda doğrulanmadan "tamamlandı" sayılmaz (`HANDOFF.md` §5).
- Release alınacaksa `RELEASE_CHECKLIST.md`'yi uygula.

---

## 5. Görev Bitince Dokümanları Güncelle

- **Her görev sonunda `HANDOFF.md` güncellenir** — son değişiklikler, bir sonraki
  önerilen iş, bilinen riskler taze tutulur. Yeni ajan buradan devralır.
- **`PROJECT_STATE.md`** anlık durumu (branch, son commit, build/test, bekleyen iş)
  yansıtacak şekilde güncellenir.
- **Büyük/mimari değişiklikte `ARCHITECTURE_DATAFLOW.md` güncellenir** — veri akışı
  değiştiyse kod referanslarıyla birlikte. (Örnek: `useSABDirectUpdate` ölü
  bulununca §1 düzeltildi.)
- Mimari karar verildiğinde bir ADR ekle: `docs/adr/NNNN-baslik.md`
  (format: Status / Context / Decision / Consequences / Links & affected files).

---

## 6. Çalışma Kuralı Hatırlatmaları

- Tüm yanıtlar **Türkçe** (CLAUDE.md).
- **Onay isteme yok** — CLAUDE.md gereği işlemler doğrudan yapılır; ancak `AI.md`
  stabilizasyon sınırları korunur.
- DOKUNULMAMASI gereken alanlar (`HANDOFF.md` §3): `blackBoxService.ts` 10Hz
  örnekleyici, güvenlik servisleri (SafetyBrain/blackBox iş mantığı),
  `FullMapView.tsx` harita/nav zırhı, `VehicleSignalResolver` Seqlock/SAB yapısı.
- Yeni bağımlılık eklemeden önce lisans kontrolü (CLAUDE.md ticari lisans kuralı):
  copyleft (GPL/AGPL/LGPL/SSPL) ve NC varlıklar yasak.

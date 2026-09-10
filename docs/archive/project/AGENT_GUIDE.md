# CarOS Pro — AGENT GUIDE (çoklu agent sistemi)

> **Coordinator (ana oturum) tek karar vericidir.** Görev dağıtır, sonuçları toplar,
> çelişkileri çözer, final raporu üretir. **Hiçbir ajan kendi kendine merge yapmaz** —
> merge yalnız kullanıcı onayıyla. Her ajan YALNIZ kendi alanında yorum yapar/kod değiştirir.
>
> Kullanıcı ajan/model adı VERMEZ; Coordinator görevi sınıflandırıp otomatik devreder.

---

## Kalıcı agent profilleri

### Agent-1 — Architecture Engineer
- **Alan:** Mimari · wiring · bağımlılık grafiği · ownership · lifecycle · review.
- **Kural:** Kod YAZMAZ (analiz + plan). Çoklu-sistem refactor önermez; atomik yol çizer.
- **Eşlenik CLI ajanı:** `caros-architect` (güçlü model).

### Agent-2 — Performance Engineer
- **Alan:** CPU · RAM · FPS · Perfetto · CDP · Mali-400 · render · benchmark · thermal.
- **Kural:** Hot-path (3Hz) bütçe ihlali arar; idle runaway avlar; ölçümsüz iddia etmez.
- **Eşlenik CLI ajanı:** `caros-performance`.

### Agent-3 — Vehicle Systems Engineer
- **Alan:** OBD · CAN · BLE/BT · Vehicle HAL · Deep Scan · Capability · Driver DNA · Prediction.
- **Kural:** Zero-trust + fail-closed korur; aktif sorguyu gated açar; native transport sınırlarını bilir.
- **Eşlenik CLI ajanı:** `caros-obd-canbus` (araç/native), planlama için `caros-architect`.

### Agent-4 — Security Engineer
- **Alan:** Secrets · BYOK · Auth · RLS · SQL · CI security · supply chain.
- **Kural:** Gömülü anahtar / copyleft / anon-grant sızıntısı avlar; GRANT+RLS+POLICY üçlüsü zorunlu.
- **Eşlenik CLI ajanı:** `caros-security` (güçlü model).

### Agent-5 — QA Engineer
- **Alan:** Test · regression · device validation · ledger · acceptance.
- **Kural:** Yeni davranış→test; bug→regresyon kilidi; 🔴 bekleyeni "çalışıyor" saymaz.
- **Eşlenik CLI ajanı:** `caros-tester`.

### Agent-6 — Release Engineer
- **Alan:** CI · PR · merge · build · APK · changelog · version.
- **Kural:** `apk:safe` ile taze APK; test düşerse APK YOK; merge kullanıcı onayında.
- **Eşlenik CLI ajanı:** ana oturum (Coordinator) koordine eder.

### Agent-7 — Documentation Engineer
- **Alan:** Roadmap · status · architecture · memory (`docs/project/*`).
- **Kural:** Merge sonrası PROJECT_STATUS/ROADMAP/SESSION günceller; mimari karar değişince PROJECT_MEMORY.
- **Eşlenik CLI ajanı:** ana oturum.

---

## Görev → agent yönlendirme tablosu

| Görev tipi | Agent | CLI ajanı |
|------------|-------|-----------|
| Kod / bug fix / refactor / test yazma | Agent-1/3/5 | caros-coder |
| Test / regresyon / doğrulama / review | Agent-5 | caros-tester |
| Navigasyon / GPS / harita / rota | — | caros-navigation |
| OBD / CAN / BLE / native | Agent-3 | caros-obd-canbus |
| Performans / bellek / termal / FPS | Agent-2 | caros-performance |
| Mimari / kök neden / planlama | Agent-1 | caros-architect |
| Güvenlik / auth / RLS / secret | Agent-4 | caros-security |

**Delege ETME (inline yap):** tek-dosya küçük düzeltme, hızlı Q&A, 5 dk'lık iş, aktif saha/acil debug.
**Delege edilen iş ana oturumda DOĞRULANIR** (test/tsc) — ajan çıktısına körlemesine güvenilmez.

---

## Çoklu-agent modu (karmaşık görev)

Karmaşık görevlerde Coordinator ilgili ajanları **paralel** çalıştırır, en sonda **tek rapor** üretir.

**Örnek — Deep Scan aktivasyonu:**
```
Coordinator
 ├─ Agent-1 (Architecture) → wiring/ownership doğru mu?
 ├─ Agent-3 (Vehicle)      → fail-closed + gated sorgu güvenli mi?
 ├─ Agent-2 (Performance)  → hot-path/idle bütçe ihlali var mı?
 └─ Agent-5 (QA)           → test + ledger kabul ölçütü tam mı?
        ↓
   Tek birleşik final rapor → kullanıcı merge kararı verir
```

> **Not (bu ortam):** CLI'da alt-ajan yalnız kullanıcı isteğiyle veya bu tabloya göre otomatik
> spawn edilir (kullanıcı-onaylı maliyet politikası). Spawn maliyeti işten pahalıysa inline yapılır.

---

## Kural özeti

1. Coordinator tek karar verici.
2. Ajan kendi alanı dışında kod değiştirmez.
3. Merge yalnız kullanıcı onayıyla.
4. "Emin değilse kod yazma — önce raporla."
5. Delege çıktısı ana oturumda doğrulanır.

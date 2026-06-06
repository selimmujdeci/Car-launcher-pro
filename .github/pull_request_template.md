<!--
  CarOS Pro PR Şablonu — tüm açıklamalar Türkçe yazılır (CLAUDE.md dil kuralı).
  AI.md STABILIZATION MODE aktif: one bug = one fix, ilgisiz değişiklik karıştırma.
  Doldurmadan PR açma.
-->

## Bu PR ne yapıyor?

<!-- Tek cümlede amaç. Hangi bug/özellik? Kök neden neydi (semptom değil)? -->



## Hangi dosyalar değişti?

<!-- Değişen dosyaları ve her birinde ne yapıldığını kısaca listele.
     İlgisiz değişiklik karıştırılmadığını teyit et (AI.md PATCH RULES). -->

-

## Build / test sonucu

- [ ] `npm run build` geçti
- [ ] `npm test` geçti (vitest)
- [ ] `npm run lint` geçti
- [ ] Native değişiklik varsa `gradlew compileDebugJavaWithJavac` geçti
- [ ] E2E (`npm run test:e2e`) gerektiyse geçti

<!-- Geçmeyen/atlanan adım varsa nedenini yaz. Build success alone is not proof. -->

## Araçta (K24 head unit) test edildi mi?

- [ ] Evet, gerçek K24 head unit'te test edildi
- [ ] Hayır — saha testi BEKLİYOR (cihazda doğrulanmadı)
- [ ] Bu değişiklik cihaz testi gerektirmiyor (salt web/UI)

<!-- OBD/BLE/Vosk/CAN/GPS/performans değişiklikleri cihazda doğrulanmadan
     "tamamlandı" sayılmaz (HANDOFF.md §5). Hangi senaryo test edildi? -->

## Debug flag kaldı mı?

- [ ] DEV-only / debug kod (import.meta.env.DEV, VITE_ENABLE_DEBUG_PANEL,
      ENABLE_DEVICE_TEST) production'a sızmıyor
- [ ] Geçici DEBUG log / teşhis rozeti bırakılmadı (ya da DEV guard'lı)
- [ ] `VITE_ENABLE_OBD_MOCK` release'te kapalı/ayarsız (mock kapalı)

## Risk seviyesi

- [ ] **Düşük** — izole, davranış değişmiyor, salt görsel/koşullu render
- [ ] **Orta** — paylaşılan servis/akış etkileniyor, geri alınabilir
- [ ] **Yüksek** — güvenlik/sensör/harita-nav/SAB-Seqlock veya çok dosya etkiliyor

<!-- DOKUNULMAMASI gereken alanlar (HANDOFF.md §3): blackBoxService 10Hz,
     SafetyBrain, FullMapView nav zırhı, VehicleSignalResolver Seqlock/SAB.
     Bunlara dokunulduysa Yüksek işaretle ve gerekçe yaz. -->

## Rollback planı

<!-- Sorun çıkarsa nasıl geri alınır? Tek commit revert mi? Bağımlı değişiklik var mı?
     Flag ile kapatılabilir mi? Veri/persist göçü içeriyor mu? -->



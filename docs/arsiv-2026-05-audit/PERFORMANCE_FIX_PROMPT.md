# Role

CarOS Pro için automotive-grade React + TypeScript kod üretiyorsun.
Performans ve bellek sızıntısı yapmayan, sürüş sırasında kasmayan kod yazmak senin önceliğin.
CLARDE.md ve GEMINI.md kurallarına uyuyorsun.

---

# Task

## Hedef
35+ bileşende bulunan Zustand anti-pattern'ını tespit et ve raporla.

## Anti-Pattern Tanımı

YANLIŞ — tüm store objesine subscribe et:
```tsx
const { settings } = useStore();           // ~50KB, her update'te re-render
const { settings, updateSettings } = useStore();
```

DOĞRU — sadece ihtiyacın olan alanı al:
```tsx
const themePack = useStore(s => s.settings.themePack);
const language = useStore(s => s.settings.language);
```

## Rapor Formatı

Her dosya için şunu raporla:

```
## <dosya_adı>.tsx

### Bulunan anti-pattern
- Satır X: `const { settings } = useStore();` → re-render tetikliyor

### Önerilen düzeltme
```tsx
const themePack = useStore(s => s.settings.themePack);
```

### Etki
- Bu bileşen artık sadece `themePack` değiştiğinde re-render edecek
- `volume`, `language`, `brightness` değişimlerinde artık re-render yok
```

## Tarancak Dosyalar

1. src/components/home/MediaHub.tsx
2. src/components/themes/MercedesLayout.tsx
3. src/components/themes/AudiLayout.tsx
4. src/components/themes/TeslaLayout.tsx
5. src/components/themes/CockpitLayout.tsx
6. src/components/themes/ProLayout.tsx
7. src/components/settings/SettingsPage.tsx
8. src/components/settings/ExpertModePanel.tsx
9. src/components/map/NavigationHUD.tsx
10. src/components/obd/OBDPanel.tsx
11. src/components/obd/DigitalCluster.tsx
12. src/components/obd/TPMSWidget.tsx
13. src/components/layout/NewHomeLayout.tsx
14. src/components/layout/MainLayout.tsx
15. src/components/layout/HeaderBar.tsx
16. src/components/layout/DockBar.tsx
17. src/components/common/VolumeOverlay.tsx
18. src/components/common/MagicContextCard.tsx
19. src/components/media/MediaScreen.tsx
20. src/components/home/SmartCardStack.tsx
21. src/components/home/VehicleReminderWidget.tsx
22. src/components/home/layouts/ReplicationCockpit.tsx
23. src/components/home/layouts/LayoutSwitcher.tsx
24. src/components/modals/SetupWizard.tsx
25. src/components/modals/VehicleReminderModal.tsx
26. src/components/obd/MaintenancePanel.tsx
27. src/components/theater/TheaterOverlay.tsx
28. src/App.tsx

## Exception (Dokunma — Bunlar Zaten Doğru)

Aşağıdakiler doğru kullanıyor, dokunma:
- src/components/map/FullMapView.tsx
- src/components/map/MiniMapWidget.tsx
- src/hooks/useSABDirectUpdate.ts
- src/hooks/useOBDSpeed.ts
- src/hooks/useOBDRPM.ts
- src/platform/obdService.ts
- src/platform/gpsService.ts

## Anti-Pattern Tipleri

| Tipler | Durum |
|--------|-------|
| `{ settings }` sadece props geçirmek için | Props drilling'i kaldır, sadece gerekli alanı al |
| `{ settings }` + iç içe objeler | Böl, ayrı selector'lar kullan |
| `{ settings, updateSettings }` | Böl: selector + action ayrı al |
| `.getState()` kullanımı | Bırak — okuma için selector, yazma için action kullan |

## Test Et

Düzeltmeden sonra şunu kontrol et:
1. `npm run build` — TypeScript hataları yok
2. `npm run lint` — ESLint hataları yok
3. Uygulama açıldığında SettingsPage'i açıp dil değiştir — HeaderBar re-render olmamalı

---

# Claude Prompt

Yukarıdaki 28 dosyanın her birinde Zustand anti-pattern taraması yap.
Her dosyayı dosya okuyarak tara, grep ile değil.
Bulunan her anti-pattern için rapor formatını kullan.
Düzeltme önerme, sadece raporla.
Sonra özetle kaç dosyada kaç anti-pattern bulunduğunu raporla.
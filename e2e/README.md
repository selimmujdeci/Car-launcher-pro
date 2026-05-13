# CockpitOS E2E Tests

Playwright tabanlı end-to-end testler.

## Kurulum

```bash
# Playwright ve dependencies
npx playwright install --with-deps chromium

# veya npm script
npm run postinstall
```

## Test Çalıştırma

```bash
# Tüm testler (headless)
npm run test:e2e

# UI modunda (interaktif)
npm run test:e2e:ui

# headed (görünür tarayıcı)
npm run test:e2e:headed

# Rapor görüntüle
npm run test:e2e:report
```

## Test Kategorileri

| Dosya | Açıklama |
|-------|----------|
| `app.spec.ts` | Boot sequence, ErrorBoundary, portrait warning |
| `navigation.spec.ts` | App grid, phone, maps, POI search |
| `obd.spec.ts` | OBD mock mode, speedometer, RPM, fuel |
| `theme.spec.ts` | Theme switching, night mode, widget styles |
| `safety.spec.ts` | Reverse overlay priority, radar HUD, geofence |
| `settings.spec.ts` | Settings drawer, language, volume, performance |
| `smart-engine.spec.ts` | Driving mode detection, quick actions, AI recs |
| `error-handling.spec.ts` | Error boundaries, console errors, safeStorage |

## Browser Desteği

- Chromium (Desktop + Mobile)
- Firefox
- Safari (WebKit)
- Mobile Chrome (Pixel 5)
- Mobile Safari (iPhone 12)

## CI/CD

GitHub Actions otomatik çalışır:

```yaml
- run: npm run test:e2e
  env:
    CI: true
```

`CI=true` ile:
- Retries: 2
- Workers: 1
- Trace: first-retry
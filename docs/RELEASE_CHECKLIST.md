# 🚦 CAROS PRO — SATIŞ / PRODUCTION YAYIN KONTROL LİSTESİ

> **Bu belge bugünkü durumu ANLATIR, gelecekteki bir durumu ilan ETMEZ.**
> Aşağıdaki maddelerin hiçbiri "yapıldı" değildir — CAROS PRO şu an
> **geliştirme + aile içi saha testi** aşamasındadır.

---

## 0. Bugünkü ürün gerçeği (2026-07-26)

- CAROS PRO **son kullanıcı ürünü değildir**; Play Store veya genel kullanıcı
  dağıtımı **YOKTUR**. Uygulamayı yalnız proje sahibi ve ağabeyleri kullanır.
- Bu yüzden **geliştirme/test APK'sında geliştirici yüzeyleri BİLİNÇLİ OLARAK
  AÇIKTIR**: CAROS LAB, Debug Panel ve geliştirici kısayolları, test APK'sını
  kuran **her cihazda** ve **her rolde** (varsayılan `driver` dâhil) görünür.
- Erişim **rol atamasına, `canDebug` iznine, localStorage'a veya gizli
  mühendislik girişine BAĞLI DEĞİLDİR** — cihazlar arası ayar taşımak gerekmez.

Tek otorite: `src/platform/debug/developerFeatures.ts`

```ts
export const DEVELOPER_FEATURES_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_PANEL === 'true';
```

Bu bayrağı **bu makinede** açan dosya: `.env.production.local`
(`.gitignore` → `.env.*.local`, depoda izlenmez).

---

## 1. 🔴 Satış build'i öncesi ZORUNLU adımlar

| # | Adım | Nasıl doğrulanır |
|---|------|------------------|
| 1 | **`.env.production.local` içindeki `VITE_ENABLE_DEBUG_PANEL=true` satırını sil** (veya dosyayı kaldır). Build makinesinde/CI'da bu bayrak **hiçbir biçimde** set edilmemeli. | `env \| grep VITE_ENABLE_DEBUG_PANEL` → boş |
| 2 | `VITE_ENABLE_INSPECTOR` de set **edilmemeli** (DevInspector ayrı bayrak). | aynı yöntem |
| 3 | Satış konfigürasyonuyla build al: `npx vite build` | build başarılı |
| 4 | **Bundle'da kapı sabitinin `false`'a katlandığını doğrula.** | `grep -o "developerFeaturesEnabled:![01]" dist/assets/main-*.js` → **`developerFeaturesEnabled:!1`** (`!1` = false) |
| 5 | Cihazda: CAROS LAB kartı **görünmemeli**, dock kısayolu **olmamalı**, 5-parmak debug tetikleyicisi **çalışmamalı**. | gerçek APK ile elle |
| 6 | Cihazda: `super_admin` rolüne geçilse bile geliştirici yüzeyleri **açılmamalı**. | gerçek APK ile elle |

**Ölçülmüş durum (2026-07-26):** 4. madde bu makinede `.env.production.local`
geçici olarak kaldırılıp gerçek `vite build` alınarak **doğrulanmıştır** —
derlenmiş çıktı `developerFeaturesEnabled:!1` üretir ve `shouldRenderCarosLab`
`!0===t` şartını korur (kapı çalışma zamanında KAPALI).
**5. ve 6. maddeler CİHAZDA DOĞRULANMAMIŞTIR** (bkz. `DEVICE_VALIDATION_LEDGER.md` #117).

---

## 2. ⚠️ Bilinen sınır — kapı kapalı ama kod hâlâ pakette

Satış konfigürasyonuyla alınan build'de kapı `false`'a katlanır ve **hiçbir
geliştirici yüzeyi render edilmez**; ancak `CarosLabShell`, `DebugPanel` ve LAB
ekran chunk'ları **APK içinde yine de bulunur** (~8 chunk). Sebep: `lazy(() =>
import(...))` çağrıları modül seviyesinde koşulsuzdur, bu yüzden bundler ölü kod
olarak eleyemez.

- Bu **yeni bir gerileme değildir** — eski rol tabanlı kapıda da aynıydı.
- **Güvenlik etkisi:** yüzey erişilemez (fail-closed), fakat kod okunabilir.
- **Sertleştirme önerisi (ayrı, atomik tur):** `App.tsx`'teki `DevInspector`
  deseni uygulanmalı —
  `const X = FLAG ? lazy(() => import('...')) : null;`
  Böylece bayrak kapalıyken dinamik import ölü dalda kalır ve chunk **hiç emit
  edilmez**. Bu tur yapılmadan "kod pakette yok" **yazılmamalıdır**.

---

## 3. Rol sistemi neden duruyor?

`canDebug` izni rol modelinden **silinmedi** (`technician` · `admin` ·
`super_admin`). Yalnız *geliştirici yüzeyi görünürlüğü* ondan ayrıldı.
Gerekçe: satış sonrası **servis/mühendis modu** için ikinci kapı olarak yeniden
kullanılacaktır — o zaman kural `DEVELOPER_FEATURES_ENABLED || canDebug`
biçiminde genişletilebilir. İzni şimdi silmek, o günü daha pahalı yapardı.

Normal uygulama yetkileri (`reverseCamera` · `obdData` · `settingsFull` ·
`accessAdminPanel`) **hiç değişmedi**; Süper Admin kartı hâlâ role bağlıdır.

---

## 4. Diğer satış öncesi maddeler (bu turun kapsamı dışında, hatırlatma)

- [ ] `npx license-checker --summary` — kopyaleft (GPL/AGPL/LGPL/SSPL) **çıkmamalı**.
- [ ] Gömülü/merkezi AI anahtarı **bulunmamalı** (BYOK kuralı).
- [ ] `© OpenStreetMap katkıcıları` atıfı ekranda görünmeli (ODbL).
- [ ] Supabase: yeni tablolarda GRANT + RLS + policy üçlüsü tamam olmalı.
- [ ] `docs/DEVICE_VALIDATION_LEDGER.md` içinde 🔴 bekleyen madde "hazır" diye sunulmamalı.

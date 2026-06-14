import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import legacy from '@vitejs/plugin-legacy'
import type { Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseVersionProperties, VERSION_FALLBACK } from './src/utils/versionProperties'

// ── Sürüm enjeksiyonu (OTA v1 / Commit 1 — device version truth) ─────────────
// VITE_APP_VERSION daha önce HİÇBİR yerde set edilmiyordu → SystemHealthMonitor
// her cihazda '1.0.0' raporluyor, RolloutCenter circuit breaker kör kalıyordu.
// Tek kaynak version.properties; build.gradle de aynı dosyayı okur → APK ile
// web asset sürümü aynı build'de drift edemez. Runtime'da native
// getAppVersionInfo (PackageManager) bu değeri ezer (kurulu gerçek).
const _versionProps = (() => {
  try {
    const path = fileURLToPath(new URL('./version.properties', import.meta.url))
    return parseVersionProperties(readFileSync(path, 'utf-8'))
  } catch {
    return VERSION_FALLBACK // dosya yoksa gradle fallback'leriyle aynı değerler
  }
})()

/**
 * addWebkitBackdropFilter — Android WebView uyumluluk fix
 *
 * backdrop-filter, Android 10 öncesi WebView'larda -webkit- prefix olmadan
 * çalışmaz. Bu plugin build çıktısındaki tüm backdrop-filter kurallarına
 * otomatik olarak -webkit-backdrop-filter: aynı_değer satırı ekler.
 */
function addWebkitBackdropFilter(): Plugin {
  return {
    name: 'webkit-backdrop-filter',
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && String(chunk.fileName).endsWith('.css')) {
          chunk.source = (chunk.source as string).replace(
            /(?<!-webkit-)backdrop-filter\s*:\s*([^;!]+?)(\s*!important)?\s*;/g,
            (_match, value, imp) => {
              const important = imp ? ' !important' : '';
              return `-webkit-backdrop-filter: ${value.trim()}${important}; backdrop-filter: ${value.trim()}${important};`;
            },
          );
        }
      }
    },
  };
}

/**
 * flattenCssLayers — Android 10 WebView uyumluluk fix
 *
 * Tailwind v4 tüm stillerini CSS @layer blokları içine yazar.
 * @layer cascade layers Chrome 99+ gerektirir. Android 10 araç tabletlerindeki
 * WebView genellikle Chrome 74-85 aralığındadır ve @layer desteklemez —
 * bu da tüm CSS'in yoksayılmasına ve siyah ekrana yol açar.
 *
 * Bu plugin build çıktısındaki @layer sarmalayıcılarını kaldırır,
 * içerik olduğu gibi kalır. Stil önceliği değişmez, tüm cihazlarda çalışır.
 */
function flattenCssLayers(): Plugin {
  return {
    name: 'flatten-css-layers',
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && String(chunk.fileName).endsWith('.css')) {
          chunk.source = removeLayers(chunk.source as string);
        }
      }
    },
  };
}

/**
 * fixLegacyModernDetection — Chrome 101 WebView uyumluluk fix (KRİTİK perf)
 *
 * @vitejs/plugin-legacy@8 modern-tarayıcı tespit script'ine `import.meta.resolve`
 * probe'u ekledi (Chrome 105+ özelliği). Head unit WebView'ı Chrome 101 →
 * probe exception atıyor → __vite_is_modern_browser set EDİLMİYOR → app ağır
 * legacy ES5/SystemJS bundle'a düşüyor (cihazda 9.7sn UI freeze + SAFE_MODE).
 * Modern bundle target'ı es2015 → Chrome 101 zaten sorunsuz çalıştırır; sorun
 * yalnızca aşırı-katı tespit. Bu plugin HTML'den SADECE import.meta.resolve
 * probe'unu çıkarır; kalan testler (import.meta.url / dynamic import / async
 * generator) korunur → gerçek eski tarayıcılar yine legacy'ye düşer.
 */
function fixLegacyModernDetection(): Plugin {
  // (1) HTML tespit script'indeki probe:  import'data:...,if(!import.meta.resolve)throw...'
  const HTML_PROBE = /import'data:text\/javascript,if\(!import\.meta\.resolve\)throw Error\("import\.meta\.resolve not supported"\)';/g;
  // (2) Modern chunk başına enjekte edilen __vite_legacy_guard'ın probe satırı:
  //     import'data:...,"assets/<file>";if(!import.meta.resolve)throw...'
  const CHUNK_PROBE = /import'data:text\/javascript,"[^"]*";if\(!import\.meta\.resolve\)throw Error\("import\.meta\.resolve not supported"\)';/g;
  return {
    name: 'fix-legacy-modern-detection',
    // 'post' + dizide legacy()'den SONRA → plugin-legacy tespit script'ini
    // enjekte ETTİKTEN sonra çalışır, HTML probe'unu çıkarır.
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        return html.replace(HTML_PROBE, '');
      },
    },
    // Modern entry chunk'ına prepend edilen import.meta.resolve guard'ını sil.
    // Kalan __vite_legacy_guard (import.meta.url / dynamic import / async gen)
    // Chrome 101'de zaten destekli → dokunma.
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') {
          chunk.code = chunk.code.replace(CHUNK_PROBE, '');
        }
      }
    },
  };
}

function removeLayers(css: string): string {
  let result = '';
  let i = 0;
  const len = css.length;

  while (i < len) {
    if (css[i] === '@' && css.slice(i, i + 7) === '@layer ') {
      // @layer name; → sadece sil (order declaration)
      const semi = css.indexOf(';', i);
      const brace = css.indexOf('{', i);
      if (semi !== -1 && (brace === -1 || semi < brace)) {
        i = semi + 1;
        continue;
      }
      // @layer name { ... } → { ve } sil, içeriği koru
      if (brace !== -1) {
        i = brace + 1; // opening { sonrasına atla
        let depth = 1;
        const contentStart = i;
        while (i < len && depth > 0) {
          if (css[i] === '{') depth++;
          else if (css[i] === '}') {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        result += css.slice(contentStart, i); // içeriği ekle, } hariç
        i++; // closing } atla
        continue;
      }
    }
    result += css[i];
    i++;
  }
  return result;
}

// COOP/COEP KAPALI — dev ortamını APK ile eşitler.
//
// Geçmiş: COEP (require-corp→credentialless) SharedArrayBuffer/crossOriginIsolated
// için açıktı. ANCAK COEP, COEP başlığı göndermeyen çapraz-köken IFRAME'leri
// bloklar → YouTube IFrame oynatıcısı dev'de yüklenemiyordu.
// APK zaten COEP göndermiyor (orada crossOriginIsolated=false, SAB → BASIC_JS
// fallback). Dev'i de COEP'siz bırakınca: (1) YouTube iframe çalışır, (2) tüm
// ses akışları (Audius/Jamendo/Archive/radyo) CORP gerekmeden yüklenir,
// (3) runtime APK ile aynı BASIC_JS yolunu kullanır. SAB yolu yine COEP'li bir
// web dağıtımında (carospro.com) aktif olur; dev artık onu test etmez.
const _coopCoepHeaders: Record<string, string> = {};

export default defineConfig({
  define: {
    // Kaynak: version.properties (yukarıdaki _versionProps). import.meta.env
    // anahtarları derlemede literal'e çevrilir — runtime env DEĞİL.
    'import.meta.env.VITE_APP_VERSION':      JSON.stringify(_versionProps.versionName),
    'import.meta.env.VITE_APP_VERSION_CODE': JSON.stringify(String(_versionProps.versionCode)),
  },
  // host 127.0.0.1: Spotify OAuth loopback redirect'i IPv4 ister. Varsayılan
  // "localhost" Windows'ta ::1'e (IPv6) bağlanıp 127.0.0.1'i reddediyordu.
  server:  { host: '127.0.0.1', port: 5173, strictPort: true, headers: _coopCoepHeaders },
  preview: { headers: _coopCoepHeaders },
  optimizeDeps: {
    // Vite 8/rolldown CJS interop fix: react-i18next → use-sync-external-store/shim
    // require("react") çağrısı React chunk'u hazır olmadan çalıştığında null döner.
    // include listesi bu paketleri React ile aynı pre-bundle oturumuna çeker.
    include: [
      'react',
      'react-dom',
      'react-i18next',
      'i18next',
      'i18next-browser-languagedetector',
      'use-sync-external-store/shim',
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    addWebkitBackdropFilter(),
    flattenCssLayers(),
    legacy({
      targets: ['Chrome >= 50', 'Android >= 6'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderModernChunks: true,
      polyfills: true,
    }),
    fixLegacyModernDetection(), // legacy()'den SONRA: enjekte edilen probe'u çıkarır
  ],
  build: {
    target: 'es2015',
    // Vite 8 modulepreload helper'ı `import.meta.resolve` (Chrome 105+) üretiyor →
    // Chrome 101 head unit WebView'da modern bundle bootstrap'ta çöküp ağır legacy'ye
    // düşüyordu (9.7sn freeze + SAFE_MODE). Tek-WebView yerel asset'te preload kazancı
    // ihmal edilebilir; kapatınca import.meta.resolve hiç emit edilmez → modern bundle
    // Chrome 101'de native çalışır. (Detection script probe'u da fixLegacyModernDetection ile silinir.)
    modulePreload: false,
    cssTarget: 'chrome61', // Chrome 74 support
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      input: {
        main:  'index.html',
        admin: 'admin.html',
      },
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/maplibre-gl'))        return 'vendor-maplibre';
          if (id.includes('node_modules/react-dom'))          return 'vendor-react';
          if (id.includes('node_modules/react/'))             return 'vendor-react';
          if (id.includes('node_modules/zustand'))            return 'vendor-zustand';
        },
      },
    },
  },
})

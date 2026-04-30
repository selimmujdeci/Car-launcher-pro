import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import legacy from '@vitejs/plugin-legacy'
import type { Plugin } from 'vite'

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

// SharedArrayBuffer için zorunlu: COOP + COEP → crossOriginIsolated = true
const _coopCoepHeaders = {
  'Cross-Origin-Opener-Policy':   'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server:  { headers: _coopCoepHeaders },
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
  ],
  build: {
    target: 'es2015',
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

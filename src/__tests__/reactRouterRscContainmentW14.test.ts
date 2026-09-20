/**
 * reactRouterRscContainmentW14.test.ts — WAVE 14 · RSC MODU KAPALI KALIR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ADVISORY
 *   GHSA-qwww-vcr4-c8h2 — "React Router: RSC Mode CSRF Bypass Allows Action
 *   Execution Before 400 Response" · CWE-352 · HIGH
 *   Savunmasız: react-router >=7.12.0 <7.18.2 · İlk yamalı: 7.18.2
 *   Kurulu: 7.18.1 (react-router-dom 7.18.1 üzerinden) → ARALIK İÇİNDE.
 *
 * ── AÇIĞIN ÖN KOŞULU ──────────────────────────────────────────────────────
 * Mekanizma RSC MODUNA özgüdür: sunucu, RSC isteğini işlerken `action`
 * fonksiyonunu 400 yanıtı DÖNMEDEN ÖNCE çalıştırır → CSRF koruması atlanır.
 * Yani açık için ŞUNLAR GEREKİR:
 *   (1) RSC modu,
 *   (2) SUNUCU TARAFINDA çalışan bir React Router runtime'ı,
 *   (3) sunucuda yürütülen `action`.
 *
 * ── CAROS'TA NEDEN ERİŞİLEMEZ ─────────────────────────────────────────────
 * · React Router YALNIZ `src/admin/**` içinde ve YALNIZ `BrowserRouter`
 *   (klasik istemci modu) ile kullanılır. Head-unit uygulaması (`src/App.tsx`,
 *   `index.html`) React Router'ı HİÇ kullanmaz.
 * · Data router (`createBrowserRouter`/`RouterProvider`/`loader`/`action`) YOK.
 * · RSC API'leri (`RSCStaticRouter`, `matchRSCServerRequest`, … ) YOK.
 * · Build iki STATİK HTML girişidir (`index.html`, `admin.html`); Vite'ta
 *   `ssr` yapılandırması YOKTUR → sunucu runtime'ı YOK.
 * Zincirin ilk halkası kurulamadığı için açık ürün yüzeyinde OLUŞAMAZ.
 *
 * ── NEDEN YÜKSELTİLMEDİ ───────────────────────────────────────────────────
 * Yama 7.18.2 (aynı minor, patch) ve beyan aralığının (^7.18.1) içinde —
 * teknik olarak ucuz. ANCAK ölçüldüğünde `npm install` lockfile'a BAŞKA
 * OTURUMUN işini de yazıyordu (proje sürümü 1.0.2→1.0.3 senkronu + kök bloğun
 * `engines`/`@maplibre/...style-spec` ile normalize edilmesi). Bu, bu Wave'e
 * ait OLMAYAN churn'dür ve worktree güvenliğini ihlal ederdi. Açık
 * erişilemez olduğu için yükseltme, lockfile meşru biçimde yeniden
 * senkronlanabildiğinde yapılmak üzere ERTELENDİ.
 *
 * ── BU DOSYA NEYİ KORUR ───────────────────────────────────────────────────
 * Güvenliği sağlayan şey sürüm DEĞİL, RSC/sunucu ön koşulunun hiç kurulmamış
 * olmasıdır. Bu test o ön koşulu kilitler: RSC API'si, sunucu runtime'ı ya da
 * sunucuda yürütülen data-router `action`'ı eklenirse KIRMIZI olur — yani
 * yükseltme yapılmadan bu yüzey açılamaz.
 *
 * ── KANIT SEVİYESİ (dürüstlük) ────────────────────────────────────────────
 * YAPISAL KUŞATMA + YAPILANDIRMA ÖLÇÜMÜ. Doğrulanacak bir sunucu davranışı
 * YOKTUR (sunucu yok); kanıtlanan şey ön koşulun yokluğudur. Bu, "upstream
 * patch trust" değil, "mekanizma ürün yüzeyinde kurulamıyor" kanıtıdır.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();

/** RSC modunu kuran React Router yüzeyleri (advisory'nin ön koşulu). */
const RSC_APIS = [
  'RSCStaticRouter',
  'RSCHydratedRouter',
  'matchRSCServerRequest',
  'routeRSCServerRequest',
  'unstable_createCallServer',
  'unstable_RSC',
  '@react-router/server',
  'react-router/rsc',
];

/** Sunucuda `action` yürüten data-router yüzeyi. */
const DATA_ROUTER_APIS = ['createBrowserRouter', 'createHashRouter', 'createMemoryRouter', 'RouterProvider'];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const p = join(abs, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...walkTs(join(dir, entry)));
    } else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const SOURCES = [...walkTs('src'), ...walkTs('website/src')];
const read = (f: string): string => readFileSync(f, 'utf8');
const rel  = (f: string): string => f.slice(ROOT.length + 1).replace(/\\/g, '/');

/** React Router'ı gerçekten import eden üretim dosyaları. */
const ROUTER_CONSUMERS = SOURCES.filter((f) => /from\s+'react-router(-dom)?'/.test(read(f)));

// ── Ölçüm gerçekten çalışıyor mu ────────────────────────────────────────────

describe('W14 · router yüzeyi ölçülebiliyor', () => {
  it('kaynak taraması ve router tüketicileri bulundu', () => {
    expect(SOURCES.length, 'kaynak taraması boş — yürüyüş bozuk').toBeGreaterThan(100);
    expect(ROUTER_CONSUMERS.length, 'React Router tüketicisi bulunamadı — test kör olurdu')
      .toBeGreaterThan(0);
  });
});

// ── 1 · RSC ÖN KOŞULU YOK ───────────────────────────────────────────────────

describe('W14 · RSC modu ürün yüzeyinde kurulmaz', () => {
  it('hiçbir RSC API\'si kullanılmıyor', () => {
    const hits: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      for (const api of RSC_APIS) if (src.includes(api)) hits.push(`${rel(f)} → ${api}`);
    }
    expect(
      hits,
      'RSC yüzeyi eklendi — GHSA-qwww-vcr4-c8h2 ön koşulu kuruldu; bu yüzey '
      + 'açılmadan ÖNCE react-router >= 7.18.2 gerekir',
    ).toEqual([]);
  });

  it('sunucuda `action` yürüten data router kullanılmıyor', () => {
    const hits: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      for (const api of DATA_ROUTER_APIS) {
        if (new RegExp(`\\b${api}\\b`).test(src)) hits.push(`${rel(f)} → ${api}`);
      }
    }
    expect(hits, 'data router eklendi — sunucu `action` yürütme yolunun ilk adımı').toEqual([]);
  });
});

// ── 2 · SUNUCU RUNTIME'I YOK (yapılandırma ölçümü) ──────────────────────────

describe('W14 · build yalnız statik istemci çıktısı üretir', () => {
  const VITE = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');

  it('Vite `ssr` yapılandırması YOK', () => {
    /* `server:` dev sunucusudur (host/port) — SSR değildir; `ssr:` alanı ya da
       middlewareMode SSR runtime'ı işaret eder. */
    expect(/\bssr\s*:/.test(VITE), 'Vite ssr yapılandırması eklenmiş — sunucu runtime\'ı doğuyor')
      .toBe(false);
    expect(/middlewareMode/.test(VITE), 'middlewareMode eklenmiş — SSR runtime\'ı').toBe(false);
  });

  it('build girişleri STATİK HTML\'dir', () => {
    const inputs = [...VITE.matchAll(/(\w+)\s*:\s*'([^']+\.html)'/g)].map((m) => m[2]);
    expect(inputs.length, 'HTML build girişi bulunamadı').toBeGreaterThan(0);
    for (const i of inputs) {
      expect(existsSync(resolve(ROOT, i)), `build girişi diskte yok: ${i}`).toBe(true);
    }
  });
});

// ── 3 · BLAST RADIUS: head-unit uygulaması router kullanmaz ────────────────

describe('W14 · React Router admin paketiyle sınırlı', () => {
  it('head-unit uygulaması React Router\'ı import ETMEZ', () => {
    const leaked = ROUTER_CONSUMERS
      .map(rel)
      .filter((f) => f.startsWith('src/') && !f.startsWith('src/admin/'));
    expect(
      leaked,
      'React Router head-unit paketine sızdı — advisory blast radius\'u araç '
      + 'uygulamasına genişler (bugün yalnız ayrı admin.html paketinde)',
    ).toEqual([]);
  });

  it('admin yalnız bildirimsel `BrowserRouter` kullanır', () => {
    const appTsx = resolve(ROOT, 'src/admin/App.tsx');
    expect(existsSync(appTsx), 'admin App.tsx bulunamadı').toBe(true);
    expect(read(appTsx)).toMatch(/<BrowserRouter\b/);
  });
});

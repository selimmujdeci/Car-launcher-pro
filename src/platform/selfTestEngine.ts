/**
 * selfTestEngine.ts — "Tanı Robotu" · on-device aktif self-test tarayıcı.
 *
 * AMAÇ: "Tanı Gönder" pasif snapshot'ın ötesine geçer — butona basınca robot
 * uygulamanın içinde dolaşıp HER ALT SİSTEMİN KAPISINI tek tek çalar
 * ("çalışıyor musun? cevap ver"), cevap vermeyeni/hata vereni yakalar ve
 * mevcut tanı hattından (support_snapshot → vehicle_events → /admin/tani)
 * panele yollar. Gerçek arabalardaki "self-test / diagnostik mod" mantığı.
 *
 * ÖZELLİKLE (kullanıcı vurgusu): GİZLİ RENDER performans sorunlarını avlar —
 * boşta 60fps rAF ısınması, çoklu/duplike WebGL (harita) bağlamı, ekran-dışı
 * çalışan animasyonlar (SMIL/CSS), uzun task'lar, heap baskısı. Bu uygulamada
 * defalarca ısı/kasma kökü olan desenler (K24 PowerVR thrash, perf-low SMIL).
 *
 * GÜVENLİK (anayasa: fail-soft · yan-etkisiz · zaman-bütçeli):
 *   - Her prob İZOLE + ZAMAN-SINIRLI: biri donarsa/patlarsa tarama durmaz
 *     (fail → 'fail' sonucu, throw yutulur). Toplam bütçe ~5 sn.
 *   - Hiçbir prob araç aktüatörünü TETİKLEMEZ (kapı/kamera/komut yok). Canlı
 *     ekran navigasyonu YAPILMAZ — sadece gözlem + hafif DOM/worker yoklaması.
 *   - Her tarayıcı API'si feature-detect'li → eski WebView'de (Chrome 64-78)
 *     yoksa prob 'skip' der, çökmez.
 *   - Ağır render örneklemesi yalnız istendiğinde (parked/manuel) çalışır.
 */

import { getCapabilities, getDeviceTier } from './deviceCapabilities';

/* ── Tipler ──────────────────────────────────────────────────── */

export type ProbeStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type ProbeCategory =
  | 'storage' | 'network' | 'workers' | 'render'
  | 'sensors' | 'permissions' | 'health' | 'screens';

export interface ProbeResult {
  name:       string;
  category:   ProbeCategory;
  status:     ProbeStatus;
  detail:     string;          // insan-okur kısa açıklama (PII yok)
  metric?:    number;          // ölçülen sayısal (ms/fps/adet) — panelde faydalı
  durationMs: number;
}

export interface SelfTestReport {
  version:  1;
  totalMs:  number;
  worst:    ProbeStatus;                       // en kötü sonuç (fail>warn>pass>skip)
  summary:  Record<ProbeStatus, number>;
  env:      { tier: string; webView: number; cores: number; memoryMb: number };
  results:  ProbeResult[];
}

export interface SelfTestOptions {
  /** Ağır render örneklemesi (idle-fps/animasyon taraması) çalışsın mı. */
  includeRenderScan?: boolean;
  /** Ekran kayıt-defteri bütünlük kontrolü çalışsın mı. */
  includeScreens?:    boolean;
}

/* ── Yardımcılar ─────────────────────────────────────────────── */

const STATUS_RANK: Record<ProbeStatus, number> = { skip: 0, pass: 1, warn: 2, fail: 3 };

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Prob'u zaman-sınırlı + izole çalıştırır: throw/timeout → 'fail' sonucu. */
async function runProbe(
  name: string,
  category: ProbeCategory,
  timeoutMs: number,
  fn: () => Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>>,
): Promise<ProbeResult> {
  const started = now();
  try {
    const raced = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { name, category, durationMs: Math.round(now() - started), ...raced };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name, category,
      status: 'fail',
      detail: msg === 'timeout' ? `zaman aşımı (>${timeoutMs}ms)` : `hata: ${msg.slice(0, 120)}`,
      durationMs: Math.round(now() - started),
    };
  }
}

/* ── Prob: DEPOLAMA ──────────────────────────────────────────── */

async function probeLocalStorage(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof localStorage === 'undefined') return { status: 'skip', detail: 'localStorage yok' };
  const k = '__selftest__' + Math.floor(now());
  localStorage.setItem(k, '1');
  const v = localStorage.getItem(k);
  localStorage.removeItem(k);
  if (v !== '1') throw new Error('yaz/oku uyuşmadı');
  return { status: 'pass', detail: 'yaz/oku/sil OK' };
}

async function probeIndexedDb(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof indexedDB === 'undefined') return { status: 'skip', detail: 'IndexedDB yok' };
  return new Promise((resolve, reject) => {
    let done = false;
    const req = indexedDB.open('__selftest_db__', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('t'); };
    req.onerror = () => reject(new Error('open hata'));
    req.onsuccess = () => {
      try {
        const db = req.result;
        const tx = db.transaction('t', 'readwrite');
        tx.objectStore('t').put('1', 'k');
        tx.oncomplete = () => {
          db.close();
          indexedDB.deleteDatabase('__selftest_db__');
          if (!done) { done = true; resolve({ status: 'pass', detail: 'aç/yaz/sil OK' }); }
        };
        tx.onerror = () => reject(new Error('tx hata'));
      } catch (e) { reject(e instanceof Error ? e : new Error('idb hata')); }
    };
  });
}

/* ── Prob: AĞ / BACKEND ──────────────────────────────────────── */

async function probeBackend(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (typeof fetch === 'undefined')  return { status: 'skip', detail: 'fetch yok' };
  if (!url || !anon)                 return { status: 'skip', detail: 'Supabase env yok (BYOK boş)' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return { status: 'warn', detail: 'cihaz çevrimdışı (onLine=false)' };

  const t0 = now();
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 3500) : null;
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: anon },
      signal: ctrl?.signal,
    });
    if (timer) clearTimeout(timer);
    const ms = Math.round(now() - t0);
    if (!res.ok && res.status >= 500) return { status: 'fail', detail: `backend ${res.status}`, metric: ms };
    if (ms > 1500) return { status: 'warn', detail: `yavaş (${ms}ms)`, metric: ms };
    return { status: 'pass', detail: `erişilebilir (${ms}ms)`, metric: ms };
  } catch (e) {
    if (timer) clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'fail', detail: `ulaşılamadı: ${msg.slice(0, 80)}` };
  }
}

/* ── Prob: WORKER'LAR + ANA THREAD ───────────────────────────── */

async function probeWorkerRoundTrip(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function')
    return { status: 'skip', detail: 'Worker/Blob yok' };

  const src = 'onmessage=function(e){postMessage(e.data)}';
  const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(blobUrl);
  const t0 = now();
  try {
    const rtt = await new Promise<number>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('pong gelmedi')), 2000);
      worker.onmessage = () => { clearTimeout(to); resolve(now() - t0); };
      worker.onerror   = () => { clearTimeout(to); reject(new Error('worker error')); };
      worker.postMessage('ping');
    });
    const ms = Math.round(rtt);
    return { status: ms > 500 ? 'warn' : 'pass', detail: `round-trip ${ms}ms`, metric: ms };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(blobUrl);
  }
}

async function probeMainThread(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  // setTimeout(0) drift'i → ana thread ne kadar tıkalı (event loop gecikmesi).
  const samples = 5;
  let maxDrift = 0;
  for (let i = 0; i < samples; i++) {
    const t = now();
    await new Promise<void>((r) => setTimeout(r, 0));
    maxDrift = Math.max(maxDrift, now() - t);
  }
  const ms = Math.round(maxDrift);
  if (ms > 250) return { status: 'fail', detail: `ana thread çok tıkalı (${ms}ms drift)`, metric: ms };
  if (ms > 80)  return { status: 'warn', detail: `ana thread gecikmesi (${ms}ms)`, metric: ms };
  return { status: 'pass', detail: `akıcı (${ms}ms drift)`, metric: ms };
}

/* ── Prob: RENDER / GİZLİ-RENDER PERFORMANSI (öncelik) ────────── */

async function probeCanvasContexts(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof document === 'undefined') return { status: 'skip', detail: 'DOM yok' };
  const canvases = Array.from(document.querySelectorAll('canvas'));
  let largeAlive = 0;
  let totalMPix = 0;
  for (const c of canvases) {
    const w = c.width || 0, h = c.height || 0;
    const mpix = (w * h) / 1_000_000;
    totalMPix += mpix;
    // "Büyük + görünmez ama canlı" = boşuna WebGL bağlamı (harita thrash riski)
    const visible = c.offsetParent !== null && (c.getClientRects?.().length ?? 0) > 0;
    if (mpix > 0.15 && !visible) largeAlive++;
  }
  const detail = `${canvases.length} canvas · ${totalMPix.toFixed(1)}MPix · gizli-büyük ${largeAlive}`;
  // Birden fazla büyük WebGL bağlamı düşük-uç GPU'da (Mali/PowerVR) thrash yapar
  if (largeAlive >= 1) return { status: 'warn', detail: detail + ' → gizli WebGL bağlamı boşuna render olabilir', metric: largeAlive };
  if (canvases.length > 4) return { status: 'warn', detail, metric: canvases.length };
  return { status: 'pass', detail, metric: canvases.length };
}

/**
 * rAF'ı çağıran kodun stack'inden ilk UYGULAMA karesini çıkarır (bu prob'un
 * kendi sarmalayıcı kareleri atlanır). Dev'de `tick@FullMapView.tsx:814` gibi
 * anlamlı; prod (minified) build'de `index-abc.js:1:45678` gibi stabil bir
 * konum verir (tek başına dosya adı değil ama tekrarlı gözlemle izlenebilir).
 * Suçluyu TAHMİN etmek yerine cihazın kendisi söylesin diye — "don't guess".
 */
function _rafCallerFrame(): string | null {
  let stack: string | undefined;
  try { stack = new Error().stack; } catch { return null; }
  if (!stack) return null;
  const frames = stack.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '));
  // İlk iki kare bu prob'un sarmalayıcısı (_rafCallerFrame + wrapped arrow) —
  // hem dev hem minified'de sabit; atla. Sonra dev'de kalan selftest karelerini de ele.
  for (let i = 2; i < frames.length; i++) {
    const line = frames[i];
    if (line.includes('selfTestEngine') || line.includes('_rafCallerFrame')) continue;
    const loc = line.match(/\(?([^()\s]+):(\d+):(\d+)\)?$/);
    if (!loc) continue;
    const file = loc[1].split(/[/\\]/).pop() ?? loc[1];
    const fnMatch = line.match(/^at\s+([^\s(]+)\s+\(/);
    const fn = fnMatch && fnMatch[1] !== 'Object' && fnMatch[1] !== 'new' ? fnMatch[1] : '';
    return fn ? `${fn}@${file}:${loc[2]}` : `${file}:${loc[2]}`;
  }
  return null;
}

/** Ekranda MapLibre haritası var mı — gizli render döngüsü çoğunlukla harita repaint'i. */
function _renderSurfaceHint(): string {
  try {
    if (typeof document === 'undefined') return '';
    const maps = document.querySelectorAll('.maplibregl-map').length;
    if (maps > 0) return `maplibre×${maps}`;
    const canvases = document.querySelectorAll('canvas').length;
    return canvases > 0 ? `canvas×${canvases}` : 'harita-yok';
  } catch { return ''; }
}

async function probeIdleRenderLoop(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function')
    return { status: 'skip', detail: 'rAF yok' };

  // DOĞRU ölçüm: prob KENDİSİ rAF ÇAĞIRMAZ. (Rekürsif rAF, tarayıcı tarafından
  // ekran tazeleme hızında beslenir → her cihazda ~refresh fps "yanılması"
  // verirdi; render döngüsü olup olmadığını AYIRT EDEMEZ.) Bunun yerine ~900ms
  // boyunca window.requestAnimationFrame'i geçici sarıp BAŞKA kodun (harita/
  // animasyon döngüleri) kaç kez frame İSTEDİĞİNİ sayarız. Boşta hiç istek
  // gelmezse 0 = on-demand (iyi); sürekli istek = gerçek gizli render döngüsü
  // (bu uygulamada FullMapView kalıcı rAF tick'i defalarca ısı/kasma köküydü).
  //
  // GENİŞLİK (2026-07-06): döngü tespit edilirse çağıranın stack karesi de
  // örneklenir → rapor suçlu kaynağı ADIYLA verir (tahmin yok). Stack yakalama
  // yalnız ilk SAMPLE_CAP istekte yapılır (overhead sınırı; tek-atış tanı).
  const orig = window.requestAnimationFrame;
  let count = 0;
  let sampled = 0;
  const SAMPLE_CAP = 120;
  const callerFreq = new Map<string, number>();
  const wrapped = ((cb: FrameRequestCallback): number => {
    if (sampled < SAMPLE_CAP) {
      sampled++;
      const f = _rafCallerFrame();
      if (f) callerFreq.set(f, (callerFreq.get(f) ?? 0) + 1);
    }
    return orig.call(window, (t: number) => { count++; cb(t); });
  }) as typeof window.requestAnimationFrame;
  window.requestAnimationFrame = wrapped;

  const windowMs = 900;
  const start = now();
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, windowMs));
  } finally {
    // Yalnız biz değiştirdiysek geri koy (arada başka sarma olduysa dokunma).
    if (window.requestAnimationFrame === wrapped) window.requestAnimationFrame = orig;
  }

  const secs = Math.max(0.001, (now() - start) / 1000);
  const fps  = Math.round(count / secs);

  // Baskın çağıran (en sık rAF isteyen kare) — sürekli döngüyü ara sıra
  // istekten ayırır.
  let topCaller: string | null = null;
  let topN = 0;
  for (const [k, v] of callerFreq) if (v > topN) { topN = v; topCaller = k; }
  const source = topCaller
    ? ` · kaynak≈${topCaller}${topN ? ` (×${topN})` : ''}`
    : '';
  const surface = _renderSurfaceHint();
  const surfTag = surface ? ` [${surface}]` : '';

  if (fps >= 45) return { status: 'warn', detail: `boşta ~${fps} frame/sn istek → GİZLİ RENDER DÖNGÜSÜ (CPU/ısı boşuna)${source}${surfTag}`, metric: fps };
  if (fps >= 20) return { status: 'warn', detail: `boşta ~${fps} frame/sn — kısmi render aktivitesi${source}${surfTag}`, metric: fps };
  return { status: 'pass', detail: `boşta ~${fps} frame/sn (on-demand — iyi)`, metric: fps };
}

interface AnimatableDoc { getAnimations?: () => Array<{ playState?: string; effect?: { target?: Element | null } | null }>; }

async function probeHiddenAnimations(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof document === 'undefined') return { status: 'skip', detail: 'DOM yok' };
  const tier = getDeviceTier();

  // Tercih: Web Animations API (Chrome 84+) — kesin ve ucuz.
  const gdoc = document as unknown as AnimatableDoc;
  if (typeof gdoc.getAnimations === 'function') {
    let running = 0, hiddenRunning = 0;
    for (const a of gdoc.getAnimations()) {
      if (a.playState !== 'running') continue;
      running++;
      const el = a.effect?.target ?? null;
      if (el && (el as HTMLElement).offsetParent === null) hiddenRunning++;
    }
    const detail = `${running} çalışan animasyon · gizli ${hiddenRunning}`;
    if (hiddenRunning > 0) return { status: 'warn', detail: detail + ' → görünmezken CPU/GPU yakıyor', metric: hiddenRunning };
    if (tier === 'low' && running > 6)
      return { status: 'warn', detail: detail + ` (düşük-tier ${tier})`, metric: running };
    return { status: 'pass', detail, metric: running };
  }

  // Yedek (eski WebView): CSS animation/SVG SMIL taraması — zaman-bütçeli, kaplı.
  const CAP = 1500;
  const nodes = document.querySelectorAll('*');
  const limit = Math.min(nodes.length, CAP);
  let animated = 0, hiddenAnimated = 0, smil = 0;
  const deadline = now() + 40;
  for (let i = 0; i < limit; i++) {
    if (now() > deadline) break;
    const el = nodes[i] as HTMLElement;
    const tag = el.tagName;
    if (tag === 'animate' || tag === 'animateTransform' || tag === 'animateMotion') { smil++; continue; }
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const anim = cs?.animationName;
    if (anim && anim !== 'none') {
      animated++;
      if (el.offsetParent === null) hiddenAnimated++;
    }
  }
  const detail = `CSS-anim ${animated} (gizli ${hiddenAnimated}) · SMIL ${smil} · tarandı ${limit}/${nodes.length}`;
  if (hiddenAnimated > 0 || (tier === 'low' && smil > 0))
    return { status: 'warn', detail: detail + ' → gizli/düşük-tier animasyon boşuna render', metric: hiddenAnimated + smil };
  return { status: 'pass', detail, metric: animated + smil };
}

interface HeapPerf { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number }; }

async function probeMemory(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  const mem = (typeof performance !== 'undefined' ? (performance as unknown as HeapPerf).memory : undefined);
  if (!mem || !mem.usedJSHeapSize || !mem.jsHeapSizeLimit)
    return { status: 'skip', detail: 'heap ölçümü yok (Chrome dışı)' };
  const usedMb = Math.round(mem.usedJSHeapSize / 1_048_576);
  const pct = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100);
  if (pct > 85) return { status: 'fail', detail: `heap %${pct} (${usedMb}MB) — sızıntı/baskı riski`, metric: pct };
  if (pct > 65) return { status: 'warn', detail: `heap %${pct} (${usedMb}MB)`, metric: pct };
  return { status: 'pass', detail: `heap %${pct} (${usedMb}MB)`, metric: pct };
}

/* ── Prob: SENSÖRLER + İZİNLER ───────────────────────────────── */

async function probeObd(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  const mod = await import('./obdService').catch(() => null);
  if (!mod || typeof mod.getOBDStatusSnapshot !== 'function')
    return { status: 'skip', detail: 'OBD servisi yok' };
  const s = mod.getOBDStatusSnapshot();
  if (s.connectionState === 'connected') return { status: 'pass', detail: `bağlı (${s.source})`, metric: s.lastSeenMs };
  if (s.source === 'none')               return { status: 'skip', detail: 'adaptör yok (beklenen — araç dışı)' };
  return { status: 'warn', detail: `durum: ${s.connectionState} (${s.source})` };
}

interface PermNav { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> }; geolocation?: unknown; }

async function probePermissions(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  if (typeof navigator === 'undefined') return { status: 'skip', detail: 'navigator yok' };
  const nav = navigator as unknown as PermNav;
  const hasGeo = !!nav.geolocation;
  if (!nav.permissions?.query) return { status: hasGeo ? 'pass' : 'warn', detail: `Permissions API yok; geolocation ${hasGeo ? 'var' : 'YOK'}` };
  const names = ['geolocation', 'microphone', 'notifications'];
  const parts: string[] = [];
  let denied = 0;
  for (const n of names) {
    try {
      const r = await nav.permissions.query({ name: n });
      parts.push(`${n}:${r.state}`);
      if (r.state === 'denied') denied++;
    } catch { parts.push(`${n}:?`); }
  }
  return { status: denied > 0 ? 'warn' : 'pass', detail: parts.join(' · '), metric: denied };
}

/* ── Prob: SAĞLIK + EKRANLAR ─────────────────────────────────── */

async function probeHealth(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  const mod = await import('./system/SystemHealthMonitor').catch(() => null);
  const hm = mod?.healthMonitor;
  if (!hm || typeof hm.getGlobalHealthSnapshot !== 'function')
    return { status: 'skip', detail: 'health monitor yok' };
  const h = hm.getGlobalHealthSnapshot();
  const unhealthy = h.services.filter((s) => !s.healthy);
  const restarts  = h.services.reduce((a, s) => a + (s.restartCount ?? 0), 0);
  const detail = `${h.overallHealth} · ${h.services.length} servis · yeniden-başlama ${restarts}`;
  if (unhealthy.length > 0) return { status: 'fail', detail: `SAĞLIKSIZ: ${unhealthy.map((s) => s.name).join(',')} · ${detail}`, metric: unhealthy.length };
  if (restarts > 0)         return { status: 'warn', detail, metric: restarts };
  return { status: 'pass', detail };
}

async function probeUntimelyModals(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  const mod = await import('./uiActivityRecorder').catch(() => null);
  if (!mod || typeof mod.getUiActivitySnapshot !== 'function')
    return { status: 'skip', detail: 'UI kaydedici yok' };
  const ui = mod.getUiActivitySnapshot();
  if (!ui.installed) return { status: 'skip', detail: 'kaydedici kurulmadı (boot öncesi/test)' };

  const untimelyOpens = ui.recent.filter((e) => e.action === 'open' && e.untimely);
  const openNow = ui.openNow.length;
  if (ui.untimelyCount > 0) {
    // En son zamansız açılışın nedenini göster (örn. "sürüşte,kullanıcı-dokunmadan")
    const last = untimelyOpens[untimelyOpens.length - 1];
    const why  = last ? ` — son: ${last.desc} [${last.reasons.join(',')}]` : '';
    return {
      status: 'fail',
      detail: `${ui.untimelyCount} ZAMANSIZ modal/overlay açılışı${why}`,
      metric: ui.untimelyCount,
    };
  }
  return {
    status: 'pass',
    detail: `zamansız açılış yok · şu an açık yüzey: ${openNow} · izlenen olay: ${ui.recent.length}`,
    metric: openNow,
  };
}

async function probeScreens(): Promise<Omit<ProbeResult, 'name' | 'category' | 'durationMs'>> {
  const mod = await import('./screenRegistry').catch(() => null);
  if (!mod || typeof mod._screenIds !== 'function')
    return { status: 'skip', detail: 'ekran defteri yok' };
  const ids = mod._screenIds();
  const dupes = ids.length - new Set(ids).size;
  // NOT: Ekranlar drawerBus ile açılır (bağımsız route değil) → canlı navigasyon
  // GÜVENSİZ olacağından yapılmaz; burada yalnız defter bütünlüğü kontrol edilir.
  // Gizli çekmece render maliyeti 'render/gizli-animasyon' probunda yakalanır.
  if (ids.length === 0) return { status: 'fail', detail: 'kayıtlı ekran yok' };
  if (dupes > 0)        return { status: 'warn', detail: `${ids.length} ekran · ${dupes} çift kimlik`, metric: dupes };
  return { status: 'pass', detail: `${ids.length} ekran kayıtlı, kimlikler tekil`, metric: ids.length };
}

/* ── Orkestratör ─────────────────────────────────────────────── */

/**
 * Tüm probları izole + zaman-sınırlı koşturur, raporu döndürür.
 * Hiçbir prob diğerini bloklamaz; toplam bütçe ~5 sn.
 */
export async function runSelfTest(opts: SelfTestOptions = {}): Promise<SelfTestReport> {
  const includeRender  = opts.includeRenderScan !== false; // varsayılan açık
  const includeScreens = opts.includeScreens    !== false;
  const t0 = now();

  const jobs: Array<Promise<ProbeResult>> = [
    runProbe('localStorage',   'storage',     1500, probeLocalStorage),
    runProbe('IndexedDB',      'storage',     3000, probeIndexedDb),
    runProbe('backend',        'network',     4000, probeBackend),
    runProbe('worker',         'workers',     2500, probeWorkerRoundTrip),
    runProbe('ana-thread',     'workers',     2000, probeMainThread),
    runProbe('canvas/WebGL',   'render',      1500, probeCanvasContexts),
    runProbe('heap',           'render',      1000, probeMemory),
    runProbe('OBD',            'sensors',     2500, probeObd),
    runProbe('izinler',        'permissions', 2000, probePermissions),
    runProbe('servis-sağlığı', 'health',      1500, probeHealth),
    runProbe('zamansız-modal', 'screens',     1500, probeUntimelyModals),
  ];
  if (includeRender) {
    jobs.push(runProbe('boşta-render', 'render', 2000, probeIdleRenderLoop));
    jobs.push(runProbe('gizli-animasyon', 'render', 1500, probeHiddenAnimations));
  }
  if (includeScreens) {
    jobs.push(runProbe('ekran-defteri', 'screens', 1500, probeScreens));
  }

  const results = await Promise.all(jobs);

  const summary: Record<ProbeStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  let worst: ProbeStatus = 'skip';
  for (const r of results) {
    summary[r.status]++;
    if (STATUS_RANK[r.status] > STATUS_RANK[worst]) worst = r.status;
  }

  const caps = getCapabilities();
  return {
    version: 1,
    totalMs: Math.round(now() - t0),
    worst,
    summary,
    env: {
      tier:     getDeviceTier(),
      webView:  caps.webViewVersion ?? 0,
      cores:    caps.cores ?? 0,
      memoryMb: caps.memoryMb ?? 0,
    },
    results,
  };
}

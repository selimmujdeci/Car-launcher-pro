/**
 * offlineRoutingStatus.ts — ÇEVRİMDIŞI ROTA YETENEĞİNİN DÜRÜST DURUMU (SAF).
 *
 * ⚠️ **DÜZELTME (NAV v3 · F1 denetimi, 2026-09-03):** aşağıdaki özgün notun
 * *"artefakt depoda YOKTUR (`public/maps/` dizini bile yok)"* iddiası ARTIK
 * GEÇERLİ DEĞİLDİR. `public/maps/routing-graph.bin` **2026-08-22'de eklendi**
 * ve ölçüldü: `RTG2` · 238 252 düğüm · 295 346 kenar · 7 651 542 bayt.
 * Modülün davranışı doğru ve değişmedi; yalnız bu belge notu bayattı
 * (F1 açık borç B7 — burada kapatıldı).
 *
 * ── ÇÖZÜLEN SORUN (özgün kayıt) ────────────────────────────────────────
 * `offlineRoutingService` `/maps/routing-graph.bin` bekler. Bu artefakt
 * o tarihte depoda YOKTU ve üretim hattı o görevde mevcut değildi.
 * Davranış zaten fail-closed'dı — worker 404 alınca `null`
 * döner ve rota zinciri DÜRÜSTÇE düz-hat katmanına düşer
 * (`serverUsed: 'straight-line'`, kullanıcıya "düz hat navigasyon" denir).
 *
 * Eksik olan ŞUYDU: bu durum hiçbir yerde GÖZLEMLENEBİLİR değildi.
 *   · Her rota isteğinde kalıcı olarak başarısız olacak bir WASM modül
 *     worker'ı boşuna ayağa kaldırılıyordu (sessiz israf).
 *   · CAROS LAB "çevrimdışı rota neden çalışmıyor" sorusunu YANITLAYAMIYORDU.
 *
 * Bu modül yeteneğin durumunu AÇIKÇA adlandırır. **Sahte çevrimdışı başarı
 * ÜRETMEZ** ve düz-hat yedeğini "çevrimdışı rota" DİYE SUNMAZ.
 *
 * SAF: I/O YOK · timer YOK · React YOK.
 */

/**
 * Çevrimdışı rota grafiğinin durumu.
 *
 * `UNKNOWN` bir kaçış değil bir CEVAPtır: henüz denenmediği için bilmiyoruz.
 * `MISSING` ile `UNKNOWN` KARIŞTIRILMAZ — biri ölçüldü, diğeri ölçülmedi.
 */
export type OfflineGraphState =
  /** Henüz hiç denenmedi. */
  | 'UNKNOWN'
  /** Grafik yüklendi ve geçerli. */
  | 'AVAILABLE'
  /** Sunucu 404/500 verdi — artefakt paketlenmemiş. */
  | 'GRAPH_MISSING'
  /** İndirildi ama sihirli sayı/biçim tutmadı. */
  | 'GRAPH_CORRUPT'
  /** Bu WebView modül worker'ı desteklemiyor (eski head unit). */
  | 'WORKER_UNSUPPORTED';

export interface OfflineRoutingStatus {
  readonly state: OfflineGraphState;
  /** Kaç kez denendi — sessiz tekrar israfını görünür kılar. */
  readonly attemptCount: number;
  /**
   * Son deneme anı — **DUVAR SAATİ** (epoch ms); `null` = hiç denenmedi.
   *
   * ⚠️ **TAZELİK HESABINDA KULLANILAMAZ** (NAV v3 · F0 ADR-N09): duvar saati
   * akü kesintisi ve NTP düzeltmesiyle GERİYE gider. Bu alan yalnız
   * gösterim/kayıt içindir. Yaş/bayatlık için `lastAttemptAtMonoMs` kullanın.
   */
  readonly lastAttemptAt: number | null;
  /**
   * Son deneme anı — **MONOTONİK** (`performance.now` alanı); `null` = hiç
   * denenmedi ya da çağıran monotonik damga vermedi.
   *
   * NAV v3 · F2.0: navigasyon tazelik/yaş hesapları YALNIZ bunu kullanır.
   */
  readonly lastAttemptAtMonoMs: number | null;
  /**
   * Çevrimdışı rota GERÇEKTEN kullanılabilir mi.
   * `AVAILABLE` dışındaki her durumda `false` (fail-closed).
   */
  readonly usable: boolean;
}

const _UNKNOWN: OfflineRoutingStatus = Object.freeze({
  state: 'UNKNOWN',
  attemptCount: 0,
  lastAttemptAt: null,
  lastAttemptAtMonoMs: null,
  usable: false,
});

let _state: OfflineGraphState = 'UNKNOWN';
let _attempts = 0;
let _lastAt: number | null = null;
let _lastAtMono: number | null = null;

/**
 * Bir deneme sonucunu kaydeder. Zaman DIŞARIDAN gelir (bu modül saat OKUMAZ).
 *
 * @param nowMs      duvar saati (epoch ms) — gösterim/kayıt için.
 * @param nowMonoMs  monotonik an (`performance.now`) — **tazelik otoritesi**.
 *                   Verilmezse `null` kalır ve bayatlık HESAPLANMAZ
 *                   (uydurma yaş yerine yokluk beyanı — fail-closed).
 */
export function recordOfflineGraphOutcome(
  state: OfflineGraphState,
  nowMs: number,
  nowMonoMs?: number | null,
): void {
  _state = state;
  _attempts += 1;
  _lastAt = nowMs;
  _lastAtMono = (typeof nowMonoMs === 'number' && Number.isFinite(nowMonoMs) && nowMonoMs >= 0)
    ? nowMonoMs
    : null;
}

/** Güncel durum — salt-okunur kopya. */
export function getOfflineRoutingStatus(): OfflineRoutingStatus {
  if (_attempts === 0 && _state === 'UNKNOWN') return _UNKNOWN;
  return Object.freeze({
    state: _state,
    attemptCount: _attempts,
    lastAttemptAt: _lastAt,
    lastAttemptAtMonoMs: _lastAtMono,
    usable: _state === 'AVAILABLE',
  });
}

/**
 * Bir daha denemeye DEĞER Mİ?
 *
 * `GRAPH_MISSING` ve `WORKER_UNSUPPORTED` KALICI durumlardır: artefakt bir
 * uygulama oturumu içinde belirmez, WebView de yetenek kazanmaz. Bunlarda
 * tekrar denemek her rota isteğinde boşuna WASM worker'ı ayağa kaldırmak
 * demektir — bu, "gizli sessiz fallback"in ta kendisiydi.
 *
 * `GRAPH_CORRUPT` de kalıcı sayılır (aynı bayt aynı sonucu verir).
 */
export function shouldAttemptOfflineRoute(): boolean {
  return _state !== 'GRAPH_MISSING'
      && _state !== 'GRAPH_CORRUPT'
      && _state !== 'WORKER_UNSUPPORTED';
}

/** LAB için bounded etiket — serbest metin üretilmez. */
export function offlineGraphStateLabel(s: OfflineGraphState): string {
  switch (s) {
    case 'UNKNOWN':            return 'ÖLÇÜLMEDİ';
    case 'AVAILABLE':          return 'HAZIR';
    case 'GRAPH_MISSING':      return 'GRAPH YOK (artefakt paketlenmemiş)';
    case 'GRAPH_CORRUPT':      return 'GRAPH BOZUK';
    case 'WORKER_UNSUPPORTED': return 'WEBVIEW DESTEKLEMİYOR';
  }
}

/**
 * Kullanıcıya gösterilecek dürüst açıklama.
 * Hiçbir durumda "çevrimdışı rota hazır" iması YOKTUR.
 */
export function offlineRoutingUserMessage(s: OfflineGraphState): string | null {
  switch (s) {
    case 'AVAILABLE': return null;                     // sorun yok, mesaj yok
    case 'UNKNOWN':   return null;                     // henüz iddia yok
    case 'GRAPH_MISSING':
      return 'Çevrimdışı rota verisi bu cihazda yüklü değil — şebeke yokken '
           + 'yalnız düz hat yönlendirme yapılabilir.';
    case 'GRAPH_CORRUPT':
      return 'Çevrimdışı rota verisi bozuk — yeniden yüklenmesi gerekiyor.';
    case 'WORKER_UNSUPPORTED':
      return 'Bu ekran birimi çevrimdışı rota hesaplamayı desteklemiyor.';
  }
}

/** @internal testler arası izolasyon. */
export function _resetOfflineRoutingStatusForTest(): void {
  _state = 'UNKNOWN';
  _attempts = 0;
  _lastAt = null;
  _lastAtMono = null;
}

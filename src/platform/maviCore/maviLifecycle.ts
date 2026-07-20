/**
 * maviCore/maviLifecycle.ts — MAVİ ÇEKİRDEĞİ Faz-1 · Sesli asistan YAŞAM DÖNGÜSÜ (state machine).
 *
 * AMAÇ (VİZYON — "aracın ikinci beyni"): Mavi'nin sesli etkileşim omurgasının deterministik
 * durum makinesi. Wake → dinleme → anlama → planlama → yürütme → konuşma akışını TEK yerden,
 * geçiş-matrisi ile zorlar. Kullanıcı hiçbir aşamada "kayıp" kalmaz; her geçiş açık ve izlenebilir.
 *
 * TASARIM İLKELERİ (CLAUDE.md · aiCore deseniyle bire-bir):
 *  - SAF / DETERMİNİSTİK: `transition()` saf fonksiyondur (aynı girdi → aynı çıktı). Sınıf
 *    yalnız mevcut durumu + oturum sayaçlarını tutar; I/O yok, TIMER YOK, abonelik yok.
 *  - FAIL-CLOSED: tanımsız (from,event) geçişi REDDEDİLİR (durum değişmez) — sessizce yutulmaz,
 *    `accepted:false` + gerekçe döner. Bozuk/eksik event → reddedilir.
 *  - STALE REDDİ: her aktif oturum bir `generation` taşır. Dışarıdan gelen event, üretildiği
 *    generation'ı damgalayabilir; mevcut generation ile eşleşmezse (bayat plan/late STT) reddedilir.
 *  - İDEMPOTENT: start/dispose/restart tekrar çağrılınca güvenli (yan etki tek sefer).
 *  - İKİNCİ OTORİTE YOK: burada güvenlik/aksiyon KARARI verilmez — yalnız akış durumu. Aksiyon
 *    güvenliği actionSafety (AiSafetyGate köprüsü), yürütme executionEngine sonraki PR'larda.
 *
 * DURUMLAR (9): idle · waking · listening · understanding · planning · executing · speaking ·
 * cancelled · error. cancelled/error TERMİNAL değildir; `recover` ile idle'a döner (kurtarma).
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Durum + olay kontratları
 * ════════════════════════════════════════════════════════════════════════ */

/** Mavi sesli etkileşim yaşam döngüsü durumu. */
export type MaviState =
  | 'idle'          // boşta — etkileşim yok
  | 'waking'        // wake tetiklendi, onay/başlatma penceresi
  | 'listening'     // mikrofon açık, kullanıcı konuşuyor (STT)
  | 'understanding' // transcript alındı, niyet çözülüyor
  | 'planning'      // niyet → aksiyon planı kuruluyor
  | 'executing'     // plan (bir/çok aksiyon) yürütülüyor
  | 'speaking'      // asistan cevabı seslendiriliyor (TTS)
  | 'cancelled'     // iptal edildi (barge-in / kullanıcı) — recover ile idle
  | 'error';        // hata — recover ile idle

/**
 * Yaşam döngüsü olayı (tetik). Aksiyon/servis DEĞİL — yalnız akış sinyali.
 *  - wake     : idle → waking (wake word / buton uzun-bas)
 *  - listen   : idle/waking → listening (dinlemeye geç)
 *  - capture  : listening → understanding (konuşma yakalandı, transcript hazır)
 *  - plan     : understanding → planning (aksiyon gerektiren niyet)
 *  - reply    : understanding/planning/executing → speaking (yalnız sözlü cevap)
 *  - execute  : planning → executing (plan hazır, yürüt)
 *  - settle   : planning/executing/speaking/understanding → idle (sessiz/temiz tamamlanma)
 *  - follow   : speaking → listening (takip dinlemesi / barge-in sonrası yeniden dinleme)
 *  - silence  : waking/listening → idle (giriş yok / sessizlik)
 *  - cancel   : herhangi bir aktif durum → cancelled (barge-in / iptal)
 *  - fail     : herhangi bir aktif durum → error
 *  - recover  : cancelled/error → idle (kurtarma)
 */
export type MaviEvent =
  | 'wake'
  | 'listen'
  | 'capture'
  | 'plan'
  | 'reply'
  | 'execute'
  | 'settle'
  | 'follow'
  | 'silence'
  | 'cancel'
  | 'fail'
  | 'recover';

/** Bir geçiş denemesinin sonucu (SAF çıktı — sınıf durumunu MUTATE ETMEZ). */
export interface MaviTransitionResult {
  /** Geçiş kabul edildi mi (tanımlı + generation eşleşti). */
  readonly accepted: boolean;
  readonly from: MaviState;
  /** Kabul edildiyse yeni durum; reddedildiyse `from` ile aynı. */
  readonly to: MaviState;
  readonly event: MaviEvent;
  /** Makine-okur gerekçe: 'ok' · 'undefined_transition' · 'invalid_event' · 'stale_generation'. */
  readonly reason: string;
  /** Bu geçişin ait olduğu oturum kuşağı (stale reddi için). */
  readonly generation: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Geçiş matrisi (tek kaynak — SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * (durum → (olay → hedef)) geçiş tablosu. Burada OLMAYAN (from,event) çifti TANIMSIZDIR
 * ve reddedilir (fail-closed). cancel/fail çoğu aktif durumdan geçerli olduğundan her
 * girişte açıkça listelenir (örtük kural yok — matris tek gerçek kaynak, denetlenebilir).
 */
const TRANSITIONS: Readonly<Record<MaviState, Readonly<Partial<Record<MaviEvent, MaviState>>>>> = Object.freeze({
  idle: Object.freeze({
    wake: 'waking',
    listen: 'listening',
  }),
  waking: Object.freeze({
    listen: 'listening',
    silence: 'idle',
    cancel: 'cancelled',
    fail: 'error',
  }),
  listening: Object.freeze({
    capture: 'understanding',
    silence: 'idle',
    cancel: 'cancelled',
    fail: 'error',
  }),
  understanding: Object.freeze({
    plan: 'planning',
    reply: 'speaking',
    settle: 'idle',
    cancel: 'cancelled',
    fail: 'error',
  }),
  planning: Object.freeze({
    execute: 'executing',
    reply: 'speaking',
    settle: 'idle',
    cancel: 'cancelled',
    fail: 'error',
  }),
  executing: Object.freeze({
    reply: 'speaking',
    settle: 'idle',
    cancel: 'cancelled',
    fail: 'error',
  }),
  speaking: Object.freeze({
    settle: 'idle',
    follow: 'listening',
    cancel: 'cancelled',
    fail: 'error',
  }),
  cancelled: Object.freeze({
    recover: 'idle',
  }),
  error: Object.freeze({
    recover: 'idle',
  }),
});

const VALID_EVENTS: ReadonlySet<string> = new Set<MaviEvent>([
  'wake', 'listen', 'capture', 'plan', 'reply', 'execute',
  'settle', 'follow', 'silence', 'cancel', 'fail', 'recover',
]);

/**
 * YENİ OTURUM başlatan geçişler: bunlarda generation artar ve yeni sessionId atanır. Wake
 * ve doğrudan dinleme (buton) idle'dan yeni bir etkileşim başlatır. waking→listening AYNI
 * oturumun devamıdır (yeni generation ÜRETMEZ).
 */
function startsNewSession(from: MaviState, event: MaviEvent): boolean {
  return from === 'idle' && (event === 'wake' || event === 'listen');
}

/**
 * SAF geçiş fonksiyonu: (durum, olay) → hedef durum veya null (tanımsız). Sınıftan bağımsız,
 * tam test edilebilir. generation/stale mantığı taşımaz (o sınıf sorumluluğu).
 */
export function nextState(from: MaviState, event: MaviEvent): MaviState | null {
  const row = TRANSITIONS[from];
  if (!row) return null;
  return row[event] ?? null;
}

/** Bu (durum,olay) geçişi tanımlı mı (yan etkisiz sorgu). */
export function canTransition(from: MaviState, event: MaviEvent): boolean {
  return nextState(from, event) !== null;
}

/** Bir durum terminal-benzeri mi (yalnız recover ile çıkılır). */
export function isRecoverable(state: MaviState): boolean {
  return state === 'cancelled' || state === 'error';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü örneği (durum + oturum sayaçları)
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviLifecycleDeps {
  /**
   * Geçiş zaman damgası için saat (test enjekte eder). Yalnız GÖZLEM içindir — geçiş
   * KARARINDA kullanılmaz (determinizm korunur). Varsayılan: Date.now.
   */
  readonly now?: () => number;
}

export interface MaviLifecycleSnapshot {
  readonly state: MaviState;
  /** Aktif/son oturum kuşağı (idle başlangıcında 0). */
  readonly generation: number;
  /** Aktif/son oturum kimliği (monoton sayaç; 0 = henüz oturum yok). */
  readonly sessionId: number;
  /** Son geçişin zamanı (deps.now); 0 = henüz geçiş yok. */
  readonly changedAt: number;
}

/**
 * Mavi yaşam döngüsü durum makinesi. Tek sorumluluk: geçerli geçişleri uygulamak, geçersizleri
 * fail-closed reddetmek, oturum kuşağı ile bayat event'leri elemek. Yan etki YOK (dinleyici
 * bildirimi hariç — o da senkron, timer'sız). start/dispose/restart idempotenttir.
 */
export class MaviLifecycle {
  private _state: MaviState = 'idle';
  private _generation = 0;
  private _sessionId = 0;
  private _changedAt = 0;
  private _started = false;
  private readonly _now: () => number;
  private readonly _listeners = new Set<(snap: MaviLifecycleSnapshot) => void>();
  private _acceptedCount = 0;
  private _rejectedCount = 0;

  constructor(deps: MaviLifecycleDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : Date.now;
  }

  /** Kur — idempotent. Zaten kuruluysa yeniden başlatmaz (durumu SIFIRLAMAZ). */
  start(): void {
    if (this._started) return;
    this._started = true;
  }

  /** Sök — idempotent. Durumu idle'a çeker, dinleyicileri temizler (yeniden kurulabilir). */
  dispose(): void {
    if (!this._started) {
      // Kurulmadan dispose çağrılsa bile temiz idle garantisi (fail-soft).
      this._resetInternal();
      return;
    }
    this._started = false;
    this._resetInternal();
    this._listeners.clear();
  }

  /** Yeniden başlat — idempotent bileşim (dispose + start). */
  restart(): void {
    this.dispose();
    this.start();
  }

  private _resetInternal(): void {
    this._state = 'idle';
    this._generation = 0;
    this._sessionId = 0;
    this._changedAt = 0;
  }

  /** Anlık durum görüntüsü (kopyasız — alanlar primitif/immutable). */
  snapshot(): MaviLifecycleSnapshot {
    return {
      state: this._state,
      generation: this._generation,
      sessionId: this._sessionId,
      changedAt: this._changedAt,
    };
  }

  get state(): MaviState { return this._state; }
  get generation(): number { return this._generation; }
  get sessionId(): number { return this._sessionId; }
  get stats(): { acceptedCount: number; rejectedCount: number } {
    return { acceptedCount: this._acceptedCount, rejectedCount: this._rejectedCount };
  }

  /**
   * Bir olayı işle. Kabul edilirse durum güncellenir + dinleyiciler bilgilendirilir; aksi
   * halde durum DEĞİŞMEZ ve `accepted:false` döner.
   *
   * @param expectedGeneration Verilirse, mevcut generation ile eşleşmeyen olay BAYAT sayılıp
   *        reddedilir (stale plan/late STT koruması). Yeni oturum başlatan olaylarda (wake/
   *        listen from idle) generation henüz ARTMADAN kontrol edildiğinden bu parametre
   *        VERİLMEMELİDİR (yeni oturum için beklenen kuşak tanım gereği bilinemez).
   */
  dispatch(event: MaviEvent, opts: { expectedGeneration?: number } = {}): MaviTransitionResult {
    const from = this._state;

    // Bozuk/tanımsız olay → fail-closed.
    if (typeof event !== 'string' || !VALID_EVENTS.has(event)) {
      this._rejectedCount++;
      return this._reject(from, event, 'invalid_event');
    }

    // Stale reddi: çağıran belirli bir kuşak beklediğini bildirdiyse ve tutmuyorsa → bayat.
    if (typeof opts.expectedGeneration === 'number' && opts.expectedGeneration !== this._generation) {
      this._rejectedCount++;
      return this._reject(from, event, 'stale_generation');
    }

    const to = nextState(from, event);
    if (to === null) {
      this._rejectedCount++;
      return this._reject(from, event, 'undefined_transition');
    }

    // Kabul → yeni oturum kuşağı gerekiyorsa artır, durumu uygula.
    if (startsNewSession(from, event)) {
      this._generation++;
      this._sessionId++;
    }
    this._state = to;
    this._changedAt = this._safeNow();
    this._acceptedCount++;

    const result: MaviTransitionResult = Object.freeze({
      accepted: true, from, to, event, reason: 'ok', generation: this._generation,
    });
    this._notify();
    return result;
  }

  /** Durum değişimi dinleyicisi (senkron). Kaldırıcı döner. */
  subscribe(listener: (snap: MaviLifecycleSnapshot) => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  private _reject(from: MaviState, event: MaviEvent, reason: string): MaviTransitionResult {
    return Object.freeze({
      accepted: false, from, to: from, event, reason, generation: this._generation,
    });
  }

  private _notify(): void {
    if (this._listeners.size === 0) return;
    const snap = this.snapshot();
    for (const fn of this._listeners) {
      try { fn(snap); } catch { /* dinleyici hatası döngüyü kırmaz (fail-soft) */ }
    }
  }

  private _safeNow(): number {
    try {
      const t = this._now();
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch { return 0; }
  }
}

/** Fabrika — DI ile örnek üretir. Import yan etkisizdir (yalnız açıkça oluşturulunca çalışır). */
export function createMaviLifecycle(deps: MaviLifecycleDeps = {}): MaviLifecycle {
  return new MaviLifecycle(deps);
}

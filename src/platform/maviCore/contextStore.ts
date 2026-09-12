/**
 * maviCore/contextStore.ts — MAVİ ÇEKİRDEĞİ Faz-1 · Kısa-süreli BAĞLAM DEPOSU.
 *
 * AMAÇ (VİZYON "8 Kapı" gate-5: neyle birleşince anlam kazanır → Fusion/Context): Mavi'nin
 * bir sonraki söylemi doğru yorumlaması için gereken KISA-SÜRELİ bağlam. "Onu kapat", "oraya
 * götür", "sesini aç" gibi referanslar son niyet/ekran/medya/navigasyon durumundan çözülür.
 *
 * TASARIM İLKELERİ (CLAUDE.md · aiCore deseni):
 *  - DECOUPLED / *Like: canlı servis (mediaService/navigationService) OKUMAZ. Medya/nav durumu
 *    dışarıdan minimal `*Snapshot` kontratlarıyla PUSH edilir (Vehicle Brain / gerçek servisler
 *    hazır olmadan test edilebilir). Bu depo veri ÜRETMEZ, yalnız son yorumlanmış durumu tutar.
 *  - BOUNDED: konuşma turları sabit tavanlı ring (MAX_TURNS). Sınırsız büyüme YOK.
 *  - KULLANICIYA ÖZEL DEĞİL (ilk sürüm): bellek-içi, oturum ömürlü. PERSIST YOK, hesap/kimlik
 *    bağı YOK. (Kalıcı kişisel bağlam ayrı bir katmandır — bu faz kapsamı dışı.)
 *  - İDEMPOTENT · TIMER YOK · yan etkisiz import.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Decoupled durum kontratları (*Like — canlı servis tiplerinden bağımsız)
 * ════════════════════════════════════════════════════════════════════════ */

/** Medyanın yorumlanmış anlık durumu (mediaService.MediaState'e BAĞIMLI DEĞİL). */
export interface MediaContextSnapshot {
  readonly playing: boolean;
  /** Çalan içeriğin başlığı (varsa) — referans çözümleme ("şunu duraklat") için. */
  readonly title?: string;
  /** Kaynak etiketi (ör. 'youtube', 'radio') — tanımlayıcı, PII değil. */
  readonly source?: string;
}

/** Navigasyonun yorumlanmış anlık durumu (navigationService'e BAĞIMLI DEĞİL). */
export interface NavContextSnapshot {
  readonly active: boolean;
  /** Aktif hedef (varsa) — "oraya ne kadar var" gibi referanslar için. */
  readonly destination?: string;
}

/** Konuşma turu — kim, hangi niyet, ne zaman (ham transcript TUTULMAZ — yalnız niyet id'si). */
export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  /** Çözülmüş niyet/eylem kimliği (ör. 'ui.theme.set'); serbest metin DEĞİL. */
  readonly intentId?: string;
  readonly at: number;
}

/** Referans çözümleme türü — bir zamir/eksiltili söylemin işaret ettiği bağlam ekseni. */
export type ContextReferenceKind = 'screen' | 'destination' | 'media' | 'lastAction';

export interface MaviContextSnapshot {
  readonly lastIntentId?: string;
  readonly lastActionId?: string;
  /** Son açılan ekran/sayfa (ui.page.open / OPEN_SCREEN eşdeğeri) — "onu kapat" çözümü. */
  readonly lastScreen?: string;
  readonly media: MediaContextSnapshot;
  readonly nav: NavContextSnapshot;
  readonly turns: readonly ConversationTurn[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Depo
 * ════════════════════════════════════════════════════════════════════════ */

/** Konuşma turu ring tavanı — bounded (kısa-süreli bağlam; uzun geçmiş burada TUTULMAZ). */
export const MAX_CONTEXT_TURNS = 8;

const EMPTY_MEDIA: MediaContextSnapshot = Object.freeze({ playing: false });
const EMPTY_NAV: NavContextSnapshot = Object.freeze({ active: false });

export interface MaviContextStoreDeps {
  /** Turn zaman damgası saati (test enjekte eder). Varsayılan Date.now. */
  readonly now?: () => number;
  /** Konuşma turu tavanı (varsayılan MAX_CONTEXT_TURNS). */
  readonly maxTurns?: number;
}

export class MaviContextStore {
  private _lastIntentId: string | undefined;
  private _lastActionId: string | undefined;
  private _lastScreen: string | undefined;
  private _media: MediaContextSnapshot = EMPTY_MEDIA;
  private _nav: NavContextSnapshot = EMPTY_NAV;
  private _turns: ConversationTurn[] = [];
  private _started = false;
  private readonly _now: () => number;
  private readonly _maxTurns: number;

  constructor(deps: MaviContextStoreDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : Date.now;
    const m = deps.maxTurns;
    this._maxTurns = typeof m === 'number' && m > 0 ? Math.floor(m) : MAX_CONTEXT_TURNS;
  }

  /** Kur — idempotent (durumu SIFIRLAMAZ; yalnız kurulu işaretler). */
  start(): void {
    if (this._started) return;
    this._started = true;
  }

  /** Sök — idempotent. Bağlamı temizler (oturum ömürlü; kalıcı kayıt yok). */
  dispose(): void {
    this._started = false;
    this.clear();
  }

  /** Yeniden başlat — idempotent bileşim. */
  restart(): void {
    this.dispose();
    this.start();
  }

  /** Tüm bağlamı temizle (yeni oturum / mod geçişi). */
  clear(): void {
    this._lastIntentId = undefined;
    this._lastActionId = undefined;
    this._lastScreen = undefined;
    this._media = EMPTY_MEDIA;
    this._nav = EMPTY_NAV;
    this._turns = [];
  }

  /* ── Beslemeler (dışarıdan PUSH — decoupled) ─────────────────── */

  setLastIntent(intentId: string | undefined): void {
    this._lastIntentId = typeof intentId === 'string' && intentId.length > 0 ? intentId : undefined;
  }

  setLastAction(actionId: string | undefined): void {
    this._lastActionId = typeof actionId === 'string' && actionId.length > 0 ? actionId : undefined;
  }

  setLastScreen(screen: string | undefined): void {
    this._lastScreen = typeof screen === 'string' && screen.trim().length > 0 ? screen.trim() : undefined;
  }

  /** Medya durum snapshot'ı (canlı servis değil — yorumlanmış). Bozuk girdi güvenli varsayıma düşer. */
  updateMedia(snap: MediaContextSnapshot | null | undefined): void {
    if (!snap || typeof snap !== 'object') { this._media = EMPTY_MEDIA; return; }
    this._media = Object.freeze({
      playing: snap.playing === true,
      title: typeof snap.title === 'string' && snap.title.length > 0 ? snap.title : undefined,
      source: typeof snap.source === 'string' && snap.source.length > 0 ? snap.source : undefined,
    });
  }

  /** Navigasyon durum snapshot'ı. */
  updateNav(snap: NavContextSnapshot | null | undefined): void {
    if (!snap || typeof snap !== 'object') { this._nav = EMPTY_NAV; return; }
    this._nav = Object.freeze({
      active: snap.active === true,
      destination: typeof snap.destination === 'string' && snap.destination.length > 0 ? snap.destination : undefined,
    });
  }

  /**
   * Konuşma turu ekle (bounded ring). Ardışık BİREBİR aynı tur (role+intentId) bastırılır
   * (duplicate suppression — aynı komut iki kez işlenirse bağlam şişmez).
   */
  pushTurn(turn: { role: 'user' | 'assistant'; intentId?: string }): void {
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) return;
    const intentId = typeof turn.intentId === 'string' && turn.intentId.length > 0 ? turn.intentId : undefined;
    const last = this._turns[this._turns.length - 1];
    if (last && last.role === turn.role && last.intentId === intentId) return; // ardışık tekrar
    this._turns.push(Object.freeze({ role: turn.role, intentId, at: this._safeNow() }));
    if (this._turns.length > this._maxTurns) {
      this._turns.splice(0, this._turns.length - this._maxTurns);
    }
  }

  /* ── Okuma / referans çözümleme ───────────────────────────────── */

  snapshot(): MaviContextSnapshot {
    return Object.freeze({
      lastIntentId: this._lastIntentId,
      lastActionId: this._lastActionId,
      lastScreen: this._lastScreen,
      media: this._media,
      nav: this._nav,
      turns: Object.freeze(this._turns.slice()),
    });
  }

  /**
   * Eksiltili/zamir referansını çöz: "onu kapat" → son ekran; "oraya" → aktif hedef; "şunu
   * duraklat" → çalan medya başlığı; "tekrar" → son eylem. Çözülemezse undefined (çağıran
   * kullanıcıdan netleştirme ister — SAHTE çözüm YOK).
   */
  resolveReference(kind: ContextReferenceKind): string | undefined {
    switch (kind) {
      case 'screen':      return this._lastScreen;
      case 'destination': return this._nav.active ? this._nav.destination : undefined;
      case 'media':       return this._media.title;
      case 'lastAction':  return this._lastActionId;
      default:            return undefined;
    }
  }

  get turnCount(): number { return this._turns.length; }

  private _safeNow(): number {
    try {
      const t = this._now();
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch { return 0; }
  }
}

/** Fabrika — boş bağlam deposu. Import yan etkisizdir. */
export function createMaviContextStore(deps: MaviContextStoreDeps = {}): MaviContextStore {
  return new MaviContextStore(deps);
}

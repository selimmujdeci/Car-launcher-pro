/**
 * sessionInspectorModel.ts — Session Inspector'ın SAF gözlemlenebilirlik modeli (Faz A3).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: session manager · state machine · birleşik
 * "truth object" YAZMAZ. Yalnız MEVCUT kaynaklardan okunmuş ham değerleri
 * SINIFLANDIRIR, ÇELİŞKİLERİ AÇIĞA ÇIKARIR ve fail-closed bir özet türetir.
 *
 * ── GÖZLEMLENEBİLİRLİK SINIFLARI ────────────────────────────────────────────
 *  OBSERVED    : değer doğrudan mevcut runtime kaynağından geldi.
 *  DERIVED     : mevcut GERÇEK alanlardan deterministik, açıkça yazılmış kuralla türetildi.
 *  UNAVAILABLE : bu bilgi için güvenilir kaynak YOK (uydurma yerine yokluk beyanı).
 *  STALE       : kaynağın GERÇEK duvar-saati damgası var ve TANIMLI eşiği aştı.
 *
 * ── STALE KURALI (pazarlıksız) ──────────────────────────────────────────────
 * Sahte bayatlık hesabı YASAK. STALE yalnız iki koşul birden sağlanırsa verilir:
 *   (1) alanın GERÇEK bir duvar-saati (Unix ms) damgası var, ve
 *   (2) o alan için REPODA TANIMLI bir eşik var (`getObdFreshWindowMs()`).
 * Monotonik saat (worker `performance.now()`) taşıyan alanlar için bayatlık
 * HESAPLANMAZ — yalnız ham değer gösterilir ve bu durum notta yazılır.
 *
 * SAF: I/O yok, timer yok, modül durumu yok. Kaynak okuma `sessionInspectorSources.ts`te.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type Observability = 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';

export interface InspectorField {
  readonly id:    string;
  readonly label: string;
  /** Gösterilecek değer (metin). UNAVAILABLE ise '—'. */
  readonly value: string;
  readonly klass: Observability;
  /** Gerçek kaynak — dosya/fonksiyon. */
  readonly source: string;
  /**
   * Kaynağın son güncellenme zamanı — YALNIZ gerçekten varsa (Unix ms duvar saati).
   * null = damga yok (bayatlık HESAPLANMAZ).
   */
  readonly updatedAt: number | null;
  /** Kısa dürüstlük notu — bu değere ne kadar güvenilebilir. */
  readonly note: string;
}

export type InspectorCardId =
  | 'transport' | 'protocol' | 'datagate' | 'kwp' | 'hal' | 'runtime';

export interface InspectorCard {
  readonly id:     InspectorCardId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

export const INSPECTOR_CARD_ORDER: readonly InspectorCardId[] = [
  'transport', 'protocol', 'datagate', 'kwp', 'hal', 'runtime',
] as const;

export const INSPECTOR_CARD_TITLE: Readonly<Record<InspectorCardId, string>> = {
  transport: '1 · Transport / Adaptör',
  protocol:  '2 · Protokol / Handshake',
  datagate:  '3 · Veri Kapısı / Sorgulama',
  kwp:       '4 · KWP / Kurtarma',
  hal:       '5 · Vehicle HAL / Kaynak Sağlığı',
  runtime:   '6 · Çalışma Zamanı / Yakalama',
} as const;

/**
 * Gözlemlenebilirlik sınıfının EKRANDA görünen Türkçe karşılığı.
 *
 * Enum DEĞERİ makine sözleşmesidir (`data-class` özniteliği + testler) ve DEĞİŞMEZ;
 * çeviri yalnız sunum katmanıdır. Dil değişimi "uydurma yasak" kilidini zayıflatmaz.
 */
export const OBSERVABILITY_LABEL: Readonly<Record<Observability, string>> = {
  OBSERVED:    'ÖLÇÜLDÜ',
  DERIVED:     'TÜRETİLDİ',
  UNAVAILABLE: 'KAYNAK YOK',
  STALE:       'BAYAT',
} as const;

/** Oturum özetinin Türkçe karşılığı (enum değeri `data-health`'te aynen kalır). */
export const SESSION_HEALTH_LABEL: Readonly<Record<SessionHealth, string>> = {
  CONNECTED:    'BAĞLI',
  DEGRADED:     'ZAYIF',
  DISCONNECTED: 'KOPUK',
  UNKNOWN:      'BİLİNMİYOR',
} as const;

/** Bounded: kart başına azami alan, çelişki listesi azami uzunluk. */
export const MAX_FIELDS_PER_CARD = 40;
export const MAX_MISMATCHES = 12;

/* ══════════════════════════════════════════════════════════════════════════
 * Alan kurucuları (saf)
 * ════════════════════════════════════════════════════════════════════════ */

const UNAVAILABLE_VALUE = '—';

export interface FieldInput {
  readonly id:        string;
  readonly label:     string;
  readonly source:    string;
  readonly note:      string;
  readonly updatedAt?: number | null;
}

/** Gözlenen değer. `value` null/undefined → UNAVAILABLE'a düşer (sahte değer yok). */
export function observed(input: FieldInput, value: unknown): InspectorField {
  if (value === null || value === undefined || value === '') {
    return unavailable(input, 'Kaynak bu alan için değer vermedi.');
  }
  return {
    id: input.id, label: input.label,
    value: _stringify(value),
    klass: 'OBSERVED',
    source: input.source,
    updatedAt: _wallTs(input.updatedAt),
    note: input.note,
  };
}

/** Türetilmiş değer — kuralı `note` alanında AÇIKÇA yazılmalıdır. */
export function derived(input: FieldInput, value: unknown): InspectorField {
  if (value === null || value === undefined || value === '') {
    return unavailable(input, 'Türetme için gerekli girdi yok.');
  }
  return {
    id: input.id, label: input.label,
    value: _stringify(value),
    klass: 'DERIVED',
    source: input.source,
    updatedAt: _wallTs(input.updatedAt),
    note: input.note,
  };
}

/** Güvenilir kaynak yok. */
export function unavailable(input: FieldInput, reasonNote?: string): InspectorField {
  return {
    id: input.id, label: input.label,
    value: UNAVAILABLE_VALUE,
    klass: 'UNAVAILABLE',
    source: input.source,
    updatedAt: null,
    note: reasonNote ?? input.note,
  };
}

function _stringify(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : UNAVAILABLE_VALUE;
  if (typeof v === 'string') return v;
  return String(v);
}

/** Yalnız GEÇERLİ duvar-saati damgasını kabul eder (0/negatif/NaN → null). */
function _wallTs(ts: number | null | undefined): number | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
  return ts;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bayatlık (yalnız gerçek damga + tanımlı eşik varken)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Alanı gerekiyorsa STALE'e yükseltir.
 * `thresholdMs` geçersizse (<=0) HİÇBİR ŞEY yapılmaz — uydurma eşik yok.
 * Damgası olmayan alan ASLA STALE olmaz.
 */
export function applyStaleness(
  field: InspectorField,
  nowMs: number,
  thresholdMs: number,
): InspectorField {
  if (!field || field.klass === 'UNAVAILABLE') return field;
  if (field.updatedAt === null) return field;                      // damga yok → hesap yok
  if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs <= 0) return field;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return field;

  const age = nowMs - field.updatedAt;
  if (age <= thresholdMs) return field;

  return {
    ...field,
    klass: 'STALE',
    note: `${field.note} · Damga ${Math.round(age / 1000)}sn eski (eşik ${Math.round(thresholdMs / 1000)}sn).`,
  };
}

/** İnsan-okur yaş metni. Damga yoksa null (uydurma yok). */
export function formatAge(updatedAt: number | null, nowMs: number): string | null {
  if (updatedAt === null || typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  const age = Math.max(0, nowMs - updatedAt);
  if (age < 1000) return `${age}ms önce`;
  if (age < 60_000) return `${Math.round(age / 1000)}sn önce`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}dk önce`;
  return `${Math.round(age / 3_600_000)}sa önce`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çelişki tespiti — aynı kavramı temsil eden AYRI kaynaklar
 * ════════════════════════════════════════════════════════════════════════ */

export interface SourceMismatch {
  readonly id:      string;
  readonly topic:   string;
  /** Taraf A: kaynak adı + değeri. */
  readonly aSource: string;
  readonly aValue:  string;
  readonly bSource: string;
  readonly bValue:  string;
  readonly note:    string;
}

/**
 * Çelişki girdisi — TÜMÜ ayrı ayrı okunmuş GERÇEK alanlardır. Hiçbiri burada
 * birleştirilmez; yalnız karşılaştırılır (sessiz ezme YASAK).
 */
export interface MismatchInput {
  /** obdService `_current.connectionState`. */
  readonly connectionState:   string | null;
  /** obdService `_current.transportConnected`. */
  readonly transportConnected: boolean | null;
  /** getObdSessionHealth().transportReady (native handle sayısı + transportConnected). */
  readonly transportReady:    boolean | null;
  /** getObdSessionHealth().dataFresh. */
  readonly dataFresh:         boolean | null;
  /** ObdHealthMonitor.isStale (MUTLAK donma sinyali — ayrı motor). */
  readonly healthIsStale:     boolean | null;
  /** VehicleConnectivityManager OBD kaynağı (kendi 3sn watchdog'u). */
  readonly connectivityObdConnected: boolean | null;
  /** halStatusStore.sourceHealth.obdAlive (worker 1Hz watchdog; null = BİLİNMİYOR). */
  readonly halObdAlive:       boolean | null;
  /** Handshake'te ZORLANAN protokol. */
  readonly protocolTried:     string | null;
  /** ATDPN ile okunan GERÇEK protokol. */
  readonly protocolActive:    string | null;
}

/**
 * Çelişkileri listeler. Hiçbir taraf "kazanmaz" — ikisi de gösterilir.
 * Bounded (MAX_MISMATCHES).
 */
export function detectMismatches(input: MismatchInput): SourceMismatch[] {
  const out: SourceMismatch[] = [];
  if (!input) return out;

  const isConnected = input.connectionState === 'connected';

  if (isConnected && input.transportConnected === false) {
    out.push({
      id: 'state-vs-transport',
      topic: 'Bağlantı',
      aSource: 'obdService.connectionState', aValue: 'connected',
      bSource: 'obdService.transportConnected', bValue: 'false',
      note: 'connectionState "bağlı" derken transport linki doğrulanmamış görünüyor.',
    });
  }

  if (isConnected && input.transportReady === false) {
    out.push({
      id: 'state-vs-sessionhealth',
      topic: 'Bağlantı',
      aSource: 'obdService.connectionState', aValue: 'connected',
      bSource: 'getObdSessionHealth().transportReady', bValue: 'false',
      note: 'Oturum sağlığı native handle yok/link ölü diyor; connectionState hâlâ bağlı.',
    });
  }

  if (isConnected && input.connectivityObdConnected === false) {
    out.push({
      id: 'state-vs-connectivity',
      topic: 'Bağlantı',
      aSource: 'obdService.connectionState', aValue: 'connected',
      bSource: 'VehicleConnectivityManager.OBD.connected', bValue: 'false',
      note: 'Bağımsız 3sn watchdog OBD akışını ölü görüyor.',
    });
  }

  if (isConnected && input.halObdAlive === false) {
    out.push({
      id: 'state-vs-hal',
      topic: 'Bağlantı',
      aSource: 'obdService.connectionState', aValue: 'connected',
      bSource: 'halStatusStore.sourceHealth.obdAlive', bValue: 'false',
      note: 'HAL worker 1Hz watchdog OBD kaynağını ölü bildirmiş.',
    });
  }

  if (input.dataFresh === true && input.healthIsStale === true) {
    out.push({
      id: 'fresh-vs-stale',
      topic: 'Veri tazeliği',
      aSource: 'getObdSessionHealth().dataFresh', aValue: 'true',
      bSource: 'ObdHealthMonitor.isStale', bValue: 'true',
      note: 'İki ayrı tazelik motoru zıt sonuç veriyor (biri kadans-göreli, diğeri mutlak).',
    });
  }

  if (
    typeof input.protocolTried === 'string' && input.protocolTried.length > 0 &&
    typeof input.protocolActive === 'string' && input.protocolActive.length > 0 &&
    input.protocolTried !== input.protocolActive
  ) {
    out.push({
      id: 'protocol-tried-vs-active',
      topic: 'Protokol',
      aSource: 'handshake.protocolTried', aValue: input.protocolTried,
      bSource: 'handshake.protocolActive', bValue: input.protocolActive,
      note: 'Zorlanan protokol ile ATDPN ile okunan aktif protokol farklı — araç değişimi göstergesi.',
    });
  }

  return out.length > MAX_MISMATCHES ? out.slice(0, MAX_MISMATCHES) : out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Genel özet — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

export type SessionHealth = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'UNKNOWN';

export interface SessionHealthInput {
  /** null = okunamadı. */
  readonly connectionState: string | null;
  readonly transportReady:  boolean | null;
  readonly sessionReady:    boolean | null;
  readonly pollingActive:   boolean | null;
  readonly dataFresh:       boolean | null;
  /** Son geçerli ECU frame damgası (Unix ms). 0/null = hiç. */
  readonly lastSeenMs:      number | null;
  /** Repoda TANIMLI tazelik penceresi (getObdFreshWindowMs). <=0 → bayatlık hesabı yok. */
  readonly freshWindowMs:   number;
  readonly nowMs:           number;
  /** Veri kaynağı: 'real' | 'mock' | 'none'. */
  readonly dataSource:      string | null;
  /** KWP kurtarma durumu (kanıt yoksa null). */
  readonly kwpStatus:       string | null;
  /** Kurtarma tavanına ulaşıldı mı (kanıt yoksa null). */
  readonly kwpAtLimit:      boolean | null;
  readonly mismatchCount:   number;
}

export interface SessionHealthResult {
  readonly status:  SessionHealth;
  /** Karara götüren GERÇEK gerekçeler (sıralı, bounded). */
  readonly reasons: readonly string[];
}

/**
 * Genel oturum sağlığı — FAIL-CLOSED birleşim.
 *
 * KURAL SIRASI (ilk eşleşen kazanır; hepsi mevcut gerçek alanlardan):
 *  1. connectionState okunamadıysa            → UNKNOWN
 *  2. ÇELİŞKİ varsa                            → DEGRADED (asla CONNECTED)
 *  3. state 'disconnected'/'error' ve transport hazır değilse → DISCONNECTED
 *  4. state 'connected' DEĞİLSE                → UNKNOWN (idle/scanning/connecting)
 *  5. state 'connected' ise, aşağıdakilerden biri bozuksa → DEGRADED:
 *       transportReady=false · sessionReady=false (data gate) · pollingActive=false ·
 *       dataFresh=false · veri kaynağı 'real' değil ·
 *       lastSeenMs TANIMLI eşiği aşmış (yalnız gerçek damga + gerçek eşik varken) ·
 *       KWP kurtarma FAILED veya tavanda
 *  6. hepsi sağlamsa                           → CONNECTED
 *
 * NOT: bu fonksiyon bir sağlık İDDİASI değil, mevcut sinyallerin ÖZETİDİR.
 */
export function deriveSessionHealth(input: SessionHealthInput): SessionHealthResult {
  const reasons: string[] = [];
  if (!input) return { status: 'UNKNOWN', reasons: ['Girdi okunamadı.'] };

  const state = typeof input.connectionState === 'string' ? input.connectionState : null;

  if (state === null || state.length === 0) {
    return { status: 'UNKNOWN', reasons: ['connectionState okunamadı — güvenilir bağlantı sinyali yok.'] };
  }

  if (input.mismatchCount > 0) {
    reasons.push(`${input.mismatchCount} kaynak çelişkisi var — birleşik "bağlı" iddiası güvenli değil.`);
    return { status: 'DEGRADED', reasons };
  }

  if ((state === 'disconnected' || state === 'error') && input.transportReady !== true) {
    reasons.push(`connectionState=${state} ve transport hazır değil.`);
    return { status: 'DISCONNECTED', reasons };
  }

  if (state !== 'connected') {
    reasons.push(`connectionState=${state} — henüz bağlı değil (geçiş durumu).`);
    return { status: 'UNKNOWN', reasons };
  }

  // state === 'connected' → her ekseni ayrı ayrı denetle
  if (input.transportReady === false) reasons.push('transportReady=false (native handle yok veya link ölü).');
  if (input.sessionReady === false)   reasons.push('sessionReady=false — DATA GATE geçilmedi.');
  if (input.pollingActive === false)  reasons.push('pollingActive=false — oturum watchdog\'u çalışmıyor.');
  if (input.dataFresh === false)      reasons.push('dataFresh=false — ECU verisi taze değil.');

  if (typeof input.dataSource === 'string' && input.dataSource !== 'real') {
    reasons.push(`Veri kaynağı '${input.dataSource}' — gerçek ECU verisi değil.`);
  }

  // Bayatlık YALNIZ gerçek damga + gerçek eşik varken
  if (
    typeof input.lastSeenMs === 'number' && input.lastSeenMs > 0 &&
    typeof input.freshWindowMs === 'number' && input.freshWindowMs > 0 &&
    typeof input.nowMs === 'number' && Number.isFinite(input.nowMs)
  ) {
    const age = input.nowMs - input.lastSeenMs;
    if (age > input.freshWindowMs) {
      reasons.push(`Son geçerli ECU frame'i ${Math.round(age / 1000)}sn eski (eşik ${Math.round(input.freshWindowMs / 1000)}sn).`);
    }
  }

  if (input.kwpStatus === 'FAILED') reasons.push('KWP kurtarma FAILED — ATPC sonrası veri dönmedi.');
  if (input.kwpAtLimit === true)    reasons.push('KWP kurtarma oturum tavanına ulaşıldı.');

  if (reasons.length > 0) return { status: 'DEGRADED', reasons };

  return {
    status: 'CONNECTED',
    reasons: ['Tüm okunabilir eksenler tutarlı: transport · data gate · polling · tazelik.'],
  };
}

/** Kart alanlarını bounded tutar. */
export function boundCard(card: InspectorCard): InspectorCard {
  if (!card || !Array.isArray(card.fields)) return card;
  if (card.fields.length <= MAX_FIELDS_PER_CARD) return card;
  return { ...card, fields: card.fields.slice(0, MAX_FIELDS_PER_CARD) };
}

/** Sınıf başına alan sayısı (özet rozetleri). */
export function countByClass(cards: readonly InspectorCard[]): Record<Observability, number> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  if (!Array.isArray(cards)) return out;
  for (const c of cards) {
    if (!c || !Array.isArray(c.fields)) continue;
    for (const f of c.fields as readonly InspectorField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass]++;
    }
  }
  return out;
}

/**
 * runtimeSchedulingModel.ts — Runtime Scheduling Inspector'ın SAF modeli (Faz A4).
 *
 * ═══ TEMEL MİMARİ KURAL ═════════════════════════════════════════════════════
 * "GLOBAL QUEUE" veya "GLOBAL SCHEDULER" YOKTUR. Repoda birbirinden bağımsız
 * runtime otoriteleri vardır ve bu model onları BİRLEŞTİRMEZ — her biri ayrı
 * KANAL olarak taşınır. Yeni scheduler/queue/polling motoru veya runtime
 * otoritesi OLUŞTURULMAZ.
 *
 * ═══ SINIFLAR ═══════════════════════════════════════════════════════════════
 *  OBSERVED           : doğrudan mevcut snapshot/getter/store'dan
 *  DERIVED            : gerçek gözlemlerden SAF, yazılı kuralla türetilen
 *  UNAVAILABLE        : güvenilir veri yüzeyi YOK (0 GÖSTERİLMEZ)
 *  STALE              : yalnız gerçek duvar-saati damgası + meşru eşik varsa
 *  UNSAFE_TO_OBSERVE  : okumak için var olan tek yol YAN ETKİ üretiyor
 *                       (ör. tekil nesneyi TEMBEL OLUŞTURAN getter) → okunmaz
 *
 * ═══ A3'TEN AYRI TUTULDU ════════════════════════════════════════════════════
 * `sessionInspectorModel` sözleşmesi (4 sınıf) BOZULMADI; A4 beşinci sınıfa
 * ihtiyaç duyduğu için kendi tipleriyle yaşar. A3 testleri etkilenmez.
 *
 * SAF: I/O yok, timer yok, modül durumu yok.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type SchedObservability =
  | 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE' | 'UNSAFE_TO_OBSERVE';

export interface SchedField {
  readonly id:        string;
  readonly label:     string;
  readonly value:     string;
  readonly klass:     SchedObservability;
  readonly source:    string;
  /** YALNIZ gerçek duvar-saati damgası (Unix ms). null = damga yok. */
  readonly updatedAt: number | null;
  readonly note:      string;
}

/** Kanalın gözlemlenebilir çalışma durumu — "timer var" TEK BAŞINA RUNNING DEĞİLDİR. */
export type ChannelActivity = 'RUNNING' | 'NOT_RUNNING' | 'BLOCKED' | 'UNKNOWN';

export type SchedChannelId =
  | 'command-exec' | 'live-polling' | 'handshake' | 'kwp' | 'discovery-deepscan' | 'can-collect';

export interface SchedChannel {
  readonly id:        SchedChannelId;
  /** Gerçek runtime otoritesinin adı (JS modülü veya NATIVE). */
  readonly authority: string;
  readonly title:     string;
  readonly activity:  ChannelActivity;
  /** Aktivite kararının GEREKÇESİ — "neden RUNNING/UNKNOWN dedik". */
  readonly activityNote: string;
  readonly fields:    readonly SchedField[];
}

export const SCHED_CHANNEL_ORDER: readonly SchedChannelId[] = [
  'command-exec', 'live-polling', 'handshake', 'kwp', 'discovery-deepscan', 'can-collect',
] as const;

export const SCHED_CHANNEL_TITLE: Readonly<Record<SchedChannelId, string>> = {
  'command-exec':       '1 · Command Execution',
  'live-polling':       '2 · Live Polling',
  'handshake':          '3 · Handshake / Initialization',
  'kwp':                '4 · KWP Keep-Alive / Recovery',
  'discovery-deepscan': '5 · Discovery / Deep Scan Scheduling',
  'can-collect':        '6 · CAN Collection',
} as const;

/** Bounded: kanal başına azami alan, çelişki listesi tavanı. */
export const MAX_FIELDS_PER_CHANNEL = 32;
export const MAX_SCHED_CONFLICTS = 10;

const NO_VALUE = '—';

/* ══════════════════════════════════════════════════════════════════════════
 * Alan kurucuları (saf)
 * ════════════════════════════════════════════════════════════════════════ */

export interface SchedFieldInput {
  readonly id:        string;
  readonly label:     string;
  readonly source:    string;
  readonly note:      string;
  readonly updatedAt?: number | null;
}

function _wallTs(ts: number | null | undefined): number | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
  return ts;
}

function _str(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : NO_VALUE;
  if (typeof v === 'string') return v;
  return String(v);
}

/** Gözlenen değer. null/undefined/'' → UNAVAILABLE (SAHTE 0 veya boş değer YOK). */
export function schedObserved(input: SchedFieldInput, value: unknown): SchedField {
  if (value === null || value === undefined || value === '') {
    return schedUnavailable(input, 'Kaynak bu alan için değer vermedi.');
  }
  return {
    id: input.id, label: input.label, value: _str(value), klass: 'OBSERVED',
    source: input.source, updatedAt: _wallTs(input.updatedAt), note: input.note,
  };
}

/** Türetilmiş değer — kuralı `note` içinde AÇIKÇA yazılır. */
export function schedDerived(input: SchedFieldInput, value: unknown): SchedField {
  if (value === null || value === undefined || value === '') {
    return schedUnavailable(input, 'Türetme için gerekli gözlem yok.');
  }
  return {
    id: input.id, label: input.label, value: _str(value), klass: 'DERIVED',
    source: input.source, updatedAt: _wallTs(input.updatedAt), note: input.note,
  };
}

/** Güvenilir veri yüzeyi yok. Değer ASLA 0 ile doldurulmaz. */
export function schedUnavailable(input: SchedFieldInput, reasonNote?: string): SchedField {
  return {
    id: input.id, label: input.label, value: NO_VALUE, klass: 'UNAVAILABLE',
    source: input.source, updatedAt: null, note: reasonNote ?? input.note,
  };
}

/**
 * Okumak için var olan TEK yol yan etki üretiyor → okumadık.
 * (Bu bir "veri yok" beyanı değil; "güvenle okuyamayız" beyanıdır.)
 */
export function schedUnsafe(input: SchedFieldInput, reasonNote: string): SchedField {
  return {
    id: input.id, label: input.label, value: NO_VALUE, klass: 'UNSAFE_TO_OBSERVE',
    source: input.source, updatedAt: null, note: reasonNote,
  };
}

/**
 * Gerekiyorsa STALE'e yükseltir. Damgası olmayan alan ASLA STALE olmaz;
 * eşik geçersizse (<=0) hesap YAPILMAZ (uydurma eşik yasak).
 */
export function schedApplyStaleness(field: SchedField, nowMs: number, thresholdMs: number): SchedField {
  if (!field || field.klass !== 'OBSERVED') return field;
  if (field.updatedAt === null) return field;
  if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs <= 0) return field;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return field;

  const age = nowMs - field.updatedAt;
  if (age <= thresholdMs) return field;
  return {
    ...field, klass: 'STALE',
    note: `${field.note} · Damga ${Math.round(age / 1000)}sn eski (eşik ${Math.round(thresholdMs / 1000)}sn).`,
  };
}

/** İnsan-okur yaş. Damga yoksa null. */
export function schedFormatAge(updatedAt: number | null, nowMs: number): string | null {
  if (updatedAt === null || typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  const age = Math.max(0, nowMs - updatedAt);
  if (age < 1000) return `${age}ms önce`;
  if (age < 60_000) return `${Math.round(age / 1000)}sn önce`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}dk önce`;
  return `${Math.round(age / 3_600_000)}sa önce`;
}

/** Kanal alanlarını bounded tutar. */
export function boundChannel(ch: SchedChannel): SchedChannel {
  if (!ch || !Array.isArray(ch.fields)) return ch;
  if (ch.fields.length <= MAX_FIELDS_PER_CHANNEL) return ch;
  return { ...ch, fields: ch.fields.slice(0, MAX_FIELDS_PER_CHANNEL) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çelişkiler
 * ════════════════════════════════════════════════════════════════════════ */

export interface SchedConflict {
  readonly id:      string;
  readonly topic:   string;
  readonly aSource: string;
  readonly aValue:  string;
  readonly bSource: string;
  readonly bValue:  string;
  readonly note:    string;
}

export interface SchedConflictInput {
  /** obdService stale-watchdog timer nesnesi VAR mı. */
  readonly pollingTimerActive: boolean | null;
  /** ECU verisi taze mi. */
  readonly dataFresh:          boolean | null;
  /** ObdHealthMonitor MUTLAK donma sinyali. */
  readonly healthIsStale:      boolean | null;
  /** Native poll kanıtı burst açık diyor mu (önbellek). */
  readonly burstEnabled:       boolean | null;
  /** OBD Canlı Test ekranı (burst tüketicisi) şu an açık mı — ref sayacı. */
  readonly liveDataScreenOpen: boolean | null;
  /** KWP kurtarma tavanına ulaşıldı mı. */
  readonly kwpAtLimit:         boolean | null;
  /** KWP kurtarma durumu. */
  readonly kwpStatus:          string | null;
}

/**
 * Çelişkileri listeler. Hiçbir taraf diğerini EZMEZ. Bounded.
 * `null` (bilinmiyor) ASLA çelişki üretmez — yokluk kanıt değildir.
 */
export function detectSchedConflicts(input: SchedConflictInput): SchedConflict[] {
  const out: SchedConflict[] = [];
  if (!input) return out;

  // Görevde açıkça istenen kilit: "timer aktif ama veri akmıyor".
  if (input.pollingTimerActive === true && input.dataFresh === false) {
    out.push({
      id: 'timer-vs-datafresh',
      topic: 'Live polling',
      aSource: 'obdService.getObdSessionHealth().pollingActive', aValue: 'true (timer nesnesi var)',
      bSource: 'obdService.getObdSessionHealth().dataFresh', bValue: 'false',
      note: 'Zamanlayıcı çalışıyor ama ECU verisi tazelenmiyor — "timer var" veri aktığı anlamına GELMEZ.',
    });
  }

  if (input.pollingTimerActive === true && input.healthIsStale === true) {
    out.push({
      id: 'timer-vs-absolute-stale',
      topic: 'Live polling',
      aSource: 'getObdSessionHealth().pollingActive', aValue: 'true',
      bSource: 'ObdHealthMonitor.isStale', bValue: 'true (MUTLAK donma)',
      note: 'Bağımsız mutlak donma sinyali açık; poll zamanlayıcısı yine de duruyor.',
    });
  }

  if (input.burstEnabled === true && input.liveDataScreenOpen === false) {
    out.push({
      id: 'burst-vs-consumer',
      topic: 'Command execution',
      aSource: 'native poll kanıtı: burstEnabled', aValue: 'true',
      bSource: 'devtoolsCapture: Live Data tüketicisi', bValue: 'kapalı',
      note: 'Native tanı BURST modu açık görünüyor ama onu açan ekran kapalı — kanıt önbelleği bayat olabilir.',
    });
  }

  if (input.kwpAtLimit === true && input.kwpStatus === 'IN_PROGRESS') {
    out.push({
      id: 'kwp-limit-vs-progress',
      topic: 'KWP recovery',
      aSource: 'kwpRecoveryEvidence: recoveryCount >= maxPerSession', aValue: 'tavanda',
      bSource: 'kwpRecoveryEvidence.status', bValue: 'IN_PROGRESS',
      note: 'Tavan dolu görünürken kurtarma hâlâ sürüyor bildiriliyor.',
    });
  }

  return out.length > MAX_SCHED_CONFLICTS ? out.slice(0, MAX_SCHED_CONFLICTS) : out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Genel runtime özeti — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

/** Araç bağlantısı DEĞİL, RUNTIME durumu. 'CONNECTED/HEALTHY' terimi KULLANILMAZ. */
export type RuntimeSummary = 'ACTIVE' | 'PARTIAL' | 'IDLE' | 'BLOCKED' | 'UNKNOWN';

export interface RuntimeSummaryInput {
  /** Doğrudan gözlemlenerek ÇALIŞTIĞI doğrulanmış kanal sayısı (timer varlığı YETMEZ). */
  readonly runningChannels: number;
  /** Açık bir bekleme/tavan/hata nedeniyle BLOKE kanal sayısı. */
  readonly blockedChannels: number;
  /** Durumu bilinemeyen (UNAVAILABLE/UNSAFE) kanal sayısı. */
  readonly unknownChannels: number;
  /** Gözlemlenerek ÇALIŞMADIĞI doğrulanmış kanal sayısı. */
  readonly notRunningChannels: number;
  /** Kaynak çelişkisi sayısı. */
  readonly conflicts: number;
  /**
   * Komut kuyruğu derinliği GERÇEKTEN okunabiliyor mu. Bugün her zaman false —
   * native kuyruk JS'e açılmamıştır. IDLE bu bayrak olmadan ASLA verilmez.
   */
  readonly queueDepthKnown: boolean;
  /** Aktif görev (çalışan iş) gerçekten okunabiliyor mu. */
  readonly activeJobKnown: boolean;
}

export interface RuntimeSummaryResult {
  readonly status:  RuntimeSummary;
  readonly reasons: readonly string[];
}

/**
 * Genel runtime özeti — FAIL-CLOSED.
 *
 * KURAL SIRASI (ilk eşleşen kazanır):
 *  1. BLOKE kanal varsa                                   → BLOCKED
 *  2. Çelişki varsa                                       → PARTIAL (asla ACTIVE)
 *  3. Çalışan kanal var + bilinmeyen kanal YOK            → ACTIVE
 *  4. Çalışan kanal var + bilinmeyen kanal VAR            → PARTIAL
 *  5. Çalışan kanal YOK + kuyruk VE aktif iş biliniyor    → IDLE
 *  6. Diğer her durum                                     → UNKNOWN
 *
 * NOT: (5) bugün ULAŞILAMAZ — native komut kuyruğu JS'e açılmadığı için
 * `queueDepthKnown` daima false'tur. Bu bilinçlidir: "kuyruk bilinmiyorsa boş
 * kuyruk varsayma" kuralının doğrudan uygulanışıdır.
 */
export function deriveRuntimeSummary(input: RuntimeSummaryInput): RuntimeSummaryResult {
  if (!input) return { status: 'UNKNOWN', reasons: ['Girdi okunamadı.'] };

  if (input.blockedChannels > 0) {
    return {
      status: 'BLOCKED',
      reasons: [`${input.blockedChannels} kanal açık bir bekleme/tavan/hata durumunda.`],
    };
  }

  if (input.conflicts > 0) {
    return {
      status: 'PARTIAL',
      reasons: [`${input.conflicts} kaynak çelişkisi var — birleşik "çalışıyor" iddiası güvenli değil.`],
    };
  }

  if (input.runningChannels > 0) {
    if (input.unknownChannels === 0) {
      return {
        status: 'ACTIVE',
        reasons: [`${input.runningChannels} kanal doğrudan gözlemle çalışıyor; bilinmeyen kanal yok.`],
      };
    }
    return {
      status: 'PARTIAL',
      reasons: [
        `${input.runningChannels} kanal çalışıyor, ${input.unknownChannels} kanalın durumu okunamıyor.`,
        'Eksik gözlem yüzeyi varken tüm runtime "ACTIVE" ilan edilmez.',
      ],
    };
  }

  if (input.queueDepthKnown === true && input.activeJobKnown === true && input.notRunningChannels > 0) {
    return { status: 'IDLE', reasons: ['Kuyruk derinliği ve aktif iş biliniyor; çalışan kanal yok.'] };
  }

  return {
    status: 'UNKNOWN',
    reasons: [
      'Çalıştığı gözlemlenen kanal yok; kuyruk derinliği ve aktif iş de okunamıyor.',
      'Kuyruk bilinmediği için IDLE (boş kuyruk) VARSAYILMAZ.',
    ],
  };
}

/** Kanal aktivitelerinden özet girdisi üretir (saf sayım). */
export function summarizeChannels(channels: readonly SchedChannel[]): {
  running: number; blocked: number; unknown: number; notRunning: number;
} {
  const out = { running: 0, blocked: 0, unknown: 0, notRunning: 0 };
  if (!Array.isArray(channels)) return out;
  for (const c of channels as readonly SchedChannel[]) {
    if (!c) continue;
    if (c.activity === 'RUNNING') out.running++;
    else if (c.activity === 'BLOCKED') out.blocked++;
    else if (c.activity === 'NOT_RUNNING') out.notRunning++;
    else out.unknown++;
  }
  return out;
}

/** Sınıf başına alan sayısı (rozet sayaçları). */
export function countBySchedClass(channels: readonly SchedChannel[]): Record<SchedObservability, number> {
  const out: Record<SchedObservability, number> = {
    OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0, UNSAFE_TO_OBSERVE: 0,
  };
  if (!Array.isArray(channels)) return out;
  for (const c of channels as readonly SchedChannel[]) {
    if (!c || !Array.isArray(c.fields)) continue;
    for (const f of c.fields as readonly SchedField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass]++;
    }
  }
  return out;
}

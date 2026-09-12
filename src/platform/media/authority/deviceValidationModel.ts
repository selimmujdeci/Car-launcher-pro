/**
 * deviceValidationModel.ts — MÜZİK HUB PAKET B · Cihaz doğrulama sözleşmesi (SAF).
 *
 * NEDEN: Paket A'nın tamamı `docs/DEVICE_VALIDATION_LEDGER.md` içinde 🔴 bekliyor.
 * Kütük bir METİN belgesidir; araçtayken telefonla belge açıp madde işaretlemek
 * pratik değildir ve **sonuç uygulamanın kendi gözlemiyle ilişkilendirilemez**.
 * Bu modül senaryoları makine-okur hâle getirir: hangi senaryo koşuldu, ne
 * bekleniyordu, ne gözlendi, hangi kanıt olaylarıyla.
 *
 * PAZARLIKSIZ: bu modül **hiçbir senaryoyu kendisi GEÇMİŞ SAYMAZ**. Varsayılan
 * `NOT_RUN`'dır; sonuç yalnız cihazda ölçüm kaydedilirse değişir. Otomatik
 * "başarılı" üretimi yapısal olarak yoktur (geçiş fonksiyonu kanıt ister).
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/* ── Senaryo katalogu ────────────────────────────────────────────────────── */

export type ScenarioGroup =
  | 'LIFECYCLE'      // A · servis yaşam döngüsü
  | 'FOCUS'          // B · audio focus
  | 'NOISY'          // C · becoming-noisy / rota
  | 'SESSION'        // D · MediaSession kontrol yüzeyleri
  | 'PROCESS'        // E · process death / restore
  | 'SOURCE_SWITCH'  // F · kaynak devri
  | 'QUEUE'          // G · kuyruk sapması
  | 'ENDURANCE';     // H · uzun süreli çalışma

export const SCENARIO_GROUP_LABEL: Readonly<Record<ScenarioGroup, string>> = {
  LIFECYCLE:     'A · Servis Yaşam Döngüsü',
  FOCUS:         'B · Ses Odağı',
  NOISY:         'C · Kulaklık/Rota Kaybı',
  SESSION:       'D · MediaSession Kontrolleri',
  PROCESS:       'E · Süreç Ölümü ve Kurtarma',
  SOURCE_SWITCH: 'F · Kaynak Devri',
  QUEUE:         'G · Kuyruk Sapması',
  ENDURANCE:     'H · Uzun Süreli Çalışma',
} as const;

export interface ScenarioSpec {
  readonly id: string;
  readonly group: ScenarioGroup;
  /** Cihazda YAPILACAK işlem (Türkçe, tek cümle). */
  readonly action: string;
  /** GÖZLENMESİ gereken sonuç — "beklenen" budur, uydurulmaz. */
  readonly expected: string;
  /**
   * Bu senaryo uygulamanın kendi olay izinden DOĞRULANABİLİR mi?
   * false → yalnız insan gözlemi (ör. "ses hoparlörden patlamadı").
   */
  readonly evidenceBacked: boolean;
}

/**
 * Zorunlu cihaz senaryoları (görev §3 · A–H). Bu liste **sözleşmedir**:
 * kütükteki maddelerle birebir izlenebilir olmalıdır.
 */
export const DEVICE_SCENARIOS: readonly ScenarioSpec[] = [
  /* A · Yaşam döngüsü */
  { id: 'lifecycle.cold_start', group: 'LIFECYCLE', evidenceBacked: true,
    action: 'Uygulamayı tamamen kapatıp aç, cihaz müziğinden bir parça çal.',
    expected: 'Servis oluşur, ses çıkar, bildirimde CAROS oynatma kontrolü görünür.' },
  { id: 'lifecycle.play', group: 'LIFECYCLE', evidenceBacked: true,
    action: 'Duraklatılmış parçada ÇAL\'a bas.',
    expected: 'Ses başlar; LAB\'da "ses kanıtı" EVET olur.' },
  { id: 'lifecycle.pause', group: 'LIFECYCLE', evidenceBacked: true,
    action: 'Çalarken DURAKLAT\'a bas.',
    expected: 'Ses susar; hüküm KULLANICI DURAKLATTI olur.' },
  { id: 'lifecycle.stop', group: 'LIFECYCLE', evidenceBacked: true,
    action: 'Oynatmayı durdur (kuyruğu boşalt).',
    expected: 'Ses susar, kuyruk 0, odak BIRAKILIR.' },
  { id: 'lifecycle.service_destroy', group: 'LIFECYCLE', evidenceBacked: true,
    action: 'Çalmazken uygulamayı son kullanılanlardan kaldır.',
    expected: 'Servis kapanır (service_destroyed olayı), kaynak sızıntısı olmaz.' },
  { id: 'lifecycle.service_recreate', group: 'LIFECYCLE', evidenceBacked: true,
    action: 'Servis kapandıktan sonra tekrar müzik çal.',
    expected: 'Servis yeniden oluşur; TEK servis örneği olur (çift oynatıcı YOK).' },

  /* B · Audio focus */
  { id: 'focus.gain', group: 'FOCUS', evidenceBacked: true,
    action: 'Müzik çalmaya başla.',
    expected: 'focus_requested → focus_granted; odak BİZDE.' },
  { id: 'focus.transient_loss', group: 'FOCUS', evidenceBacked: true,
    action: 'Çalarken navigasyon/asistan gibi kısa bir sesli kesinti tetikle.',
    expected: 'Müzik duraklar (focus_loss_transient), kesinti bitince DEVAM eder.' },
  { id: 'focus.transient_duck', group: 'FOCUS', evidenceBacked: true,
    action: 'Ducking isteyen bir bildirim sesi tetikle.',
    expected: 'Ses kısılır ama DURMAZ; bildirim bitince eski seviyeye döner.' },
  { id: 'focus.permanent_loss', group: 'FOCUS', evidenceBacked: true,
    action: 'Başka bir müzik uygulaması başlat.',
    expected: 'Müzik durur ve o uygulama kapanınca KENDİLİĞİNDEN BAŞLAMAZ.' },
  { id: 'focus.regain_after_user_pause', group: 'FOCUS', evidenceBacked: true,
    action: 'Kullanıcı olarak duraklat, sonra başka uygulama ses çalıp bıraksın.',
    expected: 'Müzik OTOMATİK BAŞLAMAZ (kullanıcı kararı korunur).' },
  { id: 'focus.delayed_gain', group: 'FOCUS', evidenceBacked: true,
    action: 'Telefon görüşmesi sürerken müzik çalmayı dene, sonra görüşmeyi bitir.',
    expected: 'Görüşme sırasında ses ÇIKMAZ; görüşme bitince çalma başlar.' },

  /* C · Becoming noisy */
  { id: 'noisy.bt_disconnect', group: 'NOISY', evidenceBacked: true,
    action: 'Bluetooth ses cihazının bağlantısını kes.',
    expected: 'Müzik ANINDA durur; hoparlörden bağırmaz (becoming_noisy).' },
  { id: 'noisy.wired_unplug', group: 'NOISY', evidenceBacked: true,
    action: 'Kablolu kulaklığı çıkar.',
    expected: 'Müzik anında durur; sebep becoming_noisy olarak görünür.' },
  { id: 'noisy.route_change_visible', group: 'NOISY', evidenceBacked: true,
    action: 'Ses yolunu değiştir (BT ↔ hoparlör).',
    expected: 'LAB\'da ses yolu değişimi görünür; yanlış yoldan ses çıkmaz.' },

  /* D · MediaSession */
  { id: 'session.notification_play_pause', group: 'SESSION', evidenceBacked: true,
    action: 'Bildirim panelinden çal/duraklat.',
    expected: 'Ses değişir ve UI ile AYNI durumu gösterir (çift komut yok).' },
  { id: 'session.lock_screen', group: 'SESSION', evidenceBacked: false,
    action: 'Kilit ekranından kontrol et.',
    expected: 'Kontroller görünür ve çalışır.' },
  { id: 'session.headset_button', group: 'SESSION', evidenceBacked: true,
    action: 'Kulaklık/BT medya tuşuna bas.',
    expected: 'Tek komut üretilir (çift atlama YOK).' },
  { id: 'session.steering_wheel', group: 'SESSION', evidenceBacked: true,
    action: 'Direksiyon medya tuşlarıyla sonraki/önceki/çal/duraklat yap.',
    expected: 'Komutlar aynı otoriteye düşer, UI eşzamanlı güncellenir.' },
  { id: 'session.unsupported_rejected', group: 'SESSION', evidenceBacked: true,
    action: 'Canlı radyoda ileri sarmayı dene.',
    expected: 'Sessizce yutulmaz; desteklenmiyor olarak REDDEDİLİR.' },

  /* E · Process death */
  { id: 'process.activity_death', group: 'PROCESS', evidenceBacked: true,
    action: 'Müzik çalarken activity\'yi öldür (geliştirici seçeneği).',
    expected: 'Çalma sürer; UI dönünce GERÇEK durumu gösterir.' },
  { id: 'process.service_death', group: 'PROCESS', evidenceBacked: true,
    action: 'Servisi öldür.',
    expected: 'Ses durur; uygulama açılınca kuyruk geri gelir ama KENDİLİĞİNDEN ÇALMAZ.' },
  { id: 'process.app_reopen', group: 'PROCESS', evidenceBacked: true,
    action: 'Uygulamayı öldür ve yeniden aç.',
    expected: 'Kurtarma duraklatılmış yüklenir; otomatik ses YOKTUR.' },
  { id: 'process.stale_command_rejected', group: 'PROCESS', evidenceBacked: true,
    action: 'Kurtarma sürerken hızlıca çal/duraklat bas.',
    expected: 'Bayat komut reddedilir; çift oynatma oluşmaz.' },
  { id: 'process.duplicate_prevention', group: 'PROCESS', evidenceBacked: true,
    action: 'Uygulamayı arka arkaya hızlıca aç/kapat.',
    expected: 'Tek servis + tek oynatıcı kalır (duplicate_backend = 0).' },

  /* F · Kaynak devri */
  { id: 'source.local_to_stream', group: 'SOURCE_SWITCH', evidenceBacked: true,
    action: 'Cihaz müziğinden internet radyosuna geç.',
    expected: 'Eski kaynak TAMAMEN susar; iki ses üst üste binmez.' },
  { id: 'source.stream_to_local', group: 'SOURCE_SWITCH', evidenceBacked: true,
    action: 'İnternet radyosundan cihaz müziğine geç.',
    expected: 'Aynı garanti; devir COMMITTED olur.' },
  { id: 'source.managed_to_external', group: 'SOURCE_SWITCH', evidenceBacked: true,
    action: 'Cihaz müziğinden Spotify/YouTube\'a geç.',
    expected: 'Yerel ses susar; dış kaynakta "çalıyor" İDDİA EDİLMEZ.' },
  { id: 'source.rollback_on_failure', group: 'SOURCE_SWITCH', evidenceBacked: true,
    action: 'Ağ kapalıyken internet radyosuna geçmeyi dene.',
    expected: 'Devir düşer, önceki kaynağa dönülür veya güvenli durulur.' },
  { id: 'source.late_callback_rejected', group: 'SOURCE_SWITCH', evidenceBacked: true,
    action: 'Devir sürerken hızlıca başka kaynak seç.',
    expected: 'Eski devir SUPERSEDED olur; yalancı başarı üretmez.' },

  /* G · Kuyruk */
  { id: 'queue.ui_ahead', group: 'QUEUE', evidenceBacked: true,
    action: 'Uygulamadan yeni bir liste çal.',
    expected: 'UI İLERİDE kısa süre görünür, kurtarma sonrası UYUMLU olur.' },
  { id: 'queue.native_ahead', group: 'QUEUE', evidenceBacked: true,
    action: 'Bildirimden birkaç kez "sonraki"ye bas.',
    expected: 'NATIVE İLERİDE görünür; UI native gerçeğe hizalanır.' },
  { id: 'queue.index_drift', group: 'QUEUE', evidenceBacked: true,
    action: 'Direksiyon tuşuyla parça atlarken UI\'yi izle.',
    expected: 'İndeks sapması tespit edilir ve hizalanır; ÇALAN parça değişmez.' },
  { id: 'queue.item_mismatch', group: 'QUEUE', evidenceBacked: true,
    action: 'Kuyruk değişimiyle atlamayı aynı anda tetikle.',
    expected: 'Çalan native öğe KORUNUR; UI ona hizalanır.' },
  { id: 'queue.duplicate_item', group: 'QUEUE', evidenceBacked: true,
    action: 'Aynı parçayı listede iki kez bulundur ve çal.',
    expected: 'Otomatik yıkıcı düzeltme YAPILMAZ; durum görünür kalır.' },
  { id: 'queue.empty_native', group: 'QUEUE', evidenceBacked: true,
    action: 'Kuyruğu bitir (son parça bitsin).',
    expected: 'Oynatma durduysa UI kuyruğu temizlenir; oynatma sürüyorsa TEMİZLENMEZ.' },
  { id: 'queue.stale_revision', group: 'QUEUE', evidenceBacked: true,
    action: 'Kurtarma anında yeni kuyruk yükle.',
    expected: 'Bayat kurtarma UYGULANMAZ (yeni durum eskiye çekilmez).' },

  /* H · Dayanıklılık */
  { id: 'endurance.30m', group: 'ENDURANCE', evidenceBacked: false,
    action: '30 dakika kesintisiz çal.',
    expected: 'Kesinti/ANR yok; ısınma kabul edilebilir.' },
  { id: 'endurance.60m', group: 'ENDURANCE', evidenceBacked: false,
    action: '60 dakika kesintisiz çal.',
    expected: 'Bellek büyümesi sınırlı; servis yeniden başlamadı.' },
  { id: 'endurance.120m', group: 'ENDURANCE', evidenceBacked: false,
    action: '120 dakika kesintisiz çal.',
    expected: 'Aynı garantiler; olay tamponu taşsa bile düşen sayısı görünür.' },
  { id: 'endurance.focus_churn', group: 'ENDURANCE', evidenceBacked: true,
    action: 'Uzun sürüşte navigasyon anonsları tekrarlansın.',
    expected: 'Duck/unduck dengeli kalır; ses kalıcı kısık kalmaz.' },
  { id: 'endurance.bt_reconnect', group: 'ENDURANCE', evidenceBacked: true,
    action: 'Bluetooth bağlan/kop döngüsü yaşat.',
    expected: 'Her kopmada güvenli duraklatma; kendiliğinden çalma YOK.' },
];

export function scenariosByGroup(group: ScenarioGroup): readonly ScenarioSpec[] {
  return DEVICE_SCENARIOS.filter((s) => s.group === group);
}

export function getScenario(id: string): ScenarioSpec | null {
  return DEVICE_SCENARIOS.find((s) => s.id === id) ?? null;
}

/* ── Oturum durumu ───────────────────────────────────────────────────────── */

export type SessionState =
  | 'idle' | 'preparing' | 'running' | 'passed' | 'failed' | 'blocked' | 'aborted';

export const SESSION_STATE_LABEL: Readonly<Record<SessionState, string>> = {
  idle:      'BOŞTA',
  preparing: 'HAZIRLANIYOR',
  running:   'KOŞUYOR',
  passed:    'GEÇTİ',
  failed:    'DÜŞTÜ',
  blocked:   'ENGELLENDİ',
  aborted:   'İPTAL',
} as const;

/** Senaryo sonucu. Varsayılan `NOT_RUN` — sahte yeşil ÜRETİLMEZ. */
export type ScenarioResult = 'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED';

export const SCENARIO_RESULT_LABEL: Readonly<Record<ScenarioResult, string>> = {
  NOT_RUN: 'KOŞULMADI',
  PASS:    'GEÇTİ',
  FAIL:    'DÜŞTÜ',
  BLOCKED: 'ENGELLENDİ',
} as const;

/**
 * Bir cihaz doğrulama oturumu. PII · token · medya URL'si · tam metadata
 * TAŞIMAZ (tip düzeyinde böyle bir alan yoktur).
 */
export interface ValidationSession {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly buildVersion: string;
  readonly deviceClass: string;
  readonly androidVersion: string;
  /** Head unit / automotive bilgisi — serbest metin DEĞİL, kısa etiket. */
  readonly headUnit: string;
  readonly activeSource: string;
  readonly scenarioId: string;
  readonly expectedOutcome: string;
  readonly observedOutcome: string;
  readonly result: ScenarioResult;
  readonly failureCode: string | null;
  /** Bu oturumda toplanan kanıt olayı sayısı. */
  readonly evidenceCount: number;
  /** Tampon dolduğu için düşen kanıt sayısı — "hiç yok" ile karıştırılmaz. */
  readonly droppedEvidenceCount: number;
}

/** Kalıcı kayıtta tutulan en fazla oturum — bounded. */
export const MAX_SESSIONS = 40;
/** Kalıcı şema sürümü — uyumsuz sürüm sessizce YÜKLENMEZ. */
export const SESSION_SCHEMA_VERSION = 1;

/** Serbest metin alanları için üst sınır (DoS + gizlilik). */
const MAX_TEXT = 160;

export function clipText(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export interface StartSessionInput {
  readonly sessionId: string;
  readonly scenarioId: string;
  readonly nowMs: number;
  readonly buildVersion?: string;
  readonly deviceClass?: string;
  readonly androidVersion?: string;
  readonly headUnit?: string;
  readonly activeSource?: string;
}

/**
 * Oturum açar. Bilinmeyen senaryo → `blocked` (uydurma senaryo KOŞULMAZ).
 * Yeni oturum ASLA `passed` başlamaz.
 */
export function startSession(input: StartSessionInput): ValidationSession {
  const spec = getScenario(input.scenarioId);
  return {
    sessionId: clipText(input.sessionId, 64),
    state: spec ? 'preparing' : 'blocked',
    startedAtMs: input.nowMs,
    completedAtMs: spec ? null : input.nowMs,
    buildVersion: clipText(input.buildVersion, 48),
    deviceClass: clipText(input.deviceClass, 48),
    androidVersion: clipText(input.androidVersion, 24),
    headUnit: clipText(input.headUnit, 64),
    activeSource: clipText(input.activeSource, 32) || 'NONE',
    scenarioId: clipText(input.scenarioId, 64),
    expectedOutcome: spec ? spec.expected : '',
    observedOutcome: '',
    result: 'NOT_RUN',
    failureCode: spec ? null : 'unknown_scenario',
    evidenceCount: 0,
    droppedEvidenceCount: 0,
  };
}

const ALLOWED_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  idle:      ['preparing', 'aborted'],
  preparing: ['running', 'blocked', 'aborted'],
  running:   ['passed', 'failed', 'blocked', 'aborted'],
  passed:    [],
  failed:    [],
  blocked:   [],
  aborted:   [],
};

export function canTransitionSession(from: SessionState, to: SessionState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface CompleteSessionInput {
  readonly observedOutcome: string;
  readonly result: Exclude<ScenarioResult, 'NOT_RUN'>;
  readonly failureCode?: string | null;
  readonly evidenceCount: number;
  readonly droppedEvidenceCount: number;
  readonly nowMs: number;
}

/**
 * Oturumu sonlandırır — **kanıt olmadan PASS verilemez.**
 * Gözlem metni boşsa veya kanıt gerektiren senaryoda hiç olay toplanmadıysa
 * sonuç `BLOCKED`'a düşürülür: "ölçmedim" ile "geçti" karıştırılmaz.
 */
export function completeSession(
  session: ValidationSession, input: CompleteSessionInput,
): ValidationSession {
  const target: SessionState =
    input.result === 'PASS' ? 'passed'
      : input.result === 'FAIL' ? 'failed'
        : 'blocked';

  if (!canTransitionSession(session.state, target)) return session;

  const spec = getScenario(session.scenarioId);
  const observed = clipText(input.observedOutcome, 240);

  // DÜRÜSTLÜK KAPISI: kanıtsız PASS yasak.
  const evidenceMissing = spec?.evidenceBacked === true && input.evidenceCount <= 0;
  const downgraded = input.result === 'PASS' && (observed.length === 0 || evidenceMissing);

  const result: ScenarioResult = downgraded ? 'BLOCKED' : input.result;
  const failureCode = downgraded
    ? (evidenceMissing ? 'no_evidence_recorded' : 'no_observation_recorded')
    : (input.failureCode ?? null);

  return {
    ...session,
    state: downgraded ? 'blocked' : target,
    completedAtMs: input.nowMs,
    observedOutcome: observed,
    result,
    failureCode: failureCode ? clipText(failureCode, 48) : null,
    evidenceCount: Math.max(0, Math.trunc(input.evidenceCount)),
    droppedEvidenceCount: Math.max(0, Math.trunc(input.droppedEvidenceCount)),
  };
}

export function markSessionRunning(
  session: ValidationSession, nowMs: number,
): ValidationSession {
  if (!canTransitionSession(session.state, 'running')) return session;
  return { ...session, state: 'running', startedAtMs: nowMs };
}

export function abortSession(session: ValidationSession, nowMs: number): ValidationSession {
  if (!canTransitionSession(session.state, 'aborted')) return session;
  return { ...session, state: 'aborted', completedAtMs: nowMs, result: 'NOT_RUN' };
}

/* ── Özet ────────────────────────────────────────────────────────────────── */

export interface ValidationSummary {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly blocked: number;
  readonly notRun: number;
  /** Kapsam: kaç senaryo EN AZ bir kez koşuldu (PASS veya FAIL). */
  readonly coveredScenarios: number;
  readonly totalScenarios: number;
}

/**
 * Senaryo başına EN SON sonucu esas alır. Hiç koşulmayan senaryolar
 * `notRun` sayılır — kapsam boşluğu gizlenmez.
 */
export function summarize(sessions: readonly ValidationSession[]): ValidationSummary {
  const latest = new Map<string, ValidationSession>();
  for (const s of sessions) {
    const prev = latest.get(s.scenarioId);
    if (!prev || s.startedAtMs >= prev.startedAtMs) latest.set(s.scenarioId, s);
  }

  let pass = 0, fail = 0, blocked = 0;
  for (const spec of DEVICE_SCENARIOS) {
    const s = latest.get(spec.id);
    if (!s) continue;
    if (s.result === 'PASS') pass += 1;
    else if (s.result === 'FAIL') fail += 1;
    else if (s.result === 'BLOCKED') blocked += 1;
  }

  const covered = pass + fail;
  return {
    total: sessions.length,
    pass,
    fail,
    blocked,
    notRun: DEVICE_SCENARIOS.length - pass - fail - blocked,
    coveredScenarios: covered,
    totalScenarios: DEVICE_SCENARIOS.length,
  };
}

/** Senaryo başına EN SON sonuç — LAB tablosu bunu gösterir. */
export function latestResults(
  sessions: readonly ValidationSession[],
): Readonly<Record<string, ScenarioResult>> {
  const out: Record<string, ScenarioResult> = {};
  for (const spec of DEVICE_SCENARIOS) out[spec.id] = 'NOT_RUN';
  const seenAt: Record<string, number> = {};
  for (const s of sessions) {
    if (!(s.scenarioId in out)) continue;
    if (seenAt[s.scenarioId] !== undefined && s.startedAtMs < seenAt[s.scenarioId]) continue;
    seenAt[s.scenarioId] = s.startedAtMs;
    out[s.scenarioId] = s.result;
  }
  return out;
}

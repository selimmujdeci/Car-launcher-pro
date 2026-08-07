/**
 * maviConsoleModel.ts — Mavi Konsolu'nun SAF modeli (Faz A7).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu yok.
 * Zaman gereken her yerde `readAt` (kaynak katmanının ölçtüğü tek damga) kullanılır.
 *
 * ── GİZLİLİK SÖZLEŞMESİ (YAPISAL) ──────────────────────────────────────────
 * Bu modelin GİRDİ tipinde (`MaviRawSnapshot`) transcript metni, `lastCommand`
 * nesnesi/metni, konuşma geçmişi (history) veya öneri METNİ TAŞIYAN HİÇBİR ALAN
 * YOKTUR. Taşınan tek şey VAR/YOK bayrakları ve ADET'lerdir. Yani "sızdırmamaya
 * dikkat etmek" gerekmez — sızdırmak TİP OLARAK mümkün değildir.
 * `transcriptLength` bir SAYIDIR (uzunluk), metin değildir; repo'nun kendi uzak
 * tanı sözleşmesi de tam olarak bunu taşır.
 *
 * ── SINIFLAR ────────────────────────────────────────────────────────────────
 * A3 (`sessionInspectorModel`) sözleşmesi AYNEN kullanılır — A4/A5/A6 ile aynı
 * gözlemlenebilirlik dili: OBSERVED · DERIVED · UNAVAILABLE · STALE.
 * Paralel bir sınıflandırma sistemi KURULMAZ.
 */

import {
  observed, derived, unavailable,
  type InspectorField, type Observability,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Repo GERÇEĞİ — durum değerleri tahmin EDİLMEZ
 *
 * `voiceService.VoiceStatus` birliği REPODA şudur:
 *   'idle' | 'listening' | 'processing' | 'success' | 'error' | 'throttled'
 * Aşağıdaki kümeler bu birlikten TÜRETİLİR; uydurma durum eklenmez.
 * ════════════════════════════════════════════════════════════════════════ */

/** Mavi'nin GERÇEKTEN bir iş yürüttüğü durumlar. */
export const MAVI_ACTIVE_VOICE_STATUS: readonly string[] = ['listening', 'processing'];

/** Kaynaklar hazır ama iş yürümüyor — "bekleme" durumları. */
export const MAVI_WAITING_VOICE_STATUS: readonly string[] = ['idle', 'success'];

/**
 * Repoda TANIMLI tüm durumlar. `throttled` bilinçli olarak NE aktif NE bekleme
 * sayılır: kısıtlama altındaki bir asistanı "HAZIR" ilan etmek yanlış olurdu,
 * "ÇALIŞIYOR" ilan etmek de. Hüküm BİLİNMİYOR'a düşer ve gerekçesi yazılır.
 */
export const MAVI_KNOWN_VOICE_STATUS: readonly string[] = [
  'idle', 'listening', 'processing', 'success', 'error', 'throttled',
];

/** Ekranda gösterilecek azami tanı satırı (bounded — ham telemetri dökülmez). */
export const MAX_MAVI_DIAG_ROWS = 20;
/** Bölüm başına azami alan. */
export const MAX_FIELDS_PER_MAVI_SECTION = 24;
/** Hüküm gerekçesi tavanı. */
export const MAX_MAVI_REASONS = 8;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü — YAPISAL tip (servis importu YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Mavi yaşam döngüsü — YALNIZ bayrak ve adet.
 * `null` = kaynak okunamadı (sıfır DEĞİL).
 */
export interface MaviVoiceRaw {
  /** Ham durum dizesi. Bilinmeyen değer TAHMİN EDİLMEZ, olduğu gibi taşınır. */
  readonly status:          string;
  readonly micAvailable:    boolean;
  /** 0.0–1.0 arası anlık mikrofon seviyesi. */
  readonly volumeLevel:     number;
  readonly followUp:        boolean;
  readonly suggestionCount: number;
  readonly historyCount:    number;
  /** Komutun KENDİSİ değil — yalnız varlığı. */
  readonly hasLastCommand:  boolean;
  /** Transcript'in KENDİSİ değil — yalnız varlığı. */
  readonly hasTranscript:   boolean;
  /** Hata METNİ değil — yalnız varlığı (mesaj serbest metindir, taşınmaz). */
  readonly hasError:        boolean;
}

/** Tanı halkası satırı — repo alan adları (`at`, `atMs` DEĞİL). */
export interface MaviDiagRaw {
  /** Duvar-saati damgası (ms). Geçersiz/0 → null; "şimdi" UYDURULMAZ. */
  readonly at:               number | null;
  readonly stage:            string;
  /** Transcript UZUNLUĞU (sayı). Metin değildir. */
  readonly transcriptLength: number | null;
  readonly errorCode:        string | null;
  readonly route:            string | null;
  readonly intent:           string | null;
}

export interface MaviAiHealthRaw {
  readonly healthy:        boolean;
  readonly consecFails:    number;
  readonly consecTimeouts: number;
  /** Devrenin daha ne kadar açık kalacağı (ms). 0 = bloke değil. */
  readonly blockedForMs:   number;
}

/** Sağlayıcı soğumaları — AYRI TUTULUR, tek toplamda BİRLEŞTİRİLMEZ. */
export interface MaviQuotaRaw {
  readonly geminiCooldownMs: number;
  readonly groqCooldownMs:   number;
  readonly haikuCooldownMs:  number;
}

/**
 * Proaktif kritik arıza uyarısı motoru — YALNIZ adet + dedup ANAHTARI + süre.
 * Uyarı METNİ, arıza açıklaması ve verdict içeriği bu katmana HİÇ GELMEZ.
 */
export interface MaviProactiveRaw {
  readonly spokenCount:         number;
  readonly suppressedCount:     number;
  /** Son uyarının makine-okur kök-neden KODU (serbest metin DEĞİL). Yoksa null. */
  readonly lastAlertKey:        string | null;
  /** Aynı arıza için kalan susma penceresi (ms). 0 = pencere kapalı. */
  readonly debounceRemainingMs: number;
  /** Son susturmanın makine-okur gerekçesi ('debounce' · 'reverse_attention' …). */
  readonly lastSuppressReason:  string | null;
  /* ── Açıklanabilir karar (bounded · kaynağı yoksa null) ─────────────────── */
  readonly lastReasonCode:      string | null;
  /** Güven DEĞERİ — kaynağı yoksa null (sahte 0 DEĞİL). */
  readonly lastConfidence:      number | null;
  /** Değerin ÖLÇEĞİ. Repoda iki ölçek var (0-100 / 0-1) ve BİRLEŞTİRİLMEZ. */
  readonly lastConfidenceScale: string | null;
  /** Kısa sanitize açıklama. Model düşüncesi/ham prompt DEĞİL. */
  readonly lastReasonSummary:   string | null;
  /** Kararın üreticisi (rule | parser | llm | fallback). */
  readonly lastDecisionSource:  string | null;
  /** Olay izinde bu karara ait satır sayısı (gerçek trail kaynağından). */
  readonly trailRowCount:       number | null;
}

/**
 * MAVI-M6-LAB-SPEECH-COUNTERS — M6 seslendirme otoritesinin tur-içi defteri ve
 * bounded sayaçları. Hepsi PII'sizdir: seslendirilen METİN taşınmaz, yalnız
 * bayrak + adet + tur kimliği (süreç-içi sayaç) gelir.
 */
export interface MaviSpeechRaw {
  /** Konuşma defterinin izlediği tur (M5 `activeTurnId` ile karşılaştırılır). */
  readonly turnId:                    number;
  readonly answeredThisTurn:          boolean;
  readonly progressedThisTurn:        boolean;
  readonly spoken:                    number;
  readonly suppressedDuplicate:       number;
  /** MAVI-M6-LATE-SPEECH-GATE: eskimiş turlu geç konuşma reddi (GERÇEKTEN ölçülür). */
  readonly staleLateSpeechSuppressed: number;
}

/** M5 tur kapılarının bounded sayaçları (PII YOK — yalnız adet ve durum). */
export interface MaviTurnRaw {
  readonly activeTurnId:                number;
  readonly activeState:                 string;
  readonly turnsStarted:                number;
  readonly turnsCompleted:              number;
  readonly turnsSuperseded:             number;
  readonly staleProviderResultsDropped: number;
  readonly staleActionsPrevented:       number;
  readonly staleFeedbackSuppressed:     number;
  /** Tavan doldu → sayılar ARTIK GERÇEK ADET DEĞİLDİR (dürüstçe belirtilir). */
  readonly countersSaturated:           boolean;
}

export interface MaviRawSnapshot {
  readonly readAt: number;
  readonly voice:    MaviVoiceRaw | null;
  /** `null` = halka OKUNAMADI · `[]` = halka GERÇEKTEN BOŞ (ikisi AYRI şeydir). */
  readonly diag:     readonly MaviDiagRaw[] | null;
  readonly aiHealth: MaviAiHealthRaw | null;
  readonly quota:    MaviQuotaRaw | null;
  readonly proactive: MaviProactiveRaw | null;
  readonly speech:   MaviSpeechRaw | null;
  readonly turn:     MaviTurnRaw | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviSectionId =
  | 'lifecycle' | 'diag' | 'ai-health' | 'quota' | 'proactive' | 'speech';

export interface MaviSection {
  readonly id:     MaviSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

export const MAVI_SECTION_TITLE: Readonly<Record<MaviSectionId, string>> = {
  'lifecycle': 'A · Mavi Yaşam Döngüsü',
  'diag':      'B · Son Teşhis Aşamaları',
  'ai-health': 'C · AI Sağlık Durumu (devre kesici)',
  'quota':     'D · Sağlayıcı Soğuma (429)',
  'proactive': 'E · Proaktif Kritik Arıza Uyarısı',
  'speech':    'F · Konuşma Otoritesi (M6) + Tur Kapıları (M5)',
} as const;

const SRC = {
  voice: 'voiceService.getVoiceSnapshot()',
  diag:  'voiceDiagService.getRecentVoiceDiag()',
  ai:    'aiHealth.getAiHealthSnapshot()',
  quota: 'companion/companionChatProvider.getProviderQuotaSnapshot()',
  proactive: 'companion/companionChatProvider.getProactiveAlertDiagnostics()'
           + ' + ai/aiOfflineReason.getProactiveSuppressionHistory()',
  speech: 'assistant/maviSpeech.getMaviSpeechDiagnostics()',
  turn:   'assistant/maviTurn.getMaviTurnDiagnostics()',
} as const;

function _bound(fields: readonly InspectorField[]): readonly InspectorField[] {
  return fields.length <= MAX_FIELDS_PER_MAVI_SECTION
    ? fields
    : fields.slice(0, MAX_FIELDS_PER_MAVI_SECTION);
}

/** VAR/YOK etiketi — içerik ASLA basılmaz. */
function _presence(v: boolean): string {
  return v ? 'VAR' : 'YOK';
}

/* ── A · Yaşam döngüsü ────────────────────────────────────────────────────── */

function _lifecycleSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const v = s.voice;

  if (!v) {
    f.push(unavailable(
      { id: 'mvVoice', label: 'ses durumu', source: SRC.voice, note: '' },
      'Ses anlık görüntüsü okunamadı — "boşta" VARSAYILMAZ.',
    ));
    return { id: 'lifecycle', title: MAVI_SECTION_TITLE.lifecycle, fields: _bound(f) };
  }

  const known = MAVI_KNOWN_VOICE_STATUS.indexOf(v.status) >= 0;

  f.push(observed(
    { id: 'mvStatus', label: 'durum (status)', source: SRC.voice,
      note: 'voiceService ham durum dizesi.' },
    v.status,
  ));
  f.push(derived(
    { id: 'mvStatusKnown', label: 'durum repoda TANIMLI mı', source: `${SRC.voice} (VoiceStatus birliği)`,
      note: 'KURAL: değer repodaki VoiceStatus birliğinde ise EVET. Bilinmeyen durum TAHMİN EDİLMEZ.' },
    known ? 'EVET' : 'HAYIR',
  ));
  f.push(observed(
    { id: 'mvMic', label: 'mikrofon kullanılabilir', source: SRC.voice,
      note: 'micAvailable — izin/donanım kapısı.' },
    v.micAvailable,
  ));
  f.push(observed(
    { id: 'mvVolume', label: 'ses seviyesi (0–1)', source: SRC.voice,
      note: 'Anlık RMS/görselleştirme seviyesi; dinleme dışında 0 olması NORMALDİR.' },
    v.volumeLevel,
  ));
  f.push(observed(
    { id: 'mvFollowUp', label: 'takip dinlemesi kurulu', source: SRC.voice,
      note: 'followUp — TTS bitince mikrofon otomatik yeniden açılacak mı.' },
    v.followUp,
  ));
  f.push(observed(
    { id: 'mvSuggestions', label: 'öneri adedi', source: SRC.voice,
      note: 'YALNIZ ADET — öneri metinleri bu katmana HİÇ GELMEZ.' },
    v.suggestionCount,
  ));
  f.push(observed(
    { id: 'mvHistory', label: 'geçmiş kaydı adedi', source: SRC.voice,
      note: 'YALNIZ ADET — konuşma geçmişi içeriği bu katmana HİÇ GELMEZ.' },
    v.historyCount,
  ));
  f.push(observed(
    { id: 'mvLastCommand', label: 'son komut', source: SRC.voice,
      note: 'GİZLİLİK: komut metni/nesnesi GÖSTERİLMEZ — yalnız varlığı.' },
    _presence(v.hasLastCommand),
  ));
  f.push(observed(
    { id: 'mvTranscript', label: 'transcript', source: SRC.voice,
      note: 'GİZLİLİK: transcript metni GÖSTERİLMEZ — yalnız varlığı.' },
    _presence(v.hasTranscript),
  ));
  f.push(observed(
    { id: 'mvError', label: 'ses hatası', source: SRC.voice,
      note: 'GİZLİLİK: hata MESAJI serbest metindir, taşınmaz — yalnız varlığı.' },
    _presence(v.hasError),
  ));

  return { id: 'lifecycle', title: MAVI_SECTION_TITLE.lifecycle, fields: _bound(f) };
}

/* ── B · Tanı özeti (satırlar ayrı yapıda) ────────────────────────────────── */

function _diagSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const d = s.diag;

  if (d === null) {
    f.push(unavailable(
      { id: 'mvDiagCount', label: 'tanı kaydı adedi', source: SRC.diag, note: '' },
      'Tanı halkası okunamadı. BOŞ halka ile OKUNAMADI AYRI şeydir — 0 gösterilmez.',
    ));
    return { id: 'diag', title: MAVI_SECTION_TITLE.diag, fields: _bound(f) };
  }

  f.push(observed(
    { id: 'mvDiagCount', label: 'tanı kaydı adedi', source: SRC.diag,
      note: 'Bounded halka (repo tavanı 40). 0 = halka GERÇEKTEN boş (okuma başarılı).' },
    d.length,
  ));

  const newest = d.length > 0 ? d[0] : null;   // dizi ZATEN en yeni→en eski sıralanmıştır
  f.push(newest
    ? observed(
        { id: 'mvDiagNewestStage', label: 'en yeni aşama', source: SRC.diag,
          note: 'Halkadaki EN SON kaydın aşaması.', updatedAt: newest.at },
        newest.stage,
      )
    : unavailable({ id: 'mvDiagNewestStage', label: 'en yeni aşama', source: SRC.diag, note: '' },
        'Halka boş — hiç ses tanı olayı kaydedilmedi.'));

  f.push(newest && newest.at !== null
    ? observed(
        { id: 'mvDiagNewestAt', label: 'en yeni kaydın damgası', source: SRC.diag,
          note: 'Gerçek duvar-saati damgası (kayıt anında alınır). Tanımlı bayatlık eşiği YOK → STALE hesaplanmaz.',
          updatedAt: newest.at },
        new Date(newest.at).toISOString(),
      )
    : unavailable({ id: 'mvDiagNewestAt', label: 'en yeni kaydın damgası', source: SRC.diag, note: '' },
        'Damga yok — "şimdi" UYDURULMAZ.'));

  f.push(observed(
    { id: 'mvDiagErrorRows', label: 'hata kodu taşıyan kayıt adedi', source: SRC.diag,
      note: 'errorCode alanı dolu olan satır sayısı (kod TANIMLAYICI sınıfıdır, serbest metin değildir).' },
    d.filter((e) => !!e.errorCode).length,
  ));

  return { id: 'diag', title: MAVI_SECTION_TITLE.diag, fields: _bound(f) };
}

/* ── C · AI sağlığı ───────────────────────────────────────────────────────── */

function _aiHealthSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const a = s.aiHealth;

  if (!a) {
    f.push(unavailable(
      { id: 'mvAi', label: 'devre kesici durumu', source: SRC.ai, note: '' },
      'AI sağlık anlık görüntüsü okunamadı — "sağlıklı" VARSAYILMAZ.',
    ));
    return { id: 'ai-health', title: MAVI_SECTION_TITLE['ai-health'], fields: _bound(f) };
  }

  f.push(observed(
    { id: 'mvAiHealthy', label: 'sağlıklı (devre kapalı)', source: SRC.ai,
      note: 'healthy = blockedUntil === 0. Bu AI AĞI sağlığıdır, araç bağlantısı DEĞİL.' },
    a.healthy,
  ));
  f.push(observed(
    { id: 'mvAiFails', label: 'art arda gerçek ağ hatası', source: SRC.ai,
      note: 'consecFails — ulaşılamazlık kovası.' },
    a.consecFails,
  ));
  f.push(observed(
    { id: 'mvAiTimeouts', label: 'art arda bütçe timeout\'u', source: SRC.ai,
      note: 'consecTimeouts — AYRI kova: yavaş ≠ ölü (repo bilinçli ayrımı).' },
    a.consecTimeouts,
  ));
  f.push(observed(
    { id: 'mvAiBlockedFor', label: 'bloke kalan süre (ms)', source: SRC.ai,
      note: 'blockedForMs — MONOTONİK saatten türeyen bir SÜREdir, duvar saati damgası DEĞİLDİR.' },
    a.blockedForMs,
  ));
  f.push(derived(
    { id: 'mvAiBlocked', label: 'şu an bloke mi', source: `${SRC.ai} (blockedForMs > 0)`,
      note: 'KURAL: blockedForMs > 0 → EVET.' },
    a.blockedForMs > 0 ? 'EVET' : 'HAYIR',
  ));

  return { id: 'ai-health', title: MAVI_SECTION_TITLE['ai-health'], fields: _bound(f) };
}

/* ── D · Sağlayıcı soğumaları ─────────────────────────────────────────────── */

function _quotaSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const q = s.quota;

  if (!q) {
    f.push(unavailable(
      { id: 'mvQuota', label: 'sağlayıcı soğuma pencereleri', source: SRC.quota, note: '' },
      'Kota anlık görüntüsü okunamadı — "kotasız" VARSAYILMAZ.',
    ));
    return { id: 'quota', title: MAVI_SECTION_TITLE.quota, fields: _bound(f) };
  }

  /* SAHA DERSİ (repo yorumu, 2026-07-04): pencereler SAĞLAYICI BAZLIDIR; tek
     ortak sayaca indirgemek "çapraz kirlenme" hatasını geri getirir. Bu yüzden
     üç alan AYRI tutulur ve TOPLANMAZ. */
  f.push(observed(
    { id: 'mvQuotaGemini', label: 'Gemini soğuma (ms)', source: SRC.quota,
      note: '0 = açık/kotasız. Diğer sağlayıcılarla BİRLEŞTİRİLMEZ.' },
    q.geminiCooldownMs,
  ));
  f.push(observed(
    { id: 'mvQuotaGroq', label: 'Groq soğuma (ms)', source: SRC.quota,
      note: '0 = açık/kotasız. Diğer sağlayıcılarla BİRLEŞTİRİLMEZ.' },
    q.groqCooldownMs,
  ));
  f.push(observed(
    { id: 'mvQuotaHaiku', label: 'Haiku soğuma (ms)', source: SRC.quota,
      note: '0 = açık/kotasız. Diğer sağlayıcılarla BİRLEŞTİRİLMEZ.' },
    q.haikuCooldownMs,
  ));
  f.push(derived(
    { id: 'mvQuotaAnyCooling', label: 'soğumada sağlayıcı var mı', source: `${SRC.quota} (herhangi biri > 0)`,
      note: 'KURAL: üç pencereden herhangi biri > 0 → EVET. Bu bir TOPLAM DEĞİLDİR; süreler ayrı alanlardadır.' },
    (q.geminiCooldownMs > 0 || q.groqCooldownMs > 0 || q.haikuCooldownMs > 0) ? 'EVET' : 'HAYIR',
  ));

  return { id: 'quota', title: MAVI_SECTION_TITLE.quota, fields: _bound(f) };
}

/* ── E · Proaktif kritik arıza uyarısı ────────────────────────────────────── */

function _proactiveSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const p = s.proactive;

  if (!p) {
    f.push(unavailable(
      { id: 'mvProactive', label: 'proaktif uyarı motoru', source: SRC.proactive, note: '' },
      'Proaktif uyarı teşhisi okunamadı — "hiç uyarı yok" VARSAYILMAZ.',
    ));
    return { id: 'proactive', title: MAVI_SECTION_TITLE.proactive, fields: _bound(f) };
  }

  f.push(observed(
    { id: 'mvPaSpoken', label: 'seslendirilen uyarı adedi', source: SRC.proactive,
      note: 'Oturum içi sayaç. GİZLİLİK: uyarı METNİ bu katmana HİÇ GELMEZ.' },
    p.spokenCount,
  ));
  f.push(observed(
    { id: 'mvPaSuppressed', label: 'bastırılan uyarı adedi', source: SRC.proactive,
      note: 'Susturma SESSİZ DEĞİLDİR: her biri sebep koduyla kaydedilir.' },
    p.suppressedCount,
  ));
  f.push(p.lastAlertKey !== null
    ? observed(
        { id: 'mvPaLastKey', label: 'son uyarı anahtarı', source: SRC.proactive,
          note: 'Kök-neden KODU (makine-okur dedup anahtarı) — arıza açıklaması DEĞİL.' },
        p.lastAlertKey,
      )
    : unavailable({ id: 'mvPaLastKey', label: 'son uyarı anahtarı', source: SRC.proactive, note: '' },
        'Bu oturumda hiç proaktif uyarı seslendirilmedi.'));
  f.push(observed(
    { id: 'mvPaDebounce', label: 'kalan susma penceresi (ms)', source: SRC.proactive,
      note: 'MONOTONİK saatten türeyen SÜRE (duvar saati damgası DEĞİL). 0 = pencere kapalı.' },
    p.debounceRemainingMs,
  ));
  f.push(p.lastSuppressReason !== null
    ? observed(
        { id: 'mvPaSuppressReason', label: 'son susturma gerekçesi', source: SRC.proactive,
          note: 'TANIMLAYICI sınıfı kod: debounce · reverse_attention · not_critical · safety_gate_unavailable …' },
        p.lastSuppressReason,
      )
    : unavailable({ id: 'mvPaSuppressReason', label: 'son susturma gerekçesi', source: SRC.proactive, note: '' },
        'Hiç susturma kaydedilmedi.'));
  f.push(derived(
    { id: 'mvPaMuted', label: 'şu an susma penceresinde mi', source: `${SRC.proactive} (debounceRemainingMs > 0)`,
      note: 'KURAL: debounceRemainingMs > 0 → EVET. Yalnız AYNI arıza anahtarı için geçerlidir.' },
    p.debounceRemainingMs > 0 ? 'EVET' : 'HAYIR',
  ));

  /* ── Açıklanabilir karar — "neden bu karar?" ─────────────────────────────
     Kaynağı OLMAYAN alan UNAVAILABLE olur; sahte varsayılan/0 BASILMAZ. */
  f.push(p.lastReasonCode !== null
    ? observed(
        { id: 'mvPaReasonCode', label: 'son karar sebep kodu', source: SRC.proactive,
          note: 'BOUNDED birlik (ok · not_critical · debounce · reverse_attention …) — serbest metin DEĞİL.' },
        p.lastReasonCode,
      )
    : unavailable({ id: 'mvPaReasonCode', label: 'son karar sebep kodu', source: SRC.proactive, note: '' },
        'Bu oturumda hiç proaktif karar üretilmedi.'));

  f.push(p.lastConfidence !== null && p.lastConfidenceScale !== null
    ? observed(
        { id: 'mvPaConfidence', label: 'karar güveni', source: `${SRC.proactive} → diagnosticTriage.RootCauseHypothesis.confidence`,
          note: 'ÖLÇEK BİRLİKTE TAŞINIR. Repoda İKİ ölçek var (percent_0_100 · unit_0_1) ve BİRLEŞTİRİLMEZ.' },
        `${p.lastConfidence} (${p.lastConfidenceScale})`,
      )
    : unavailable({ id: 'mvPaConfidence', label: 'karar güveni', source: SRC.proactive, note: '' },
        'Güven kaynağı YOK — sahte değer üretilmez (0 gösterilmez).'));

  f.push(p.lastDecisionSource !== null
    ? observed(
        { id: 'mvPaSource', label: 'karar üreticisi', source: SRC.proactive,
          note: 'Bugün üretimde YALNIZ deterministik kural motoru (`rule`) doğar; llm/parser/fallback üretilmez.' },
        p.lastDecisionSource,
      )
    : unavailable({ id: 'mvPaSource', label: 'karar üreticisi', source: SRC.proactive, note: '' },
        'Karar üreticisi bilinmiyor.'));

  f.push(p.lastReasonSummary !== null
    ? observed(
        { id: 'mvPaSummary', label: 'kısa açıklama', source: SRC.proactive,
          note: 'GİZLİLİK: tanı kuralının STATİK başlığı, kırpılmış. Ham prompt / model düşüncesi / seslendirilen metin DEĞİL.' },
        p.lastReasonSummary,
      )
    : unavailable({ id: 'mvPaSummary', label: 'kısa açıklama', source: SRC.proactive, note: '' },
        'Açıklama kaynağı yok.'));

  f.push(p.trailRowCount !== null
    ? observed(
        { id: 'mvPaTrailRows', label: 'olay izindeki karar satırı', source: 'diagnosticTrail.getDiagnosticTrail()',
          note: 'GERÇEK olay izi kaynağından sayım — ayrı/paralel bir kayıt deposu KURULMADI.' },
        p.trailRowCount,
      )
    : unavailable({ id: 'mvPaTrailRows', label: 'olay izindeki karar satırı', source: 'diagnosticTrail.getDiagnosticTrail()', note: '' },
        'Olay izi okunamadı — 0 VARSAYILMAZ.'));

  return { id: 'proactive', title: MAVI_SECTION_TITLE.proactive, fields: _bound(f) };
}

/* ── F · Konuşma otoritesi (M6) + tur kapıları (M5) ───────────────────────── */

/**
 * M6 seslendirme defteri ve M5 tur kapısı sayaçları.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `getMaviSpeechDiagnostics()` ve `getMaviTurnDiagnostics()` ÜRETİLİYOR ama
 * hiçbir LAB ekranı OKUMUYORDU → "gözlemlenemeyen özellik tamamlanmış değildir"
 * kuralına göre açık borçtu. Özellikle MAVI-M6-LATE-SPEECH-GATE'in eklediği
 * `staleLateSpeechSuppressed` sahada tek doğrulama kanıtıdır: geç konuşma
 * kapısının GERÇEKTEN tetiklendiğini yalnız bu sayaç gösterir.
 *
 * ── DÜRÜSTLÜK ──────────────────────────────────────────────────────────────
 *  · Kaynak okunamazsa `0` BASILMAZ → KAYNAK YOK.
 *  · Sayaç tavanı dolduysa ("doydu") sayılar ARTIK GERÇEK ADET DEĞİLDİR;
 *    bu durum ayrı bir alanla açıkça bildirilir.
 *  · Seslendirilen METİN, transcript ve kullanıcı içeriği BU BÖLÜME GİRMEZ.
 */
function _speechSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const sp = s.speech;
  const tn = s.turn;

  /* — M6 konuşma defteri — */
  if (!sp) {
    f.push(unavailable(
      { id: 'msSpeech', label: 'M6 konuşma defteri', source: SRC.speech, note: '' },
      'Konuşma otoritesi tanı yüzeyi okunamadı.',
    ));
  } else {
    f.push(observed(
      { id: 'msLedgerTurn', label: 'defterin izlediği tur', source: SRC.speech,
        note: 'Konuşma defterinin son tazelendiği tur kimliği (süreç-içi sayaç).' },
      sp.turnId,
    ));
    f.push(observed(
      { id: 'msAnswered', label: 'bu turda cevap verildi', source: SRC.speech,
        note: 'M6: tur başına EN FAZLA BİR `answer`.' },
      _presence(sp.answeredThisTurn),
    ));
    f.push(observed(
      { id: 'msProgressed', label: 'bu turda ara bilgi verildi', source: SRC.speech,
        note: 'M6: tur başına EN FAZLA BİR `progress`.' },
      _presence(sp.progressedThisTurn),
    ));
    f.push(observed(
      { id: 'msSpoken', label: 'toplam seslendirme', source: SRC.speech,
        note: 'Gerçekten TTS\'e giden çağrı adedi (metin TAŞINMAZ).' },
      sp.spoken,
    ));
    f.push(observed(
      { id: 'msDuplicate', label: 'mükerrer cevap reddi', source: SRC.speech,
        note: 'Aynı turda ikinci cevap/ara bilgi girişimi — üst üste konuşma önlendi.' },
      sp.suppressedDuplicate,
    ));
    f.push(observed(
      { id: 'msStaleLate', label: 'geç konuşma reddi (M6 kapısı)', source: SRC.speech,
        note: 'MAVI-M6-LATE-SPEECH-GATE: eskimiş turlu geç cevap susturuldu. '
            + 'Bu sayacın ARTMASI kapının sahada çalıştığının TEK kanıtıdır.' },
      sp.staleLateSpeechSuppressed,
    ));
  }

  /* — M5 tur kapıları — */
  if (!tn) {
    f.push(unavailable(
      { id: 'msTurn', label: 'M5 tur kapıları', source: SRC.turn, note: '' },
      'Tur tanı yüzeyi okunamadı.',
    ));
    return { id: 'speech', title: MAVI_SECTION_TITLE.speech, fields: _bound(f) };
  }

  f.push(observed(
    { id: 'msActiveTurn', label: 'aktif tur', source: SRC.turn, note: '' },
    tn.activeTurnId,
  ));
  f.push(observed(
    { id: 'msTurnState', label: 'tur durumu', source: SRC.turn,
      note: 'active = eylem/konuşma yetkisi var · completed = nihai zarf üretildi · '
          + 'superseded = kullanıcı yeni komut verdi.' },
    tn.activeState,
  ));

  /* Defter turu ile aktif tur AYRIŞMIŞSA: bu turda henüz konuşulmamış demektir.
     Türetilmiş ama İKİ GÖZLENEN alandan çıkar — tahmin YOK. */
  if (sp) {
    f.push(derived(
      { id: 'msTurnSync', label: 'defter aktif turla aynı mı', source: `${SRC.speech} + ${SRC.turn}`,
        note: 'HAYIR = bu turda henüz hiç konuşulmadı (defter önceki turda kalmış). '
            + 'Bu bir hata DEĞİLDİR; yalnız durum bilgisidir.' },
      sp.turnId === tn.activeTurnId ? 'EVET' : 'HAYIR',
    ));
  }

  f.push(observed({ id: 'msTurnsStarted',    label: 'başlayan tur',    source: SRC.turn, note: '' }, tn.turnsStarted));
  f.push(observed({ id: 'msTurnsCompleted',  label: 'tamamlanan tur',  source: SRC.turn, note: '' }, tn.turnsCompleted));
  f.push(observed(
    { id: 'msTurnsSuperseded', label: 'devralınan tur', source: SRC.turn,
      note: 'Kullanıcı cevabı beklemeden yeni komut verdi — geç sonuç yetkisi iptal edildi.' },
    tn.turnsSuperseded,
  ));
  f.push(observed(
    { id: 'msStaleProvider', label: 'düşürülen sağlayıcı sonucu', source: SRC.turn,
      note: 'Eskimiş turun geç AI cevabı eyleme DÖNÜŞMEDİ.' },
    tn.staleProviderResultsDropped,
  ));
  f.push(observed(
    { id: 'msStaleAction', label: 'engellenen geç eylem', source: SRC.turn,
      /* NOT: "BAŞLAT" gibi eylem fiilleri bilinçli olarak KULLANILMAZ — bu ekran
         salt-okunurdur ve müdahale butonu içermediği kaynak taramasıyla kilitlidir. */
      note: 'Eskimiş tur yan etki üretemedi.' },
    tn.staleActionsPrevented,
  ));
  f.push(observed(
    { id: 'msStaleFeedback', label: 'susturulan geç geri bildirim', source: SRC.turn,
      note: 'Çağrı-yeri tur kapısı (`continueIfTurnCurrent`) geç cevabı düşürdü.' },
    tn.staleFeedbackSuppressed,
  ));

  /* Doyma DÜRÜSTÇE bildirilir: tavana ulaşan sayaç artık ADET DEĞİLDİR. */
  f.push(tn.countersSaturated
    ? derived(
        { id: 'msSaturated', label: 'sayaçlar doydu', source: SRC.turn,
          note: 'Tavana ulaşıldı — yukarıdaki sayılar ARTIK GERÇEK ADET DEĞİLDİR (alt sınırdır).' },
        'EVET',
      )
    : observed(
        { id: 'msSaturated', label: 'sayaçlar doydu', source: SRC.turn,
          note: 'Tavana ulaşılmadı → sayılar gerçek adettir.' },
        'HAYIR',
      ));

  return { id: 'speech', title: MAVI_SECTION_TITLE.speech, fields: _bound(f) };
}

export function buildMaviSections(s: MaviRawSnapshot): MaviSection[] {
  if (!s) return [];
  return [
    _lifecycleSection(s), _diagSection(s), _aiHealthSection(s),
    _quotaSection(s), _proactiveSection(s), _speechSection(s),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı satırları — EN YENİDEN ESKİYE
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviDiagRow {
  /** 0 = en yeni. */
  readonly index:            number;
  readonly at:               number | null;
  /** Damga yoksa '—' (sahte tarih YOK). */
  readonly atLabel:          string;
  readonly stage:            string;
  /** Transcript UZUNLUĞU; yoksa null. Metin DEĞİL. */
  readonly transcriptLength: number | null;
  readonly errorCode:        string | null;
  readonly route:            string | null;
  readonly intent:           string | null;
}

/**
 * Görüntülenecek satırlar. `null` = kaynak okunamadı; `[]` = halka boş.
 * Kaynak katmanı diziyi ZATEN en yeni→en eski çevirir; burada sıra KORUNUR ve
 * bounded kırpma EN YENİLERİ tutar.
 */
export function buildMaviDiagRows(s: MaviRawSnapshot): MaviDiagRow[] | null {
  if (!s || s.diag === null) return null;
  const out: MaviDiagRow[] = [];
  const n = Math.min(s.diag.length, MAX_MAVI_DIAG_ROWS);
  for (let i = 0; i < n; i++) {
    const e = s.diag[i];
    out.push({
      index:            i,
      at:               e.at,
      atLabel:          e.at !== null ? new Date(e.at).toISOString() : '—',
      stage:            e.stage,
      transcriptLength: e.transcriptLength,
      errorCode:        e.errorCode,
      route:            e.route,
      intent:           e.intent,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * HÜKÜM — FAIL-CLOSED, ilk eşleşen kazanır
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviVerdict =
  | 'UNKNOWN' | 'AI_BLOCKED' | 'ERROR' | 'MIC_UNAVAILABLE' | 'RUNNING' | 'READY';

export const MAVI_VERDICT_LABEL: Readonly<Record<MaviVerdict, string>> = {
  UNKNOWN:         'BİLİNMİYOR',
  AI_BLOCKED:      'AI GEÇİCİ BLOKE',
  ERROR:           'HATA',
  MIC_UNAVAILABLE: 'MİKROFON KULLANILAMIYOR',
  RUNNING:         'ÇALIŞIYOR',
  READY:           'HAZIR',
} as const;

export interface MaviVerdictResult {
  readonly status:  MaviVerdict;
  readonly reasons: readonly string[];
}

/**
 * KURAL SIRASI (ilk eşleşen kazanır):
 *  1. Tüm ANA kaynaklar okunamadı                      → BİLİNMİYOR
 *  2. AI devre kesici blockedForMs > 0                 → AI GEÇİCİ BLOKE
 *  3. Ses hatası VAR *veya* EN YENİ tanı kaydı errorCode taşıyor → HATA
 *  4. micAvailable === false                           → MİKROFON KULLANILAMIYOR
 *  5. status aktif kümede ('listening' | 'processing') → ÇALIŞIYOR
 *  6. mic VAR ve status bekleme kümesinde ('idle' | 'success') → HAZIR
 *  7. Diğer her durum                                  → BİLİNMİYOR
 *
 * NOT: `throttled` ve repoda TANIMSIZ her durum (7)'ye düşer. Bilinmeyen bir
 * duruma "HAZIR" demek sahte güven üretirdi — tahmin YASAK.
 */
export function deriveMaviVerdict(s: MaviRawSnapshot): MaviVerdictResult {
  const reasons: string[] = [];
  const push = (r: string): void => { if (reasons.length < MAX_MAVI_REASONS) reasons.push(r); };

  if (!s) return { status: 'UNKNOWN', reasons: ['Anlık görüntü okunamadı.'] };

  const v = s.voice;
  const a = s.aiHealth;

  // 1 — hiçbir ana kaynak okunamadı
  if (v === null && a === null && s.quota === null && s.diag === null) {
    return {
      status: 'UNKNOWN',
      reasons: ['Hiçbir ana kaynak okunamadı (ses · tanı · AI sağlığı · kota) — hüküm verilemez.'],
    };
  }

  // 2 — AI devre kesici
  if (a && a.blockedForMs > 0) {
    push(`AI devre kesici AÇIK: ${a.blockedForMs} ms daha bloke.`);
    push('Bu bir AĞ/AI durumu; mikrofon ve STT ayrıca değerlendirilir.');
    return { status: 'AI_BLOCKED', reasons };
  }

  // 3 — hata (ses durumu veya EN YENİ tanı kaydının hata kodu)
  const newestDiag = s.diag && s.diag.length > 0 ? s.diag[0] : null;
  const newestErr  = newestDiag && newestDiag.errorCode ? newestDiag.errorCode : null;
  if ((v && (v.hasError || v.status === 'error')) || newestErr !== null) {
    if (v && v.hasError) push('Ses katmanında hata kaydı VAR (mesaj GÖSTERİLMEZ).');
    if (v && v.status === 'error') push('Ses durumu: error.');
    if (newestErr !== null) push(`En yeni tanı kaydı hata kodu taşıyor: ${newestErr}`);
    return { status: 'ERROR', reasons };
  }

  // 4 — mikrofon
  if (v && v.micAvailable === false) {
    push('micAvailable = false — mikrofon izni/donanımı kullanılamıyor.');
    return { status: 'MIC_UNAVAILABLE', reasons };
  }

  // 5 — aktif iş
  if (v && MAVI_ACTIVE_VOICE_STATUS.indexOf(v.status) >= 0) {
    push(`Ses durumu aktif işlem: ${v.status}.`);
    return { status: 'RUNNING', reasons };
  }

  // 6 — hazır (POZİTİF KANIT ŞARTI: ses kaynağı GERÇEKTEN okunmuş olmalı)
  if (v && v.micAvailable === true && MAVI_WAITING_VOICE_STATUS.indexOf(v.status) >= 0) {
    push(`Mikrofon kullanılabilir ve ses durumu beklemede: ${v.status}.`);
    return { status: 'READY', reasons };
  }

  // 7 — fail-closed
  if (v === null) {
    push('Ses anlık görüntüsü okunamadı — "hazır" VARSAYILMAZ.');
  } else if (MAVI_KNOWN_VOICE_STATUS.indexOf(v.status) < 0) {
    push(`Ses durumu repoda TANIMSIZ: "${v.status}" — tahmin edilmez.`);
  } else {
    push(`Ses durumu "${v.status}" ne aktif ne bekleme kümesinde — hüküm verilmez.`);
  }
  return { status: 'UNKNOWN', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rozet sayaçları
 * ════════════════════════════════════════════════════════════════════════ */

export function countByMaviClass(
  sections: readonly MaviSection[],
): Record<Observability, number> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  if (!Array.isArray(sections)) return out;
  for (const sec of sections) {
    if (!sec || !Array.isArray(sec.fields)) continue;
    for (const f of sec.fields as readonly InspectorField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass]++;
    }
  }
  return out;
}

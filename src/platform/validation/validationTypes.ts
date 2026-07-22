/**
 * validationTypes — Saha Doğrulama Modu (Validation Mode) sözleşmeleri.
 *
 * ⚠️ YENİ TELEMETRİ MOTORU DEĞİLDİR. Bu katman, MEVCUT kaynakların
 * (obdService tanı erişimcileri · obdDiagnosticRecorder · dtcService ·
 * ObdHealthMonitor · Mavi orkestrasyon telemetrisi) SALT-OKUNUR bir
 * TOPLAYICISIDIR. Yeni OBD komutu göndermez, yeni ölçüm başlatmaz.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  - Yalnız debug/developer özelliği; varsayılan KAPALI (validationFlag).
 *  - Oturum kapalıyken TEK bir boolean kontrolü dışında ek yük YOKTUR.
 *  - Kişisel veri TAŞIMAZ: ham VIN / ham MAC / kullanıcı metni / koordinat YOK.
 *  - Ölçülmeyen değer UYDURULMAZ → `null` ("ölçülmedi") olarak taşınır.
 *
 * V8/JIT: tüm kayıt tipleri SABİT alan sırasına sahiptir ve üretim
 * TEMPLATE spread'i üzerinden yapılır (boş `{}` + dinamik property YASAK).
 * Süreler monotonik delta'dır (performance.now); duvar saati yalnız gösterim.
 */

/* ── Ortak ─────────────────────────────────────────────────────────────────── */

/** Bir doğrulama testinin sonucu. `skip` = ölçüm yapılamadı (yargı YOK). */
export type ValidationStatus = 'pass' | 'warn' | 'fail' | 'skip';

/** Canlı kütük kanalı. */
export type ValidationChannel = 'obd' | 'perf' | 'mavi' | 'system';

export type ValidationLevel = 'info' | 'warn' | 'error';

/** Canlı kütük satırı — mesajlar SABİT/BOUNDED metindir, kullanıcı verisi taşımaz. */
export interface ValidationLogEntry {
  readonly id:       string;   // 'vlog-<seq>'
  readonly tsMonoMs: number;   // oturum başından monotonik delta
  readonly tsWallMs: number;   // yalnız gösterim
  readonly channel:  ValidationChannel;
  readonly level:    ValidationLevel;
  readonly message:  string;   // ≤ LOG_MESSAGE_MAX
}

export const LOG_MESSAGE_MAX = 160;

/* ── OBD bölümü ────────────────────────────────────────────────────────────── */

/**
 * OBD doğrulama metrikleri. Hepsi MEVCUT erişimcilerden TÜRETİLİR
 * (getHandshakeDiagnostics · getTransportStats · getObdConnLifecycle ·
 * getObdSessionHealth · dtcService · obdDiagnosticRecorder).
 */
export interface ObdValidationMetrics {
  /** Bağlantı başlangıcı (duvar saati, gösterim). null = oturum görülmedi. */
  readonly connectStartedWallMs: number | null;
  /** Bağlantı süresi (ms) — handshake `durationMs`. null = ölçülmedi. */
  readonly connectDurationMs:    number | null;
  /** Adaptör adı (bounded). '' = bilinmiyor. */
  readonly adapterName:          string;
  /** Adaptör adresi — MASKELİ (ham MAC ASLA). */
  readonly adapterAddrMasked:    string;
  /** 'ble' | 'classic' | 'tcp' | 'none' | 'unknown'. */
  readonly transport:            string;
  /** ZORLANAN protokol (ATSP<n>). */
  readonly protocolTried:        string | null;
  /** GERÇEK aktif protokol (ATDPN). */
  readonly protocolActive:       string | null;
  /** VIN OKUNDU mu — ham VIN taşınmaz. */
  readonly vinPresent:           boolean;
  /** VIN maskeli türev (yalnız WMI açık). null = VIN yok. */
  readonly vinMasked:            string | null;
  /** Taranan ECU sayısı. null = ECU taraması ÇALIŞMADI (uydurma yok). */
  readonly ecuCount:             number | null;
  /** Desteklenen PID sayısı (handshake `supportedCount`). */
  readonly pidCount:             number;
  /** Okunan DTC sayısı. null = DTC okuması ÇALIŞMADI. */
  readonly dtcCount:             number | null;
  /** Bağlantı kopması sayısı (lifecycle `disconnectCalled`). */
  readonly disconnectCount:      number;
  /** Yeniden bağlanma denemesi sayısı. */
  readonly reconnectAttempts:    number;
}

export const OBD_METRICS_TEMPLATE: Readonly<ObdValidationMetrics> = Object.freeze({
  connectStartedWallMs: null,
  connectDurationMs:    null,
  adapterName:          '',
  adapterAddrMasked:    '',
  transport:            'unknown',
  protocolTried:        null,
  protocolActive:       null,
  vinPresent:           false,
  vinMasked:            null,
  ecuCount:             null,
  pidCount:             0,
  dtcCount:             null,
  disconnectCount:      0,
  reconnectAttempts:    0,
});

/* ── Performans bölümü ─────────────────────────────────────────────────────── */

/**
 * Performans metrikleri. Gecikme/poll ölçümleri MEVCUT `onOBDData` akışının
 * monotonik varış deltalarından türetilir — yeni sorgu ÜRETİLMEZ.
 * Bellek/FPS yalnız altyapı varsa doldurulur; yoksa `null`.
 */
export interface PerfValidationMetrics {
  /** Gözlemlenen canlı veri paketi sayısı. */
  readonly liveDataSamples:   number;
  /** Ortalama canlı veri gecikmesi (son paket yaşı ortalaması, ms). */
  readonly avgLiveLatencyMs:  number | null;
  /** Ortalama polling süresi (paketler arası aralık ortalaması, ms). */
  readonly avgPollIntervalMs: number | null;
  /** Gözlemlenen en büyük paket arası boşluk (ms). */
  readonly maxLatencyMs:      number | null;
  /** Timeout sayısı (reconnect geçmişinde `timeout` nedenli). */
  readonly timeoutCount:      number;
  /** Kurtarma sayısı (tamamlanan reset). */
  readonly recoveryCount:     number;
  /** JS heap kullanımı (MB). null = tarayıcı/WebView sağlamıyor. */
  readonly memoryUsedMb:      number | null;
  readonly memoryPeakMb:      number | null;
  /** Ortalama FPS. null = ölçülmedi. */
  readonly avgFps:            number | null;
  readonly minFps:            number | null;
}

export const PERF_METRICS_TEMPLATE: Readonly<PerfValidationMetrics> = Object.freeze({
  liveDataSamples:   0,
  avgLiveLatencyMs:  null,
  avgPollIntervalMs: null,
  maxLatencyMs:      null,
  timeoutCount:      0,
  recoveryCount:     0,
  memoryUsedMb:      null,
  memoryPeakMb:      null,
  avgFps:            null,
  minFps:            null,
});

/* ── Mavi bölümü ───────────────────────────────────────────────────────────── */

/**
 * Tek bir Mavi (Operatör) çağrısının GÜVENLİ metadata'sı.
 * Kullanıcı metni / prompt / cevap ASLA taşınmaz — yalnız sabit jetonlar ve sayılar.
 */
export interface MaviValidationRecord {
  readonly id:                 string;   // 'mavi-<seq>'
  readonly tsMonoMs:           number;
  /** 'operator_task' | 'clarify' | 'chat' | 'needs_approval' | 'disabled'. */
  readonly intentKind:         string;
  /** Operatör görev kimliği veya 'none'. */
  readonly operatorTask:       string;
  readonly plannerUsed:        boolean;
  readonly toolCalls:          number;
  /** AI Usta bloğu üretildi mi. */
  readonly mechanicUsed:       boolean;
  readonly knowledgeUsed:      boolean;
  readonly memoryUsed:         boolean;
  readonly vehicleContextUsed: boolean;
  readonly durationMs:         number;
  readonly ok:                 boolean;
  /** Sabit hata jetonu (serbest metin DEĞİL). null = hata yok. */
  readonly errorKind:          string | null;
}

export const MAVI_RECORD_TEMPLATE: Readonly<MaviValidationRecord> = Object.freeze({
  id:                 '',
  tsMonoMs:           0,
  intentKind:         'disabled',
  operatorTask:       'none',
  plannerUsed:        false,
  toolCalls:          0,
  mechanicUsed:       false,
  knowledgeUsed:      false,
  memoryUsed:         false,
  vehicleContextUsed: false,
  durationMs:         0,
  ok:                 false,
  errorKind:          null,
});

/** `recordMaviRun` girdisi — id/zaman damgası kaydedici tarafından üretilir. */
export type MaviValidationInput = Omit<MaviValidationRecord, 'id' | 'tsMonoMs'>;

/* ── Oturum ────────────────────────────────────────────────────────────────── */

/** Doğrulama oturumunun tam anlık görüntüsü. */
export interface ValidationSnapshot {
  readonly sessionId:     string;
  readonly startedWallMs: number;
  /** Oturum süresi (monotonik, ms). */
  readonly durationMs:    number;
  readonly active:        boolean;
  readonly obd:           ObdValidationMetrics;
  readonly perf:          PerfValidationMetrics;
  readonly mavi:          readonly MaviValidationRecord[];
  readonly log:           readonly ValidationLogEntry[];
  /**
   * Teknisyenin işaretlediği saha adımları (`validationChecklist` id'leri).
   * Ölçüm DEĞİL beyandır: raporun hangi koşullarda toplandığını dürüstçe taşır.
   */
  readonly checklistDone: readonly string[];
}

/* ── Test sonucu ───────────────────────────────────────────────────────────── */

/** Tek ekranda gösterilecek test satırı — açıklama SABİT/kısa Türkçe metindir. */
export interface ValidationTest {
  readonly id:     string;
  readonly label:  string;
  readonly status: ValidationStatus;
  readonly detail: string;
}

/** Tüm testlerin özeti. */
export interface ValidationSummary {
  readonly tests:   readonly ValidationTest[];
  readonly passed:  number;
  readonly warned:  number;
  readonly failed:  number;
  readonly skipped: number;
  /** Genel karar: bir tane bile `fail` varsa `fail`, yoksa `warn`, yoksa `pass`. */
  readonly overall: ValidationStatus;
}

/**
 * Guardian AI Core — Faz A saf modeller — GUARDIAN-AI-G1.
 *
 * Navigasyondan BAĞIMSIZ, saf, fail-closed, deterministik güvenlik motoru
 * çekirdeği. `trip/cost/` saf çekirdek disiplinini birebir izler: yalnız
 * tipler + saf hesap, yan etki YOK.
 *
 * KESİN YASAK (bu modülde hiçbiri yok, hepsi gelecekte DI ile gelecek):
 * Mavi konuşması, UI, Toast, bildirim, ActionRegistry, GPS/OBD okuma, harita
 * sorgusu, ağ erişimi, React/Android, IO, global state, singleton.
 *
 * İLK SÜRÜM KAPSAMI: bu motor ANALİZ YAPMAZ (viraj/hız/hava/yorgunluk hesabı
 * YOK) — yalnız DI ile verilen `GuardianRuleResult[]`i toplar, tekilleştirir,
 * sıralar ve tek bir risk skoruna indirger. Gerçek analiz kuralları gelecekte
 * bu sözleşmeye uyan ayrı, saf fonksiyonlar olarak eklenecek.
 */

/* ── Severity — merkezi sıra + ağırlık ───────────────────────────────────── */

export type GuardianSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Düşükten yükseğe deterministik sıra — sıralama/karşılaştırma bunu kullanır. */
export const SEVERITY_ORDER: readonly GuardianSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Sayısal ağırlık — dedup karşılaştırması VE risk skoru formülü bunu kullanır. */
export const SEVERITY_WEIGHT: Readonly<Record<GuardianSeverity, number>> = {
  INFO:     0,
  LOW:      1,
  MEDIUM:   2,
  HIGH:     3,
  CRITICAL: 4,
};

/* ── Risk tipi ────────────────────────────────────────────────────────────── */

export type GuardianRiskType =
  | 'CURVE_RISK'            // viraj riski
  | 'SPEED_LIMIT_RISK'      // hız sınırı riski
  | 'DOWNHILL_RISK'         // iniş/yokuş aşağı riski
  | 'WEATHER_RISK'          // hava koşulu riski
  | 'VEHICLE_HEALTH_RISK'   // araç sağlığı riski
  | 'DRIVER_FATIGUE_RISK'   // sürücü yorgunluğu riski
  | 'ROAD_HAZARD'           // yol tehlikesi
  | 'SPEED_CAMERA_WARNING'; // hız kamerası uyarısı

/* ── Risk olayı ───────────────────────────────────────────────────────────── */

/**
 * Gelecekteki bir analiz kuralının ürettiği TEK risk olayı. Bu motor bu
 * olayları ÜRETMEZ — yalnız DI ile alır, toplar, tekilleştirir, sıralar.
 */
export interface GuardianRiskEvent {
  id:                  string;
  type:                GuardianRiskType;
  severity:            GuardianSeverity;
  /** Sürücüye olan mesafe (metre) — sıralamada yakınlık kriteri. */
  distanceMeters:      number;
  title:               string;
  message:             string;
  recommendedAction:   string;
  /** 0..1 — motor bunu savunmacı olarak clamp'ler (aralık dışı girişe karşı). */
  confidence:          number;
  /** Bu olayı üreten kuralın/kaynağın kimliği (teşhis amaçlı, serbest metin). */
  source:              string;
}

/** Bir analiz kuralının (DI ile gelecek) çıktısı. */
export interface GuardianRuleResult {
  ruleId:      string;
  riskEvents:  readonly GuardianRiskEvent[];
}

/** `runGuardian`in TEK girdisi. */
export interface GuardianInput {
  ruleResults: readonly GuardianRuleResult[];
}

/** `runGuardian`in çıktısı. */
export interface GuardianOutput {
  /** Tekilleştirilmiş + deterministik sıralı risk olayları. */
  riskEvents:        readonly GuardianRiskEvent[];
  /** Olaylar arasında en yüksek severity; hiç olay yoksa `null`. */
  highestSeverity:   GuardianSeverity | null;
  /** Bkz. aşağıdaki "overallRiskScore formülü" — bounded [0,1], deterministik. */
  overallRiskScore:  number;
}

/* ── overallRiskScore FORMÜLÜ (belgelenmiş, testte KESİN sayıyla kilitli) ──
 *
 * Olasılıksal-OR birleşimi: her risk olayı bağımsız bir "kötü sonuç" olasılığı
 * gibi ele alınır; skor "en az biri gerçekleşir" olasılığının yaklaşık halidir.
 *
 *   contribution_i = (SEVERITY_WEIGHT[severity_i] / 4) × clamp(confidence_i, 0, 1)
 *   overallRiskScore = 1 − Π_i (1 − contribution_i)
 *
 * Özellikler (hepsi testle kilitli):
 *   - BOUNDED [0,1]: her `contribution_i` ∈ [0,1] olduğundan her çarpan
 *     `(1 − contribution_i)` ∈ [0,1]; çarpımları da [0,1] içinde kalır.
 *   - BOŞ GİRİŞ → 0 (boş çarpım = 1 → 1 − 1 = 0).
 *   - TEK CRITICAL + confidence=1 → contribution=1 → çarpan 0 → skor 1.0.
 *   - MONOTON: yeni bir risk eklemek VEYA mevcut birinin severity/confidence
 *     değerini artırmak `contribution_i`yi artırır → çarpanı KÜÇÜLTÜR (asla
 *     büyütmez) → çarpım KÜÇÜLÜR (asla büyümez) → skor (1 − çarpım) ASLA
 *     AZALMAZ. "Risk ekleyince/kötüleşince güven sahte şekilde düşmez."
 *   - Skor DEDUPE SONRASI kümeden hesaplanır — aynı id'nin iki kez sayılması
 *     (skorun yanlışlıkla şişmesi) ENGELLENİR.
 */

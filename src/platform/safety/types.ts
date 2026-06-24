/**
 * Safety Assistant FAZ 1 — Tip tanımları
 *
 * SafetyRuleEngine'in girdi/çıktı sözleşmesi.
 * Sinyal isimleri CanAdapterData / VehicleState ile hizalıdır.
 */

// ── Uyarı seviyesi ──────────────────────────────────────────────────────────
/** info: bilgilendirme, ses yok. warning: dikkat, sesli. critical: anında müdahale. */
export type SafetyLevel = 'info' | 'warning' | 'critical';

// ── Ekran katmanı ────────────────────────────────────────────────────────────
/** icon: durum ikonu şeridinde. banner: üst bant. overlay: tam ekran (geri vites). */
export type SafetyScreen = 'icon' | 'banner' | 'overlay';

// ── Tek uyarı nesnesi ────────────────────────────────────────────────────────
/**
 * SafetyRuleEngine'den dönen atomik uyarı.
 * V8 hidden-class stabilitesi: tüm alanlar her zaman mevcut (tanımsız yok).
 */
export interface SafetyAlert {
  /** Kural kimliği (benzersiz, regresyon kasasına kilitlenir). */
  ruleId: string;
  /** Uyarı seviyesi. */
  level: SafetyLevel;
  /** Sürücüye gösterilecek Türkçe mesaj (kısa, emir kipi). */
  message: string;
  /** UI ikon anahtarı (string — UI katmanı çözümler). */
  icon: string;
  /** Hangi ekran katmanında gösterileceği. */
  screen: SafetyScreen;
  /**
   * Öncelik skoru — yüksek = önce.
   * critical: 80–100, warning: 40–70, info: 10–20 aralığı.
   */
  priority: number;
  /** Uyarının üretildiği zaman damgası (ms, now parametresinden gelir). */
  ts: number;
}

// ── Araç sinyal durumu ───────────────────────────────────────────────────────
/**
 * SafetyRuleEngine'e verilen normalleştirilmiş araç durumu.
 * Tüm alanlar opsiyonel + null kabul eder — sinyal yoksa kural tetiklenmez.
 */
export interface SafetyVehicleState {
  /** Araç hızı (km/h). null = sensör yok/bilinmiyor. */
  speed?: number | null;
  /** Geri vites durumu. */
  reverse?: boolean | null;
  /** Herhangi bir kapı açık mı (tüm kapılar toplu bayrak). */
  doorOpen?: boolean | null;
  /** El freni çekili mi. */
  parkingBrake?: boolean | null;
  /** Emniyet kemeri takılı mı. */
  seatbelt?: boolean | null;
  /** Farlar açık mı. */
  headlightsOn?: boolean | null;
  /** Motor kaputu açık mı. */
  hoodOpen?: boolean | null;
  /** Bagaj kapağı açık mı. */
  trunkOpen?: boolean | null;
  /** Motor soğutma suyu sıcaklığı (°C). */
  coolantTemp?: number | null;
  /** Yakıt seviyesi (%). */
  fuel?: number | null;
  /** 12V akü voltajı (V). */
  batteryVolt?: number | null;
  /** Yağ basıncı uyarı bayrağı. */
  oilWarning?: boolean | null;
  /** Gece/karanlık algısı (saat + ortam ışığı füzyonu). */
  isDark?: boolean | null;
}

// ── Stale damga haritası ─────────────────────────────────────────────────────
/**
 * Her sinyalin son güncellenme zamanı (ms).
 * Anahtar, SafetyVehicleState'in keyof'u.
 * Eksik anahtar = "taze sayılır" (engine uyarır).
 */
export type SafetyUpdatedAt = Partial<Record<keyof SafetyVehicleState, number>>;

// ── Engine girişi (state + stale damgaları) ─────────────────────────────────
/**
 * Birleşik giriş — state + her sinyal için son güncelleme ts'i.
 * SafetyRuleEngine yalnızca bu tiplerle çalışır; IO yok.
 */
export interface SafetyEngineInput {
  state: SafetyVehicleState;
  updatedAt?: SafetyUpdatedAt;
}

// ── SafetyAlertQueue çıktısı ─────────────────────────────────────────────────
/**
 * SafetyAlertQueue.update() dönüş tipi.
 * UI ve ses katmanı yalnızca bu çıktıya bakar; iç state'e erişmez.
 *
 * V8 hidden-class stabilitesi: tüm alanlar her zaman mevcut.
 */
export interface SafetyQueueOutput {
  /**
   * Görünür (debounce onaylı, koşulu aktif) alertler — priority azalan.
   * Eşitlikte ruleId alfabetik. Muted olanlar dahil (ses≠görsel).
   */
  visibleAlerts: SafetyAlert[];

  /**
   * visibleAlerts içindeki en yüksek öncelikli screen==='banner' alert.
   * Muted olsa bile gösterilir. Yoksa null.
   */
  primaryBannerAlert: SafetyAlert | null;

  /**
   * Bu tick'te seslendirilecek TEK alert. Seçim kriteri:
   *   - screen==='banner' (icon/overlay asla ses üretmez)
   *   - muted değil
   *   - announceCount < maxRepeats
   *   - lastAnnouncedTs==null VEYA now-lastAnnouncedTs >= repeatSec*1000
   * En yüksek öncelikli aday seçilir; hiç aday yoksa null.
   */
  voiceAnnouncementAlert: SafetyAlert | null;

  /**
   * Şu an current-instance olarak susturulmuş ruleId'ler.
   * (mute() çağrılmış, koşul hâlâ aktif, görsel görünür ama ses yok.)
   */
  muted: string[];

  /**
   * visibleAlerts içindeki screen==='banner' alertler arasında bu tick'te
   * seslendirilmeyen ruleId'ler (cooldown dolmamış / maxRepeats aşıldı /
   * muted / tek-slot yarışını kaybeden).
   */
  suppressed: string[];
}

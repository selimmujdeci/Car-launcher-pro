/**
 * mechanicHistoryTypes — AI Usta Faz 2 sözleşmesi: GEÇMİŞ + EĞİLİM + TAZELİK.
 *
 * ⚠️ YENİ TEŞHİS MOTORU YOKTUR, YENİ DEPO YOKTUR.
 * Faz 2 saf bir YORUM KATMANIDIR: Faz 1'in ürettiği `MechanicDiagnosis`
 * DEĞİŞTİRİLMEZ (güven, risk, nedenler aynen kalır); yanına yalnız
 * "bu daha önce de oldu mu / sıklaşıyor mu / bu sonuç ne kadar taze"
 * yorumu eklenir.
 *
 * ── GEÇMİŞİN KAYNAĞI (mevcut otoriteler) ───────────────────────────────────
 *   1) `platformEventBus.getRecentEvents({ name: 'ai.mechanic.report' })`
 *      → aiCore runtime ZATEN her koşuda bu olayı yayınlar (topCode, urgency,
 *        confidence, hasEvidence, generatedAt). Bounded RAM geçmişi.
 *   2) `aiCore/vehicleMemory` (MEVCUT Vehicle Memory) → araç hakkında ÖĞRENİLMİŞ
 *      kalıcı gerçekler, SALT OKUNUR (`recall`).
 * Hiçbirine YAZILMAZ: yazma, hafızayı ajanın `memory` girdisine geri besleyip
 * deterministik `hasEvidence`/kanıt setini değiştirirdi → "Verdict Engine
 * sonucunu yeniden hesaplama" kuralının ihlali olurdu.
 */

/** Tekrarlama durumu — aynı arıza kodunun geçmişteki görülme sayısından türer. */
export type MechanicRecurrence =
  | 'ilk'         // bu oturumda ilk kez görülüyor
  | 'tekrar'      // daha önce 1-2 kez görüldü
  | 'kronik'      // 3+ kez görüldü — kalıcı/yinelenen arıza
  | 'bilinmiyor'; // geçmiş okunamadı (uydurma yok)

/** Eğilim — aynı kodun görülme ARALIKLARININ yönü. */
export type MechanicTrend =
  | 'sıklaşıyor'
  | 'kararlı'
  | 'seyrekleşiyor'
  | 'bilinmiyor';  // ölçmeye yetecek tekrar yok

/** Teşhisin tazeliği — sonucun üretildiği andan bu yana geçen süre. */
export type MechanicFreshness =
  | 'taze'
  | 'gecikmiş'
  | 'bayat'
  | 'bilinmiyor';  // zaman damgası yok

/** Geçmişte görülmüş tek bir teşhis olayı (bus payload'ından, PII taşımaz). */
export interface MechanicHistoryEvent {
  /** Olayın arıza kodu (yoksa boş). */
  readonly code:        string;
  /** 0..100 — o anki rapor güveni (DEĞİŞTİRİLMEZ, yalnız taşınır). */
  readonly confidence:  number;
  /** aiCore aciliyet etiketi (ham). */
  readonly urgency:     string;
  /** Üretim zamanı (wall-clock ms). */
  readonly at:          number;
}

/**
 * Faz 2 çıktısı. `diagnosis` Faz 1'den GELDİĞİ GİBİ taşınır — bu katman onu
 * asla yeniden hesaplamaz.
 */
export interface MechanicInsight {
  /** Geçmişte aynı kodla eşleşen olaylar (en yeni önce, bounded). */
  readonly similarEvents: readonly MechanicHistoryEvent[];
  /** Aynı kodun toplam geçmiş görülme sayısı (mevcut sonuç HARİÇ). */
  readonly repeatCount:   number;
  readonly recurrence:    MechanicRecurrence;
  readonly trend:         MechanicTrend;
  readonly freshness:     MechanicFreshness;
  /** Teşhisin yaşı (ms) — zaman damgası yoksa undefined. */
  readonly ageMs?:        number;
  /** Deterministik takip önerisi (LLM üretmez). */
  readonly followUp:      string;
  /** Bayat sonuçta kullanıcıya AÇIKÇA gösterilecek uyarı. */
  readonly stalenessNote?: string;
  /** Mevcut Vehicle Memory'den ilgili ÖĞRENİLMİŞ gerçekler (salt okunur). */
  readonly learnedFacts:  readonly string[];
}

/** YALNIZ güvenli metadata — kod/metin içeriği taşımaz. */
export interface MechanicInsightTelemetry {
  readonly enabled:     boolean;
  readonly historyRead: boolean;
  readonly repeatCount: number;
  readonly recurrence:  MechanicRecurrence;
  readonly trend:       MechanicTrend;
  readonly freshness:   MechanicFreshness;
  readonly factCount:   number;
}

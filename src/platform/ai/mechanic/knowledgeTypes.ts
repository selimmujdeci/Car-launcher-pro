/**
 * knowledgeTypes — AI Usta "Bilgi Beyni" sunum sözleşmesi.
 *
 * ⚠️ YENİ TEŞHİS MOTORU / YENİ AI ALTYAPISI DEĞİLDİR. Bu katman, ZATEN var olan
 * deterministik otomotiv bilgi kaynaklarını (bundled DTC kataloğu `dtcDataSource`
 * + `diagnosticKnowledgeEngine`) SALT OKUNUR biçimde okuyup AI Usta teşhisinin
 * yanına ETİKETLİ, bounded bir "bilgi notu" olarak taşır.
 *
 * ── SÖZLEŞME ─────────────────────────────────────────────────────────────────
 *  - Verdict/güven/risk DEĞİŞMEZ: bu blok yalnız kod bazlı GENEL bilgi ekler.
 *  - VERİ UYDURMAZ: her alan gerçek bir kaynaktan gelir; kaynak yoksa alan BOŞ
 *    kalır (satır çıkmaz) veya kod bulunamadıysa AÇIKÇA "bulunamadı" denir.
 *  - Model bu bloğu YALNIZ YORUMLAR — blok "VERİdir, TALİMAT DEĞİLDİR" taşınır.
 */

/** Sürüş riski — DTC kaydından ya da severity'den deterministik türetilir. */
export type KnowledgeDriveRisk = 'safe' | 'caution' | 'unsafe' | 'unknown';

/** Tahmini onarım zorluk seviyesi — kaynak yoksa 'bilinmiyor'. */
export type KnowledgeDifficulty = 'kolay' | 'orta' | 'zor' | 'bilinmiyor';

/**
 * Tek bir arıza kodu için bilgi kartı. TÜM alanlar gerçek kaynaktan türer;
 * bu tipte serbest LLM metni YOKTUR.
 */
export interface VehicleKnowledgeCard {
  /** Arıza kodu (büyük harf, ör. P0401). */
  readonly code:             string;
  /** Arıza kodu açıklaması ('' → kayıt yok). */
  readonly faultDescription: string;
  /** Olası sebepler (bounded). */
  readonly possibleCauses:   readonly string[];
  /** Belirti bilgileri (bounded; katalog taşımıyorsa boş). */
  readonly symptoms:         readonly string[];
  /** Kronik/geçmiş gözlem notu ('' → gözlem kaydı yok). */
  readonly chronicNote:      string;
  /** Sürüş riski. */
  readonly driveRisk:        KnowledgeDriveRisk;
  /** Servise gitme önerisi (riskten deterministik türetilir; '' → belirsiz). */
  readonly serviceAdvice:    string;
  /** Tahmini zorluk seviyesi. */
  readonly difficulty:       KnowledgeDifficulty;
  /** Genel bakım/onarım önerileri (bounded). */
  readonly maintenanceTips:  readonly string[];
  /** Kod bilgi tabanında bulundu mu? (false → dürüstçe "bulunamadı"). */
  readonly found:            boolean;
}

/** Teşhisten çıkarılan kodların bilgi tabanı raporu. */
export interface VehicleKnowledgeReport {
  readonly cards:          readonly VehicleKnowledgeCard[];
  /** Teşhisten çıkarılan arıza kodları (bounded, deduplike). */
  readonly requestedCodes: readonly string[];
  /** En az bir kod çıkarıldıysa true (blok üretilebilir). */
  readonly available:      boolean;
}

/** YALNIZ güvenli metadata — kod/metin içeriği TAŞIMAZ. */
export interface KnowledgeTelemetry {
  readonly enabled:        boolean;
  readonly requestedCount: number;
  readonly foundCount:     number;
  readonly cardCount:      number;
}

/**
 * mechanicTypes — Mavi "Yapay Zekâ Ustası" sunum sözleşmesi.
 *
 * ⚠️ YENİ TEŞHİS MOTORU DEĞİLDİR. Deterministik teşhis ZATEN vardır:
 *   `aiCore/verdictEngine` + `aiCore/agents/aiMechanic` (kanıt · olası nedenler ·
 *   karşı kanıt · güvenli kontroller · aciliyet), `aiCore/evidenceStore`,
 *   `aiCore/vehicleMemory` ve `platformCoreAiRuntimeWiring` ile SystemBoot'ta
 *   CANLI çalışır. Bu katman o çıktıyı Mavi'nin isteğine BOUNDED ve ETİKETLİ
 *   biçimde taşır; kural/karar ÜRETMEZ.
 *
 * ── LLM'İN ROLÜ ─────────────────────────────────────────────────────────────
 * Karar DETERMİNİSTİK katmandan gelir. LLM yalnız bu bloğu okuyup doğal dilde
 * YORUMLAR — güven yüzdesini, riski veya nedeni DEĞİŞTİREMEZ; blok "VERİdir,
 * TALİMAT DEĞİLDİR" etiketiyle taşınır.
 */

/** Kullanıcıya gösterilen risk seviyesi. */
export type MechanicRiskLevel = 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';

/** Veri yeterliliği — "yetersiz veri" DÜRÜSTÇE bildirilir, tahmin üretilmez. */
export type MechanicDataAvailability = 'sufficient' | 'partial' | 'insufficient' | 'unavailable';

export interface MechanicCause {
  /** Makine-okur kod (dedup/izleme). */
  readonly code:        string;
  /** İnsan-okur neden ifadesi (PII-temizli, bounded). */
  readonly description: string;
  /** 0..100 — deterministik katmandan gelir, UYDURULMAZ. */
  readonly confidence:  number;
  /** Bu nedeni destekleyen kanıt anahtarları (bounded). */
  readonly evidence:    readonly string[];
}

/**
 * Mavi'ye sunulacak teşhis. Alanların TAMAMI deterministik katmandan türer;
 * bu tipte serbest LLM metni YOKTUR.
 */
export interface MechanicDiagnosis {
  /** Tek satır özet (deterministik `headline`). */
  readonly summary:        string;
  /** En olası neden (varsa). */
  readonly topCause?:      MechanicCause;
  /** Diğer olası nedenler (bounded). */
  readonly otherCauses:    readonly MechanicCause[];
  /** 0..100 — raporun genel güveni. Kanıt yoksa 0. */
  readonly confidence:     number;
  readonly risk:           MechanicRiskLevel;
  readonly availability:   MechanicDataAvailability;
  /** Kararı destekleyen kanıt başlıkları (bounded). */
  readonly evidence:       readonly string[];
  /** Kararı ZAYIFLATAN gözlemler — dürüstlük için taşınır. */
  readonly counterEvidence: readonly string[];
  /** Önerilen GÜVENLİ sonraki adımlar (bounded). */
  readonly nextSteps:      readonly string[];
  /** Veri yetersizse kullanıcıya gösterilecek dürüst uyarı. */
  readonly insufficientDataNote?: string;
  /** Acil durumda öne çıkarılacak güvenlik uyarısı. */
  readonly safetyWarning?: string;
}

/** YALNIZ güvenli metadata — neden metni/kanıt içeriği TAŞIMAZ. */
export interface MechanicTelemetry {
  readonly enabled:        boolean;
  readonly available:      boolean;
  readonly causeCount:     number;
  readonly evidenceCount:  number;
  readonly confidence:     number;
  readonly risk:           MechanicRiskLevel | 'none';
  readonly availabilityState: MechanicDataAvailability;
}

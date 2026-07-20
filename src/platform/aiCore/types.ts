/**
 * aiCore/types.ts — AI Core Faz-1 ORTAK KONTRATLAR (tek kaynak).
 *
 * AMAÇ (VİZYON — "aracın ikinci beyni"): AI Core, mevcut olgun altyapıyı (Vehicle HAL ·
 * Platform Event Bus · SignalEnvelope · Diagnostics V2 kök-neden motoru · Capability
 * Registry · Vehicle Fingerprint) ORKESTRE eden ince bir AKIL-YÜRÜTME katmanıdır. Bu
 * dosya o katmanın tüm modüllerinin (Evidence Store · Vehicle Context · Vehicle Memory ·
 * Verdict Engine · AI Orchestrator · Safety Gate · ajanlar) paylaştığı tipleri tanımlar.
 *
 * TASARIM İLKELERİ (CLAUDE.md · mevcut foundation deseniyle bire-bir):
 *  - İKİNCİ VERİ OTORİTESİ YOK: AI Core veri ÜRETMEZ, mevcut kaynaklardan TÜRETİR.
 *    Buradaki tipler ham telemetri değil, YORUMLANMIŞ akıl-yürütme çıktısıdır.
 *  - EXPLAINABLE (açıklanabilir): her ajan çıktısı kanıt + güven + olası nedenler +
 *    KARŞI KANIT + sonraki GÜVENLİ kontrol + aciliyet taşır. "Kara kutu skor" YASAK.
 *  - KANIT YOKSA TAHMİN YOK: `hasEvidence=false` ise ajan sonuç uydurmaz (gate-1).
 *  - READ-ONLY: Faz-1'de hiçbir ajan yazamaz. ECU write / coding / actuator KAPSAM DIŞI
 *    (Safety Gate zorlar — bkz. safetyGate.ts).
 *  - DETERMİNİSTİK: karar motoru offline çalışır; LLM yalnız `explanation` katmanıdır,
 *    KARAR OTORİTESİ DEĞİL (LLM null olabilir → sistem yine tam çalışır).
 *  - SAF/immutable: bu dosya yalnız tip + saf yardımcı; I/O · modül-durumu · yan etki YOK.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Aciliyet (urgency) — "8 Kapı" gate-8: en doğru aksiyon ne kadar acele?
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Aciliyet seviyesi (düşükten yükseğe). Aksiyon ÜRETMEZ (Faz-1 read-only) — yalnız
 * kullanıcıya/UI'a "ne kadar acele" sinyali verir. Güvenlik-kritik olaylar (overheat,
 * düşük yağ basıncı) `critical`e çıkar; salt gözlemler `watch`ta kalır.
 */
export type AiUrgency = 'none' | 'watch' | 'soon' | 'urgent' | 'critical';

const URGENCY_RANK: Readonly<Record<AiUrgency, number>> = {
  none: 0, watch: 1, soon: 2, urgent: 3, critical: 4,
};

/** İki aciliyetten YÜKSEK olanı (eskalasyon anlık — güvenlik lehine). */
export function maxUrgency(a: AiUrgency, b: AiUrgency): AiUrgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

/** Aciliyet sıralama rütbesi (0=none … 4=critical). */
export function urgencyRank(u: AiUrgency): number {
  return URGENCY_RANK[u] ?? 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt (evidence) — akıl-yürütmenin atomu
 * ════════════════════════════════════════════════════════════════════════ */

/** Kanıtın türü — hangi mevcut kaynaktan TÜREDİĞİNİ söyler (yeni veri değil). */
export type AiEvidenceKind =
  | 'signal'       // SignalEnvelope türevi (OBD/CAN/GPS ölçümü)
  | 'dtc'          // arıza kodu (Mode03)
  | 'diagnostic'   // Diagnostics V2 kök-neden hipotezi / triyaj bulgusu
  | 'capability'   // Capability Registry kaydı
  | 'memory'       // Vehicle Memory (öğrenilmiş kalıcı gerçek)
  | 'fingerprint'  // araç kimliği (fingerprint)
  | 'derived';     // birleşimden türetilen (fusion/context)

/**
 * Tek kanıt satırı. `summary` PII-temizli statik/sayısal metindir (koordinat/VIN/plaka
 * ASLA). `confidence` KANITTAN türer (SignalEnvelope confidence, capability confidence,
 * hipotez güveni) — sabit sayı DEĞİL.
 */
export interface AiEvidenceItem {
  /** Kararlı, dedup edilebilir anahtar (ör. 'signal.coolant_temp', 'dtc.P0128'). */
  readonly key: string;
  readonly kind: AiEvidenceKind;
  /** PII-temizli tek satır özet (sayısal/enum + statik metin). */
  readonly summary: string;
  /** 0..1 — kanıttan türeyen güven. */
  readonly confidence: number;
  /** Kanıtın gözlendiği an (Unix ms). 0 = bilinmiyor. */
  readonly observedAt: number;
  /** Kaynak etiketi (ör. 'obd', 'can', 'diagnostics', 'capability'). */
  readonly source: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Olası neden + karşı kanıt (explainable çekirdek)
 * ════════════════════════════════════════════════════════════════════════ */

/** Olası neden — RAKİP AĞIRLIKLI hipotez (Diagnostics V2 RootCauseHypothesis ile hizalı). */
export interface AiPossibleCause {
  /** Sabit makine-okur kod (dedup/ranking). */
  readonly code: string;
  /** İnsan-okur problem ifadesi (PII-temizli). */
  readonly description: string;
  /** 0..100 — kanıttan türeyen olasılık. */
  readonly confidence: number;
  /** Bu nedeni DESTEKLEYEN kanıt anahtarları (AiEvidenceItem.key). */
  readonly supportingEvidence: readonly string[];
}

/**
 * KARŞI KANIT — bir nedene KARŞI argüman. Explainable akıl-yürütmenin ayırt edici
 * parçası: "bu ısınma gibi görünüyor AMA soğutucu sıcaklık sinyali taze ve normal".
 * Zero-trust'ın doğal sonucu — tek yönlü "kanıt topla" değil, çürütmeyi de göster.
 */
export interface AiCounterEvidence {
  /** Karşı çıktığı neden kodu (AiPossibleCause.code) veya genel ise ''. */
  readonly againstCode: string;
  /** Neden bu hipotezi zayıflatıyor (PII-temizli tek satır). */
  readonly note: string;
}

/**
 * SONRAKİ GÜVENLİ KONTROL — kullanıcıya/mekaniğe önerilen bir sonraki adım. Faz-1'de
 * DAİMA read-only: `readOnly` alanı kontrat gereği true (aktüatör/yazma önerisi YASAK).
 */
export interface AiSafeCheck {
  /** Kısa başlık (ör. "Soğutucu seviyesini gözle kontrol et"). */
  readonly title: string;
  /** Detay/gerekçe (PII-temizli). */
  readonly detail: string;
  /** Faz-1 invaryantı: her zaman true (yalnız okuma/gözlem önerilir). */
  readonly readOnly: true;
}

/** Sonuca varılamayan subsystem beyanı (Diagnostics V2 InconclusiveNote ile hizalı). */
export interface AiInconclusive {
  readonly subsystem: string;
  readonly reason: string;
  readonly missingEvidence: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ajan raporu — HER ajanın döndürdüğü EXTENSIBLE kontrat (sonraki ajanlar için)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir AI Core ajanının (Faz-1: yalnız AI Mechanic) read-only, explainable çıktısı.
 * SÖZLEŞME SABİT: sonraki ajanlar (Enerji Koçu, Sürüş Analisti, Güvenlik Gözcüsü…)
 * aynı şekli döndürür → Orchestrator/UI tek tip tüketir, yeni ajan alan eklemez.
 */
export interface AiAgentReport {
  /** Ajanı üreten kimlik (ör. 'ai_mechanic'). */
  readonly agentId: string;
  readonly generatedAt: number;
  /** Tek satır sonuç — kullanıcının/mühendisin İLK okuyacağı (PII-temizli). */
  readonly headline: string;
  readonly urgency: AiUrgency;
  /** 0..100 — raporun genel güveni (en güçlü nedenden türer; kanıt yoksa 0). */
  readonly confidence: number;
  /**
   * KANIT VAR MI? false → ajan sonuç UYDURMADI (nedenler boş, headline dürüst
   * "yeterli kanıt yok"). Bu bayrak, "kanıt yoksa tahmin yasak" invaryantının kanıtıdır.
   */
  readonly hasEvidence: boolean;
  readonly evidence: readonly AiEvidenceItem[];
  readonly possibleCauses: readonly AiPossibleCause[];
  readonly counterEvidence: readonly AiCounterEvidence[];
  readonly nextSafeChecks: readonly AiSafeCheck[];
  readonly inconclusive: readonly AiInconclusive[];
  /**
   * LLM AÇIKLAMA katmanı (opsiyonel). null → LLM yok/offline; sistem yine tam çalışır.
   * KARAR OTORİTESİ DEĞİL — yalnız yukarıdaki deterministik çıktının doğal-dil özeti.
   */
  readonly explanation: string | null;
}

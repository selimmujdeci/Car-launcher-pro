/**
 * aiMemorySources.ts — CAROS LAB · Bellek Gezgini TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz/yazmaz: hafızaya kayıt EKLEMEZ, SİLMEZ, temizlemez,
 * bütçe değiştirmez, hassas kapıyı gevşetmez.
 *
 * ── GİZLİLİK — BU DOSYANIN EN ÖNEMLİ SÖZLEŞMESİ ────────────────────────────
 * Hafıza kayıtlarının içeriği KULLANICI METNİDİR (konuşma/tercih). CLAUDE.md
 * gözlemlenebilirlik kuralı 6 bunu açıkça yasaklar: "ham komut/transkript
 * LAB'a TAŞINMAMALI — yalnız VAR/YOK ve ADET."
 *
 * Bu yüzden bu katman `text` alanını OKUR AMA DIŞARI VERMEZ: yalnız ADET,
 * YAŞ ve KÖKEN SINIFI çıkar. Metnin kendisi, ilk harfi, uzunluğu, özeti veya
 * hash'i BİLE taşınmaz — uzunluk bile ayırt edici olabilir (kısa bir tercih
 * ile uzun bir adres arasındaki fark). Aşağıdaki tipte `string` içerik alanı
 * BULUNMAMASI bilinçlidir ve kilit testiyle korunur.
 */

import {
  getShortTermMemory, SHORT_TERM_CAPACITY,
} from '../ai/memory/shortTermMemory';
import { MAX_MEMORY_TEXT_LENGTH } from '../ai/memory/sensitiveMemoryGuard';
import {
  DEFAULT_MEMORY_BUDGET, MIN_VEHICLE_FACT_CONFIDENCE,
} from '../ai/memory/memoryEngine';
import { createMaviMemorySources } from '../ai/memory/concrete/maviMemorySources';
import type { MemoryOrigin } from '../ai/memory/memoryTypes';

/** Tek kaydın METİNSİZ izdüşümü — içerik ALANI YOKTUR (bilinçli). */
export interface MemoryRecordShape {
  readonly origin: MemoryOrigin;
  /** Kaydın damgası (epoch ms); `0` = damga yok — yaş HESAPLANMAZ. */
  readonly atMs: number;
}

export interface AiMemoryRawSnapshot {
  readonly readAt: number;

  /* ── Kısa dönem (RAM · süreç-ömürlü) ── */
  /** `null` = okuma HATA VERDİ ("boş" ile karıştırılmaz). */
  readonly shortTerm: readonly MemoryRecordShape[] | null;
  readonly shortTermCapacity: number;

  /* ── Uzun dönem ── */
  /** Kullanıcı tercihi ADEDİ; `null` = kaynak okunamadı. */
  readonly preferenceCount: number | null;
  /** Araç geçmişi gerçeklerinin ADEDİ; `null` = kaynak okunamadı. */
  readonly vehicleFactCount: number | null;
  /** Araç geçmişi otoritesi bağlı mı (parmak izi + depo VAR mı). */
  readonly vehicleHistoryWired: boolean;
  /** Eşik ÜSTÜ güvene sahip araç gerçeği adedi; `null` = okunamadı. */
  readonly confidentVehicleFactCount: number | null;

  /* ── Politika (sabitler — kaynağıyla gösterilir) ── */
  readonly maxTextLength: number;
  readonly minVehicleFactConfidence: number;
  readonly budgetMaxRecords: number;
  readonly budgetMaxLongTerm: number;
  readonly budgetMaxShortTerm: number;
  readonly budgetMaxChars: number;
}

/**
 * Tek okuma turu. Her kaynak KENDİ try/catch'inde (fail-soft).
 *
 * @param nowMs Çağıranın bastığı damga — bu katman `Date.now()` ÇAĞIRMAZ.
 */
export function readAiMemorySnapshot(nowMs: number): AiMemoryRawSnapshot {
  let shortTerm: readonly MemoryRecordShape[] | null = null;
  try {
    /* METNİ BURADA BIRAKIYORUZ: yalnız köken + damga dışarı çıkar. */
    shortTerm = getShortTermMemory().map((r) => ({
      origin: r.origin,
      atMs: Number.isFinite(r.at) ? r.at : 0,
    }));
  } catch { shortTerm = null; }

  let preferenceCount: number | null = null;
  let vehicleFactCount: number | null = null;
  let confidentVehicleFactCount: number | null = null;
  let vehicleHistoryWired = false;
  try {
    const sources = createMaviMemorySources();
    try { preferenceCount = sources.readUserPreferences().length; } catch { /* fail-soft */ }
    try {
      const facts = sources.readVehicleHistory();
      vehicleFactCount = facts.length;
      /* "Bağlı" ile "kayıt yok" AYRIDIR: otorite bağlıysa 0 kayıt geçerli bir
         cevaptır; bağlı değilse 0 bir ÖLÇÜM DEĞİLDİR. */
      vehicleHistoryWired = true;
      confidentVehicleFactCount = facts.filter(
        (f) => typeof f.confidence === 'number'
          && f.confidence >= MIN_VEHICLE_FACT_CONFIDENCE,
      ).length;
    } catch { /* fail-soft */ }
  } catch { /* fail-soft: kaynak fabrikası kurulamadı */ }

  return {
    readAt: nowMs,
    shortTerm,
    shortTermCapacity: SHORT_TERM_CAPACITY,
    preferenceCount,
    vehicleFactCount,
    vehicleHistoryWired,
    confidentVehicleFactCount,
    maxTextLength: MAX_MEMORY_TEXT_LENGTH,
    minVehicleFactConfidence: MIN_VEHICLE_FACT_CONFIDENCE,
    budgetMaxRecords: DEFAULT_MEMORY_BUDGET.maxRecords,
    budgetMaxLongTerm: DEFAULT_MEMORY_BUDGET.maxLongTerm,
    budgetMaxShortTerm: DEFAULT_MEMORY_BUDGET.maxShortTerm,
    budgetMaxChars: DEFAULT_MEMORY_BUDGET.maxChars,
  };
}

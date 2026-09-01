/**
 * P0-VDK-B7 · SESSİZ ADRES ELEME MERDİVENİ kilitleri.
 *
 * ── SAHADA ÖLÇÜLEN KUSUR (2026-08-30 · gerçek araç · B3 saha turu) ────────
 * Ana ekranda, DTC ekranı KAPALIYKEN:
 *   · `readAdvancedDtcs` ~1,15/sn · 10 dk'da 712 çağrı
 *   · `probeEcus` 102 çağrı → 712 ≈ 102 × 7 (tam uyum)
 *   · 60 sn'de 44 × `1902FF` → HEPSİ NO DATA
 *   · bilgi üretmeyen süre 335 270 ms → hattın %83'ü
 *
 * Kök neden: `planPhysicalProbes` yalnız "zaten bulunmuş" adresleri eliyordu;
 * hiç yanıt vermeyen 7E1–7E7 envantere ASLA giremediği için sonsuza kadar
 * yeniden soruluyordu.
 *
 * Bu dosya merdivenin İKİ YÖNÜNÜ birden kilitler: israf durmalı **ve**
 * hiçbir ECU yanlışlıkla kaybedilmemeli.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  planPhysicalProbes, noteProbeOutcome, classifyProbeLearning,
  getProbeSuppressionStates, getProbeSuppressionSavings, getSuppressedProbes,
  recordSuppressedProbes, _resetProbeSuppressionForTest,
  PROBE_SILENCE_CONFIRM, PROBE_BACKOFF_LADDER_MS, STANDARD_PHYSICAL_TX,
  MAX_PHYSICAL_PROBES,
} from '../platform/obd/physicalEcuProbe';
import type { DiscoveredEcu } from '../platform/obd/ecuDiscovery';

const EPOCH = 1;
const PROTO = '6';
const T0 = 1_000_000;

/** Sahadaki gibi: fonksiyonel keşif yalnız motor ECU'sunu buldu. */
function knownEngineOnly(): readonly DiscoveredEcu[] {
  return [{
    rxHeader: '7E8', txHeader: '7E0', addressBits: 11, role: 'engine',
    roleEvidence: 'standard', label: 'ECU 7E0', discoverySource: 'functional_0100',
    probeOutcome: 'responded', kwpTargetVerified: false, txProvenance: 'can_11bit_standard',
  } as DiscoveredEcu];
}

/** Bir adresi `n` kez sessiz bırakır (gerçek NO DATA). */
function silence(tx: string, n: number, startMs = T0): number {
  let t = startMs;
  for (let i = 0; i < n; i++) {
    noteProbeOutcome(tx, 'no_response', null, EPOCH, PROTO, t, 450);
    t += 1_000;
  }
  return t;
}

beforeEach(() => { _resetProbeSuppressionForTest(); });

describe('B7 · öğrenme sınıflandırması — üç sınıf karıştırılmaz', () => {
  it('🔒 NRC gelen her yanıt ECU VARLIĞIDIR (0x11 · 0x12 · 0x31 ayrı ama hepsi RESPONDED)', () => {
    /* NRC semantikleri FARKLIDIR ama üçü de "ECU beni duydu" der →
       hiçbiri bastırma üretemez. */
    expect(classifyProbeLearning('negative_nrc', 0x11)).toBe('RESPONDED');
    expect(classifyProbeLearning('negative_nrc', 0x12)).toBe('RESPONDED');
    expect(classifyProbeLearning('negative_nrc', 0x31)).toBe('RESPONDED');
    expect(classifyProbeLearning('unsupported', 0x11)).toBe('RESPONDED');
    expect(classifyProbeLearning('ok', null)).toBe('RESPONDED');
    /* Sözlük tanınmasa bile NRC ölçüldüyse ECU konuşmuştur. */
    expect(classifyProbeLearning('bilinmeyen_sonuc', 0x22)).toBe('RESPONDED');
  });

  it('🔒 gerçek sessizlik SILENT; hat sorunu INCONCLUSIVE', () => {
    expect(classifyProbeLearning('no_response', null)).toBe('SILENT');
    expect(classifyProbeLearning('timeout', null)).toBe('SILENT');
    /* Hat/çözümleme sorunu ECU yokluğu SAYILMAZ. */
    expect(classifyProbeLearning('transport_error', null)).toBe('INCONCLUSIVE');
    expect(classifyProbeLearning('malformed', null)).toBe('INCONCLUSIVE');
    expect(classifyProbeLearning('cancelled', null)).toBe('INCONCLUSIVE');
  });
});

describe('B7 · sonsuz döngü DURUR (asıl saha kusuru)', () => {
  it('🔒 7E1–7E7 sürekli NO DATA → bir noktadan sonra SORULMAZ', () => {
    const known = knownEngineOnly();
    let now = T0;
    let totalRequests = 0;

    /* Sahadaki döngüyü taklit et: 40 keşif turu, her tur planla + sonuçları işle. */
    for (let round = 0; round < 40; round++) {
      const { targets } = planPhysicalProbes(known, MAX_PHYSICAL_PROBES, { nowMs: now });
      totalRequests += targets.length;
      for (const tx of targets) {
        noteProbeOutcome(tx, 'no_response', null, EPOCH, PROTO, now, 450);
      }
      now += 1_000;   // turlar ~1 sn arayla (sahada ~750 ms)
    }

    /* Eski davranış 40 × 7 = 280 istek üretirdi. */
    expect(totalRequests).toBeLessThan(280);
    /* İlk iki tur doğrulama içindir (7×2=14); sonrası bastırılır. */
    expect(totalRequests).toBeLessThanOrEqual(7 * PROBE_SILENCE_CONFIRM + 7);

    /* Ve son turda hiçbir adres sorulmuyor. */
    const last = planPhysicalProbes(known, MAX_PHYSICAL_PROBES, { nowMs: now });
    expect(last.targets).toHaveLength(0);
    expect(last.suppressed.length).toBe(STANDARD_PHYSICAL_TX.length);
    expect(last.suppressed[0]!.reason).toBe('CONFIRMED_SILENT_BACKOFF');
  });

  it('🔒 tasarruf ÖLÇÜLÜR (savedRequests / savedMs)', () => {
    const known = knownEngineOnly();
    let now = T0;
    for (let round = 0; round < 10; round++) {
      const { targets } = planPhysicalProbes(known, MAX_PHYSICAL_PROBES, { nowMs: now });
      for (const tx of targets) noteProbeOutcome(tx, 'no_response', null, EPOCH, PROTO, now, 450);
      now += 1_000;
    }
    const sav = getProbeSuppressionSavings();
    expect(sav.savedRequests).toBeGreaterThan(0);
    expect(sav.suppressedAddresses).toBe(STANDARD_PHYSICAL_TX.length);
    /* Süre gerçekten ölçüldüyse tasarruf tahmini üretilir. */
    expect(sav.avgProbeMs).toBe(450);
    expect(sav.savedMs).toBe(sav.savedRequests * 450);
  });
});

describe('B7 · false-skip YOK — ECU kaybedilmez', () => {
  it('🔒 TEK NO DATA kalıcı eleme YAPMAZ', () => {
    silence('7E1', 1);
    const { targets, suppressed } = planPhysicalProbes(
      knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: T0 + 100 },
    );
    expect(targets).toContain('7E1');
    expect(suppressed).toHaveLength(0);
  });

  it('🔒 transport hatası ABSENT/bastırma ÜRETMEZ (adaptör koparsa körleşmeyiz)', () => {
    /* Adaptör koptu: yedi adres birden hata verir. */
    for (const tx of STANDARD_PHYSICAL_TX) {
      for (let i = 0; i < 10; i++) {
        noteProbeOutcome(tx, 'transport_error', null, EPOCH, PROTO, T0 + i * 100, 5);
      }
    }
    const { targets, suppressed } = planPhysicalProbes(
      knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: T0 + 5_000 },
    );
    expect(suppressed).toHaveLength(0);
    expect(targets).toHaveLength(STANDARD_PHYSICAL_TX.length);
    /* Görünürlük: öğrenmeye girmeyen denemeler yine sayılır. */
    const st = getProbeSuppressionStates().find((x) => x.txHeader === '7E1')!;
    expect(st.inconclusiveCount).toBe(10);
    expect(st.silentStreak).toBe(0);
  });

  it('🔒 ECU sonradan cevap verirse YENİDEN KAZANILIR (terminal kara liste yok)', () => {
    const now = silence('7E3', 5);
    expect(planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: now })
      .suppressed.some((x) => x.txHeader === '7E3')).toBe(true);

    /* ECU uyandı — tek pozitif kanıt tüm geçmişi siler. */
    noteProbeOutcome('7E3', 'ok', null, EPOCH, PROTO, now, 120);
    const after = planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: now });
    expect(after.targets).toContain('7E3');
    expect(after.suppressed.some((x) => x.txHeader === '7E3')).toBe(false);
    expect(getProbeSuppressionStates().some((x) => x.txHeader === '7E3')).toBe(false);
  });

  it('🔒 bastırma ZAMAN AŞIMLIDIR — süre dolunca yeniden ölçülür', () => {
    const now = silence('7E5', PROBE_SILENCE_CONFIRM);
    const blocked = planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: now });
    expect(blocked.targets).not.toContain('7E5');

    /* İlk basamak dolunca adres yeniden aday olur. */
    const later = now + PROBE_BACKOFF_LADDER_MS[0]! + 1;
    expect(planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: later })
      .targets).toContain('7E5');
  });

  it('🔒 backoff TAVANLI — sonsuza kadar büyümez', () => {
    let now = T0;
    for (let i = 0; i < 50; i++) {
      noteProbeOutcome('7E6', 'no_response', null, EPOCH, PROTO, now, 450);
      now += 1_000;
    }
    const st = getProbeSuppressionStates().find((x) => x.txHeader === '7E6')!;
    expect(st.backoffStepIndex).toBe(PROBE_BACKOFF_LADDER_MS.length - 1);
    expect(st.nextEligibleAtMs - now).toBeLessThanOrEqual(
      PROBE_BACKOFF_LADDER_MS[PROBE_BACKOFF_LADDER_MS.length - 1]!,
    );
  });
});

describe('B7 · kapsam mühürlü — öğrenme SIZMAZ', () => {
  it('🔒 oturum mührü değişince bastırma TÜMÜYLE atılır', () => {
    const now = silence('7E2', 5);
    expect(planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: now })
      .suppressed.some((x) => x.txHeader === '7E2')).toBe(true);

    /* Yeni bağlantı = yeni oturum mührü (belki BAŞKA araç). */
    noteProbeOutcome('7E4', 'no_response', null, EPOCH + 1, PROTO, now, 450);
    expect(getProbeSuppressionStates().some((x) => x.txHeader === '7E2')).toBe(false);
    expect(planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: now })
      .targets).toContain('7E2');
  });

  it('🔒 protokol değişince bastırma TÜMÜYLE atılır', () => {
    const now = silence('7E7', 5);
    noteProbeOutcome('7E1', 'no_response', null, EPOCH, '7', now, 450);   // 11-bit → 29-bit
    expect(getProbeSuppressionStates().some((x) => x.txHeader === '7E7')).toBe(false);
  });
});

describe('B7 · kullanıcı aktif taraması merdiveni ATLAR', () => {
  it('🔒 `force` ile bastırılmış adresler YENİDEN sorulur', () => {
    const now = silence('7E1', 5);
    silence('7E2', 5, now);
    const bg = planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: now });
    expect(bg.targets).not.toContain('7E1');

    const user = planPhysicalProbes(knownEngineOnly(), MAX_PHYSICAL_PROBES,
      { nowMs: now, force: true });
    expect(user.targets).toContain('7E1');
    expect(user.targets).toContain('7E2');
    expect(user.suppressed).toHaveLength(0);
  });
});

describe('B7 · mevcut sözleşme KORUNDU', () => {
  it('🔒 zaten keşfedilmiş adres yine sorulmaz (eski davranış)', () => {
    const known = [...knownEngineOnly(), {
      rxHeader: '7E9', txHeader: '7E1', addressBits: 11, role: 'unknown',
      roleEvidence: 'none', label: 'ECU 7E1', discoverySource: 'functional_0100',
      probeOutcome: 'responded', kwpTargetVerified: false, txProvenance: 'can_11bit_standard',
    } as DiscoveredEcu];
    const { targets } = planPhysicalProbes(known, MAX_PHYSICAL_PROBES, { nowMs: T0 });
    expect(targets).not.toContain('7E1');
    expect(targets).toHaveLength(STANDARD_PHYSICAL_TX.length - 1);
  });

  it('🔒 bütçe kırpması SESSİZ DEĞİL (skipped korunur)', () => {
    const { targets, skipped } = planPhysicalProbes(knownEngineOnly(), 3, { nowMs: T0 });
    expect(targets).toHaveLength(3);
    expect(skipped).toBe(STANDARD_PHYSICAL_TX.length - 3);
  });

  it('🔒 LAB yüzeyi salt-okunur ve bounded', () => {
    silence('7E1', 3);
    recordSuppressedProbes(planPhysicalProbes(
      knownEngineOnly(), MAX_PHYSICAL_PROBES, { nowMs: T0 + 3_000 },
    ).suppressed);
    const shown = getSuppressedProbes();
    expect(shown.length).toBeLessThanOrEqual(MAX_PHYSICAL_PROBES);
    expect(shown.every((x) => x.reason === 'CONFIRMED_SILENT_BACKOFF')).toBe(true);
    /* Bastırma bir HÜKÜM değildir — ABSENT/UNSUPPORTED sözcüğü ÜRETİLMEZ. */
    expect(JSON.stringify(shown)).not.toContain('ABSENT');
    expect(JSON.stringify(shown)).not.toContain('UNSUPPORTED');
  });
});

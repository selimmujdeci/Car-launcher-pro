/**
 * SafetyAlertQueue — Durumlu uyarı kuyruğu (FAZ 2)
 *
 * SÖZLEŞME:
 *   - SafetyRuleEngine'den gelen anlık alert listesini alır; debounce,
 *     tekrar sınırı (repeatEverySec / maxRepeats) ve mute yönetimi burada.
 *   - Engine saf fonksiyon olarak kalır; bu sınıf state tutmakla yükümlü.
 *   - Deterministik: Date.now() / Math.random() kullanılmaz. Tüm zaman
 *     kararları dışarıdan gelen `now` parametresiyle yapılır.
 *   - Aynı (update çağrı dizisi + now değerleri) → her zaman aynı çıktı.
 *
 * Ses üretim kuralları:
 *   - Yalnızca screen==='banner' alertler ses adayı olur.
 *   - icon / overlay alertler (low_fuel, park.door.open, reverse.active)
 *     voiceAnnouncementAlert'e asla girmez.
 *   - Her update tick'inde en fazla 1 ses kararı verilir.
 *   - critical (priority 80–100) doğal olarak warning'i baskılar çünkü
 *     en yüksek öncelikli aday seçilir.
 */

import type { SafetyAlert, SafetyQueueOutput } from './types';

// ── Kural başına konfigürasyon ────────────────────────────────────────────────

interface QueueRuleConfig {
  /** Alert görünür olmadan önce geçmesi gereken süre (ms). 0 → anında. */
  debounceMs: number;
  /** Ses tekrarı aralığı (saniye). 0 → yalnızca tek kez. */
  repeatSec: number;
  /** Maksimum ses sayısı. 0 → ses yok (icon-only). 99 → kalıcı. */
  maxRepeats: number;
}

/**
 * Kural bazında debounce / tekrar / maksimum ses konfigürasyonu.
 * SAFETY_ASSISTANT_STANDARD.md Bölüm 1 matrisinden türetilmiştir.
 */
const QUEUE_CONFIG: Record<string, QueueRuleConfig> = {
  'reverse.active':             { debounceMs: 300,  repeatSec: 0,  maxRepeats: 0  },
  'door.open.moving':           { debounceMs: 800,  repeatSec: 20, maxRepeats: 3  },
  'parking_brake.moving':       { debounceMs: 1000, repeatSec: 15, maxRepeats: 3  },
  'engine.overheat':            { debounceMs: 0,    repeatSec: 30, maxRepeats: 99 },
  'seatbelt.unfastened.moving': { debounceMs: 2000, repeatSec: 30, maxRepeats: 2  },
  'hood_or_trunk.open.moving':  { debounceMs: 1000, repeatSec: 20, maxRepeats: 3  },
  'headlights.off.dark':        { debounceMs: 0,    repeatSec: 60, maxRepeats: 2  },
  'low_fuel':                   { debounceMs: 0,    repeatSec: 0,  maxRepeats: 1  },
  'battery_or_oil.warning':     { debounceMs: 0,    repeatSec: 60, maxRepeats: 99 },
  'park.door.open':             { debounceMs: 800,  repeatSec: 0,  maxRepeats: 0  },
} as const;

/** Konfigürasyonda bulunmayan kural ID'leri için varsayılan değerler. */
const QUEUE_DEFAULT: QueueRuleConfig = {
  debounceMs: 0,
  repeatSec: 30,
  maxRepeats: 3,
};

/** Bir kural ID'si için konfigürasyonu döner (yoksa varsayılan). */
function getConfig(ruleId: string): QueueRuleConfig {
  return QUEUE_CONFIG[ruleId] ?? QUEUE_DEFAULT;
}

// ── İç state: her aktif ruleId için bir instance ──────────────────────────────

interface AlertTrack {
  /** Alert ilk görüldüğünde atanan zaman (ms). Debounce başlangıcı. */
  firstSeenTs: number;
  /**
   * Debounce dolunca atanır. null → henüz onaylanmamış (görünmez).
   * debounceMs=0 → ilk update'de anında set edilir.
   */
  confirmedTs: number | null;
  /** Şimdiye kadar yapılan ses sayısı. */
  announceCount: number;
  /** Son ses yapıldığındaki zaman (ms). null → hiç ses yapılmadı. */
  lastAnnouncedTs: number | null;
  /**
   * Bu instance susturulmuş mu? mute() çağrısıyla true olur.
   * Koşul kalkınca track silinir → mute otomatik kalkar.
   * Critical kurallar da susturulabilir (tek olay susturma),
   * ancak koşul kalkıp yeniden oluşunca yeni instance → yeniden konuşur.
   */
  muted: boolean;
}

// ── SafetyAlertQueue sınıfı ───────────────────────────────────────────────────

export class SafetyAlertQueue {
  /**
   * Aktif ruleId → track haritası.
   * Yalnızca update() çağrısında activeAlerts listesinde olan ruleId'ler için
   * entry bulunur; listenin dışına çıkan ruleId silinir (condition clear).
   */
  private tracks = new Map<string, AlertTrack>();

  /**
   * Motoru çalıştır ve kuyruğu güncelle.
   *
   * @param activeAlerts - SafetyRuleEngine'in bu tick'te ürettiği alert'ler.
   *                       Engine ruleId-unique garantisi verir; aynı ruleId
   *                       iki kez gelirse ilki alınır.
   * @param now          - Mevcut zaman (ms) — Date.now() değil, dışarıdan.
   * @returns            - UI ve ses katmanına iletilecek SafetyQueueOutput.
   */
  update(activeAlerts: SafetyAlert[], now: number): SafetyQueueOutput {
    // ── 1. Dedup: aynı tick'te aynı ruleId birden fazla gelirse ilkini al ──
    const seenInTick = new Set<string>();
    const dedupedAlerts: SafetyAlert[] = [];
    for (const alert of activeAlerts) {
      if (!seenInTick.has(alert.ruleId)) {
        seenInTick.add(alert.ruleId);
        dedupedAlerts.push(alert);
      }
    }

    // ── 2. Condition clear: bu tick'te olmayan track'leri sil ──────────────
    for (const ruleId of this.tracks.keys()) {
      if (!seenInTick.has(ruleId)) {
        this.tracks.delete(ruleId);
      }
    }

    // ── 3. Track oluştur / güncelle + debounce işle ────────────────────────
    for (const alert of dedupedAlerts) {
      const cfg = getConfig(alert.ruleId);
      let track = this.tracks.get(alert.ruleId);

      if (track === undefined) {
        // Yeni alert — track oluştur
        track = {
          firstSeenTs: now,
          confirmedTs: cfg.debounceMs === 0 ? now : null,
          announceCount: 0,
          lastAnnouncedTs: null,
          muted: false,
        };
        this.tracks.set(alert.ruleId, track);
      } else if (track.confirmedTs === null) {
        // Debounce bekleniyorsa: süre doldu mu kontrol et
        if (now - track.firstSeenTs >= cfg.debounceMs) {
          track.confirmedTs = now;
        }
      }
      // confirmedTs zaten set ise debounce tamamlanmıştır, dokunma.
    }

    // ── 4. visibleAlerts: confirmedTs != null olanlar, priority azalan ─────
    // Engine zaten priority sırasında verir ama biz kendi sıralamamızı
    // yeniden uygularız (Engine sırası değişse dahi tutarlı kalmak için).
    const visibleAlerts: SafetyAlert[] = dedupedAlerts
      .filter((a) => {
        const track = this.tracks.get(a.ruleId);
        return track !== undefined && track.confirmedTs !== null;
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        // Eşit priority → ruleId alfabetik (deterministik)
        return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
      });

    // ── 5. primaryBannerAlert: screen==='banner' olan en yüksek öncelikli ─
    let primaryBannerAlert: SafetyAlert | null = null;
    for (const a of visibleAlerts) {
      if (a.screen === 'banner') {
        primaryBannerAlert = a;
        break; // visibleAlerts zaten priority azalan; ilk banner en yüksek
      }
    }

    // ── 6. voiceAnnouncementAlert: bu tick TEK ses seçimi ─────────────────
    // Adaylar: screen==='banner' + görünür + muted değil + ses-uygun.
    let voiceCandidate: SafetyAlert | null = null;
    for (const a of visibleAlerts) {
      if (a.screen !== 'banner') continue; // icon/overlay ses üretmez

      const track = this.tracks.get(a.ruleId)!;
      if (track.muted) continue;

      const cfg = getConfig(a.ruleId);
      if (cfg.maxRepeats === 0) continue; // ses hiç üretilmez (icon-only config)

      // Ses sayısı sınırını aşmadı mı?
      if (track.announceCount >= cfg.maxRepeats) continue;

      // Cooldown doldu mu?
      const cooldownOk =
        track.lastAnnouncedTs === null ||
        now - track.lastAnnouncedTs >= cfg.repeatSec * 1000;
      if (!cooldownOk) continue;

      // İlk uygun aday (visibleAlerts priority azalan → en yüksek öncelikli)
      voiceCandidate = a;
      break;
    }

    // Aday varsa ses sayacını güncelle
    if (voiceCandidate !== null) {
      const track = this.tracks.get(voiceCandidate.ruleId)!;
      track.announceCount += 1;
      track.lastAnnouncedTs = now;
    }

    // ── 7. muted: current-instance muted olan görünür ruleId'ler ──────────
    const mutedIds: string[] = [];
    for (const a of visibleAlerts) {
      const track = this.tracks.get(a.ruleId);
      if (track?.muted === true) {
        mutedIds.push(a.ruleId);
      }
    }

    // ── 8. suppressed: görünür banner ama bu tick seslendirilmeyen ─────────
    const suppressedIds: string[] = [];
    for (const a of visibleAlerts) {
      if (a.screen !== 'banner') continue;
      if (voiceCandidate !== null && a.ruleId === voiceCandidate.ruleId) continue;
      suppressedIds.push(a.ruleId);
    }

    // ── Çıktı nesnesi (V8 hidden-class: her zaman aynı alan sırası) ────────
    return {
      visibleAlerts,
      primaryBannerAlert,
      voiceAnnouncementAlert: voiceCandidate,
      muted: mutedIds,
      suppressed: suppressedIds,
    };
  }

  /**
   * Belirtilen ruleId'nin current instance'ını susturur.
   * Yalnızca sesi keser; banner / ikon görünür kalmaya devam eder.
   * Koşul kalkıp yeniden tetiklenince (yeni instance) susturma kalkar.
   *
   * @param ruleId - Susturulacak kural kimliği. Track yoksa (henüz aktif
   *                 değilse) çağrı görmezden gelinir.
   */
  mute(ruleId: string): void {
    const track = this.tracks.get(ruleId);
    if (track !== undefined) {
      track.muted = true;
    }
  }

  /**
   * Tüm iç state'i sıfırlar (test veya oturum yeniden başlatma için).
   * Track'leri tamamen temizler; bir sonraki update() yeni başlangıç.
   */
  reset(): void {
    this.tracks.clear();
  }
}

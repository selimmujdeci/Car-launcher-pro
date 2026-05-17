import type { UsageMap, DrivingMode, SmartRecommendation, TimeContext, RecommendationCandidate } from './smartTypes';
import { getConfig } from './performanceMode';
import { score, timedScore } from './smartUsageUtils';

// performance.now() kullan — Date.now() saat atlarsa cooldown sıfırlanır
let _lastRecommendationPerfMs = 0;

function shouldGenerateNow(): boolean {
  const cfg = getConfig();
  if (!cfg.enableRecommendations) return false;
  return performance.now() - _lastRecommendationPerfMs >= cfg.recCooldownMs;
}

/**
 * Generate a single high-confidence recommendation based on:
 *   - Time of day + usage patterns
 *   - Current driving mode
 *   - Respects performance mode cooldown
 * Returns undefined if cooldown not met or recommendations disabled.
 */
export function generateRecommendation(
  map: UsageMap,
  timeContext: TimeContext,
  drivingMode: DrivingMode,
): SmartRecommendation | undefined {
  if (!shouldGenerateNow()) return;

  const candidates: RecommendationCandidate[] = [];

  // ── Driving mode: minimal UI ─────────────────────────────────────────
  // Sürüş güvenliği: karmaşık glassmorphism efektleri sürücü dikkatini
  // dağıtır. Minimal tema → daha az görsel gürültü, daha hızlı bilgi işleme.
  // autoApply: true — güvenlik-kritik, kullanıcı onayı beklenmez.
  // confidence: 0.97 — neredeyse kesin; sürüş modu tespit edildi.
  if (drivingMode === 'driving') {
    candidates.push({
      rec: {
        type: 'theme-style',
        reason: 'driving_safety_minimal_ui',
        value: 'minimal',
        confidence: 0.97,
        autoApply: true,
      },
      score: 0.97,
    });
  }

  // ── Idle mode: rich theme based on usage
  if (drivingMode === 'idle') {
    const navScore = score(map.maps) + score(map.waze);
    const musicScore = score(map.spotify) + score(map.youtube);

    if (navScore > musicScore + 0.5) {
      candidates.push({
        rec: {
          type: 'theme-pack',
          reason: 'idle_high_nav_usage',
          value: 'big-cards',
          confidence: 0.7,
          autoApply: false,
        },
        score: 0.7,
      });
    } else if (musicScore > navScore + 0.5) {
      candidates.push({
        rec: {
          type: 'theme-pack',
          reason: 'idle_high_music_usage',
          value: 'ai-center',
          confidence: 0.65,
          autoApply: false,
        },
        score: 0.65,
      });
    }
  }

  // ── Time context: Morning → commute
  if (timeContext === 'morning') {
    const navScore = timedScore('maps', map, timeContext) + timedScore('waze', map, timeContext);
    if (navScore > 0.8) {
      candidates.push({
        rec: {
          type: 'app',
          reason: 'morning_commute_pattern',
          value: timedScore('maps', map, timeContext) > timedScore('waze', map, timeContext) ? 'maps' : 'waze',
          confidence: 0.75,
          autoApply: false,
        },
        score: 0.75,
      });
    }
  }

  // ── Time context: Evening → entertainment
  if (timeContext === 'evening') {
    const musicScore = timedScore('spotify', map, timeContext) + timedScore('youtube', map, timeContext);
    if (musicScore > 0.7) {
      candidates.push({
        rec: {
          type: 'app',
          reason: 'evening_entertainment_pattern',
          value: timedScore('spotify', map, timeContext) > timedScore('youtube', map, timeContext) ? 'spotify' : 'youtube',
          confidence: 0.7,
          autoApply: false,
        },
        score: 0.7,
      });
    }
  }

  // ── Low activity + idle: sleep mode
  const totalRecentUsage = Object.values(map).reduce((sum, rec) => sum + rec.recentCount, 0);
  if (totalRecentUsage === 0 && drivingMode === 'idle') {
    candidates.push({
      rec: {
        type: 'sleep-mode',
        reason: 'low_activity_idle',
        value: 'true',
        confidence: 0.35,
        autoApply: false,
      },
      score: 0.35,
    });
  }

  // Pick best candidate
  if (candidates.length === 0) return;
  const best = candidates.reduce((a, b) => b.score - a.score > 0 ? b : a);

  // Only return if confidence high enough
  if (best.rec.confidence < 0.4) return;

  _lastRecommendationPerfMs = performance.now();
  return best.rec;
}

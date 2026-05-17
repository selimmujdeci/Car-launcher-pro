import type { DeviceStatus } from './deviceApi';
import type { NavOptionKey, MusicOptionKey } from '../data/apps';

export interface _SpeedEstimate {
  kmh:  number;
  tsMs: number;
}

export interface UsageRecord {
  count:       number;   // total lifetime launches
  recentCount: number;   // launches in current 24-h window
  lastUsed:    number;   // epoch ms; 0 = never
}

export type UsageMap = Record<string, UsageRecord>;

/** Flex weights for the hero row — drives NavHero / MediaPanel sizing. */
export interface LayoutWeights {
  navFlex:   2 | 3 | 4;
  mediaFlex: 1 | 2 | 3;
}

/** Detected driving context — 3-level mode system based on vehicle speed. */
export type DrivingMode = 'idle' | 'normal' | 'driving';

/** A single contextual quick-action suggestion. */
export interface QuickAction {
  id:    string;  // unique key
  label: string;
  icon:  string;
  appId: string;  // target for onLaunch()
}

/** AI-powered recommendation. */
export interface SmartRecommendation {
  type: 'app' | 'theme-pack' | 'sleep-mode' | 'theme-style';
  reason: string;  // "morning_high_nav" | "driving_mode_active" | "idle_rich_theme" etc.
  value: string;   // app ID, 'tesla'/'big-cards'/'ai-center', 'true', 'glass'/'neon'/'minimal'
  confidence: number;  // 0.0–1.0
  autoApply: boolean;  // true only for safe recommendations (driving mode)
}

/** Sparse geçiş matrisi satır ve matris tipleri */
export type MarkovRow    = Record<string, number>;
export type MarkovMatrix = Record<string, MarkovRow>;

export interface MarkovPrediction {
  appId:       string;
  probability: number;  // 0–1, normalize edilmiş
  /** İnsan-okunabilir bağlam etiketi */
  context:     string;
}

/** Full computed smart state. */
export interface SmartSnapshot {
  layoutWeights:  LayoutWeights;
  quickActions:   QuickAction[];
  drivingMode:    DrivingMode;
  dockIds:        string[];  // up to 4, usage-ranked
  recommendation?: SmartRecommendation;  // single highest-confidence recommendation
  /** True when music is actively playing — media panel should be visually prominent. */
  mediaProminent: boolean;
  /** True when an active navigation route exists — map/nav section takes priority. */
  mapPriority:    boolean;
  /** Markov Chain: son açılan uygulamadan sonra en olası 3 uygulama tahmini. */
  predictions:    MarkovPrediction[];
}

export type TimeContext = 'morning' | 'afternoon' | 'evening' | 'night';

export interface RecommendationCandidate {
  rec: SmartRecommendation;
  score: number;
}

export type SmartParams = {
  device:        Pick<DeviceStatus, 'btConnected' | 'charging' | 'ready'>;
  favorites:     string[];
  defaultNav:    NavOptionKey;
  defaultMusic:  MusicOptionKey;
  obdSpeed?:     number;
  /** GPS-derived speed (km/h). Used as fallback when OBD is not connected. */
  gpsSpeedKmh?:  number;
  /** Whether music is currently playing. */
  isPlaying?:    boolean;
  /** Whether an active navigation route exists. */
  isNavigating?: boolean;
};

/**
 * maviMechanicHistory — Faz 2 composition root (geçmiş + eğilim + tazelik).
 *
 * ⚠️ YENİ DEPO / YENİ MOTOR / YENİ ABONELİK YOK. İki MEVCUT otorite SALT OKUNUR:
 *
 *   1) `getAppEventBus().getRecentEvents({ name: 'ai.mechanic.report' })`
 *      → aiCore runtime ZATEN her koşuda bu olayı yayınlar. Burada yalnız
 *        bounded RAM geçmişi OKUNUR: `subscribe` YOK, `publish` YOK, timer YOK.
 *
 *   2) `getLiveVehicleMemoryStore().recall(fingerprint)`
 *      → MEVCUT Vehicle Memory, yalnız `recall`. YAZILMAZ: `remember` çağrısı
 *        hafızayı aiMechanic ajanının `memory` girdisine geri besler ve ajanın
 *        `hasEvidence`/kanıt setini değiştirirdi → Verdict Engine sonucunu
 *        dolaylı olarak yeniden hesaplamış olurduk. Bu yüzden SALT OKUNUR.
 *
 * Fail-closed: şalter kapalı / bus yok / hata → BOŞ blok, Faz 1 çıktısı aynen
 * kalır. ASLA throw etmez.
 */

import { getAppEventBus } from '../../../system/platformCoreEventBusWiring';
import { getLastAiMechanicResult, getLiveVehicleMemoryStore } from '../../../system/platformCoreAiRuntimeWiring';
import { vehicleHal } from '../../../vehicleHal';
import { isMaviMechanicHistoryEnabled } from '../../gateway/aiGatewayFlag';
import { analyzeMechanicHistory } from '../mechanicHistoryAnalyzer';
import { serializeMechanicInsight } from '../mechanicInsightSerializer';
import type { MechanicDiagnosis } from '../mechanicTypes';
import type {
  MechanicHistoryEvent,
  MechanicInsight,
  MechanicInsightTelemetry,
} from '../mechanicHistoryTypes';

/** aiCore runtime'ın yayınladığı olay adı (aiCoreRuntime.AI_MECHANIC_REPORT_EVENT). */
const AI_MECHANIC_REPORT_EVENT = 'ai.mechanic.report';

/** Bus geçmişinden en fazla bu kadar olay taranır (bounded okuma). */
const MAX_SCANNED_EVENTS = 64;

export interface MechanicInsightOutcome {
  /** System prompt'a eklenecek etiketli blok; yoksa BOŞ. */
  readonly block:     string;
  readonly insight?:  MechanicInsight;
  readonly telemetry: MechanicInsightTelemetry;
}

const DISABLED: MechanicInsightOutcome = {
  block: '',
  telemetry: {
    enabled: false, historyRead: false, repeatCount: 0,
    recurrence: 'bilinmiyor', trend: 'bilinmiyor', freshness: 'bilinmiyor', factCount: 0,
  },
};

/* ── Salt-okunur kaynak adaptörleri ────────────────────────────────────────*/

/** Bus geçmişini okur. Bus yoksa/hata → null (geçmiş "bilinmiyor" olur). */
function readHistoryEvents(): MechanicHistoryEvent[] | null {
  try {
    const bus = getAppEventBus();
    if (!bus) return null;                              // bus yok → uydurma geçmiş YOK
    const raw = bus.getRecentEvents({ name: AI_MECHANIC_REPORT_EVENT });
    if (!Array.isArray(raw)) return null;

    const out: MechanicHistoryEvent[] = [];
    for (const ev of raw.slice(-MAX_SCANNED_EVENTS)) {
      const p = (ev as { payload?: unknown }).payload;
      if (!p || typeof p !== 'object') continue;
      const rec = p as Record<string, unknown>;
      const at = typeof rec['generatedAt'] === 'number' ? rec['generatedAt'] : NaN;
      if (!Number.isFinite(at)) continue;               // zamansız olay sayılmaz
      out.push({
        code:       typeof rec['topCode'] === 'string' ? rec['topCode'] : '',
        confidence: typeof rec['confidence'] === 'number' ? rec['confidence'] : 0,
        urgency:    typeof rec['urgency'] === 'string' ? rec['urgency'] : 'none',
        at,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Mevcut sonucun üretim zamanı (aiCore `generatedAt`). Yoksa undefined. */
function readGeneratedAt(): number | undefined {
  try {
    const run = getLastAiMechanicResult() as { generatedAt?: unknown } | null;
    const at = run?.generatedAt;
    return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : undefined;
  } catch {
    return undefined;
  }
}

/**
 * MEVCUT Vehicle Memory'den bu araca ait ÖĞRENİLMİŞ ifadeler — SALT OKUNUR.
 * Fingerprint yoksa (ham VIN taşınmaz) boş döner.
 */
function readLearnedFacts(): string[] {
  try {
    const identity = vehicleHal.getVehicleIdentity();
    if (!identity || identity.supported !== true) return [];
    const hash = identity.fingerprintHash;
    if (typeof hash !== 'string' || !hash) return [];

    const store = getLiveVehicleMemoryStore();
    if (!store) return [];
    return store.recall(hash).map((f) => f.statement).filter(Boolean);
  } catch {
    return [];
  }
}

/* ── Genel API ─────────────────────────────────────────────────────────────*/

/** Companion prompt'una beslenecek eğilim girdisi — YALNIZ adet + kod. */
export interface DiagnosticTrendInput {
  /** En son arıza koduyla AYNI kodun bus geçmişindeki toplam görülme adedi. */
  readonly historyCount: number;
  /** En son kaydedilen arıza kodu; okunamadı/boş → null (uydurulmaz). */
  readonly lastDtcCode:  string | null;
}

const EMPTY_TREND: DiagnosticTrendInput = Object.freeze({ historyCount: 0, lastDtcCode: null });

/**
 * Companion sohbet bağlamı için GEÇMİŞ ARIZA EĞİLİMİ girdisi — SENKRON, SALT OKUNUR.
 *
 * ⚠️ NEDEN AYRI KAPI (ve `isMaviMechanicHistoryEnabled` şalterine BAĞLI DEĞİL):
 * `buildMechanicInsightBlock` aiMechanic ajanının TEŞHİS BLOĞUNU kurar ve o şalter
 * teşhis çıktısının biçimini yönetir. Buradaki yüzey ise yalnız bir ADET + bir KOD
 * döndürür; kod dışarı ÇIKMAZ (`interpretDiagnosticTrend` yalnız ilk harfini kullanır).
 * Yeni depo/abonelik/timer AÇILMAZ — mevcut bus halkası okunur, `subscribe`/`publish` YOK.
 *
 * Fail-soft: bus yok / halka boş / hata → `historyCount:0, lastDtcCode:null` (SUS).
 * ASLA throw etmez.
 */
export function readDiagnosticTrendInput(): DiagnosticTrendInput {
  try {
    const events = readHistoryEvents();
    if (!events || events.length === 0) return EMPTY_TREND;

    // Halka en eski→en yeni sıralıdır → son KOD TAŞIYAN olay "en son arıza"dır.
    let lastCode = '';
    for (let i = events.length - 1; i >= 0; i--) {
      const c = events[i]?.code;
      if (typeof c === 'string' && c.length > 0) { lastCode = c; break; }
    }
    if (!lastCode) return EMPTY_TREND;

    let count = 0;
    for (const ev of events) if (ev && ev.code === lastCode) count++;
    return Object.freeze({ historyCount: count, lastDtcCode: lastCode });
  } catch {
    return EMPTY_TREND;
  }
}

/**
 * Faz 1 teşhisini DEĞİŞTİRMEDEN geçmiş/eğilim/tazelik bloğunu üretir.
 * `diagnosis` yoksa (teşhis üretilememişse) yorum da üretilmez.
 */
export function buildMechanicInsightBlock(
  diagnosis: MechanicDiagnosis | undefined,
  now: number,
): MechanicInsightOutcome {
  try {
    if (!isMaviMechanicHistoryEnabled()) return DISABLED;
    if (!diagnosis) return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };

    const events = readHistoryEvents();
    const insight = analyzeMechanicHistory({
      diagnosis,
      ...(readGeneratedAt() !== undefined ? { generatedAt: readGeneratedAt() } : {}),
      events: events ?? [],
      historyRead: events !== null,
      learnedFacts: readLearnedFacts(),
      now,
    });

    return {
      block: serializeMechanicInsight(insight),
      insight,
      telemetry: {
        enabled:     true,
        historyRead: events !== null,
        repeatCount: insight.repeatCount,
        recurrence:  insight.recurrence,
        trend:       insight.trend,
        freshness:   insight.freshness,
        factCount:   insight.learnedFacts.length,
      },
    };
  } catch {
    return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };
  }
}

/**
 * useExpertStore — Expert Trust durumu + HMAC mühürlü kalıcılık (safeStorage).
 *
 * hydrateExpertTrustStore() SystemBoot Wave 1 sonunda çağrılmalıdır.
 */

import { create } from 'zustand';
import {
  evaluateTrust,
  normalizeVin,
  normalizeEcuSupplier,
  type TrustEngineInputs,
} from '../platform/expert/TrustEngine';
import {
  EXPERT_TRUST_STORAGE_KEY,
  flushSignedState,
  loadSignedState,
  type ExpertTrustPersistedBody,
} from '../platform/expert/expertTrustSeal';
import { safeGetRaw } from '../utils/safeStorage';
import { logError } from '../platform/crashLogger';

const PERSIST_DEBOUNCE_MS = 8000;

function rollbackFrequencyFromState(
  numerator: number,
  denominator: number,
): number {
  const d = Math.max(1, Math.floor(denominator));
  const n = Math.max(0, numerator);
  return Math.min(1, n / d);
}

function buildInputs(
  vin: string,
  ecuSupplier: string,
  rollbackNumerator: number,
  rollbackDenominator: number,
): TrustEngineInputs {
  return {
    vin: normalizeVin(vin),
    ecuSupplier: normalizeEcuSupplier(ecuSupplier),
    rollbackFrequency: rollbackFrequencyFromState(rollbackNumerator, rollbackDenominator),
  };
}

interface ExpertTrustState {
  vin:                   string;
  ecuSupplier:           string;
  rollbackNumerator:     number;
  rollbackDenominator:   number;
  trustScore:            number;
  writeLocked:           boolean;
  lastEvaluatedAt:       number;
  hydrated:              boolean;

  setVehicleContext:     (ctx: { vin: string; ecuSupplier: string }) => void;
  recordRollbackEvent:   () => void;
  recordStableWriteCycle: () => void;
  recomputeTrust:        () => void;
  canMutateExpertData:   () => boolean;
  /**
   * Araç kimliği (17 haneli VIN) bilinmeden güven skoru anlamlı değildir;
   * bu durumda yazımlar engellenmez. VIN bilindikten ve güven < 70 iken atar.
   */
  assertWritesAllowed:   () => void;
}

function stateToBody(s: ExpertTrustState): ExpertTrustPersistedBody {
  return {
    schemaVersion: 1,
    vin:             s.vin,
    ecuSupplier:     s.ecuSupplier,
    rollbackNumerator: s.rollbackNumerator,
    rollbackDenominator: s.rollbackDenominator,
  };
}

function initialTrustFields(): Pick<ExpertTrustState, 'trustScore' | 'writeLocked' | 'lastEvaluatedAt'> {
  const ev = evaluateTrust(
    buildInputs('', '', 0, 1000),
  );
  return {
    trustScore:      ev.score,
    writeLocked:     ev.writeLocked,
    lastEvaluatedAt: ev.evaluatedAt,
  };
}

const initFields = initialTrustFields();

export const useExpertStore = create<ExpertTrustState>()((set, get) => ({
  vin:                   '',
  ecuSupplier:           '',
  rollbackNumerator:     0,
  rollbackDenominator:   1000,
  trustScore:            initFields.trustScore,
  writeLocked:           initFields.writeLocked,
  lastEvaluatedAt:       initFields.lastEvaluatedAt,
  hydrated:              false,

  setVehicleContext: (ctx) => {
    set({
      vin:           ctx.vin,
      ecuSupplier:   ctx.ecuSupplier,
    });
    get().recomputeTrust();
  },

  recordRollbackEvent: () => {
    set((s) => ({ rollbackNumerator: s.rollbackNumerator + 1 }));
    get().recomputeTrust();
  },

  recordStableWriteCycle: () => {
    set((s) => ({ rollbackDenominator: s.rollbackDenominator + 1 }));
    get().recomputeTrust();
  },

  recomputeTrust: () => {
    const s = get();
    const ev = evaluateTrust(
      buildInputs(s.vin, s.ecuSupplier, s.rollbackNumerator, s.rollbackDenominator),
    );
    set({
      trustScore:      ev.score,
      writeLocked:     ev.writeLocked,
      lastEvaluatedAt: ev.evaluatedAt,
    });
  },

  canMutateExpertData: () => !get().writeLocked,

  assertWritesAllowed: () => {
    const s = get();
    if (!s.hydrated) return;
    const v = normalizeVin(s.vin);
    if (!v || !/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return;
    if (s.writeLocked) {
      throw new Error('ExpertTrust: güven skoru < 70 — yazım kilitli');
    }
  },
}));

let _persistSubscription: (() => void) | null = null;

function registerPersistSubscription(): void {
  if (_persistSubscription) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const runFlush = (): void => {
    debounceTimer = null;
    const s = useExpertStore.getState();
    if (!s.hydrated) return;
    void flushSignedState(stateToBody(s)).catch((e) => logError('ExpertTrust:persist', e));
  };

  const unsub = useExpertStore.subscribe(() => {
    if (!useExpertStore.getState().hydrated) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runFlush, PERSIST_DEBOUNCE_MS);
  });

  _persistSubscription = (): void => {
    unsub();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    _persistSubscription = null;
  };

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      _persistSubscription?.();
    });
  }
}

/**
 * Diskten mühürlü expert trust durumunu yükler; başarısızsa varsayılanlarla devam eder.
 * Idempotent — birden fazla çağrılabilir.
 */
export async function hydrateExpertTrustStore(): Promise<void> {
  const rawExisting = safeGetRaw(EXPERT_TRUST_STORAGE_KEY);
  const loaded = await loadSignedState();

  if (rawExisting && loaded === null) {
    logError(
      'ExpertTrust:hydrate',
      new Error('Mühür doğrulaması başarısız veya depo bozuk'),
    );
  }

  if (loaded) {
    useExpertStore.setState({
      vin:                   loaded.vin,
      ecuSupplier:           loaded.ecuSupplier,
      rollbackNumerator:     Math.max(0, loaded.rollbackNumerator),
      rollbackDenominator:   Math.max(1, loaded.rollbackDenominator),
      hydrated:              true,
    });
  } else {
    useExpertStore.setState({ hydrated: true });
  }

  useExpertStore.getState().recomputeTrust();
  registerPersistSubscription();
}

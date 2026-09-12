/**
 * guardianRuntimeModel.ts — CAROS LAB · Guardian Runtime SAF model katmanı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Girdi yalnız `GuardianRuntimeRawSnapshot`; çıktı kart/alan listesi ve hüküm.
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini
 * KULLANIR (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem YOK.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { GuardianRuntimeRawSnapshot } from './guardianRuntimeSources';

export type GuardianCardId = 'ownership' | 'cadence' | 'sources' | 'health' | 'output' | 'budget';

export interface GuardianCard {
  readonly id:      GuardianCardId;
  readonly title:   string;
  readonly fields:  readonly InspectorField[];
}

export const GUARDIAN_CARD_TITLE: Readonly<Record<GuardianCardId, string>> = {
  ownership: '1 · Tick Sahipliği',
  cadence:   '2 · Kadans · Tier Bütçesi',
  sources:   '3 · Sağlayıcı Envanteri',
  health:    '4 · Koşum Sağlığı',
  output:    '5 · Motor Çıktısı',
  budget:    '6 · Koşum Süresi · Bütçe (#494)',
};

/**
 * Ekranın tek cümlelik hükmü — FAIL-CLOSED.
 *
 *  · `NOT_RUNNING`  — görev wheel'e kaydedilmedi (Guardian ÖLÜ).
 *  · `NO_TICK_YET`  — kayıtlı ama henüz hiç koşmadı.
 *  · `OVER_BUDGET`  — koştu ama #494 tavanını (16 ms) aşan koşum VAR.
 *  · `NEAR_BUDGET`  — 8 ms bütçesini aşan koşum var, 16 ms tavanı aşılmadı.
 *  · `ERRORING`     — koşuyor ama boru hattı hata üretiyor.
 *  · `NO_INPUT`     — koşuyor, hatasız, ama hiçbir kural çalışmıyor (girdi yok).
 *  · `RUNNING`      — koşuyor, bütçe içinde, en az bir kural değerlendiriliyor.
 */
export type GuardianVerdict =
  | 'NOT_RUNNING' | 'NO_TICK_YET' | 'OVER_BUDGET' | 'NEAR_BUDGET'
  | 'ERRORING' | 'NO_INPUT' | 'RUNNING';

export const GUARDIAN_VERDICT_LABEL: Readonly<Record<GuardianVerdict, string>> = {
  NOT_RUNNING: 'ÇALIŞMIYOR — tick sahibi kayıtlı değil',
  NO_TICK_YET: 'KAYITLI, HENÜZ KOŞMADI',
  OVER_BUDGET: 'BÜTÇE TAVANI AŞILDI (#494 · 16 ms)',
  NEAR_BUDGET: 'BÜTÇE AŞIMI VAR (8 ms) — tavan aşılmadı',
  ERRORING:    'KOŞUYOR AMA HATA ÜRETİYOR',
  NO_INPUT:    'KOŞUYOR — AMA HİÇBİR KURAL ÇALIŞMIYOR (girdi yok)',
  RUNNING:     'KOŞUYOR — bütçe içinde',
};

export interface GuardianVerdictResult {
  readonly status:   GuardianVerdict;
  readonly reasons:  readonly string[];
}

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

/** Süreyi okunur hale getirir; ölçüm yoksa `null` (sahte 0 YASAK). */
function ms(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return v < 1 ? `${(v * 1000).toFixed(0)} µs` : `${v.toFixed(2)} ms`;
}

function yesNo(v: boolean | null): string | null {
  return v === null ? null : v ? 'EVET' : 'HAYIR';
}

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export function deriveGuardianVerdict(snap: GuardianRuntimeRawSnapshot): GuardianVerdictResult {
  const r = snap.runtime;
  const reasons: string[] = [];

  if (!r.running) {
    reasons.push('Görev §L.0 tik-wheel\'ine kaydedilmedi — motoru kimse sürmüyor.');
    return { status: 'NOT_RUNNING', reasons };
  }

  reasons.push(`Sahip: ${r.owner} · görev kimliği "${r.taskId}" · kritiklik ${r.criticality}.`);

  if (r.tickCount === 0) {
    reasons.push('Kayıt yapıldı ama henüz hiç koşum ölçülmedi.');
    return { status: 'NO_TICK_YET', reasons };
  }

  if (r.overHardLimitCount > 0) {
    reasons.push(`${r.overHardLimitCount} koşum ${r.hardLimitMs} ms tavanını AŞTI — #494 kabul ölçütü DÜŞER.`);
    return { status: 'OVER_BUDGET', reasons };
  }

  if (r.errorCount > 0) {
    reasons.push(`${r.errorCount} hata sayıldı (son: ${r.lastErrorKind ?? '?'} · aşama ${r.lastErrorStage ?? '?'}).`);
    return { status: 'ERRORING', reasons };
  }

  if (r.overBudgetCount > 0) {
    reasons.push(`${r.overBudgetCount} koşum ${r.budgetMs} ms bütçesini aştı (tavan ${r.hardLimitMs} ms aşılmadı).`);
    return { status: 'NEAR_BUDGET', reasons };
  }

  if (r.evaluatedRuleCount === 0) {
    reasons.push('Motor koşuyor ama girdisi olan kural YOK — bugün yalnız vehicle-health bağlıdır ve o da OBD verisi bekliyor.');
    return { status: 'NO_INPUT', reasons };
  }

  reasons.push(`${r.evaluatedRuleCount ?? 0} kural değerlendirildi · ${r.riskEventCount ?? 0} risk olayı üretildi.`);
  return { status: 'RUNNING', reasons };
}

/* ── Kartlar ─────────────────────────────────────────────────────────────── */

export function buildGuardianCards(snap: GuardianRuntimeRawSnapshot): readonly GuardianCard[] {
  const r  = snap.runtime;
  const at = snap.readAt;

  const ownership: InspectorField[] = [
    observed({
      id: 'running', label: 'Görev kayıtlı', source: 'guardianRuntime',
      note: 'Wheel üstünde kayıt var mı — "kayıtlı" ile "koştu" AYRI alanlardır.',
      updatedAt: at,
    }, yesNo(r.running)),
    observed({
      id: 'owner', label: 'Kadans sahibi', source: 'AdaptiveRuntimeManager',
      note: 'Guardian KENDİ setInterval\'ini kurmaz; §L.0 tek tik-wheel\'ine biner (ikinci zamanlayıcı otoritesi doğmaz).',
      updatedAt: at,
    }, r.owner),
    observed({
      id: 'task-id', label: 'Görev kimliği', source: 'guardianTickPolicy',
      note: 'Aynı kimlikle ikinci kayıt öncekini DEĞİŞTİRİR (idempotent — çift tick yok).',
      updatedAt: at,
    }, r.taskId),
    observed({
      id: 'criticality', label: 'Kritiklik', source: 'guardianTickPolicy',
      note: 'NORMAL: hiçbir tier\'da KAPANMAZ, yalnız mod çarpanıyla yavaşlar. SAFETY seçilseydi düşük tier\'da aynı OBD örneği 5 kez yeniden hesaplanırdı (gecikme kazancı sıfır).',
      updatedAt: at,
    }, r.criticality),
    observed({
      id: 'defer-idle', label: 'requestIdleCallback\'e ötelenir', source: 'guardianTickPolicy',
      note: 'HAYIR olmalı: bir risk katmanının kadansı belirsiz olamaz.',
      updatedAt: at,
    }, yesNo(r.deferIdle)),
    observed({
      id: 'policy-version', label: 'Politika sürümü', source: 'guardianTickPolicy',
      note: 'Kadans veya eşik değişince ARTIRILIR.', updatedAt: at,
    }, r.policyVersion),
  ];

  const cadence: InspectorField[] = [
    r.mode === null
      ? unavailable({
          id: 'mode', label: 'Runtime modu', source: 'AdaptiveRuntimeManager',
          note: 'Mod okunamadı.',
        })
      : observed({
          id: 'mode', label: 'Runtime modu', source: 'AdaptiveRuntimeManager',
          note: 'Tier uyarlaması bu moddan gelir (mod çarpanı).', updatedAt: at,
        }, r.mode),
    observed({
      id: 'base-period', label: 'Taban periyot', source: 'guardianTickPolicy',
      note: 'BALANCED/PERFORMANCE\'ta (çarpan=1) aynen uygulanır. Wheel çözünürlüğü 333 ms → tam 3 tik.',
      updatedAt: at,
    }, `${r.basePeriodMs} ms`),
    r.effectivePeriodMs === null
      ? unavailable({
          id: 'effective-period', label: 'Etkin periyot', source: 'guardianTickPolicy',
          note: 'Mod okunmadan hesaplanamaz.',
        })
      : derived({
          id: 'effective-period', label: 'Etkin periyot', source: 'guardianTickPolicy',
          note: 'taban × mod çarpanı, en yakın 333 ms tikine yuvarlanmış — manager\'ın uygulayacağı gerçek periyot.',
          updatedAt: at,
        }, `${r.effectivePeriodMs} ms`),
    r.worstCaseLatencyMs === null
      ? unavailable({
          id: 'worst-latency', label: 'EN KÖTÜ tespit gecikmesi', source: 'guardianTickPolicy',
          note: 'Mod okunmadan hesaplanamaz.',
        })
      : derived({
          id: 'worst-latency', label: 'EN KÖTÜ tespit gecikmesi', source: 'guardianTickPolicy',
          note: 'OBD anket periyodu + Guardian periyodu. Sensörün tazelenme süresi Guardian\'ın kontrolünde DEĞİLDİR — bu sayı ikisini birlikte dürüstçe gösterir.',
          updatedAt: at,
        }, `${r.worstCaseLatencyMs} ms`),
    r.keepsUpWithObd === null
      ? unavailable({
          id: 'keeps-up', label: 'Guardian ≤ OBD anketi', source: 'guardianTickPolicy',
          note: 'Mod okunmadan doğrulanamaz.',
        })
      : observed({
          id: 'keeps-up', label: 'Guardian ≤ OBD anketi', source: 'guardianTickPolicy',
          note: 'Kadans sözleşmesi: Guardian aynı modda zincirin EN YAVAŞ HALKASI olamaz. HAYIR görünürse kadans kararı bozulmuştur.',
          updatedAt: at,
        }, yesNo(r.keepsUpWithObd)),
  ];

  const sources: InspectorField[] = r.sources.length === 0
    ? [unavailable({
        id: 'sources-empty', label: 'Sağlayıcılar', source: 'guardianRuntime',
        note: 'Envanter okunamadı.',
      })]
    : r.sources.map((s) => observed({
        id: `source-${s.id}`,
        label: `Kaynak · ${s.id}`,
        source: 'guardianProviderRegistry',
        note: s.reason,
        updatedAt: at,
      }, s.wired ? 'BAĞLI' : 'BAĞLI DEĞİL'));

  sources.push(derived({
    id: 'wired-count', label: 'Bağlı sağlayıcı', source: 'guardianRuntime',
    note: '5 sağlayıcı yuvasından kaçı gerçek bir okuma yapıyor.', updatedAt: at,
  }, `${r.wiredSourceCount} / ${r.sources.length}`));

  const health: InspectorField[] = [
    observed({
      id: 'tick-count', label: 'Koşum sayısı', source: 'guardianRuntime',
      note: 'Wheel\'in Guardian\'ı fiilen çağırdığı kez sayısı.', updatedAt: at,
    }, r.tickCount),
    r.lastTickAgeMs === null
      ? unavailable({
          id: 'last-tick-age', label: 'Son koşumun yaşı', source: 'guardianRuntime',
          note: 'Henüz hiç koşum olmadı.',
        })
      : derived({
          id: 'last-tick-age', label: 'Son koşumun yaşı', source: 'guardianRuntime',
          note: 'Monotonik saatten (performance.now) — sistem saati atlarsa bozulmaz.',
          updatedAt: r.lastTickAtWallMs,
        }, `${r.lastTickAgeMs} ms`),
    observed({
      id: 'error-count', label: 'Hata sayısı', source: 'guardianRuntime',
      note: 'Kural kayıt defteri bozuk girdide THROW eder; tik gövdesi yakalar, sayar ve DEVAM eder (fail-soft).',
      updatedAt: at,
    }, r.errorCount),
    r.lastErrorKind === null
      ? unavailable({
          id: 'last-error', label: 'Son hata', source: 'guardianRuntime',
          note: 'Hiç hata sayılmadı.',
        })
      : observed({
          id: 'last-error', label: 'Son hata', source: 'guardianRuntime',
          note: 'Yalnız hata SINIFI ve boru hattı AŞAMASI taşınır — mesaj/değer LAB\'a getirilmez.',
          updatedAt: at,
        }, `${r.lastErrorKind} @ ${r.lastErrorStage ?? '?'}`),
  ];

  const output: InspectorField[] = [
    r.evaluatedRuleCount === null
      ? unavailable({
          id: 'evaluated-rules', label: 'Değerlendirilen kural', source: 'guardianRuleRegistry',
          note: 'Henüz başarılı bir koşum yok.',
        })
      : observed({
          id: 'evaluated-rules', label: 'Değerlendirilen kural', source: 'guardianRuleRegistry',
          note: '8 kuraldan girdisi OLAN kaç tanesi çalıştı. Bugün yalnız vehicle-health bağlıdır — 0 görmek NORMALDİR (OBD verisi yoksa).',
          updatedAt: r.lastOutputAtWallMs,
        }, r.evaluatedRuleCount),
    r.riskEventCount === null
      ? unavailable({
          id: 'risk-events', label: 'Risk olayı', source: 'guardianEngine',
          note: 'Henüz başarılı bir koşum yok.',
        })
      : observed({
          id: 'risk-events', label: 'Risk olayı', source: 'guardianEngine',
          note: 'Tekilleştirilmiş + deterministik sıralı olay sayısı.',
          updatedAt: r.lastOutputAtWallMs,
        }, r.riskEventCount),
    r.highestSeverity === null
      ? unavailable({
          id: 'highest-severity', label: 'En yüksek severity', source: 'guardianEngine',
          note: 'Risk olayı yok — bu bir arıza DEĞİLDİR.',
        })
      : observed({
          id: 'highest-severity', label: 'En yüksek severity', source: 'guardianEngine',
          note: 'Aynı kimlikli olaylarda EN YÜKSEK severity korunur (fail-closed).',
          updatedAt: r.lastOutputAtWallMs,
        }, r.highestSeverity),
    r.overallRiskScore === null
      ? unavailable({
          id: 'risk-score', label: 'Toplam risk skoru', source: 'guardianEngine',
          note: 'Henüz başarılı bir koşum yok.',
        })
      : derived({
          id: 'risk-score', label: 'Toplam risk skoru', source: 'guardianEngine',
          note: 'Olasılıksal-OR: 1 − Π(1 − ağırlık×güven). Bounded [0,1].',
          updatedAt: r.lastOutputAtWallMs,
        }, r.overallRiskScore.toFixed(4)),
    r.lastOutputAgeMs === null
      ? unavailable({
          id: 'output-age', label: 'Çıktının yaşı', source: 'guardianRuntime',
          note: 'Henüz başarılı bir koşum yok.',
        })
      : derived({
          id: 'output-age', label: 'Çıktının yaşı', source: 'guardianRuntime',
          note: 'Koşum yaşından AYRI tutulur: hata alan tik sayacı ilerletir ama çıktıyı tazelemez → bayat çıktı taze görünemez.',
          updatedAt: r.lastOutputAtWallMs,
        }, `${r.lastOutputAgeMs} ms`),
    observed({
      id: 'presentation', label: 'Sürücüye sunuluyor mu', source: 'guardianRuntime',
      note: 'Bu tur Guardian\'a KALP ATIŞI verir, SES vermez. Aşırı ısınma/akü uyarısının ürün otoritesi hâlâ VehicleCompute.worker → SystemOrchestrator\'dır.',
      updatedAt: at,
    }, 'HAYIR — yalnız gözlem'),
  ];

  for (const e of r.events) {
    output.push(observed({
      id: `event-${e.id}`, label: `Olay · ${e.id}`, source: 'guardianEngine',
      note: 'Serbest metin (başlık/mesaj/öneri) LAB\'a taşınmaz.',
      updatedAt: r.lastOutputAtWallMs,
    }, `${e.type} · ${e.severity} · güven ${e.confidence.toFixed(2)} · ${e.distanceMeters} m`));
  }

  const budget: InspectorField[] = [
    observed({
      id: 'budget-ms', label: 'Koşum bütçesi', source: 'guardianTickPolicy',
      note: '#494 tavanının yarısı. TEK bütçe — tier\'a göre değişen şey PERİYOTtur, koşum başına izin verilen süre değil.',
      updatedAt: at,
    }, `${r.budgetMs} ms`),
    observed({
      id: 'hard-limit-ms', label: 'Kabul ölçütü tavanı (#494)', source: 'DEVICE_VALIDATION_LEDGER',
      note: '"low tier\'da tek koşum < 16 ms" — bu aşılırsa kabul ölçütü DÜŞER.',
      updatedAt: at,
    }, `${r.hardLimitMs} ms`),
    r.lastDurationMs === null
      ? unavailable({ id: 'last-duration', label: 'Son koşum süresi', source: 'guardianRuntime', note: 'Henüz ölçüm yok.' })
      : observed({
          id: 'last-duration', label: 'Son koşum süresi', source: 'guardianRuntime',
          note: 'performance.now farkı — tüm boru hattı (sağlayıcı→adaptör→kural→motor).',
          updatedAt: r.lastTickAtWallMs,
        }, ms(r.lastDurationMs)),
    r.p50DurationMs === null
      ? unavailable({ id: 'p50', label: 'p50 koşum süresi', source: 'guardianRuntime', note: 'Henüz ölçüm yok.' })
      : derived({
          id: 'p50', label: 'p50 koşum süresi', source: 'guardianRuntime',
          note: `Son ${r.durationSampleCount} örnekten (sabit boyutlu halka).`, updatedAt: at,
        }, ms(r.p50DurationMs)),
    r.p95DurationMs === null
      ? unavailable({ id: 'p95', label: 'p95 koşum süresi', source: 'guardianRuntime', note: 'Henüz ölçüm yok.' })
      : derived({
          id: 'p95', label: 'p95 koşum süresi', source: 'guardianRuntime',
          note: 'Tek örnek bütçeyi kanıtlamaz; dağılım kanıtlar.', updatedAt: at,
        }, ms(r.p95DurationMs)),
    r.maxDurationMs === null
      ? unavailable({ id: 'max-duration', label: 'En kötü koşum', source: 'guardianRuntime', note: 'Henüz ölçüm yok.' })
      : observed({
          id: 'max-duration', label: 'En kötü koşum', source: 'guardianRuntime',
          note: 'Oturum boyunca görülen tepe değer (halkadan bağımsız, sıfırlanmaz).',
          updatedAt: at,
        }, ms(r.maxDurationMs)),
    observed({
      id: 'over-budget', label: 'Bütçe aşımı', source: 'guardianRuntime',
      note: 'Aşım SAYILIR, katman KAPATILMAZ — bir güvenlik katmanının kendini sessizce öldürmesi daha tehlikelidir.',
      updatedAt: at,
    }, r.overBudgetCount),
    observed({
      id: 'over-hard-limit', label: 'Tavan aşımı (16 ms)', source: 'guardianRuntime',
      note: '0\'dan büyükse #494 kabul ölçütü CİHAZDA DÜŞMÜŞ demektir.',
      updatedAt: at,
    }, r.overHardLimitCount),
    observed({
      id: 'thresholds', label: 'Kullanılan eşikler', source: 'guardianVehicleHealthPolicy',
      note: 'Soğutucu VehicleCompute.worker (ENGINE_OVERHEAT_ON/OFF), akü BatteryProtectionService (THRESH_WARN/THRESH_SLEEP) ile PARİTE — Guardian ikinci eşik otoritesi kurmaz.',
      updatedAt: at,
    }, `soğutucu ${snap.coolantHighC}/${snap.coolantCriticalC} °C · akü ${snap.batteryLowV}/${snap.batteryCriticalV} V`),
  ];

  return [
    { id: 'ownership', title: GUARDIAN_CARD_TITLE.ownership, fields: ownership },
    { id: 'cadence',   title: GUARDIAN_CARD_TITLE.cadence,   fields: cadence },
    { id: 'sources',   title: GUARDIAN_CARD_TITLE.sources,   fields: sources },
    { id: 'health',    title: GUARDIAN_CARD_TITLE.health,    fields: health },
    { id: 'output',    title: GUARDIAN_CARD_TITLE.output,    fields: output },
    { id: 'budget',    title: GUARDIAN_CARD_TITLE.budget,    fields: budget },
  ];
}

/** Sınıf sayacı — ekran başlığındaki ÖLÇÜLDÜ/TÜRETİLDİ/KAYNAK YOK rozetleri. */
export function countByGuardianClass(
  cards: readonly GuardianCard[],
): Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}

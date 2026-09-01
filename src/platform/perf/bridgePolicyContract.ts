/**
 * bridgePolicyContract — ARCH-06/F4 · NATIVE KÖPRÜ TRAFİK SÖZLEŞMESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YÖNLENDİRİCİ DEĞİLDİR.** Hiçbir olayı yakalamaz, geciktirmez,
 *     birleştirmez. Coalescing native tarafta (CAN 80 ms penceresi),
 *     örnekleme alan sahibinde (`gpsService` throttle, native OBD poll planı)
 *     KALIR.
 * (2) **YENİ SINIFLANDIRMA ÜRETMEZ.** Buradaki tablo, kodun ZATEN yaptığını
 *     yazıya döker; bir yüzeyin sınıfı değişirse kilit testi düşer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN SÖZLEŞME GEREKLİ ────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `COALESCED` ile `BATCHED` karıştırılırsa iki ayrı arıza doğar:
 *   · COALESCED ara değerleri KASTEN düşürür (son durum yeterliyken doğru).
 *   · BATCHED hiçbirini düşürmez (her kayıt anlamlıyken doğru).
 * Bir güvenlik komutunu "verimlilik için" batch'lemek, sırasını ve gecikmesini
 * bozar — bu yüzden `DIRECT` sınıfı için batch/coalesce YAPISAL OLARAK
 * yasaktır ve kilit testi bunu sabitler.
 */

export type BridgeTrafficClass =
  /** Değiştirilmeden, sırası korunarak, en düşük gecikmeyle geçer. */
  | 'DIRECT'
  /** Pencere içinde SON DEĞER kazanır; ara değerler KASTEN düşer. */
  | 'COALESCED'
  /** N kayıt tek mesajda; HİÇBİRİ düşmez, sıra korunur. */
  | 'BATCHED'
  /** Sabit periyotta anlık okuma; kaçırılan değişim kaybı KABUL. */
  | 'SAMPLED'
  /** Tüketici açık değilse native taraf HİÇ emit etmez. */
  | 'ON_DEMAND';

export interface BridgeSurfaceDescriptor {
  readonly surfaceId: string;
  readonly direction: 'NATIVE_TO_JS' | 'JS_TO_NATIVE';
  readonly trafficClass: BridgeTrafficClass;
  /** Sınıfı UYGULAYAN yer — bu dosya DEĞİL. */
  readonly enforcedBy: string;
  /** Güvenlik/komut yüzeyi mi. `true` ise batch/coalesce YASAK. */
  readonly safetyCritical: boolean;
  readonly rationale: string;
}

const B = (d: BridgeSurfaceDescriptor): BridgeSurfaceDescriptor => Object.freeze(d);

const SURFACES: readonly BridgeSurfaceDescriptor[] = Object.freeze([
  /* ── Araç veri akışları ─────────────────────────────────────────────── */
  B({
    surfaceId: 'canData', direction: 'NATIVE_TO_JS', trafficClass: 'COALESCED',
    enforcedBy: 'CarLauncherPlugin.scheduleOrEmitToJs (80 ms trailing+leading + tam-alan dedup)',
    safetyCritical: false,
    rationale: 'Son araç durumu yeterlidir; ara hız/RPM değeri ekranda anlam taşımaz.',
  }),
  B({
    surfaceId: 'canData.safetyBypass', direction: 'NATIVE_TO_JS', trafficClass: 'DIRECT',
    enforcedBy: 'CarLauncherPlugin.isSafetyCriticalChange (reverse · parkingBrake)',
    safetyCritical: true,
    rationale: 'Geri görüş kamerası ve el freni uyarısı 80 ms bile GECİKEMEZ — pencere ATLANIR.',
  }),
  B({
    surfaceId: 'canRawFrame', direction: 'NATIVE_TO_JS', trafficClass: 'ON_DEMAND',
    enforcedBy: 'CarLauncherPlugin._canSnifferActive bayrağı',
    safetyCritical: false,
    rationale: 'Her ham frame ANLAMLIDIR → coalesce EDİLEMEZ; bu yüzden yalnız sniffer açıkken akar.',
  }),
  B({
    surfaceId: 'obdData', direction: 'NATIVE_TO_JS', trafficClass: 'SAMPLED',
    enforcedBy: 'native AdaptivePidScheduler poll planı + PollCostLedger bütçesi',
    safetyCritical: false,
    rationale: 'Kadans native poll bütçesinin sonucudur; JS ikinci bütçe KURMAZ.',
  }),
  B({
    surfaceId: 'gps.watchPosition', direction: 'NATIVE_TO_JS', trafficClass: 'SAMPLED',
    enforcedBy: 'gpsService throttle (200 ms taban · termal L2+ 500 ms) + GPS_NAV_MAX_INTERVAL_MS tabanı',
    safetyCritical: false,
    rationale: 'Alan sahibi kadansı; navigasyon için 2 Hz taban GARANTİLİDİR.',
  }),

  /* ── Durum/olay yüzeyleri ───────────────────────────────────────────── */
  B({
    surfaceId: 'obdStatus', direction: 'NATIVE_TO_JS', trafficClass: 'DIRECT',
    enforcedBy: 'obdService dinleyicisi (nesil kapılı)',
    safetyCritical: false,
    rationale: 'Durum geçişi seyrektir ve geciktirilirse bağlantı kaybı geç fark edilir.',
  }),
  B({
    surfaceId: 'mediaChanged', direction: 'NATIVE_TO_JS', trafficClass: 'DIRECT',
    enforcedBy: 'mediaService dinleyicisi',
    safetyCritical: false,
    rationale: 'Parça değişimi seyrek ve kullanıcı-görünür.',
  }),
  B({
    surfaceId: 'memoryPressure', direction: 'NATIVE_TO_JS', trafficClass: 'DIRECT',
    enforcedBy: 'memoryWatchdog dinleyicisi',
    safetyCritical: true,
    rationale: 'Baskı sinyali gecikirse anlamını YİTİRİR — LMK zaten süreci öldürüyor olabilir.',
  }),
  B({
    surfaceId: 'thermalStatus', direction: 'NATIVE_TO_JS', trafficClass: 'DIRECT',
    enforcedBy: 'thermalWatchdog',
    safetyCritical: true,
    rationale: 'Aşırı ısınma koruması geciktirilemez.',
  }),
  B({
    surfaceId: 'hardwareMediaKey', direction: 'NATIVE_TO_JS', trafficClass: 'DIRECT',
    enforcedBy: 'mediaCommandGateway (tek komut kapısı)',
    safetyCritical: true,
    rationale: 'KULLANICI GİRDİSİDİR — batch/coalesce dokunma hissini bozar.',
  }),

  /* ── JS → native komut yüzeyleri ────────────────────────────────────── */
  B({
    surfaceId: 'mcuCommand', direction: 'JS_TO_NATIVE', trafficClass: 'DIRECT',
    enforcedBy: 'nativeCommandBridge → CarLauncherPlugin → McuCommandFactory',
    safetyCritical: true,
    rationale: 'Kilit/korna/far komutu: SIRA ve GECİKME kritiktir. Batch YASAK.',
  }),
  B({
    surfaceId: 'sendDiagnosticPdu', direction: 'JS_TO_NATIVE', trafficClass: 'DIRECT',
    enforcedBy: 'genericPduTransport + native DiagnosticServiceGate (çift kapı)',
    safetyCritical: true,
    rationale: 'Her PDU ayrı bir işlemdir ve yetki/gate kararı tekildir — birleştirilemez.',
  }),
  B({
    surfaceId: 'storage.filesystem', direction: 'JS_TO_NATIVE', trafficClass: 'BATCHED',
    enforcedBy: 'safeStorage 5 s debounce + idle yield',
    safetyCritical: false,
    rationale: 'eMMC ömrü; HİÇBİR yazım düşmez, yalnız gruplanır.',
  }),
]);

export interface BridgePolicySnapshot {
  readonly surfaces: readonly BridgeSurfaceDescriptor[];
  readonly byClass: Readonly<Record<BridgeTrafficClass, number>>;
  readonly safetyCriticalCount: number;
  readonly notes: readonly string[];
}

const CLASSES: readonly BridgeTrafficClass[] = Object.freeze([
  'DIRECT', 'COALESCED', 'BATCHED', 'SAMPLED', 'ON_DEMAND',
]);

/** Salt-okunur projeksiyon. Hiçbir köprüye dokunmaz. */
export function getBridgePolicy(): BridgePolicySnapshot {
  const byClass = {} as Record<BridgeTrafficClass, number>;
  for (const c of CLASSES) byClass[c] = 0;
  let safety = 0;
  for (const s of SURFACES) {
    byClass[s.trafficClass] += 1;
    if (s.safetyCritical) safety += 1;
  }
  return Object.freeze({
    surfaces: SURFACES,
    byClass: Object.freeze(byClass),
    safetyCriticalCount: safety,
    notes: Object.freeze([
      'COALESCED ara değeri KASTEN düşürür; BATCHED hiçbirini düşürmez. Karıştırılamaz.',
      'safetyCritical bir yüzey ASLA COALESCED/BATCHED olamaz — kilit testi bunu zorlar.',
      'Sınıfı bu dosya UYGULAMAZ; `enforcedBy` alanı gerçek uygulayıcıyı gösterir.',
    ]),
  });
}

/** Statik kilit testleri için kapalı liste. */
export function bridgeSurfaces(): readonly BridgeSurfaceDescriptor[] { return SURFACES; }

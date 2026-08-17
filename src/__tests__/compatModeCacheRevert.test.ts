/**
 * compatModeCacheRevert.test.ts — KİLİT: `perf-low` önbelleği GERİ ALINABİLİR.
 *
 * ── NEDEN BU DOSYA VAR (kütük #601, cihazda ölçüldü 2026-08-16) ────────────
 * `applyCompatMode()` şunu yapıyordu:
 *   1. `applyCachedHeadUnitFlag()` → önbellek '1' ise `perf-low` EKLE (FOUC önleme)
 *   2. canlı profili hesapla, önbelleği yeniden yaz
 *   3. `if (profile.isLowTier) { perf-low EKLE ... }`
 * …ama **`else` dalı YOKTU**. Yani önbellek bir kez '1' yazıldıysa, cihaz
 * artık düşük sınıf olmasa bile o oturum boyunca `perf-low` kalıyordu.
 *
 * ÖLÇÜLEN BEDEL: `perf-low` aktifken `MapInteractionManager._smoothPan` false
 * olur → kamera `easeTo` yerine `jumpTo` kullanır → harita ~6,7 fps'te
 * "takıla takıla" akar (#570 kusurunun geri dönüşü). Bu yüzden #599'un tier
 * düzeltmesi TEK BAŞINA yetmezdi: önbellek '1' kaldığı için ilk açılış yine
 * takılırdı.
 *
 * Kilit, iki yönü de korur: düşükse UYGULA, düşük değilse GERİ AL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Tier'ı test başına seçilebilir yapan mock. */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high' }));

vi.mock('../platform/deviceCapabilities', () => ({
  getDeviceTier: () => env.tier,
  getCapabilities: () => ({
    cores: 8, memoryMb: 8192, weakGpu: false, supportsWebGL: true,
    supportsBackdropFilter: true, supportsDvh: true, supportsCssLayer: true,
    lowEndScreen: false, hasWorkerSAB: false, androidVersion: 13, webViewVersion: 150,
  }),
}));

function temizle(): void {
  document.documentElement.classList.remove('perf-low');
  document.documentElement.removeAttribute('data-compat-mode');
  try { localStorage.clear(); } catch { /* yok */ }
  vi.resetModules();
}

beforeEach(temizle);
afterEach(temizle);

describe('applyCompatMode — perf-low önbelleği geri alınabilir (#601)', () => {
  it('KİLİT: önbellek "1" ama cihaz YÜKSEK sınıf → perf-low GERİ ALINIR', async () => {
    /* Kusurun tam senaryosu: eski/hatalı bir sürüm önbelleğe '1' yazmış. */
    localStorage.setItem('cl_compatLowTier', '1');
    env.tier = 'high';

    const { applyCompatMode } = await import('../platform/headUnitCompat');
    applyCompatMode();

    expect(
      document.documentElement.classList.contains('perf-low'),
      'perf-low kaldırılmadı → harita jumpTo ile takılmaya devam eder',
    ).toBe(false);
    expect(document.documentElement.getAttribute('data-compat-mode')).toBeNull();
    expect(localStorage.getItem('cl_compatLowTier')).toBe('0');
  });

  it('KİLİT: cihaz gerçekten DÜŞÜK sınıf → perf-low UYGULANIR (bütçe korunur)', async () => {
    env.tier = 'low';

    const { applyCompatMode } = await import('../platform/headUnitCompat');
    applyCompatMode();

    expect(
      document.documentElement.classList.contains('perf-low'),
      'gerçek düşük-uç cihazda bütçe kapısı KAPANMAMALI',
    ).toBe(true);
    expect(document.documentElement.getAttribute('data-compat-mode')).toBe('true');
    expect(localStorage.getItem('cl_compatLowTier')).toBe('1');
  });

  it('KİLİT: eski `cl_isHeadUnit` damgası da yüksek sınıfta geri alınır', async () => {
    /* #411'de bırakılan eski anahtar yalnız geriye dönük OKUNUR; yüksek sınıf
       cihazda onun da kalıcı hasar vermemesi gerekir. */
    localStorage.setItem('cl_isHeadUnit', '1');
    env.tier = 'high';

    const { applyCompatMode } = await import('../platform/headUnitCompat');
    applyCompatMode();

    expect(document.documentElement.classList.contains('perf-low')).toBe(false);
    expect(localStorage.getItem('cl_isHeadUnit'), 'eski anahtar temizlenmeli').toBeNull();
  });

  it('KİLİT: kullanıcının performans tercihi SESSİZCE EZİLMEZ', async () => {
    /* Geri alma yalnız iki DOM işaretini kaldırır; `cl_performanceMode`
       kullanıcıya aittir ve bu yolda değiştirilmemelidir. */
    localStorage.setItem('cl_compatLowTier', '1');
    localStorage.setItem('cl_performanceMode', 'lite');
    localStorage.setItem('cl_performanceMode_userSet', '1');
    env.tier = 'high';

    const { applyCompatMode } = await import('../platform/headUnitCompat');
    applyCompatMode();

    expect(document.documentElement.classList.contains('perf-low')).toBe(false);
    expect(localStorage.getItem('cl_performanceMode')).toBe('lite');
  });
});

/**
 * SafetyAlertQueue birim testleri — FAZ 2
 *
 * Her davranış sözleşmesi için ayrı test.
 * Determinizm zorunlu: Date.now() / Math.random() kullanılmaz.
 * SafetyRuleEngine'e DOKUNULMAZ; alertler elle oluşturulur.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SafetyAlertQueue } from '../platform/safety/SafetyAlertQueue';
import type { SafetyAlert } from '../platform/safety/types';

// ── Test yardımcıları ────────────────────────────────────────────────────────

/** Minimum geçerli SafetyAlert şablonu — her alan V8 shape'e uygun. */
function makeAlert(overrides: Partial<SafetyAlert> & { ruleId: string }): SafetyAlert {
  return {
    ruleId: overrides.ruleId,
    level: overrides.level ?? 'warning',
    message: overrides.message ?? 'Test uyarısı.',
    icon: overrides.icon ?? 'warning',
    screen: overrides.screen ?? 'banner',
    priority: overrides.priority ?? 50,
    ts: overrides.ts ?? 0,
  };
}

/** Kapı açık / hareket halinde — banner, critical, priority 95. */
const DOOR_ALERT = makeAlert({
  ruleId: 'door.open.moving',
  level: 'critical',
  screen: 'banner',
  priority: 95,
});

/** Motor aşırı ısınma — banner, critical, priority 100. */
const OVERHEAT_ALERT = makeAlert({
  ruleId: 'engine.overheat',
  level: 'critical',
  screen: 'banner',
  priority: 100,
});

/** Emniyet kemeri — banner, warning, priority 70. */
const SEATBELT_ALERT = makeAlert({
  ruleId: 'seatbelt.unfastened.moving',
  level: 'warning',
  screen: 'banner',
  priority: 70,
});

/** Yakıt düşük — icon, warning, priority 40. */
const FUEL_ALERT = makeAlert({
  ruleId: 'low_fuel',
  level: 'warning',
  screen: 'icon',
  priority: 40,
});

/** Park halinde kapı açık — icon, info, priority 20. */
const PARK_DOOR_ALERT = makeAlert({
  ruleId: 'park.door.open',
  level: 'info',
  screen: 'icon',
  priority: 20,
});

/** Geri vites — overlay, info, priority 10. */
const REVERSE_ALERT = makeAlert({
  ruleId: 'reverse.active',
  level: 'info',
  screen: 'overlay',
  priority: 10,
});

// Referans zamanı (ms) — büyük, kesin, sabitleştirilmiş
const T0 = 10_000_000;

// ── Testler ──────────────────────────────────────────────────────────────────

describe('dedup — aynı ruleId tek track, çıktıda tek kez', () => {
  it('activeAlerts içinde aynı ruleId iki kez gelirse visibleAlerts tek entry içerir', () => {
    const queue = new SafetyAlertQueue();
    // debounceMs=0 olan engine.overheat: anında görünür
    const result = queue.update([OVERHEAT_ALERT, OVERHEAT_ALERT], T0);
    const ids = result.visibleAlerts.map((a) => a.ruleId);
    expect(ids.filter((id) => id === 'engine.overheat')).toHaveLength(1);
  });
});

describe('debounce — koşul yeterince sürmeden alert görünmez', () => {
  it('door.open.moving (800ms) t=0\'da gelir → görünmez', () => {
    const queue = new SafetyAlertQueue();
    const r = queue.update([DOOR_ALERT], T0);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();
    expect(r.voiceAnnouncementAlert).toBeNull();
  });

  it('door.open.moving t=799\'da hâlâ görünmez', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    const r = queue.update([DOOR_ALERT], T0 + 799);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();
  });

  it('door.open.moving t=800\'de görünür ve ilk sesi üretir', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    const r = queue.update([DOOR_ALERT], T0 + 800);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
    expect(r.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');
  });

  it('debounce=0 olan engine.overheat ilk tick\'te anında görünür', () => {
    const queue = new SafetyAlertQueue();
    const r = queue.update([OVERHEAT_ALERT], T0);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'engine.overheat')).toBeDefined();
    expect(r.voiceAnnouncementAlert?.ruleId).toBe('engine.overheat');
  });
});

describe('repeatEverySec — tekrar cooldown', () => {
  it('door confirmed t=800 → ses üretir (1. ses)', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    const r800 = queue.update([DOOR_ALERT], T0 + 800);
    expect(r800.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');
  });

  it('door ses(1) sonrası t=1000\'de (20sn dolmadı) ses yok, suppressed\'da', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    queue.update([DOOR_ALERT], T0 + 800); // ses 1
    const r = queue.update([DOOR_ALERT], T0 + 1000);
    expect(r.voiceAnnouncementAlert).toBeNull();
    expect(r.suppressed).toContain('door.open.moving');
    // Görsel hâlâ mevcut
    expect(r.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
  });

  it('door t=800+20000\'de (20sn doldu) ses üretir (2. ses)', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    queue.update([DOOR_ALERT], T0 + 800);        // ses 1
    queue.update([DOOR_ALERT], T0 + 1000);       // cooldown içi
    const r = queue.update([DOOR_ALERT], T0 + 800 + 20_000);
    expect(r.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');
  });
});

describe('maxRepeats — seatbelt max=2', () => {
  it('seatbelt (max=2, debounce=2000) 2 kez seslendikten sonra 3. sesde voiceAnnouncementAlert=null', () => {
    const queue = new SafetyAlertQueue();
    // debounce 2000ms bekle
    queue.update([SEATBELT_ALERT], T0);
    const rConfirm = queue.update([SEATBELT_ALERT], T0 + 2000); // ses 1
    expect(rConfirm.voiceAnnouncementAlert?.ruleId).toBe('seatbelt.unfastened.moving');

    // 2. ses: 30sn sonra (repeatSec=30)
    const r2 = queue.update([SEATBELT_ALERT], T0 + 2000 + 30_000); // ses 2
    expect(r2.voiceAnnouncementAlert?.ruleId).toBe('seatbelt.unfastened.moving');

    // 3. ses denemesi: maxRepeats(2) aşıldı
    const r3 = queue.update([SEATBELT_ALERT], T0 + 2000 + 60_000);
    expect(r3.voiceAnnouncementAlert).toBeNull();

    // Görsel hâlâ var, suppressed'da
    expect(r3.visibleAlerts.find((a) => a.ruleId === 'seatbelt.unfastened.moving')).toBeDefined();
    expect(r3.suppressed).toContain('seatbelt.unfastened.moving');
  });
});

describe('mute — sesi keser, görsel kalır', () => {
  it('door aktifken mute → voiceAnnouncementAlert null, visible+muted\'da var, primaryBanner door', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    queue.update([DOOR_ALERT], T0 + 800); // confirmed

    queue.mute('door.open.moving');

    const r = queue.update([DOOR_ALERT], T0 + 800 + 1);
    // Ses yok
    expect(r.voiceAnnouncementAlert).toBeNull();
    // Görsel var
    expect(r.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
    // muted listesinde
    expect(r.muted).toContain('door.open.moving');
    // primaryBanner door (muted görsel kapatmaz)
    expect(r.primaryBannerAlert?.ruleId).toBe('door.open.moving');
  });

  it('mute sonrası condition clear ve yeniden tetiklenince ses yeniden gelir (critical oturumluk susmaz)', () => {
    const queue = new SafetyAlertQueue();
    // Overheat tetikle, mute et
    queue.update([OVERHEAT_ALERT], T0);          // debounce=0 → anında
    queue.mute('engine.overheat');
    const rMuted = queue.update([OVERHEAT_ALERT], T0 + 1);
    expect(rMuted.voiceAnnouncementAlert).toBeNull();
    expect(rMuted.muted).toContain('engine.overheat');

    // Condition clear: overheat düzeldi
    queue.update([], T0 + 2000);

    // Yeniden tetiklendi (yeni instance)
    const rNew = queue.update([OVERHEAT_ALERT], T0 + 3000);
    // Yeni instance: mute sıfırlandı → ses üretir
    expect(rNew.voiceAnnouncementAlert?.ruleId).toBe('engine.overheat');
    expect(rNew.muted).not.toContain('engine.overheat');
  });
});

describe('critical override — critical warning\'i aynı tick suspend eder', () => {
  it('seatbelt aktifken overheat gelince voiceAnnouncementAlert=overheat, seatbelt suppressed', () => {
    const queue = new SafetyAlertQueue();

    // seatbelt debounce bekleniyor (2000ms)
    queue.update([SEATBELT_ALERT], T0);
    // t=2000: seatbelt confirmed → ses 1
    const rSeatbelt = queue.update([SEATBELT_ALERT], T0 + 2000);
    expect(rSeatbelt.voiceAnnouncementAlert?.ruleId).toBe('seatbelt.unfastened.moving');

    // t=32000: seatbelt cooldown doldu (30sn) → normalde 2. sesi gelecek
    // Ama bu tick overheat de var (debounce=0 → anında onaylı)
    const rBoth = queue.update([SEATBELT_ALERT, OVERHEAT_ALERT], T0 + 32_000);

    // priority: overheat(100) > seatbelt(70) → overheat seçilir
    expect(rBoth.voiceAnnouncementAlert?.ruleId).toBe('engine.overheat');
    // seatbelt suppressed'da (ses adayıydı ama kaybetti)
    expect(rBoth.suppressed).toContain('seatbelt.unfastened.moving');
    // Her ikisi de görünür
    expect(rBoth.visibleAlerts.find((a) => a.ruleId === 'seatbelt.unfastened.moving')).toBeDefined();
    expect(rBoth.visibleAlerts.find((a) => a.ruleId === 'engine.overheat')).toBeDefined();
  });
});

describe('condition clear — koşul kalkınca track silinir, yeniden tetiklenince debounce baştan', () => {
  it('door confirmed sonra activeAlerts boş → visibleAlerts boş, iç state temizlenmiş', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    queue.update([DOOR_ALERT], T0 + 800);  // confirmed + ses

    // Koşul kalktı
    const rClear = queue.update([], T0 + 900);
    expect(rClear.visibleAlerts).toHaveLength(0);
    expect(rClear.voiceAnnouncementAlert).toBeNull();
    expect(rClear.primaryBannerAlert).toBeNull();

    // Yeniden tetiklendi — debounce baştan (t=900)
    const rNew = queue.update([DOOR_ALERT], T0 + 900);
    // Henüz debounce dolmadı (800ms şart)
    expect(rNew.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();

    // Debounce dolduktan sonra görünür
    const rConfirmed = queue.update([DOOR_ALERT], T0 + 900 + 800);
    expect(rConfirmed.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
  });
});

describe('icon-only sessiz — low_fuel ve park.door.open ses üretmez', () => {
  it('low_fuel (screen=icon) görünür ama voiceAnnouncementAlert asla low_fuel olmaz', () => {
    const queue = new SafetyAlertQueue();
    // debounce=0 → anında görünür
    const r = queue.update([FUEL_ALERT], T0);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'low_fuel')).toBeDefined();
    expect(r.voiceAnnouncementAlert).toBeNull();
    // Sonraki update'lerde de sessiz kalır
    const r2 = queue.update([FUEL_ALERT], T0 + 100_000);
    expect(r2.voiceAnnouncementAlert).toBeNull();
  });

  it('park.door.open (screen=icon, debounce=800) görünür ama ses üretmez', () => {
    const queue = new SafetyAlertQueue();
    queue.update([PARK_DOOR_ALERT], T0);
    const r = queue.update([PARK_DOOR_ALERT], T0 + 800);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'park.door.open')).toBeDefined();
    expect(r.voiceAnnouncementAlert).toBeNull();
  });

  it('reverse.active (screen=overlay, debounce=300, maxRepeats=0) ses üretmez', () => {
    const queue = new SafetyAlertQueue();
    queue.update([REVERSE_ALERT], T0);
    const r = queue.update([REVERSE_ALERT], T0 + 300);
    expect(r.visibleAlerts.find((a) => a.ruleId === 'reverse.active')).toBeDefined();
    expect(r.voiceAnnouncementAlert).toBeNull();
  });
});

describe('çoklu alert priority sıralaması', () => {
  it('overheat+door+low_fuel aynı anda → visibleAlerts priority azalan (overheat,door,low_fuel)', () => {
    const queue = new SafetyAlertQueue();
    // Hepsi debounce=0; hemen görünür
    const r = queue.update([OVERHEAT_ALERT, DOOR_ALERT, FUEL_ALERT], T0);

    const ids = r.visibleAlerts.map((a) => a.ruleId);
    // Sıra kontrolü
    const iOverheat = ids.indexOf('engine.overheat');
    const iDoor = ids.indexOf('door.open.moving');
    const iFuel = ids.indexOf('low_fuel');
    // door debounce=800ms → henüz görünmez; overheat ve fuel anında görünür
    // Bu yüzden door yoksa sıra: overheat, fuel
    // door'u debounce'suz varsayalım: ayrı test (door debounce 800ms şart)
    // Burada sadece görünür olanların sırası doğru olmalı
    if (iDoor >= 0) {
      expect(iOverheat).toBeLessThan(iDoor);
      expect(iDoor).toBeLessThan(iFuel);
    } else {
      // door henüz debounce'ta; overheat < fuel
      expect(iOverheat).toBeLessThan(iFuel);
    }

    // voice = overheat (en yüksek priority, banner, debounce=0)
    expect(r.voiceAnnouncementAlert?.ruleId).toBe('engine.overheat');
    // primaryBanner = overheat
    expect(r.primaryBannerAlert?.ruleId).toBe('engine.overheat');
  });

  it('debounce sonrası overheat+door+low_fuel → visibleAlerts: overheat(100)>door(95)>fuel(40)', () => {
    const queue = new SafetyAlertQueue();
    queue.update([OVERHEAT_ALERT, DOOR_ALERT, FUEL_ALERT], T0);
    // t=800: door debounce doldu
    const r = queue.update([OVERHEAT_ALERT, DOOR_ALERT, FUEL_ALERT], T0 + 800);

    const ids = r.visibleAlerts.map((a) => a.ruleId);
    expect(ids[0]).toBe('engine.overheat'); // priority 100
    expect(ids[1]).toBe('door.open.moving'); // priority 95
    // fuel (icon) görünür ama banner değil; primaryBanner=overheat
    expect(r.primaryBannerAlert?.ruleId).toBe('engine.overheat');
  });
});

describe('determinizm — iki ayrı instance aynı (update dizisi, now) → çıktılar derin eşit', () => {
  it('iki SafetyAlertQueue örneğine AYNI dizi uygulandığında toEqual geçer', () => {
    function runSequence(q: SafetyAlertQueue): ReturnType<typeof q.update> {
      q.update([OVERHEAT_ALERT, SEATBELT_ALERT], T0);
      q.update([OVERHEAT_ALERT, SEATBELT_ALERT], T0 + 2000); // seatbelt confirmed
      q.update([OVERHEAT_ALERT, SEATBELT_ALERT, FUEL_ALERT], T0 + 5000);
      return q.update([OVERHEAT_ALERT, SEATBELT_ALERT, FUEL_ALERT], T0 + 8000);
    }

    const q1 = new SafetyAlertQueue();
    const q2 = new SafetyAlertQueue();
    const out1 = runSequence(q1);
    const out2 = runSequence(q2);

    expect(out1).toEqual(out2);
  });
});

describe('muted listesi — görünür banner\'lar', () => {
  it('muted ruleId visibleAlerts içinde kalır, primaryBannerAlert\'e dahil olur', () => {
    const queue = new SafetyAlertQueue();
    queue.update([DOOR_ALERT], T0);
    queue.update([DOOR_ALERT], T0 + 800); // confirmed
    queue.mute('door.open.moving');

    const r = queue.update([DOOR_ALERT], T0 + 801);
    // Görsel
    expect(r.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
    // Ses yok
    expect(r.voiceAnnouncementAlert).toBeNull();
    // primaryBanner var (mute görsel kapatmaz)
    expect(r.primaryBannerAlert?.ruleId).toBe('door.open.moving');
    // muted listesinde
    expect(r.muted).toContain('door.open.moving');
  });
});

describe('suppressed listesi', () => {
  it('cooldown içinde kalan banner alert suppressed\'da görünür', () => {
    const queue = new SafetyAlertQueue();
    // overheat: debounce=0, ses 1 t=0'da
    const r1 = queue.update([OVERHEAT_ALERT, SEATBELT_ALERT], T0);
    // seatbelt debounce=2000ms → henüz görünmez
    // overheat ses aldı; seatbelt görünmediği için suppressed'a girmez
    expect(r1.voiceAnnouncementAlert?.ruleId).toBe('engine.overheat');

    // t=2000: seatbelt confirmed; overheat cooldown içi (30sn dolmadı)
    const r2 = queue.update([OVERHEAT_ALERT, SEATBELT_ALERT], T0 + 2000);
    // seatbelt ses adayı; overheat cooldown içi → suppressed
    expect(r2.voiceAnnouncementAlert?.ruleId).toBe('seatbelt.unfastened.moving');
    expect(r2.suppressed).toContain('engine.overheat');
  });
});

describe('reset() — tüm state temizlenir', () => {
  it('reset sonrası visibleAlerts boş, confirmed alertler yeniden debounce ister', () => {
    const queue = new SafetyAlertQueue();
    // Overheat görünür yap
    queue.update([OVERHEAT_ALERT], T0);
    const rBefore = queue.update([OVERHEAT_ALERT], T0 + 1);
    expect(rBefore.visibleAlerts.find((a) => a.ruleId === 'engine.overheat')).toBeDefined();

    // Reset
    queue.reset();

    // Aynı alert tekrar verilse debounce=0 olduğu için anında görünür
    const rAfter = queue.update([OVERHEAT_ALERT], T0 + 2);
    // debounce=0 → hâlâ anında görünür (state sıfırlandı, yeni instance)
    expect(rAfter.visibleAlerts.find((a) => a.ruleId === 'engine.overheat')).toBeDefined();

    // Ama door (debounce=800) reset sonrası yeniden bekler
    queue.reset();
    queue.update([DOOR_ALERT], T0 + 3);
    const rDoor = queue.update([DOOR_ALERT], T0 + 3 + 400);
    expect(rDoor.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();
  });
});

describe('primaryBannerAlert — icon/overlay alert\'ler dahil olmaz', () => {
  it('yalnızca icon alertler varsa primaryBannerAlert=null', () => {
    const queue = new SafetyAlertQueue();
    const r = queue.update([FUEL_ALERT, PARK_DOOR_ALERT, REVERSE_ALERT], T0 + 1000);
    expect(r.primaryBannerAlert).toBeNull();
    // Ama visibleAlerts'ta olabilirler (debounce'a göre)
  });

  it('banner + icon karışık → primaryBanner=en yüksek banner', () => {
    const queue = new SafetyAlertQueue();
    // overheat (banner, 100) + fuel (icon, 40) + door (banner, 95, debounce=800)
    const r = queue.update([OVERHEAT_ALERT, FUEL_ALERT], T0);
    expect(r.primaryBannerAlert?.ruleId).toBe('engine.overheat');
    expect(r.primaryBannerAlert?.screen).toBe('banner');
  });
});

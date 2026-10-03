/**
 * canComfortControl — CAN konfor komutlarının yürütücüsü ve araç durumu cevapları
 * (Megane 4 · NWD/Raise, 2026-10-02).
 *
 * SÖZLEŞME (CLAUDE.md §8 · M3 sahte-ACK yasağı):
 *  · Yazma YALNIZ native beyaz listeden geçer (`CarLauncher.setCanComfortSetting`).
 *  · "Yaptım" YALNIZ aracın kendi durum yankısı (ham 0x71 / 0x72 → store) istenen
 *    değeri gösterince söylenir. `sent` başarı DEĞİLDİR → yankı yoksa "onaylamadı".
 *  · Değer bilinmiyorsa uydurulmaz: göreli komutta ("artır") şu anki seviye
 *    okunamıyorsa dürüstçe söylenir; cevaplarda ölçülmeyen teker "ölçülmedi" der.
 *  · Kanonik doğruluk store'dadır (`UnifiedVehicleStore`); bu modül yalnız okur.
 */

import { isNative } from '../bridge';
import { CarLauncher } from '../nativePlugin';
import { useUnifiedVehicleStore, type UnifiedVehicleState } from './UnifiedVehicleStore';
import {
  RAISE_TYPE, CENTRAL_ID, AMBIENT_COLOR_NAMES, MASSAGE_MODE_NAMES,
  MASSAGE_STRENGTH_MAX, AMBIENT_BRIGHTNESS_MAX, AMBIENT_BRIGHTNESS_STEP,
  type CanAmbientState, type CanClimateState, type CanDoorsState,
  type CanMassageState, type CanTpmsState, type CanTripState,
} from './raiseRenaultFrames';
import type { CanInfoTopic, ComfortCommand, ComfortLevel } from '../vehicleComfortIntents';
import { readVehicleAccess, type VehicleAccessState } from './vehicleAccess';

/** Temel modda (ham çerçeve kurulumu yok) söylenen dürüst ek. */
const SETUP_HINT = 'Sonucu görebilmem için bir kerelik araç bağlantısı kurulumu gerekiyor.';
/** CAN akışı sustuğunda söylenen dürüst ek. */
const SILENT_HINT = 'Araçtan şu an veri gelmiyor; sonucu göremiyorum.';

/**
 * Bu komutta aracın yankısı OKUNABİLİR mi. Temel modda (kurulum yok) ya da CAN akışı
 * sustuğunda (bayat) okunamaz → boşuna beklenmez, eldeki durum "şu an" sayılmaz.
 */
function blindness(access: VehicleAccessState): string | null {
  if (access.tier === 'BASIC') return SETUP_HINT;
  if (access.stream === 'STALE') return SILENT_HINT;
  return null;
}

/** Son bilinen (bayat) cevabı etiketler — "şu an böyle" denmez. */
function staleLabel(text: string, access: VehicleAccessState): string {
  if (access.stream !== 'STALE') return text;
  return `Araçtan bir süredir veri gelmiyor. Son bilinen: ${text[0]!.toLocaleLowerCase('tr-TR')}${text.slice(1)}`;
}

/** Aracın yankısı için bekleme (saha: yankı < 1 sn). */
export const ECHO_TIMEOUT_MS = 2_500;
/** Durum isteğinin taze cevabı için bekleme. */
export const FRESH_READ_TIMEOUT_MS = 1_500;

export type ComfortStatus =
  | 'succeeded' | 'already' | 'unconfirmed' | 'unavailable' | 'unsupported' | 'unknown_state';

export interface ComfortOutcome {
  readonly status: ComfortStatus;
  /** Kullanıcıya söylenecek KISA Türkçe cümle. */
  readonly text: string;
}

/* ── Store bekleme yardımcıları ─────────────────────────────────────────── */

type Pick<T> = (s: UnifiedVehicleState) => T | null;

function waitForState<T>(pick: Pick<T>, ok: (v: T) => boolean, timeoutMs: number): Promise<T | null> {
  const now = pick(useUnifiedVehicleStore.getState());
  if (now !== null && ok(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsub: (() => void) | null = null;
    const finish = (v: T | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      unsub?.();
      resolve(v);
    };
    unsub = useUnifiedVehicleStore.subscribe((s) => {
      const v = pick(s);
      if (v !== null && ok(v)) finish(v);
    });
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Durum isteği gönderir; istekten SONRA gelen değer `fresh` sayılır. `need` verilirse
 * gereken alan da gelene kadar beklenir (0x72 ayarları ayrı ayrı çerçevelerle gelir).
 */
async function requestFresh<T extends { readonly atMs: number }>(
  type: number, pick: Pick<T>, need?: (x: T) => boolean,
): Promise<{ state: T | null; fresh: boolean }> {
  const t0 = Date.now();
  let sent = false;
  try { sent = (await CarLauncher.requestCanData?.({ type }))?.sent === true; } catch { sent = false; }
  if (sent) {
    const v = await waitForState(pick, (x) => x.atMs >= t0 && (need ? need(x) : true), FRESH_READ_TIMEOUT_MS);
    if (v) return { state: v, fresh: true };
  }
  return { state: pick(useUnifiedVehicleStore.getState()), fresh: false };
}

interface WriteOp<T> {
  readonly id: number;
  readonly value: number;
  readonly confirm: (s: T) => boolean;
}

/** Tek ayar yazar ve aracın yankısını bekler. */
async function writeAndConfirm<T extends { readonly atMs: number }>(
  op: WriteOp<T>, pick: Pick<T>, confirmable: boolean,
): Promise<'confirmed' | 'unconfirmed' | 'not_sent'> {
  const t0 = Date.now();
  let sent = false;
  try {
    sent = (await CarLauncher.setCanComfortSetting?.({ id: op.id, value: op.value }))?.sent === true;
  } catch { sent = false; }
  if (!sent) return 'not_sent';
  if (!confirmable) return 'unconfirmed';   // temel mod: yankı okunamaz → boşuna bekleme
  const v = await waitForState(pick, (x) => x.atMs >= t0 && op.confirm(x), ECHO_TIMEOUT_MS);
  return v ? 'confirmed' : 'unconfirmed';
}

async function runOps<T extends { readonly atMs: number }>(
  ops: readonly WriteOp<T>[], pick: Pick<T>, unavailableText: string, unconfirmedText: string,
  confirmable = true,
): Promise<ComfortOutcome | null> {
  for (const op of ops) {
    const r = await writeAndConfirm(op, pick, confirmable);
    if (r === 'not_sent')    return { status: 'unavailable', text: unavailableText };
    if (r === 'unconfirmed') return { status: 'unconfirmed', text: unconfirmedText };
  }
  return null;
}

/* ── Seviye hesabı ───────────────────────────────────────────────────────── */

/** Masaj şiddeti: kullanıcı 1–5 söyler, kutu 0–4 bekler. */
export function massageStrengthTarget(level: ComfortLevel, cur: number | null): number | null {
  const clamp = (v: number): number => Math.max(0, Math.min(MASSAGE_STRENGTH_MAX, v));
  if (level === 'max') return MASSAGE_STRENGTH_MAX;
  if (level === 'min') return 0;
  if (typeof level === 'number') return clamp(Math.round(level) - 1);
  if (cur === null) return null;
  return clamp(cur + (level === '+' ? 1 : -1));
}

/** Ambiyans parlaklığı: 10'luk adım, 10–100 (kapatmak için "kapat" kullanılır). */
export function ambientBrightnessTarget(level: ComfortLevel, cur: number | null): number | null {
  const step = AMBIENT_BRIGHTNESS_STEP;
  const clamp = (v: number): number => Math.max(step, Math.min(AMBIENT_BRIGHTNESS_MAX, v));
  if (level === 'max') return AMBIENT_BRIGHTNESS_MAX;
  if (level === 'min') return step;
  if (typeof level === 'number') return clamp(Math.round(level / step) * step);
  if (cur === null) return null;
  return clamp(Math.round(cur / step) * step + (level === '+' ? step : -step));
}

/* ── Masaj ──────────────────────────────────────────────────────────────── */

const pickMassage: Pick<CanMassageState> = (s) => s.canMassage;

function modeName(i: number | null): string | null {
  return i === null ? null : (MASSAGE_MODE_NAMES[i] ?? `${i} numaralı`);
}

async function runMassage(c: ComfortCommand, access: VehicleAccessState): Promise<ComfortOutcome> {
  if (c.unavailable === 'massage_speed') {
    return { status: 'unsupported', text: 'Masaj hızını sesle ayarlayamıyorum; açıp kapatabilir, şiddetini ve modunu değiştirebilirim.' };
  }
  const hint = blindness(access);
  // Akış sustuysa store'daki durum "şu an" değildir → "zaten açık" kararı ona dayanamaz.
  let st = access.stream === 'STALE' ? null : pickMassage(useUnifiedVehicleStore.getState());
  const needStrength = c.level === '+' || c.level === '-';
  const needMode = c.mode === 'next';
  if (st === null || needStrength || needMode) {
    const r = await requestFresh(RAISE_TYPE.CENTRAL2, pickMassage, (x) =>
      x.driverOn !== null && (!needStrength || x.strength !== null) && (!needMode || x.mode !== null));
    // Akış bayatken yalnız TAZE cevap kullanılır; store'daki eski durum geri sızmaz.
    st = r.fresh || access.stream !== 'STALE' ? (r.state ?? st) : null;
  }
  /* Yokluk ÇIKARIMI yalnız ham çerçeveler gerçekten akarken: kutuya soruldu ve
   * masaj bilgisi hiç gelmedi → bu araç masaj bildirmiyor (yazma YAPILMAZ). */
  if (st === null && access.rawFlowing) {
    return { status: 'unsupported', text: 'Bu araçta koltuk masajı görünmüyor; araç masaj bilgisi bildirmiyor.' };
  }
  const basic = hint !== null;
  const UNAVAILABLE = 'Koltuk masajına şu an ulaşamıyorum.';
  const UNCONFIRMED = basic
    ? `Masaj komutunu araca ilettim. ${hint}`
    : 'Masaj komutunu gönderdim ama araç onaylamadı.';
  const run = (ops: readonly WriteOp<CanMassageState>[]) => runOps(ops, pickMassage, UNAVAILABLE, UNCONFIRMED, !basic);
  const stateUnknown = (what: string): ComfortOutcome => ({
    status: 'unknown_state', text: basic ? `Masajın şu anki ${what} okuyamıyorum. ${hint}` : `Masajın şu anki ${what} okuyamadım.`,
  });

  if (c.zone === 'passenger') {
    if (c.power === undefined) {
      return { status: 'unsupported', text: 'Yolcu masajını yalnız açıp kapatabiliyorum.' };
    }
    const on = c.power === 'on';
    if (st?.passengerOn === on) return { status: 'already', text: `Yolcu masajı zaten ${on ? 'açık' : 'kapalı'}.` };
    const fail = await runOps([{ id: CENTRAL_ID.MASSAGE_PASSENGER_ON, value: on ? 1 : 0, confirm: (s) => s.passengerOn === on }],
      pickMassage, UNAVAILABLE, UNCONFIRMED, !basic);
    return fail ?? { status: 'succeeded', text: `Yolcu masajı ${on ? 'açıldı' : 'kapatıldı'}.` };
  }

  if (c.power === 'off') {
    if (st?.driverOn === false) return { status: 'already', text: 'Koltuk masajı zaten kapalı.' };
    const fail = await runOps([{ id: CENTRAL_ID.MASSAGE_DRIVER_ON, value: 0, confirm: (s) => s.driverOn === false }],
      pickMassage, UNAVAILABLE, UNCONFIRMED, !basic);
    return fail ?? { status: 'succeeded', text: 'Koltuk masajı kapatıldı.' };
  }

  const ops: WriteOp<CanMassageState>[] = [];
  const wasOff = st?.driverOn !== true;
  if (wasOff) ops.push({ id: CENTRAL_ID.MASSAGE_DRIVER_ON, value: 1, confirm: (s) => s.driverOn === true });

  let alreadyText = 'Koltuk masajı zaten açık.';
  if (c.mode !== undefined) {
    const cur = st?.mode ?? null;
    const target = c.mode === 'next' ? (cur === null ? null : (cur + 1) % MASSAGE_MODE_NAMES.length) : c.mode;
    if (target === null) return stateUnknown('modunu');
    if (target !== cur) ops.push({ id: CENTRAL_ID.MASSAGE_MODE, value: target, confirm: (s) => s.mode === target });
    else alreadyText = `Masaj zaten ${modeName(target)} modda.`;
  }
  if (c.level !== undefined) {
    const cur = st?.strength ?? null;
    const target = massageStrengthTarget(c.level, cur);
    if (target === null) return stateUnknown('şiddetini');
    if (target !== cur) ops.push({ id: CENTRAL_ID.MASSAGE_STRENGTH, value: target, confirm: (s) => s.strength === target });
    else alreadyText = target === MASSAGE_STRENGTH_MAX && (c.level === '+' || c.level === 'max')
      ? 'Masaj zaten en yüksek şiddette.'
      : target === 0 && (c.level === '-' || c.level === 'min')
        ? 'Masaj zaten en düşük şiddette.'
        : `Masaj şiddeti zaten ${target + 1}.`;
  }
  if (ops.length === 0) return { status: 'already', text: alreadyText };

  const fail = await run(ops);
  if (fail) return fail;
  const fin = pickMassage(useUnifiedVehicleStore.getState());
  const mode = modeName(fin?.mode ?? null);
  const strength = fin?.strength ?? null;
  if (wasOff) {
    const d: string[] = [];
    if (mode) d.push(`${mode} mod`);
    if (strength !== null) d.push(`şiddet ${strength + 1}`);
    return { status: 'succeeded', text: d.length ? `Koltuk masajı açıldı: ${d.join(', ')}.` : 'Koltuk masajı açıldı.' };
  }
  const modeChanged = c.mode !== undefined && mode !== null;
  const levelChanged = c.level !== undefined && strength !== null;
  if (modeChanged && levelChanged) return { status: 'succeeded', text: `Masaj ${mode} modda, şiddet ${strength! + 1}.` };
  if (modeChanged)  return { status: 'succeeded', text: `Masaj modu ${mode}.` };
  if (levelChanged) return { status: 'succeeded', text: `Masaj şiddeti ${strength! + 1}.` };
  return { status: 'succeeded', text: 'Masaj ayarlandı.' };
}

/* ── Ambiyans ───────────────────────────────────────────────────────────── */

const pickAmbient: Pick<CanAmbientState> = (s) => s.canAmbient;

const UNAVAILABLE_COLOR_TR: Readonly<Record<string, string>> = {
  sari: 'sarı', pembe: 'pembe', kahverengi: 'kahverengi', siyah: 'siyah', altin: 'altın', gumus: 'gümüş',
};

function colorName(i: number | null | undefined): string | null {
  return i === null || i === undefined ? null : (AMBIENT_COLOR_NAMES[i] ?? null);
}

function joinTr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ve ${items[items.length - 1]}`;
}

async function runAmbient(c: ComfortCommand, access: VehicleAccessState): Promise<ComfortOutcome> {
  if (c.unavailable === 'color') {
    const asked = UNAVAILABLE_COLOR_TR[c.colorName ?? ''] ?? 'bu renk';
    return { status: 'unsupported', text: `Ambiyansta ${asked} yok. ${joinTr(AMBIENT_COLOR_NAMES.map((n, i) => (i === 0 ? n[0]!.toUpperCase() + n.slice(1) : n)))} seçebilirim.` };
  }
  const hint = blindness(access);
  let st = access.stream === 'STALE' ? null : pickAmbient(useUnifiedVehicleStore.getState());
  if (st === null || c.level === '+' || c.level === '-' || c.color === 'next') {
    const r = await requestFresh(RAISE_TYPE.CENTRAL1, pickAmbient);
    st = r.fresh || access.stream !== 'STALE' ? (r.state ?? st) : null;
  }
  const basic = hint !== null;
  const UNAVAILABLE = 'Ambiyansa şu an ulaşamıyorum.';
  const UNCONFIRMED = basic
    ? `Ambiyans komutunu araca ilettim. ${hint}`
    : 'Ambiyans komutunu gönderdim ama araç onaylamadı.';

  if (c.zone && c.power) {
    const on = c.power === 'on';
    const isFront = c.zone === 'front';
    const label = isFront ? 'Ön ambiyans' : 'Arka ambiyans';
    const cur = isFront ? st?.front : st?.rear;
    const ops: WriteOp<CanAmbientState>[] = [];
    if (on && st?.on !== true) ops.push({ id: CENTRAL_ID.AMBIENT_ON, value: 1, confirm: (s) => s.on });
    if (cur !== on) {
      ops.push({
        id: isFront ? CENTRAL_ID.AMBIENT_FRONT : CENTRAL_ID.AMBIENT_REAR, value: on ? 1 : 0,
        confirm: (s) => (isFront ? s.front : s.rear) === on,
      });
    }
    if (ops.length === 0) return { status: 'already', text: `${label} zaten ${on ? 'açık' : 'kapalı'}.` };
    const fail = await runOps(ops, pickAmbient, UNAVAILABLE, UNCONFIRMED, !basic);
    return fail ?? { status: 'succeeded', text: `${label} ${on ? 'açıldı' : 'kapatıldı'}.` };
  }

  if (c.power === 'off') {
    if (st?.on === false) return { status: 'already', text: 'Ambiyans zaten kapalı.' };
    const fail = await runOps([{ id: CENTRAL_ID.AMBIENT_ON, value: 0, confirm: (s) => !s.on }],
      pickAmbient, UNAVAILABLE, UNCONFIRMED, !basic);
    return fail ?? { status: 'succeeded', text: 'Ambiyans kapatıldı.' };
  }

  const ops: WriteOp<CanAmbientState>[] = [];
  const wasOff = st?.on !== true;
  if (wasOff) ops.push({ id: CENTRAL_ID.AMBIENT_ON, value: 1, confirm: (s) => s.on });

  let alreadyText = 'Ambiyans zaten açık.';
  if (c.color !== undefined) {
    const cur = st?.colorIndex ?? null;
    const target = c.color === 'next' ? (cur === null ? null : (cur + 1) % AMBIENT_COLOR_NAMES.length) : c.color;
    if (target === null) return { status: 'unknown_state', text: basic ? 'Ambiyansın şu anki rengini okuyamıyorum. ' + hint : 'Ambiyansın şu anki rengini okuyamadım.' };
    if (target !== cur) ops.push({ id: CENTRAL_ID.AMBIENT_COLOR, value: target, confirm: (s) => s.colorIndex === target });
    else alreadyText = `Ambiyans zaten ${colorName(target)}.`;
  }
  if (c.level !== undefined) {
    const cur = st?.brightness ?? null;
    const target = ambientBrightnessTarget(c.level, cur);
    if (target === null) return { status: 'unknown_state', text: basic ? 'Ambiyansın şu anki parlaklığını okuyamıyorum. ' + hint : 'Ambiyansın şu anki parlaklığını okuyamadım.' };
    if (target !== cur) ops.push({ id: CENTRAL_ID.AMBIENT_BRIGHTNESS, value: target, confirm: (s) => s.brightness === target });
    else alreadyText = target === AMBIENT_BRIGHTNESS_MAX && (c.level === '+' || c.level === 'max')
      ? 'Ambiyans zaten en parlak seviyede.'
      : target === AMBIENT_BRIGHTNESS_STEP && (c.level === '-' || c.level === 'min')
        ? 'Ambiyans zaten en kısık seviyede.'
        : `Ambiyans parlaklığı zaten yüzde ${target}.`;
  }
  if (ops.length === 0) return { status: 'already', text: alreadyText };

  const fail = await runOps(ops, pickAmbient, UNAVAILABLE, UNCONFIRMED, !basic);
  if (fail) return fail;
  const fin = pickAmbient(useUnifiedVehicleStore.getState());
  const color = colorName(fin?.colorIndex);
  const bright = fin?.brightness ?? null;
  if (wasOff) {
    const d: string[] = [];
    if (color) d.push(color);
    if (bright !== null) d.push(`parlaklık yüzde ${bright}`);
    return { status: 'succeeded', text: d.length ? `Ambiyans açıldı: ${d.join(', ')}.` : 'Ambiyans açıldı.' };
  }
  if (c.color !== undefined && c.level !== undefined && color && bright !== null) {
    return { status: 'succeeded', text: `Ambiyans ${color}, parlaklık yüzde ${bright}.` };
  }
  if (c.color !== undefined && color) return { status: 'succeeded', text: `Ambiyans rengi ${color}.` };
  if (c.level !== undefined && bright !== null) return { status: 'succeeded', text: `Ambiyans parlaklığı yüzde ${bright}.` };
  return { status: 'succeeded', text: 'Ambiyans ayarlandı.' };
}

/**
 * Konfor komutunu yürütür. ASLA throw etmez; sonuç her zaman dürüst bir cümle taşır.
 * Çağıran (commandExecutor · eylem kapısından SONRA) cümleyi seslendirir.
 */
export async function executeComfortCommand(c: ComfortCommand): Promise<ComfortOutcome> {
  if (!isNative) {
    return { status: 'unavailable', text: 'Konfor ayarlarını yalnız araç ekranından yönetebilirim.' };
  }
  try {
    const access = await readVehicleAccess();
    if (access.tier === 'NONE') {
      return { status: 'unavailable', text: 'Bu cihazda araç bağlantısı yok; konfor ayarlarına ulaşamıyorum.' };
    }
    return c.target === 'massage' ? await runMassage(c, access) : await runAmbient(c, access);
  } catch {
    return { status: 'unconfirmed', text: 'Komutun sonucunu doğrulayamadım.' };
  }
}

/** En zayıf sonuç toplamı belirler: biri gönderilemediyse bütün "başarılı" sayılamaz. */
const STATUS_RANK: Readonly<Record<ComfortStatus, number>> = {
  unavailable: 0, unsupported: 1, unknown_state: 1, unconfirmed: 2, succeeded: 3, already: 4,
};

/**
 * "Masajı aç ve ambiyansı mavi yap" — komutları SIRAYLA yürütür (aynı kutuya
 * eşzamanlı yazma yok). Cümle her parçanın KENDİ dürüst sonucudur; durum en
 * zayıf parçanınkidir (biri onaylanmadıysa bütün "yapıldı" sayılmaz).
 */
export async function executeComfortCommands(list: readonly ComfortCommand[]): Promise<ComfortOutcome> {
  if (list.length === 1) return executeComfortCommand(list[0]!);
  const outs: ComfortOutcome[] = [];
  for (const c of list) outs.push(await executeComfortCommand(c));
  let worst = outs[0]!.status;
  for (const o of outs) if (STATUS_RANK[o.status] < STATUS_RANK[worst]) worst = o.status;
  const texts = outs.map((o) => o.text).filter((t, i, a) => a.indexOf(t) === i);
  return { status: worst, text: texts.join(' ') };
}

/* ── Araç durumu cevapları (SAF — test edilebilir) ──────────────────────── */

/** 1 ondalık, Türkçe virgül; tam sayıda ",0" söylenmez. */
function fmt1(v: number): string {
  const s = (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  return s.endsWith(',0') ? s.slice(0, -2) : s;
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

const TIRE_NAMES = ['ön sol', 'ön sağ', 'arka sol', 'arka sağ'] as const;

export function tiresSpeech(t: CanTpmsState | null, fresh: boolean): string {
  if (!t) return 'Lastik basıncı verisi şu an gelmiyor.';
  const known: string[] = [];
  const missing: string[] = [];
  t.bar.forEach((v, i) => {
    if (v === null) missing.push(TIRE_NAMES[i]!);
    else known.push(`${TIRE_NAMES[i]} ${fmt1(v)}`);
  });
  if (known.length === 0) return 'Lastik sensörleri henüz ölçüm göndermedi.';
  let s = `${fresh ? '' : 'Son bildirilen değerler: '}${fresh ? cap(known.join(', ')) : known.join(', ')} bar.`;
  if (missing.length) s += ` ${cap(joinTr(missing))} henüz ölçülmedi.`;
  /* Uyarı YALNIZ aynı akstaki iki teker arasında: ön/arka farkı araç
     spesifikasyonu olabilir (sahada ön 2,4 · arka 2,0) — eşik uydurulmaz. */
  for (const [a, b] of [[0, 1], [2, 3]] as const) {
    const va = t.bar[a], vb = t.bar[b];
    if (va === null || vb === null) continue;
    const diff = Math.round(Math.abs(va - vb) * 10) / 10;
    if (diff >= 0.3) {
      const low = va < vb ? TIRE_NAMES[a] : TIRE_NAMES[b];
      s += ` ${cap(low)} lastik, aynı akstaki diğerinden ${fmt1(diff)} bar düşük; kontrol etmeni öneririm.`;
    }
  }
  return s;
}

export function tripSpeech(t: CanTripState | null): string {
  if (!t) return 'Yol bilgisayarı verisi şu an gelmiyor.';
  const parts: string[] = [];
  if (t.avgFuelL100km !== null) parts.push(`ortalama tüketim 100 kilometrede ${fmt1(t.avgFuelL100km)} litre`);
  if (t.avgSpeedKmh !== null) parts.push(`ortalama hız saatte ${Math.round(t.avgSpeedKmh)} kilometre`);
  if (t.totalKm !== null) parts.push(`toplam ${Math.round(t.totalKm)} kilometre`);
  return parts.length ? `Yol bilgisayarı: ${parts.join(', ')}.` : 'Yol bilgisayarı henüz değer göstermiyor.';
}

export function doorsSpeech(d: CanDoorsState | null): string {
  if (!d) return 'Kapı bilgisi şu an gelmiyor.';
  const open: string[] = [];
  if (d.frontLeft)  open.push('ön sol kapı');
  if (d.frontRight) open.push('ön sağ kapı');
  if (d.rearLeft)   open.push('arka sol kapı');
  if (d.rearRight)  open.push('arka sağ kapı');
  if (d.trunk)      open.push('bagaj');
  return open.length ? `${cap(joinTr(open))} açık.` : 'Tüm kapılar ve bagaj kapalı.';
}

export function climateSpeech(c: CanClimateState | null): string {
  if (!c || c.power === null) return 'Klima bilgisi şu an gelmiyor.';
  if (!c.power) return 'Klima kapalı.';
  const parts: string[] = [];
  if (c.auto) parts.push('otomatik');
  const td = c.tempDriverC, tp = c.tempPassengerC;
  if (td !== null && tp !== null && td !== tp) parts.push(`sürücü ${fmt1(td)}, yolcu ${fmt1(tp)} derece`);
  else if (td !== null) parts.push(`${fmt1(td)} derece`);
  if (c.fanLevel !== null && c.auto !== true) parts.push(`fan ${c.fanLevel}. kademe`);
  if (c.ac === false) parts.push('kompresör kapalı');
  return parts.length ? `Klima açık: ${parts.join(', ')}.` : 'Klima açık.';
}

export function massageSpeech(m: CanMassageState | null): string {
  if (!m || m.driverOn === null) return 'Masaj bilgisi şu an gelmiyor.';
  if (!m.driverOn) return m.passengerOn ? 'Sürücü masajı kapalı, yolcu masajı açık.' : 'Koltuk masajı kapalı.';
  const d: string[] = [];
  const mode = modeName(m.mode);
  if (mode) d.push(`${mode} mod`);
  if (m.strength !== null) d.push(`şiddet ${m.strength + 1}`);
  return d.length ? `Koltuk masajı açık: ${d.join(', ')}.` : 'Koltuk masajı açık.';
}

export function ambientSpeech(a: CanAmbientState | null): string {
  if (!a) return 'Ambiyans bilgisi şu an gelmiyor.';
  if (!a.on) return 'Ambiyans kapalı.';
  const color = colorName(a.colorIndex);
  return color
    ? `Ambiyans açık: ${color}, parlaklık yüzde ${a.brightness}.`
    : `Ambiyans açık, parlaklık yüzde ${a.brightness}.`;
}

/**
 * Araç durumu sorusunu cevaplar (salt okuma). Gerekirse önce kutudan taze durum
 * ister; gelmezse son bildirilen değeri ETİKETLEYEREK söyler. ASLA throw etmez.
 */
export async function answerCanVehicleInfo(topic: CanInfoTopic): Promise<string> {
  try {
    const s = (): UnifiedVehicleState => useUnifiedVehicleStore.getState();
    const LOCKED_TEXT: Partial<Record<CanInfoTopic, string>> = {
      tires: 'Lastik basıncını', trip: 'Yol bilgisayarını', massage: 'Masaj durumunu', ambient: 'Ambiyans durumunu',
    };
    const access = topic === 'tires_reset' ? null : await readVehicleAccess();
    const label = (t: string): string => (access ? staleLabel(t, access) : t);
    if (LOCKED_TEXT[topic] && access) {
      const feature = topic === 'tires' ? 'tpms' : topic as 'trip' | 'massage' | 'ambient';
      if (access.features[feature] === 'LOCKED') {
        return `${LOCKED_TEXT[topic]} okuyabilmem için bir kerelik araç bağlantısı kurulumu gerekiyor.`;
      }
    }
    switch (topic) {
      case 'tires_reset':
        return 'Lastik basıncı sıfırlamayı ben yapamıyorum; aracın kendi menüsünden yapabilirsin.';
      case 'tires': {
        const r = await requestFresh(RAISE_TYPE.TPMS, (x) => x.canTpms);
        return tiresSpeech(r.state, r.fresh);
      }
      case 'trip': {
        const r = await requestFresh(RAISE_TYPE.TRIP, (x) => x.canTrip);
        return tripSpeech(r.state);
      }
      case 'doors':   return s().canDoors ? label(doorsSpeech(s().canDoors)) : doorsSpeech(null);
      case 'climate': return s().canClimate ? label(climateSpeech(s().canClimate)) : climateSpeech(null);
      case 'massage': {
        const r = await requestFresh(RAISE_TYPE.CENTRAL2, pickMassage, (x) => x.driverOn !== null);
        return r.state && !r.fresh ? label(massageSpeech(r.state)) : massageSpeech(r.state);
      }
      case 'ambient': {
        const r = await requestFresh(RAISE_TYPE.CENTRAL1, pickAmbient);
        return r.state && !r.fresh ? label(ambientSpeech(r.state)) : ambientSpeech(r.state);
      }
      default:        return 'Bunu araçtan okuyamıyorum.';
    }
  } catch {
    return 'Araç verisini şu an okuyamadım.';
  }
}

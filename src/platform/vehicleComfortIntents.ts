/**
 * vehicleComfortIntents — CAN konfor komutları ve araç durumu soruları için YEREL parser. SAF.
 *
 * Kapsam (Megane 4 · NWD/Raise, 2026-10-02):
 *  · KOMUT: koltuk masajı (aç/kapat · şiddet · mod · yolcu) ve iç ambiyans
 *    (aç/kapat · renk · parlaklık · ön/arka). Yürütme `canComfortControl`dedir.
 *  · SORU: lastik basıncı · yol bilgisayarı · kapılar · klima · masaj · ambiyans.
 *
 * Bu modül YALNIZ niyeti çözer; değer, durum veya "yapıldı" ÜRETMEZ. Eşleşme yoksa
 * null döner ve cümle mevcut zincire (sözlük / beyin) aynen devam eder.
 */

import { AMBIENT_COLOR_NAMES, MASSAGE_MODE_NAMES } from './vehicleDataLayer/raiseRenaultFrames';

export type ComfortTarget = 'massage' | 'ambient';
/** '+' / '-' bir adım · 'max' / 'min' · sayı = kullanıcının söylediği değer (masaj 1–5, ambiyans %). */
export type ComfortLevel = '+' | '-' | 'max' | 'min' | number;

export interface ComfortCommand {
  readonly target: ComfortTarget;
  readonly power?: 'on' | 'off';
  /** Masaj: yolcu koltuğu · ambiyans: ön / arka bölge (yalnız aç/kapat ile). */
  readonly zone?: 'passenger' | 'front' | 'rear';
  readonly level?: ComfortLevel;
  /** Ambiyans renk numarası (`AMBIENT_COLOR_NAMES`) ya da sıradaki renk. */
  readonly color?: number | 'next';
  /** Masaj modu numarası (`MASSAGE_MODE_NAMES`) ya da sıradaki mod. */
  readonly mode?: number | 'next';
  /** Dürüst "yapamam": masaj hızı sesle ayarlanmaz · araçta olmayan renk. */
  readonly unavailable?: 'massage_speed' | 'color';
  /** Araçta olmayan rengin sadeleştirilmiş kökü ("sari", "pembe"…). */
  readonly colorName?: string;
}

export type CanInfoTopic = 'tires' | 'tires_reset' | 'trip' | 'doors' | 'climate' | 'massage' | 'ambient';

/** Türkçe aksan sadeleştirme — vehicleIntents ile aynı kural (bağımsız kopya). */
function norm(s: string): string {
  return s.replace(/İ/g, 'i').toLowerCase()
    .replace(/̇/g, '')                       // "İ".toLowerCase() → i + birleşik nokta
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MASSAGE_RE = /\bmasaj\w*/;
const AMBIENT_RE = /\b(ambi\w*|ortam\s+(isi[gk]\w*|aydinlat\w*)|atmosfer\s+isi[gk]\w*)/;

/** "yarın masajı açmayı hatırla" komut değil, hafıza cümlesidir. */
const MEMORY_RE = /\s(hatirla|unutma)$|\saklinda\s+tut$/;
/** Olumsuz emir ("masajı kapatma") — komut üretilmez. */
const NEGATION_RE = /\b(acma|kapatma|kapama|yapma|artirma|arttirma|azaltma|degistirme|ayarlama|durdurma|sondurme)\b/;

const ON_RE  = /\b(ac|acar|acin|acsana|acabilir\w*|acalim|calistir\w*|baslat\w*|aktiflestir\w*|aktif\s+et\w*|devreye\s+al\w*|yak|yakar|yaksana|istiyorum)\b/;
const OFF_RE = /\b(kapat|kapatir|kapatin|kapatsana|kapatabilir\w*|kapatalim|kapa|durdur\w*|sondur\w*|kes|keser|kesin|iptal\s+et\w*|devre\s*disi\w*)\b/;
const INC_RE = /\b(artir\w*|arttir\w*|yukselt\w*|cogalt\w*|guclendir\w*|sertlestir\w*|siddetlendir\w*|parlat\w*|fazlalastir\w*|daha\s+(guclu|sert|parlak|yogun|fazla))\b/;
const DEC_RE = /\b(azalt\w*|dusur\w*|kis(ar|abilir|sana|in|alim)?|hafiflet\w*|yumusat\w*|karart\w*|daha\s+(hafif|yumusak|los|az|dusuk))\b/;
const MAX_RE = /\b(en\s+(yuksek|guclu|sert|parlak|fazla)|maksimum|maks|sonuna\s+kadar|full)\b/;
const MIN_RE = /\b(en\s+(dusuk|az|hafif|yumusak|los)|minimum)\b/;
const SET_RE = /\b(yap\w*|ayarla\w*|getir\w*|olsun|cek\w*|al)\b/;
const CHANGE_RE = /\bdegistir\w*/;

/** Soru ama rica DEĞİL: "kırmızı mı" (soru) ≠ "kırmızı yapar mısın" (rica). */
const ENDS_WITH_Q_RE = /\b(mi|mu)\s*$/;
const POLITE_REQUEST_RE = /\b\w+(ar|er|ir|ur)\s+mi(sin|siniz)\b/;

const MASSAGE_LEVEL_NOUN_RE = /\b(siddet\w*|guc\w*|sertlig\w*|yogunlug\w*|seviye\w*|kademe\w*)/;
const AMBIENT_LEVEL_NOUN_RE = /\b(parlak\w*|siddet\w*|isig\w*|isik\w*|seviye\w*|kademe\w*|yogunlug\w*)/;

/* Numaralar AMBIENT_COLOR_NAMES (NWD Renault/Raise listesi) ile AYNI sıra — test kilitler. */
const COLOR_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bbeyaz\w*/, 0],
  [/\byesil\w*/, 1],
  [/\bkirmizi\w*/, 2],
  [/\b(turkuaz\w*|camgobeg\w*|acik\s+mavi\w*)/, 6],   // "mavi"den ÖNCE
  [/\b(mavi\w*|lacivert\w*)/, 3],
  [/\b(mor(a|u|un|lu)?|eflatun\w*|lila\w*)\b/, 4],
  [/\b(turuncu\w*|amber)\b/, 5],
  [/\bsari\w*/, 7],
];
const UNAVAILABLE_COLOR_RE = /\b(gri|pembe|kahverengi|siyah|altin|gumus)\w*/;

const MODE_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(dinlendirici|dinlenme|rahatlatici|relaks|relax)\w*/, 0],
  [/\bbel\b/, 1],
  [/\b(tonik|canlandirici)\w*/, 2],
];

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  iki: 2, uc: 3, dort: 4, dord: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
  yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90, yuz: 100,
};
const NUMBER_WORD_RE = /^(iki|uc|dort|dord|bes|alti|yedi|sekiz|dokuz|on|yirmi|otuz|kirk|elli|altmis|yetmis|seksen|doksan|yuz)(e|a|ye|ya)?$/;

/** İlk sayıyı bulur: rakam ya da Türkçe sayı sözcüğü ("yetmiş beş" → 75). "bir" bilinçli YOK (belirsiz). */
function firstNumber(t: string): number | null {
  const tokens = t.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (/^\d{1,3}$/.test(tok)) return Number(tok);
    const m = NUMBER_WORD_RE.exec(tok);
    if (!m) continue;
    // "ön ambiyans" ("ön" → "on") sayı DEĞİL.
    if (m[1] === 'on' && /^(ambi|taraf|kisim|koltu|kapi)/.test(tokens[i + 1] ?? '')) continue;
    let v = NUMBER_WORDS[m[1]!]!;
    if (v >= 10 && v < 100 && !m[2]) {
      const next = NUMBER_WORD_RE.exec(tokens[i + 1] ?? '');
      if (next && NUMBER_WORDS[next[1]!]! < 10) v += NUMBER_WORDS[next[1]!]!;
    }
    return v;
  }
  return null;
}

function stripVocative(t: string): string {
  // "Mavi, ambiyansı kırmızı yap" — baştaki hitap renk sanılmasın.
  return t.replace(/^(hey\s+)?mavi\s+(?=\S)/, '');
}

function parseLevel(t: string, levelNoun: RegExp): ComfortLevel | undefined {
  if (INC_RE.test(t)) return '+';
  if (DEC_RE.test(t)) return '-';
  if (MAX_RE.test(t)) return 'max';
  if (MIN_RE.test(t)) return 'min';
  const n = firstNumber(t);
  if (n !== null && (levelNoun.test(t) || SET_RE.test(t))) return n;
  return undefined;
}

/**
 * Konfor KOMUTU. Hedef (masaj / ambiyans) ve en az bir işlem yoksa null.
 * Soru biçimi ("ambiyans kırmızı mı") komut sayılmaz → null.
 */
export function tryParseVehicleComfort(text: string): ComfortCommand | null {
  const raw = norm(text);
  if (raw.length < 4 || MEMORY_RE.test(raw) || NEGATION_RE.test(raw)) return null;
  const t = stripVocative(raw);
  const isMassage = MASSAGE_RE.test(t);
  const isAmbient = AMBIENT_RE.test(t);
  if (isMassage === isAmbient) return null;                    // hedef yok ya da ikisi birden
  if (ENDS_WITH_Q_RE.test(t) && !POLITE_REQUEST_RE.test(t)) return null;

  const power: ComfortCommand['power'] = OFF_RE.test(t) ? 'off' : ON_RE.test(t) ? 'on' : undefined;

  if (isMassage) {
    if (/\bhiz\w*/.test(t)) return { target: 'massage', unavailable: 'massage_speed' };
    const zone = /\byolcu\w*/.test(t) ? 'passenger' as const : undefined;
    if (power === 'off') return { target: 'massage', power, ...(zone ? { zone } : {}) };
    let mode: ComfortCommand['mode'];
    for (const [re, idx] of MODE_WORDS) if (re.test(t)) { mode = idx; break; }
    if (mode === undefined && CHANGE_RE.test(t)) mode = 'next';
    const level = mode === 'next' ? undefined : parseLevel(t, MASSAGE_LEVEL_NOUN_RE);
    const implicitOn = power === undefined && mode === undefined && level === undefined && SET_RE.test(t);
    const pw = power ?? (implicitOn ? 'on' : undefined);
    if (!pw && mode === undefined && level === undefined) return null;
    return {
      target: 'massage',
      ...(pw ? { power: pw } : {}),
      ...(zone ? { zone } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(level !== undefined ? { level } : {}),
    };
  }

  // ── Ambiyans ──
  const saysFront = /\b(on\s+(ambi|taraf|kisim)\w*|ondeki|on\s+ve\s+arka)\b/.test(t);
  const saysRear  = /\barka(daki)?\b/.test(t);
  // "ön ve arka ambiyansı aç" → iki bölge birden = bölge yok (tümü).
  const zone = saysFront && !saysRear ? 'front' as const : saysRear && !saysFront ? 'rear' as const : undefined;
  if (power === 'off') return { target: 'ambient', power, ...(zone ? { zone } : {}) };
  let color: ComfortCommand['color'];
  for (const [re, idx] of COLOR_WORDS) if (re.test(t)) { color = idx; break; }
  if (color === undefined) {
    const bad = UNAVAILABLE_COLOR_RE.exec(t);
    if (bad) return { target: 'ambient', unavailable: 'color', colorName: bad[1]! };
    if (CHANGE_RE.test(t) && !AMBIENT_LEVEL_NOUN_RE.test(t)) color = 'next';
  }
  const level = parseLevel(t, AMBIENT_LEVEL_NOUN_RE);
  if (!power && color === undefined && level === undefined) return null;
  return {
    target: 'ambient',
    ...(power ? { power } : {}),
    ...(zone && power ? { zone } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(level !== undefined ? { level } : {}),
  };
}

/* ── Çok cümlecikli konfor komutu ("… ve …") ───────────────────────────── */

const CLAUSE_SPLIT_RE = /\s+(?:ve|sonra|ardindan|bir de|hem de|ayrica)\s+/;

/**
 * Hedefsiz devam cümleciğinde ("… ve şiddetini artır") izin verilen sözcükler.
 * Listede olmayan TEK sözcük ("müziği", "ekran") cümleciği konfor dışı yapar ve
 * cümle zincir yoluna aynen bırakılır. Ölçüldü (2026-10-03): zincir yolunda
 * hedefsiz "şiddetini artır" ses artırmaya (volume_up 1.0), "parlaklığını artır"
 * ekran parlaklığına (set_setting 0.93) düşüyordu.
 */
const CONTINUATION_TOKEN_RE = new RegExp('^(?:' + [
  'bir', 'de', 'da', 'biraz', 'daha', 'en', 'cok', 'az', 'lutfen', 'simdi', 'hemen', 'onu', 'bunu', 'sunu',
  'yuzde', 'kadar', 'tam', 'on', 'ondeki', 'arka\\w*', 'koltu\\w*', 'surucu\\w*', 'yolcu\\w*',
  'ac\\w*', 'kapat\\w*', 'kapa', 'yap\\w*', 'ayarla\\w*', 'artir\\w*', 'arttir\\w*', 'azalt\\w*', 'dusur\\w*',
  'yukselt\\w*', 'cogalt\\w*', 'guclendir\\w*', 'sertlestir\\w*', 'siddetlendir\\w*', 'yumusat\\w*', 'hafiflet\\w*',
  'parlat\\w*', 'karart\\w*', 'kis(ar|abilir|sana|in|alim)?', 'degistir\\w*', 'getir\\w*', 'cevir\\w*', 'al', 'olsun',
  'yak\\w*', 'sondur\\w*', 'baslat\\w*', 'durdur\\w*', 'calistir\\w*',
  'siddet\\w*', 'parlak\\w*', 'guc\\w*', 'seviye\\w*', 'kademe\\w*', 'mod\\w*', 'ren[gk]\\w*', 'isi[gk]\\w*',
  'sertlig\\w*', 'yogunlug\\w*', 'hiz\\w*',
  'beyaz\\w*', 'kirmizi\\w*', 'mavi\\w*', 'lacivert\\w*', 'turkuaz\\w*', 'camgobeg\\w*', 'turuncu\\w*', 'mor\\w*',
  'gri\\w*', 'yesil\\w*', 'eflatun\\w*', 'lila\\w*', 'sari\\w*', 'pembe\\w*', 'kahverengi\\w*', 'siyah\\w*',
  'dinlendirici\\w*', 'rahatlatici\\w*', 'relaks\\w*', 'bel', 'tonik\\w*', 'canlandirici\\w*',
  'yuksek\\w*', 'dusuk\\w*', 'maksimum', 'maks', 'minimum', 'sonuna', 'full', '\\d{1,3}',
  '(iki|uc|dort|dord|bes|alti|yedi|sekiz|dokuz|yirmi|otuz|kirk|elli|altmis|yetmis|seksen|doksan|yuz)(e|a|ye|ya)?',
].join('|') + ')$');

const TARGET_WORD: Readonly<Record<ComfortTarget, string>> = { massage: 'masaj', ambient: 'ambiyans' };

function targetOf(t: string): ComfortTarget | null {
  const m = MASSAGE_RE.test(t);
  const a = AMBIENT_RE.test(t);
  return m === a ? null : m ? 'massage' : 'ambient';
}

/** Aynı hedefe ardışık komutları birleştirir ("ambiyansı aç" + "mavi yap" → tek komut). */
function mergeSameTarget(list: readonly ComfortCommand[]): ComfortCommand[] {
  const out: ComfortCommand[] = [];
  for (const c of list) {
    const prev = out[out.length - 1];
    if (prev && prev.target === c.target && !prev.unavailable && !c.unavailable
      && prev.power !== 'off' && c.power !== 'off' && prev.zone === c.zone) {
      out[out.length - 1] = { ...prev, ...c };
    } else {
      out.push(c);
    }
  }
  return out;
}

/**
 * Konfor KOMUT(LAR)I — tek cümlecik ya da "… ve …" ile bağlı cümlecikler.
 * Her cümlecik kendi hedefini taşır ya da (yalnız konfor sözcükleriyle) bir
 * öncekinin hedefini devralır. Tek bir cümlecik bile konfor dışıysa null →
 * cümle zincir yoluna aynen bırakılır ("masajı aç ve müziği aç").
 */
export function tryParseVehicleComforts(text: string): readonly ComfortCommand[] | null {
  const raw = stripVocative(norm(text));
  if (raw.length < 4 || MEMORY_RE.test(raw) || NEGATION_RE.test(raw)) return null;
  const clauses = raw.split(CLAUSE_SPLIT_RE).filter((c) => c.length > 0);
  if (clauses.length <= 1) {
    const one = tryParseVehicleComfort(text);
    return one ? [one] : null;
  }
  if (clauses.length > 4) return null;
  const out: ComfortCommand[] = [];
  let prev: ComfortTarget | null = null;
  for (const clause of clauses) {
    let cmd: ComfortCommand | null = null;
    if (targetOf(clause)) {
      cmd = tryParseVehicleComfort(clause);
    } else if (prev && clause.split(' ').every((w) => CONTINUATION_TOKEN_RE.test(w))) {
      cmd = tryParseVehicleComfort(`${TARGET_WORD[prev]} ${clause}`);
    }
    if (!cmd) return null;
    out.push(cmd);
    prev = cmd.target;
  }
  return mergeSameTarget(out);
}

const CONTROL_VERB_RE = /\b(ac|acar|kapat\w*|yap\w*|ayarla\w*|artir\w*|arttir\w*|azalt\w*|dusur\w*|yukselt\w*|degistir\w*|kilitle\w*|goster\w*)\b/;
const STATE_Q_RE = /\b(acik|kapali|aktif|calisiyor|yaniyor)\s*(mi|mu)\b|\bdurum\w*|\bne\s+durumda\b|\bkontrol\w*/;

/** Araç durumu SORUSU — hangi konu sorulduğunu döner; komut biçimindeyse null. */
export function tryParseCanVehicleInfo(text: string): CanInfoTopic | null {
  const t = stripVocative(norm(text));
  if (t.length < 4 || MEMORY_RE.test(t)) return null;

  if (/\b(lastik|teker)\w*/.test(t)) {
    if (/\bsifirla\w*/.test(t)) return 'tires_reset';
    if (/\bbasinc\w*|\bhava\w*/.test(t)) return 'tires';
    if (/\b(kontrol\w*|durum\w*|nasil|kac|bak\w*|ne\s+durumda)\b/.test(t)
      && !/\b(degis|tak|sok|patla|tamir)\w*/.test(t)) return 'tires';
    return null;
  }
  if (/\bortalama\s+(yakit|tuketim|hiz|surat)\w*|\byol\s+bilgisayar\w*|\btoplam\s+(kilometre|km|mesafe)\w*/.test(t)
    && !/\b(ac|acar|goster\w*|kapat\w*)\b/.test(t)) return 'trip';
  if (/\b(kapi|kapilar|bagaj)\w*/.test(t)
    && (/\b(acik|kapali)\s*(mi|mu)\b|\bacik\s+kal\w*/.test(t) || /\b(durum\w*|kontrol\w*)\b/.test(t))
    && !/\b(kilitle\w*|ac|acar|kapat\w*)\b/.test(t)) return 'doors';
  if (/\bklima\w*/.test(t)
    && (STATE_Q_RE.test(t) || /\bkac\s+derece\w*|\bderece\w*\s+(kac|ne)\b/.test(t))
    && !CONTROL_VERB_RE.test(t)) return 'climate';
  if (MASSAGE_RE.test(t)
    && (STATE_Q_RE.test(t) || /\bhangi\s+mod\w*|\bsiddet\w*\s+(ne|kac)\b/.test(t))
    && !CONTROL_VERB_RE.test(t)) return 'massage';
  if (AMBIENT_RE.test(t)
    && (STATE_Q_RE.test(t) || /\b(ne|hangi)\s+renk\w*|\brengi\s+ne\b|\b(mi|mu)\s*$|\bparlaklig\w*\s+(ne|kac)\b/.test(t))
    && !CONTROL_VERB_RE.test(t)) return 'ambient';
  return null;
}

/* ── İnternetsiz (Vosk) tanıma sözlüğü ─────────────────────────────────── */

/**
 * Konfor komutlarının ve araç durumu sorularının sözcükleri — internetsizken Vosk
 * bu kelimeleri tanısın diye komut sözlüğüne eklenir. Renk ve masaj modu adları
 * kod çözücünün KENDİ listesinden gelir (ikinci liste yok). Yalnız ayrıştırıcının
 * gerçekten anladığı sözcükler — yeni komut İCAT ETMEZ.
 */
export const COMFORT_GRAMMAR_WORDS: readonly string[] = Object.freeze([
  'masaj', 'masajı', 'masajını', 'koltuk', 'koltuk masajı', 'yolcu', 'sürücü',
  'ambiyans', 'ambiyansı', 'ambiyansları', 'iç ambiyans', 'ortam ışığı', 'ön', 'arka',
  'şiddet', 'şiddetini', 'parlaklık', 'parlaklığını', 'mod', 'modunu', 'renk', 'rengini',
  'artır', 'arttır', 'azalt', 'kıs', 'yükselt', 'düşür', 'değiştir', 'yap', 'kapat',
  'en yüksek', 'en düşük', 'yüzde', 'daha',
  ...AMBIENT_COLOR_NAMES, 'lacivert', 'açık mavi',
  ...MASSAGE_MODE_NAMES, 'rahatlatıcı',
  'lastik', 'lastikler', 'lastik basıncı', 'lastik basınçlarını', 'basınç', 'kontrol et',
  'yol bilgisayarı', 'ortalama', 'tüketim', 'ortalama hız', 'toplam kilometre',
  'kapılar', 'bagaj', 'açık mı', 'kapalı mı', 'klima', 'kaç derece', 'durumu',
]);

/* ── ParsedCommand.extra taşıması (Record<string,string>) ───────────────── */

export function encodeComfortCommands(list: readonly ComfortCommand[]): string {
  return JSON.stringify(list);
}

function validateComfort(o: unknown): ComfortCommand | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (r.target !== 'massage' && r.target !== 'ambient') return null;
  const okLevel = (v: unknown): v is ComfortLevel =>
    v === '+' || v === '-' || v === 'max' || v === 'min' || (typeof v === 'number' && Number.isFinite(v));
  const okIndex = (v: unknown, max: number): v is number | 'next' =>
    v === 'next' || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max);
  const out: Record<string, unknown> = { target: r.target };
  if (r.power === 'on' || r.power === 'off') out.power = r.power;
  if (r.zone === 'passenger' || r.zone === 'front' || r.zone === 'rear') out.zone = r.zone;
  if (okLevel(r.level)) out.level = r.level;
  if (okIndex(r.color, 7)) out.color = r.color;
  if (okIndex(r.mode, 2)) out.mode = r.mode;
  if (r.unavailable === 'massage_speed' || r.unavailable === 'color') out.unavailable = r.unavailable;
  if (typeof r.colorName === 'string') out.colorName = r.colorName.slice(0, 20);
  return out as unknown as ComfortCommand;
}

/** Taşınan metni DOĞRULAYARAK çözer (1–4 komut); bozuksa null (yürütücü dürüstçe reddeder). */
export function decodeComfortCommands(s: string | undefined): readonly ComfortCommand[] | null {
  if (!s) return null;
  let o: unknown;
  try { o = JSON.parse(s); } catch { return null; }
  const arr: unknown[] = Array.isArray(o) ? o : [o];
  if (arr.length === 0 || arr.length > 4) return null;
  const out: ComfortCommand[] = [];
  for (const x of arr) {
    const c = validateComfort(x);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

/**
 * companionEngine.ts — Faz 4: Proaktif Motor (PromptScheduler) + Uyku Önleyici.
 *
 * "Asla konuşmak için konuşma" (mimari §5): 60 sn'lik tick döngüsü her turda
 * önce GATE ZİNCİRİNİ, sonra TETİKLEYİCİLERİ öncelik sırasıyla değerlendirir.
 * Tetikler şablon + companionContext yorumlayıcısından üretilir — proaktif
 * konuşma GEMİNİ'YE GİTMEZ (mimari §2.8: maliyet + internetsiz head unit).
 *
 * Tetikleyiciler (öncelik sırası):
 *  1. Yakıt menzili < 50 km  — GÜVENLİK: medya çalarken bile konuşur (duck'lı)
 *  2. Uyku önleme            — GÜVENLİK: gece + sürüş + uzun sessizlik → açık
 *     uçlu soru (sürücüyü konuşturmak uyanık tutar; Anti-Drowsiness)
 *  3. Kontak/boot selamlama  — oturumda 1 kez, boot'tan sonraki ilk dakikalar
 *  4. Mola önerisi           — sürüş > breakReminderIntervalMin (vars. 2 saat)
 *  5. Yolculuk yorumu        — yalnız chattiness='sik' (küçük sohbet)
 *
 * Frequency budget (mimari §5.2): chattiness → proaktif konuşmalar arası
 * minimum boşluk (az=45dk · normal=20dk · sık=10dk). GÜVENLİK tetikleri (1-2)
 * bütçeden bağımsızdır ama kendi cooldown'larına tabidir (gevezeleşmez).
 * 'az' seçiliyse bütçeli tetikler (4-5) hiç çalışmaz — yalnız güvenlik +
 * tek seferlik selamlama (kontak açılışı her seviyede selamlanır; ürün kararı).
 *
 * Interaction Gate (mimari §5.3 — hepsi geçmeli):
 *  - companionEnabled açık · personality ≠ 'sessiz' (sessiz = proaktif 0, §7)
 *  - CognitiveMode < PROTECTION (PROTECTION/CRITICAL/LIMP_HOME → sus)
 *  - voiceService duraklatılmamış (isVoicePaused) ve aktif sesli oturum yok
 *    (status ≠ idle veya takip dinlemesi → sus)
 *  - kendi TTS'imiz uçuşta değil
 *  - medya "prominent" (çalıyor) ise yalnız tetik #1 geçer — müzik kesilmez
 *
 * Sessizlik tanımı (uyku önleme): ne sesli etkileşim ne medya — her ikisi de
 * tick'te örneklenir + komut/TTS olayları anında sıfırlar. Süreler MONOTONİK
 * kaynaktan (performance.now) hesaplanır (CLAUDE.md §4 — clock jump koruması).
 *
 * Zero-Leak: startCompanionEngine() cleanup döner — interval, abonelikler ve
 * emniyet zamanlayıcısı kapatılır. SystemBoot Wave 4'e named cleanup ile kayıt.
 */

import { useStore } from '../../store/useStore';
import { useCognitiveStore, MODE_RANK } from '../../store/useCognitiveStore';
import { resolveCompanionIdentity } from './companionIdentity';
import {
  interpretTimeOfDay,
  interpretRange,
  interpretBreakNeed,
  interpretTripDuration,
  interpretDoorAjar,
  interpretTirePressure,
} from './companionContext';
import type { OBDData } from '../obdTypes';
import { onOBDData } from '../obdService';
import { onTripState } from '../tripLogService';
import { getMediaState } from '../mediaService';
import { getVoiceSnapshot, isVoicePaused, registerCommandHandler } from '../voiceService';
import { speakAssistant, registerTtsEndListener } from '../ttsService';

/* ── Zamanlama sabitleri (dakika) ───────────────────────────── */

export const COMPANION_TICK_MS = 60_000;

/** Frequency budget: proaktif konuşmalar arası minimum boşluk (mimari §5.2). */
const BUDGET_GAP_MIN: Record<string, number> = { az: 45, normal: 20, sik: 10 };

const FUEL_CRITICAL_RANGE_KM   = 50;  // tetik #1 eşiği
const FUEL_WARN_COOLDOWN_MIN   = 15;  // kritik yakıt tekrar aralığı
const DOOR_WARN_COOLDOWN_MIN   = 3;   // kapı açık (seyir hâlinde) tekrar aralığı — acil ama gevezeleşmesin
const TPMS_WARN_COOLDOWN_MIN   = 30;  // lastik basıncı kalıcı durum → seyrek hatırlat
const DROWSY_MIN_TRIP_MIN      = 30;  // uyku kontrolü için minimum sürüş
const DROWSY_SILENCE_MIN       = 20;  // "uzun sessizlik" eşiği
const DROWSY_COOLDOWN_MIN      = 25;  // iki uyku sorusu arası minimum
const BREAK_REPEAT_GAP_MIN     = 45;  // iki mola hatırlatması arası minimum
const GREETING_WINDOW_MIN      = 5;   // boot sonrası selamlama fırsat penceresi
const TRIP_COMMENT_MIN_TRIP    = 30;  // yolculuk yorumu için minimum sürüş
const SPEAK_SAFETY_TIMEOUT_MS  = 35_000; // onEnd gelmezse uçuş bayrağı sıfırla

/* ── Şablonlar (deterministik — Math.random YOK) ────────────── */

/** Hitap eki: varsa " {ad}", yoksa boş — cümle başı selamlamalara eklenir. */
function callsignSuffix(callsign: string): string {
  return callsign ? ` ${callsign}` : '';
}

function greetingLine(callsign: string, hour: number): string {
  const cs = callsignSuffix(callsign);
  switch (interpretTimeOfDay(hour)) {
    case 'sabah': return `Günaydın${cs}! Yola hazırız, ben buradayım.`;
    case 'ogle':  return `Merhaba${cs}! Hazırsan yola bakalım.`;
    case 'aksam': return `İyi akşamlar${cs}! Hadi bakalım, ben yanındayım.`;
    case 'gece':  return `İyi geceler${cs}! Gece yolculuğundayız, gözüm yolda — bir şey lazım olursa söyle.`;
  }
}

/**
 * Uyku önleme: açık uçlu sorular — sürücüyü KONUŞTURMAK uyanık tutar
 * ("evet/hayır" değil, cevap kurdurtan sorular). Deterministik rotasyon.
 * Hitap ("kanka" vb.) gömülmez — kullanıcı hitabı (callsign) ayarından gelir.
 */
const DROWSY_QUESTIONS: readonly string[] = [
  'Orada mısın? Yol nasıl gidiyor, yorulduk mu?',
  'Epeydir sesin çıkmıyor — nasılsın, her şey yolunda mı?',
  'Gece yolculuğu sessiz geçiyor. İstersen biraz konuşalım, uykunu dağıtır. Bugün nasıldı?',
];
let _drowsyVariant = 0;

function drowsyQuestion(callsign: string): string {
  const q = DROWSY_QUESTIONS[_drowsyVariant % DROWSY_QUESTIONS.length] as string;
  _drowsyVariant++;
  // İlk varyantta hitap kullan (varsa) — "Selim, orada mısın?" dikkat çeker.
  if (callsign && q === DROWSY_QUESTIONS[0]) return `${callsign}, ${q.charAt(0).toLowerCase()}${q.slice(1)}`;
  return q;
}

/* ── Monotonik saat ─────────────────────────────────────────── */

function nowMin(): number {
  return performance.now() / 60_000;
}

/* ── Modül durumu ───────────────────────────────────────────── */

let _started = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsubs: Array<() => void> = [];
let _speakSafetyTimer: ReturnType<typeof setTimeout> | null = null;

let _bootAtMin        = 0;
let _greetingDone     = false;
let _speaking         = false;          // kendi TTS'imiz uçuşta
let _silenceStartMin  = 0;              // sessizlik penceresi başlangıcı
let _lastSpokeAtMin   = -Infinity;      // frequency budget saati
let _lastFuelWarnMin  = -Infinity;
let _lastDrowsyMin    = -Infinity;
let _lastBreakMin     = -Infinity;
let _lastDoorWarnMin  = -Infinity;
let _lastTpmsWarnMin  = -Infinity;

// Sinyal önbellekleri (abonelikler doldurur — tick içinde senkron okunur)
let _rangeKm      = -1;                 // -1 = veri yok
let _tripActive   = false;
let _tripMin      = 0;
let _tripKm       = 0;
let _doors: OBDData['doors'] = undefined; // CAN gövde durumu (undefined = sensör yok)
let _tpms:  OBDData['tpms']  = undefined;

/* ── Yardımcılar ────────────────────────────────────────────── */

function markActivity(): void {
  _silenceStartMin = nowMin();
}

function speak(text: string): void {
  _speaking = true;
  _lastSpokeAtMin = nowMin();
  markActivity();
  // Web yolunda onerror userOnEnd çağırmaz → emniyet zamanlayıcısı bayrağı
  // her durumda sıfırlar (asılı _speaking = sonsuza dek susmuş motor olurdu).
  if (_speakSafetyTimer) clearTimeout(_speakSafetyTimer);
  _speakSafetyTimer = setTimeout(() => { _speaking = false; }, SPEAK_SAFETY_TIMEOUT_MS);
  // Akıllı asistan cevabı: klip → online TTS → native zinciri (motorsuz ünitede de sesli)
  speakAssistant(text, () => {
    _speaking = false;
    markActivity();
    if (_speakSafetyTimer) { clearTimeout(_speakSafetyTimer); _speakSafetyTimer = null; }
  });
}

/* ── Tick: gate zinciri + tetik önceliği ────────────────────── */

function tick(): void {
  try {
    const settings = useStore.getState().settings;
    if (settings.companionEnabled !== true) return;

    const id = resolveCompanionIdentity(settings);
    // 'sessiz' kişilik = proaktif 0 (mimari §7): yalnız sorulara cevap verir.
    if (id.personality === 'sessiz') return;

    const t     = nowMin();
    const voice = getVoiceSnapshot();
    const media = getMediaState();
    const voiceBusy = voice.status !== 'idle' || voice.followUp;

    // Sessizlik örneklemesi: kabinde ses (sesli oturum / medya) varsa pencere
    // şimdiden başlar — "20 dk sessizlik" yalnız gerçekten sessiz kabini sayar.
    if (voiceBusy || media.playing) markActivity();

    // ── Interaction Gate ──
    if (MODE_RANK[useCognitiveStore.getState().currentMode] >= MODE_RANK.PROTECTION) return;
    if (isVoicePaused()) return;
    if (voiceBusy || _speaking) return;

    const isNight = interpretTimeOfDay(new Date().getHours()) === 'gece';

    // ── 1. Yakıt menzili < 50 km (GÜVENLİK — medya çalarken bile, duck'lı) ──
    if (_rangeKm >= 0 && _rangeKm < FUEL_CRITICAL_RANGE_KM &&
        t - _lastFuelWarnMin >= FUEL_WARN_COOLDOWN_MIN) {
      const line = interpretRange(_rangeKm);
      if (line) {
        _lastFuelWarnMin = t;
        speak(line);
        return;
      }
    }

    // ── 1b. Kapı/bagaj açık + araç SEYİR HÂLİNDE (GÜVENLİK — medyayı da keser) ──
    //     Park hâlinde (trip yok) uyarmaz: yükleme yaparken "kapı açık" demek
    //     rahatsız eder. Trip aktif = araç sürülüyor → açık kapı gerçek tehlike.
    if (_tripActive && t - _lastDoorWarnMin >= DOOR_WARN_COOLDOWN_MIN) {
      const line = interpretDoorAjar(_doors);
      if (line) {
        _lastDoorWarnMin = t;
        speak(line);
        return;
      }
    }

    // Medya prominent (çalıyor): müzik/video kesilmez — gerisi duraklara kalır.
    if (media.playing) return;

    // ── 1c. Lastik basıncı düşük (GÜVENLİK — kalıcı durum, bütçeden bağımsız) ──
    if (t - _lastTpmsWarnMin >= TPMS_WARN_COOLDOWN_MIN) {
      const line = interpretTirePressure(_tpms);
      if (line) {
        _lastTpmsWarnMin = t;
        speak(line);
        return;
      }
    }

    // ── 2. Uyku önleme (GÜVENLİK): gece + sürüş + uzun sessizlik ──
    if (isNight && _tripActive && _tripMin >= DROWSY_MIN_TRIP_MIN &&
        t - _silenceStartMin >= DROWSY_SILENCE_MIN &&
        t - _lastDrowsyMin >= DROWSY_COOLDOWN_MIN) {
      _lastDrowsyMin = t;
      speak(drowsyQuestion(id.userCallsign));
      return;
    }

    // ── 3. Kontak/boot selamlaması (oturumda 1, ilk dakikalar) ──
    if (!_greetingDone) {
      if (t - _bootAtMin <= GREETING_WINDOW_MIN) {
        _greetingDone = true;
        speak(greetingLine(id.userCallsign, new Date().getHours()));
        return;
      }
      _greetingDone = true; // pencere kaçtı (gate'ler doluydu) — sonradan selamlama tuhaf olur
    }

    // ── Frequency budget: 'az' = yalnız güvenlik; diğerleri aralığa tabi ──
    if (id.chattiness === 'az') return;
    if (t - _lastSpokeAtMin < (BUDGET_GAP_MIN[id.chattiness] ?? 45)) return;

    // ── 4. Mola önerisi (sürüş > breakReminderIntervalMin) ──
    if (_tripActive && t - _lastBreakMin >= BREAK_REPEAT_GAP_MIN) {
      const line = interpretBreakNeed(_tripMin, settings.breakReminderIntervalMin);
      if (line) {
        _lastBreakMin = t;
        speak(line);
        return;
      }
    }

    // ── 5. Küçük yolculuk yorumu (yalnız 'sik') ──
    if (id.chattiness === 'sik' && _tripActive && _tripMin >= TRIP_COMMENT_MIN_TRIP) {
      const line = interpretTripDuration(_tripMin, _tripKm);
      if (line) speak(line);
    }
  } catch { /* proaktif motor hiçbir koşulda uygulamayı çökertmez */ }
}

/* ── Public API ─────────────────────────────────────────────── */

export function startCompanionEngine(): () => void {
  if (_started) return stopCompanionEngine;
  _started = true;

  _bootAtMin       = nowMin();
  _silenceStartMin = _bootAtMin;
  _greetingDone    = false;

  // Sinyal abonelikleri — tick içinde senkron okunacak önbellekleri doldurur
  _unsubs.push(onOBDData((d) => {
    const r = d.estimatedRangeKm >= 0 ? d.estimatedRangeKm : (d.range >= 0 ? d.range : -1);
    _rangeKm = typeof r === 'number' && Number.isFinite(r) ? r : -1;
    _doors = d.doors;   // CAN gövde durumu — tetik #1b/#1c için (undefined = sensör yok)
    _tpms  = d.tpms;
  }));
  _unsubs.push(onTripState((s) => {
    _tripActive = s.active;
    _tripMin    = s.current?.liveDurationMin ?? 0;
    _tripKm     = s.current?.liveDistanceKm  ?? 0;
  }));
  // Sessizlik sıfırlayıcıları: her sesli komut + her TTS bitişi (navigasyon
  // anonsu dahil) kabinde ses demektir — uyku penceresi yeniden başlar.
  _unsubs.push(registerCommandHandler(() => markActivity()));
  _unsubs.push(registerTtsEndListener(() => markActivity()));

  _timer = setInterval(tick, COMPANION_TICK_MS);

  return stopCompanionEngine;
}

export function stopCompanionEngine(): void {
  if (!_started) return;
  _started = false;
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_speakSafetyTimer) { clearTimeout(_speakSafetyTimer); _speakSafetyTimer = null; }
  for (const u of _unsubs) { try { u(); } catch { /* abone kapanışı motoru kırmasın */ } }
  _unsubs = [];
  _speaking = false;
}

/* ── Test kancaları ─────────────────────────────────────────── */

/** @internal — tick'i zamanlayıcı beklemeden çalıştırır. */
export function _companionEngineTickForTest(): void {
  tick();
}

/** @internal — testler arası tam izolasyon. */
export function _resetCompanionEngineForTest(): void {
  stopCompanionEngine();
  _bootAtMin       = nowMin();
  _silenceStartMin = _bootAtMin;
  _greetingDone    = false;
  _speaking        = false;
  _lastSpokeAtMin  = -Infinity;
  _lastFuelWarnMin = -Infinity;
  _lastDrowsyMin   = -Infinity;
  _lastBreakMin    = -Infinity;
  _lastDoorWarnMin = -Infinity;
  _lastTpmsWarnMin = -Infinity;
  _drowsyVariant   = 0;
  _rangeKm    = -1;
  _tripActive = false;
  _tripMin    = 0;
  _tripKm     = 0;
  _doors      = undefined;
  _tpms       = undefined;
}

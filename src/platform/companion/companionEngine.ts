/**
 * companionEngine.ts — Faz 4: Proaktif Motor (PromptScheduler) + Uyku Önleyici.
 *
 * "Asla konuşmak için konuşma" (mimari §5): 60 sn'lik tick döngüsü her turda
 * önce GATE ZİNCİRİNİ, sonra TETİKLEYİCİLERİ öncelik sırasıyla değerlendirir.
 * Tetikler şablon + companionContext yorumlayıcısından üretilir — proaktif
 * konuşma GEMİNİ'YE GİTMEZ (mimari §2.8: maliyet + internetsiz head unit).
 *
 * FAZ 16 grup-2: tick artık sabit `setInterval` DEĞİL, runtimeManager
 * scheduler'ının periodMs=60000 görevi (§L.0) — BALANCED/PERFORMANCE'ta 60s
 * AYNEN korunur, düşük-tier'da moda göre yavaşlar. Tüm zamanlama kararları
 * (`nowMin()` = MONOTONİK `performance.now()`) mutlak farklarla hesaplandığından
 * (tick-sayımına dayalı birikim YOK) periyodun uzaması sonuçları bozmaz.
 *
 * ── MAVI-F9 · ARTIK "MOTOR" DEĞİL, TEKLİF ÜRETİCİSİ ────────────────────────
 * F9 öncesi bu dosya hem tetikleri ÜRETİYOR hem kararı KENDİSİ veriyordu:
 * sabit bir `if/return` merdiveni, tetik başına modül-içi cooldown değişkeni
 * ve global bir sesli proaktif tavanının YOKLUĞU. Dışarıdan hiçbir kaynak
 * (navigasyon · araç zekâsı · filo) bu merdivene bağlanamıyordu.
 *
 * F9 ile karar `assistant/proactivePolicyEngine`e taşındı. Bu dosya artık
 * yalnız **teklif** üretir; hangi teklifin konuşacağına motor karar verir:
 * cooldown · sıklık bütçesi · saatlik tavan · medya politikası · iş yükü ·
 * presence · öğrenilmiş bastırma · TEK KONU kuralı ORADA uygulanır.
 * Seslendirme yine BURADADIR (motor ikinci bir TTS kanalı açmaz).
 *
 * Teklifler (öncelik `relevance` ile taşınır — sıra AYNEN korundu):
 *  1. Yakıt menzili < 50 km  — `safety`, medya çalarken bile konuşur (duck'lı)
 *  2. Kapı/bagaj açık (seyir) — `safety`, medyayı keser
 *  3. Lastik basıncı         — `safety`
 *  4. Kötü hava + far        — `safety`
 *  5. Uyku önleme            — `safety`: gece + sürüş + uzun sessizlik → açık
 *     uçlu soru (sürücüyü konuşturmak uyanık tutar; Anti-Drowsiness)
 *  6. Kontak/boot selamlama  — `social`, oturumda 1 kez, bütçeden MUAF
 *  7. Mola önerisi           — `social`, sürüş > breakReminderIntervalMin
 *  8. Yolculuk yorumu        — `social`, yalnız chattiness='sik'
 *
 * ⚠️ Mola önerisi bugün `social` sınıfındadır çünkü ÜRETİMDEKİ davranışı budur
 * (bütçeye tabi + iş yükü sohbet kapısına tabi). `informational`a yükseltmek
 * DAVRANIŞ DEĞİŞİKLİĞİDİR ve F9 kapsamı dışında bırakıldı (açık borç).
 *
 * Frequency budget (mimari §5.2): chattiness → proaktif konuşmalar arası
 * minimum boşluk (az=45dk · normal=20dk · sık=10dk); motor uygular. GÜVENLİK
 * teklifleri bütçeden bağımsızdır ama kendi cooldown'larına tabidir.
 * 'az' seçiliyse bütçeli teklifler hiç çalışmaz — yalnız güvenlik + tek
 * seferlik selamlama (kontak açılışı her seviyede selamlanır; ürün kararı,
 * `frequencyBudget: 'EXEMPT'` ile BEYAN EDİLİR).
 *
 * Interaction Gate — BURADA KALAN (motor devralmadı, spec F9 "KEEP"):
 *  - companionEnabled açık (motorun kendi şalteri) · personality ≠ 'sessiz'
 *    (sessiz = proaktif 0, §7 — güvenlik dahil susar; ürün kararı)
 *  - CognitiveMode < PROTECTION (PROTECTION/CRITICAL/LIMP_HOME → sus)
 *  - voiceService duraklatılmamış (isVoicePaused)
 * MOTORA DEVREDİLEN: konuşma sırası meşguliyeti (`turnBusy`), medya politikası,
 * iş yükü sınıf tavanı, presence, bütçe, cooldown, tek konu kuralı.
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
  interpretVisibilityLights,
} from './companionContext';
import type { OBDData } from '../obdTypes';
import { onOBDData } from '../obdService';
import { onTripState } from '../tripLogService';
import { onWeatherState } from '../weatherService';
import { getMediaState } from '../mediaService';
import { getVoiceSnapshot, isVoicePaused, registerCommandHandler } from '../voiceService';
import { speakAssistant, registerTtsEndListener } from '../ttsService';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
/* MAVI-F8: güvenlik DIŞI proaktif konuşmanın iş yükü kapısı. SAF çözümleyici
   (canlı okuma DI ile ayrı adaptördedir) → motor grafiği büyümez.
   F9 NOTU: iş yükü SINIFLA uygulanır (`safety` tavanı CRITICAL, `social` tavanı
   NORMAL) — kapı artık `proactivePolicyEngine`dedir; burada yalnız SEVİYE
   okunur ve F8 sayacı (`noteProactiveSuppressed`) beslenir. */
import { currentMaviWorkload, noteProactiveSuppressed } from '../assistant/maviWorkload';
/* MAVI-F9: proaktif konuşma izninin TEK kapısı. SAF karar çekirdeği + bounded
   defter; bu dosya yalnız TEKLİF verir ve kazananı seslendirir. */
import {
  evaluateProactiveProposals,
  endProactiveDelivery,
  _resetProactivePolicyForTest,
  type ProactiveProposal,
} from '../assistant/proactivePolicyEngine';

/* ── Zamanlama sabitleri (dakika) ───────────────────────────── */

export const COMPANION_TICK_MS = 60_000;

/** Frequency budget: proaktif konuşmalar arası minimum boşluk (mimari §5.2). */
const BUDGET_GAP_MIN: Record<string, number> = { az: 45, normal: 20, sik: 10 };

const FUEL_CRITICAL_RANGE_KM   = 50;  // teklif #1 eşiği
const FUEL_WARN_COOLDOWN_MIN   = 15;  // kritik yakıt tekrar aralığı
const DOOR_WARN_COOLDOWN_MIN   = 3;   // kapı açık (seyir hâlinde) tekrar aralığı — acil ama gevezeleşmesin
const TPMS_WARN_COOLDOWN_MIN   = 30;  // lastik basıncı kalıcı durum → seyrek hatırlat
const VIS_LIGHTS_COOLDOWN_MIN  = 25;  // kötü hava + far hatırlatması → nazik, seyrek
const DROWSY_MIN_TRIP_MIN      = 30;  // uyku kontrolü için minimum sürüş
const DROWSY_SILENCE_MIN       = 20;  // "uzun sessizlik" eşiği
const DROWSY_COOLDOWN_MIN      = 25;  // iki uyku sorusu arası minimum
const BREAK_REPEAT_GAP_MIN     = 45;  // iki mola hatırlatması arası minimum
const GREETING_WINDOW_MIN      = 5;   // boot sonrası selamlama fırsat penceresi
const TRIP_COMMENT_MIN_TRIP    = 30;  // yolculuk yorumu için minimum sürüş
const SPEAK_SAFETY_TIMEOUT_MS  = 35_000; // onEnd gelmezse uçuş bayrağı sıfırla

/**
 * MAVI-F9 · KAYNAK KİMLİKLERİ. Öğrenme, susturma ve LAB tablosu bu SABİT
 * anahtarlara bağlıdır — serbest metin DEĞİL, PII DEĞİL, çeviriye TABİ DEĞİL.
 */
export const COMPANION_PROACTIVE_SOURCES = Object.freeze({
  fuel:       'companion.fuel_range',
  door:       'companion.door_ajar',
  tpms:       'companion.tire_pressure',
  visibility: 'companion.visibility_lights',
  drowsy:     'companion.drowsiness',
  greeting:   'companion.greeting',
  breakHint:  'companion.break_reminder',
  tripNote:   'companion.trip_comment',
} as const);

/** Dakika → ms (motor MONOTONİK ms ile çalışır). */
const MIN_MS = 60_000;

/**
 * Teklif önceliği (`relevance`). Bu değerler ÖLÇÜLMÜŞ kabul skoru DEĞİL, ürünün
 * BUGÜNKÜ doğrulanmış tetik SIRASIDIR — F9 sırayı değiştirmez, taşır.
 */
const REL = Object.freeze({
  fuel: 0.99, door: 0.97, tpms: 0.95, visibility: 0.93, drowsy: 0.91,
  greeting: 0.60, breakHint: 0.50, tripNote: 0.40,
});

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
let _timer: (() => void) | null = null;
let _unsubs: Array<() => void> = [];
let _speakSafetyTimer: ReturnType<typeof setTimeout> | null = null;

let _bootAtMin        = 0;
let _greetingDone     = false;
let _speaking         = false;          // kendi TTS'imiz uçuşta
let _silenceStartMin  = 0;              // sessizlik penceresi başlangıcı
/* MAVI-F9 · TEK DEFTER: cooldown saatleri (`_lastFuelWarnMin` · `_lastDoorWarnMin`
   · `_lastTpmsWarnMin` · `_lastVisLightsMin` · `_lastDrowsyMin` · `_lastBreakMin`)
   ve sıklık bütçesi saati (`_lastSpokeAtMin`) BU DOSYADAN KALDIRILDI.
   Tek sahibi `proactivePolicyEngine`dir; burada paralel bir zaman defteri
   tutmak "ikinci otorite" olurdu ve iki defter kaçınılmaz olarak ayrışırdı. */

// Sinyal önbellekleri (abonelikler doldurur — tick içinde senkron okunur)
let _rangeKm      = -1;                 // -1 = veri yok
let _tripActive   = false;
let _tripMin      = 0;
let _tripKm       = 0;
let _doors: OBDData['doors'] = undefined; // CAN gövde durumu (undefined = sensör yok)
let _tpms:  OBDData['tpms']  = undefined;
let _headlights   = false;              // OBD far durumu (universal; veri yoksa false)
let _weatherCode  = -1;                 // WMO hava kodu (-1 = hava verisi yok)

/* ── Yardımcılar ────────────────────────────────────────────── */

function markActivity(): void {
  _silenceStartMin = nowMin();
}

function speak(text: string): void {
  _speaking = true;
  markActivity();
  // Web yolunda onerror userOnEnd çağırmaz → emniyet zamanlayıcısı bayrağı
  // her durumda sıfırlar (asılı _speaking = sonsuza dek susmuş motor olurdu).
  if (_speakSafetyTimer) clearTimeout(_speakSafetyTimer);
  _speakSafetyTimer = setTimeout(() => {
    _speaking = false;
    /* MAVI-F9: teslim penceresi de kapanır — aksi hâlde çok sonra gelen bir
       kullanıcı kesintisi ÖLÜ bir teslime "ret" olarak yazılırdı. */
    try { endProactiveDelivery(); } catch { /* fail-soft */ }
  }, SPEAK_SAFETY_TIMEOUT_MS);
  // Akıllı asistan cevabı: klip → online TTS → native zinciri (motorsuz ünitede de sesli)
  speakAssistant(text, () => {
    _speaking = false;
    markActivity();
    /* Teslim bitti. Bu bir KABUL kanıtı DEĞİLDİR (kullanıcı öneriye uydu mu
       bilmiyoruz) — yalnız kesinti penceresini kapatır. */
    try { endProactiveDelivery(); } catch { /* fail-soft */ }
    if (_speakSafetyTimer) { clearTimeout(_speakSafetyTimer); _speakSafetyTimer = null; }
  });
}

/* ── Tick: interaction gate + TEKLİF üretimi (karar MOTORDA) ─── */

/**
 * `chattiness` → sıklık bütçesi aralığı (ms). `'az'` = bütçeli teklifler
 * TAMAMEN kapalı → `Infinity` (motor bunu "bu sınıf konuşmaz" olarak uygular).
 */
function budgetGapMs(chattiness: string): number {
  if (chattiness === 'az') return Infinity;
  const min = BUDGET_GAP_MIN[chattiness];
  return typeof min === 'number' ? min * MIN_MS : Infinity;
}

/** Bounded teklif kurucusu — her alan AÇIKÇA beyan edilir (sessiz varsayılan YOK). */
function proposal(
  sourceId: string,
  kind: ProactiveProposal['kind'],
  relevance: number,
  cooldownMin: number,
  mediaPolicy: ProactiveProposal['mediaPolicy'],
  frequencyBudget: ProactiveProposal['frequencyBudget'],
  text: () => string | null,
): ProactiveProposal {
  return Object.freeze({
    sourceId,
    kind,
    relevance,
    /* Güven 1.0: bu tekliflerin tamamı DOĞRUDAN gözlenmiş sinyalden doğar
       (OBD gövde/basınç/menzil · yolculuk durumu · sistem saati). Türetilmiş
       ya da tahmini bir sinyal YOKTUR — olsaydı daha düşük yazılırdı. */
    confidence: 1,
    /* Teklif YALNIZ bu tick geçerlidir: sonraki tick canlı durumdan yeniden
       türetilir. Kuyruk YOK → bayat proaktif konuşma yapısal olarak imkânsız. */
    decayAtMs: null,
    cooldownKey: sourceId,
    cooldownMs: cooldownMin * MIN_MS,
    mediaPolicy,
    frequencyBudget,
    deliver: 'voice' as const,
    text,
  });
}

function tick(): void {
  try {
    const settings = useStore.getState().settings;
    if (settings.companionEnabled !== true) return;

    const id = resolveCompanionIdentity(settings);
    // 'sessiz' kişilik = proaktif 0 (mimari §7): yalnız sorulara cevap verir.
    if (id.personality === 'sessiz') return;

    const t     = nowMin();
    const nowMs = t * MIN_MS;
    const voice = getVoiceSnapshot();
    const media = getMediaState();
    const voiceBusy = voice.status !== 'idle' || voice.followUp;

    // Sessizlik örneklemesi: kabinde ses (sesli oturum / medya) varsa pencere
    // şimdiden başlar — "20 dk sessizlik" yalnız gerçekten sessiz kabini sayar.
    if (voiceBusy || media.playing) markActivity();

    // ── Interaction Gate (F9 sonrası BURADA KALAN kısım) ──
    if (MODE_RANK[useCognitiveStore.getState().currentMode] >= MODE_RANK.PROTECTION) return;
    if (isVoicePaused()) return;

    const isNight = interpretTimeOfDay(new Date().getHours()) === 'gece';
    const S = COMPANION_PROACTIVE_SOURCES;
    const proposals: ProactiveProposal[] = [];

    /* ── GÜVENLİK TEKLİFLERİ ──────────────────────────────────────────────
     * Sınıf `safety`: iş yükünden, presence'tan, sıklık bütçesinden, saatlik
     * tavandan ve öğrenilmiş bastırmadan BAĞIMSIZ (`PROACTIVE_CLASS_RULES`).
     * Tek frenleri kendi cooldown'larıdır. */

    // 1 — Yakıt menzili < 50 km: medya çalarken bile konuşur (duck ttsService işi).
    if (_rangeKm >= 0 && _rangeKm < FUEL_CRITICAL_RANGE_KM) {
      proposals.push(proposal(S.fuel, 'safety', REL.fuel, FUEL_WARN_COOLDOWN_MIN,
        'INTERRUPTS_MEDIA', 'EXEMPT', () => interpretRange(_rangeKm)));
    }

    /* 2 — Kapı/bagaj açık + araç SEYİR HÂLİNDE. Park hâlinde (trip yok)
     *     uyarmaz: yükleme yaparken "kapı açık" demek rahatsız eder. */
    if (_tripActive) {
      proposals.push(proposal(S.door, 'safety', REL.door, DOOR_WARN_COOLDOWN_MIN,
        'INTERRUPTS_MEDIA', 'EXEMPT', () => interpretDoorAjar(_doors)));
    }

    // 3 — Lastik basıncı düşük (kalıcı durum → seyrek). Medyayı KESMEZ.
    proposals.push(proposal(S.tpms, 'safety', REL.tpms, TPMS_WARN_COOLDOWN_MIN,
      'DEFERS_TO_MEDIA', 'EXEMPT', () => interpretTirePressure(_tpms)));

    /* 4 — Bağlam köprüsü: görünürlük düşüren havada (yağmur/kar/sis) farların
     *     kapalı/bilinmiyor olması → nazik far sorusu. Yalnız seyirde anlamlı. */
    if (_tripActive) {
      proposals.push(proposal(S.visibility, 'safety', REL.visibility, VIS_LIGHTS_COOLDOWN_MIN,
        'DEFERS_TO_MEDIA', 'EXEMPT', () => interpretVisibilityLights(_weatherCode, _headlights)));
    }

    // 5 — Uyku önleme: gece + sürüş + uzun sessizlik → açık uçlu soru.
    if (isNight && _tripActive && _tripMin >= DROWSY_MIN_TRIP_MIN
        && t - _silenceStartMin >= DROWSY_SILENCE_MIN) {
      proposals.push(proposal(S.drowsy, 'safety', REL.drowsy, DROWSY_COOLDOWN_MIN,
        'DEFERS_TO_MEDIA', 'EXEMPT', () => drowsyQuestion(id.userCallsign)));
    }

    /* ── SOHBET TEKLİFLERİ ────────────────────────────────────────────────
     * Sınıf `social`: iş yükü tavanı NORMAL (ELEVATED ve üstünde SUSAR — F8
     * `allowProactiveChatter` kapısının SINIF karşılığı), presence gerektirir
     * ve (selamlama hariç) sıklık bütçesine tabidir. */

    // 6 — Kontak/boot selamlaması: oturumda 1, ilk dakikalar, bütçeden MUAF.
    const greetingWindowOpen = t - _bootAtMin <= GREETING_WINDOW_MIN;
    if (!_greetingDone && greetingWindowOpen) {
      proposals.push(proposal(S.greeting, 'social', REL.greeting, 0,
        'DEFERS_TO_MEDIA', 'EXEMPT',
        () => greetingLine(id.userCallsign, new Date().getHours())));
    }

    // 7 — Mola önerisi (sürüş > breakReminderIntervalMin).
    if (_tripActive) {
      proposals.push(proposal(S.breakHint, 'social', REL.breakHint, BREAK_REPEAT_GAP_MIN,
        'DEFERS_TO_MEDIA', 'SUBJECT',
        () => interpretBreakNeed(_tripMin, settings.breakReminderIntervalMin)));
    }

    // 8 — Küçük yolculuk yorumu (yalnız 'sik').
    if (id.chattiness === 'sik' && _tripActive && _tripMin >= TRIP_COMMENT_MIN_TRIP) {
      proposals.push(proposal(S.tripNote, 'social', REL.tripNote, 0,
        'DEFERS_TO_MEDIA', 'SUBJECT', () => interpretTripDuration(_tripMin, _tripKm)));
    }

    /* ── KARAR: MOTORDA ───────────────────────────────────────────────────
     * Bu dosya hangi teklifin konuşacağına KARAR VERMEZ. Motor TEK KONU
     * kuralını uygular; kazanan dışındaki her teklif DÜŞER (kuyruk YOK). */
    const decision = evaluateProactiveProposals(proposals, {
      nowMs,
      workload: currentMaviWorkload(nowMs).level,
      presenceEnabled: settings.companionEnabled === true,
      chattinessGapMs: budgetGapMs(id.chattiness),
      mediaProminent: media.playing === true,
      turnBusy: voiceBusy || _speaking,
    });

    /* F8 sayacı KORUNUR: bir sohbet teklifi İŞ YÜKÜ yüzünden düştüyse tick
       başına bir kez sayılır (F8 LAB satırı ve testleri bu sayaca bakar). */
    if (decision.drops.some((d) => d.reason === 'workload')) {
      try { noteProactiveSuppressed(); } catch { /* fail-soft */ }
    }

    if (decision.admitted && decision.text) speak(decision.text);

    /* Selamlama defteri (mevcut davranış birebir): pencere KAÇTIYSA ve bu
       tick'te selamlamanın SIRASI GERÇEKTEN GELDİYSE (sohbet sınıfı kapıları
       açık · medya susuyor · daha yüksek öncelikli bir güvenlik uyarısı
       konuşmadı) selamlama bir daha DENENMEZ — sonradan selamlamak tuhaf olur. */
    if (decision.sourceId === S.greeting) {
      _greetingDone = true;
    } else if (!_greetingDone && !greetingWindowOpen
        && !media.playing
        && decision.admissibleKinds.includes('social')
        && decision.kind !== 'safety') {
      _greetingDone = true;
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
    _headlights = d.headlights === true; // far durumu — tetik #1d (hava köprüsü)
  }));
  _unsubs.push(onWeatherState((s) => {
    // WMO hava kodu — tetik #1d. Veri yoksa -1 (görünürlük köprüsü sessiz kalır).
    _weatherCode = typeof s.weather?.code === 'number' ? s.weather.code : -1;
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

  // FAZ 16 — sabit setInterval yerine scheduler (§L.0, periodMs API).
  _timer = runtimeManager.scheduleTask({
    id: 'companion-tick', periodMs: COMPANION_TICK_MS, criticality: 'NORMAL', fn: tick,
  });

  return stopCompanionEngine;
}

export function stopCompanionEngine(): void {
  if (!_started) return;
  _started = false;
  if (_timer) { _timer(); _timer = null; }
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
  /* MAVI-F9: cooldown/bütçe defteri artık MOTORDA — testler arası izolasyon
     için o defter de sıfırlanır (aksi hâlde bir testin cooldown'ı sonrakini
     sessizce susturur ve sahte yeşil üretirdi). */
  _resetProactivePolicyForTest();
  _drowsyVariant   = 0;
  _rangeKm    = -1;
  _tripActive = false;
  _tripMin    = 0;
  _tripKm     = 0;
  _doors      = undefined;
  _tpms       = undefined;
  _headlights = false;
  _weatherCode = -1;
}

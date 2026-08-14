/**
 * mediaAuthorityModel.ts — CAROS LAB · Medya Otoritesi görünüm modeli (SAF).
 *
 * I/O · timer · Date.now · global durum · React importu YOKTUR.
 * `sessionInspectorModel` sözleşmesini KULLANIR (OBSERVED · DERIVED ·
 * UNAVAILABLE · STALE) — paralel sistem kurulmaz.
 *
 * DÜRÜSTLÜK: otorite yoksa alanlar UNAVAILABLE'dır; "duraklatılmış" veya
 * "sağlıklı" gibi bir varsayım ÜRETİLMEZ.
 */

import type { InspectorField, Observability } from './sessionInspectorModel';
import type { MediaAuthorityRawSnapshot } from './mediaAuthoritySources';
import { QUEUE_DRIFT_LABEL } from '../media/authority/queueReconciliation';

export interface MediaAuthorityCard {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export type MediaAuthorityVerdict =
  | 'RENDERING'          // ses gerçekten üretiliyor (kanıtlı)
  | 'REQUESTED_ONLY'     // komut kabul edildi, ses kanıtı YOK
  | 'PAUSED_BY_USER'
  | 'PAUSED_BY_FOCUS'
  | 'IDLE'
  | 'DUPLICATE_BACKEND'  // SÖZLEŞME İHLALİ
  | 'UNAVAILABLE';

export const MEDIA_AUTHORITY_VERDICT_LABEL:
Readonly<Record<MediaAuthorityVerdict, string>> = {
  RENDERING: 'SES ÜRETİLİYOR (KANITLI)',
  REQUESTED_ONLY: 'YALNIZ İSTEK — SES KANITI YOK',
  PAUSED_BY_USER: 'KULLANICI DURAKLATTI',
  PAUSED_BY_FOCUS: 'SES ODAĞI NEDENİYLE DURAKLADI',
  IDLE: 'BOŞTA',
  DUPLICATE_BACKEND: 'İHLAL: BİRDEN FAZLA SES KAYNAĞI',
  UNAVAILABLE: 'OTORİTE YOK — DURUM BİLİNMİYOR',
} as const;

const NA = '—';

function field(
  id: string, label: string, value: string, klass: Observability,
  source: string, note: string, updatedAt: number | null = null,
): InspectorField {
  return { id, label, value, klass, source, updatedAt, note };
}

function boolText(v: boolean | null): string {
  if (v === null) return NA;
  return v ? 'EVET' : 'HAYIR';
}

function numText(v: number | null, suffix = ''): string {
  if (v === null || !Number.isFinite(v)) return NA;
  return `${v}${suffix}`;
}

/** Otorite yoksa gözlem sınıfı UNAVAILABLE'dır — sahte OBSERVED üretilmez. */
function klassFor(available: boolean, value: unknown): Observability {
  if (!available) return 'UNAVAILABLE';
  return value === null || value === undefined ? 'UNAVAILABLE' : 'OBSERVED';
}

export function buildMediaAuthorityCards(
  s: MediaAuthorityRawSnapshot,
): readonly MediaAuthorityCard[] {
  const av = s.authorityAvailable;
  const t = s.readAt;

  const authority: InspectorField[] = [
    field('platform', 'Native platform', boolText(s.isNativePlatform),
      'OBSERVED', 'bridge.isNative',
      'Web modunda native otorite YOKTUR; oynatma yalnız WebView backend\'lerindedir.', t),
    field('available', 'Otorite erişilebilir', boolText(s.authorityAvailable),
      'OBSERVED', 'CarosPlaybackBridge.snapshot',
      'HAYIR ise aşağıdaki tüm alanlar KAYNAK YOK sayılır; "duraklatıldı" varsayılmaz.', t),
    field('src-native', 'Aktif kaynak (native)', av ? s.activeSourceNative : NA,
      klassFor(av, s.activeSourceNative), 'CarosPlaybackService.activeSource',
      'ExoPlayer\'ın çaldığı kaynak sınıfı. NONE = kuyruk yok.', t),
    field('src-gateway', 'Aktif kaynak (gateway)', s.activeSourceGateway ?? NA,
      s.activeSourceGateway ? 'OBSERVED' : 'UNAVAILABLE', 'sourceCoordinator.committed',
      'Devir işlemi COMMITTED olan kaynak. Native ile çelişirse devir yarım kalmıştır.', t),
  ];

  const playback: InspectorField[] = [
    field('playing', 'Çalıyor (bildirilen)', av ? boolText(s.playing) : NA,
      klassFor(av, s.playing), 'ExoPlayer.isPlaying',
      'Bu TEK BAŞINA "ses çıkıyor" DEMEK DEĞİLDİR; alt satırdaki kanıta bakılır.', t),
    field('rendering', 'Ses kanıtı (render + odak + seviye)',
      av ? boolText(s.renderingVerified) : NA,
      klassFor(av, s.renderingVerified), 'CarosPlaybackService.isRenderingVerified',
      'EVET = render ediyor VE audio focus bizde VE etkin ses > 0. Elimizdeki en güçlü kanıt.', t),
    field('pwr', 'playWhenReady', av ? boolText(s.playWhenReady) : NA,
      klassFor(av, s.playWhenReady), 'ExoPlayer.getPlayWhenReady',
      'Niyet bayrağı. Gerçek durumu değil, hedefi gösterir.', t),
    field('buffering', 'Tamponlama', av ? boolText(s.buffering) : NA,
      klassFor(av, s.buffering), 'ExoPlayer.playbackState',
      'STATE_BUFFERING — ağ akışlarında beklenen geçici durum.', t),
    field('pos', 'Konum / süre',
      av ? `${numText(s.positionMs, ' ms')} / ${numText(s.durationMs, ' ms')}` : NA,
      klassFor(av, s.positionMs), 'ExoPlayer.getCurrentPosition',
      'Canlı yayında süre 0 olabilir — bu bir hata değil, bilinmiyor demektir.', t),
    field('last-pause', 'Son duraklatma nedeni', av ? (s.lastPauseReason || NA) : NA,
      av && s.lastPauseReason ? 'OBSERVED' : 'UNAVAILABLE', 'CarosPlaybackService.lastPauseReason',
      'user · focus_loss · focus_loss_transient · becoming_noisy · stopped.', t),
  ];

  const focus: InspectorField[] = [
    field('focus-state', 'Odak durumu', av ? s.focusState : NA,
      klassFor(av, s.focusState), 'CarosAudioFocusManager.focusState',
      'DELAYED = sistem odağı şimdi veremedi; oynatma BAŞLAMAZ, GAIN beklenir.', t),
    field('has-focus', 'Odak bizde', av ? boolText(s.hasAudioFocus) : NA,
      klassFor(av, s.hasAudioFocus), 'AudioManager.requestAudioFocus',
      'Odak bizde değilken "çalıyor" iddiası kurulamaz.', t),
    field('user-paused', 'Kullanıcı duraklattı', av ? boolText(s.userPaused) : NA,
      klassFor(av, s.userPaused), 'CarosAudioFocusManager.userPaused',
      'EVET ise odak geri gelse bile OTOMATİK BAŞLATILMAZ (kullanıcı kararı korunur).', t),
    field('focus-paused', 'Odak nedeniyle duraklı', av ? boolText(s.pausedByFocus) : NA,
      klassFor(av, s.pausedByFocus), 'CarosAudioFocusManager.pausedByFocus',
      'Yalnız bu EVET ve kullanıcı duraklatması HAYIR ise odak dönüşünde devam edilir.', t),
    field('route', 'Ses yolu', av ? s.audioRoute : NA,
      av && s.audioRoute !== 'UNKNOWN' ? 'OBSERVED' : 'UNAVAILABLE',
      'AudioManager route okuması',
      'BİLİNMİYOR yolun olmadığı anlamına gelmez — okunamadığı anlamına gelir.', t),
    field('noisy', 'Becoming-noisy alıcısı', av ? boolText(s.noisyReceiverActive) : NA,
      klassFor(av, s.noisyReceiverActive), 'CarosPlaybackService.noisyReceiver',
      'HAYIR ise kulaklık/BT koptuğunda güvenli duraklatma ÇALIŞMAZ.', t),
  ];

  const volume: InspectorField[] = [
    field('duck-native', 'Duck çarpanı (native)', av ? numText(s.duckVolume) : NA,
      klassFor(av, s.duckVolume), 'CarosAudioFocusManager.getDuckVolume',
      '1.0 = kısma yok. En agresif sebep kazanır (nested duck).', t),
    field('duck-reasons-native', 'Duck sebepleri (native)',
      av ? (s.duckReasonsNative.length ? s.duckReasonsNative.join(', ') : 'YOK') : NA,
      klassFor(av, s.duckReasonsNative), 'CarosAudioFocusManager.getActiveDuckReasons',
      'Sebepler token bazlıdır; bayat token sesi yükseltemez.', t),
    field('duck-reasons-gw', 'Duck sebepleri (gateway)',
      s.duckReasonsGateway.length ? s.duckReasonsGateway.join(', ') : 'YOK',
      'OBSERVED', 'duckPolicy.activeReasons',
      'Native ile çelişirse iki otorite ayrışmış demektir — çelişki gizlenmez.', t),
    field('vol-eff-native', 'Etkin ses (native)', av ? numText(s.effectiveVolumeNative) : NA,
      klassFor(av, s.effectiveVolumeNative), 'ExoPlayer.getVolume',
      'kullanıcı sesi × duck çarpanı. Player\'a fiilen yazılan değer.', t),
    field('vol-eff-gw', 'Etkin ses (gateway formülü)', numText(s.effectiveVolumeGateway),
      s.effectiveVolumeGateway === null ? 'UNAVAILABLE' : 'DERIVED',
      'volumePolicy.computeEffectiveVolume',
      'Tek deterministik formülün çıktısı. Native değerden farklıysa yazım kaybı vardır.', t),
    field('vol-user', 'Kullanıcı sesi (native)', av ? numText(s.userVolumeNative) : NA,
      klassFor(av, s.userVolumeNative), 'CarosPlaybackService.userVolume',
      'Duck ÖNCESİ kullanıcı seviyesi — duck bunu değiştirmez.', t),
  ];

  const queue: InspectorField[] = [
    field('q-len', 'Kuyruk uzunluğu', av ? numText(s.queueLength) : NA,
      klassFor(av, s.queueLength), 'ExoPlayer.getMediaItemCount', 'Native timeline gerçeği.', t),
    field('q-index', 'Geçerli indeks', av ? numText(s.currentIndex) : NA,
      klassFor(av, s.currentIndex), 'ExoPlayer.getCurrentMediaItemIndex', '-1 = öğe yok.', t),
    field('q-rev', 'Kuyruk revizyonu', av ? numText(s.queueRevision) : NA,
      klassFor(av, s.queueRevision), 'CarosPlaybackService.queueRevision',
      'Her setQueue/stop artırır — UI ile karşılaştırılıp sapma tespit edilir.', t),
    field('shuffle', 'Karıştır', av ? boolText(s.shuffle) : NA,
      klassFor(av, s.shuffle), 'ExoPlayer.getShuffleModeEnabled', '', t),
    field('repeat', 'Tekrar', av ? s.repeat : NA,
      klassFor(av, s.repeat), 'ExoPlayer.getRepeatMode', '', t),
    field('meta', 'Metadata var', av ? boolText(s.hasTrackMetadata) : NA,
      klassFor(av, s.hasTrackMetadata), 'MediaController.getMediaMetadata',
      'GİZLİLİK: başlık/sanatçı LAB\'a taşınmaz — yalnız VAR/YOK bilgisi.', t),
    field('q-ui', 'UI kuyruğu (rev / uzunluk / indeks)',
      s.uiQueueRevision === null
        ? NA
        : `${numText(s.uiQueueRevision)} / ${numText(s.uiQueueLength)} / ${numText(s.uiQueueIndex)}`,
      s.uiQueueRevision === null ? 'UNAVAILABLE' : 'OBSERVED',
      'carosMediaLayer.getUiQueueView',
      'Kullanıcının gördüğü tam liste. Native timeline bunun bir PENCERESİdir — uzlaştırma bununla DEĞİL, gönderilen pencereyle yapılır.', t),
    field('q-projected', 'Gönderilen pencere (rev / uzunluk / indeks)',
      s.projectedRevision === null
        ? NA
        : `${numText(s.projectedRevision)} / ${numText(s.projectedLength)} / ${numText(s.projectedIndex)}`,
      s.projectedRevision === null ? 'UNAVAILABLE' : 'OBSERVED',
      'mediaAuthorityRuntime.getProjectedQueueView',
      'Native\'e FİİLEN yazılan kuyruk. Uzlaştırmanın gerçek girdisi budur (yanlış "uzunluk sapması" böyle önlenir).', t),
    field('q-drift', 'Kuyruk uzlaştırma', QUEUE_DRIFT_LABEL[s.queueDrift],
      s.queueDrift === 'UNKNOWN' ? 'UNAVAILABLE' : 'DERIVED',
      'queueReconciliation.reconcileQueue',
      `${s.queueDriftReason} Sapmada NATIVE esastır: ses fiilen orada üretilir. Bu paket sapmayı GÖRÜNÜR kılar, otomatik DÜZELTMEZ.`, t),
  ];

  const c = s.evidence.counters;
  const truth: InspectorField[] = [
    field('cmd-total', 'Komut (toplam)', String(c.commandsTotal),
      s.evidence.status === 'OBSERVED' ? 'OBSERVED' : 'UNAVAILABLE',
      'mediaAuthorityEvidence', 'Bu oturumda kapıdan geçen komut sayısı.', t),
    field('cmd-verified', 'Doğrulanmış başarı', String(c.verified),
      'OBSERVED', 'mediaAuthorityEvidence',
      'Hedef durum GÖZLENDİ. "Çalıyor" iddiası yalnız buradan kurulabilir.', t),
    field('cmd-unverified', 'Kabul — doğrulanmamış', String(c.acceptedUnverified),
      'OBSERVED', 'mediaAuthorityEvidence',
      'Komut kabul edildi ama ses kanıtı YOK (uzak kaynak / iframe).', t),
    field('cmd-failed', 'Başarısız', String(c.failed),
      'OBSERVED', 'mediaAuthorityEvidence', '', t),
    field('cmd-timeout', 'Zaman aşımı', String(c.timedOut),
      'OBSERVED', 'mediaAuthorityEvidence', '', t),
    field('cmd-rejected', 'Reddedildi', String(c.rejected),
      'OBSERVED', 'mediaAuthorityEvidence',
      'Yetenek kapısı / çift komut / kaynak yok nedeniyle HİÇ denenmedi.', t),
    field('handover', 'Kaynak devri (top/başarısız)',
      `${c.handoverTotal} / ${c.handoverFailed}`,
      'OBSERVED', 'mediaAuthorityEvidence',
      'Başarısız devirde eski kaynağa rollback denenir; olmazsa güvenli duruş.', t),
    field('dup-backend', 'İHLAL: çift ses kaynağı', String(c.duplicateBackendDetected),
      c.duplicateBackendDetected > 0 ? 'OBSERVED' : 'OBSERVED', 'sourceCoordinator.audibleBackends',
      '0 OLMALI. 0\'dan büyükse aynı anda iki backend ses vermiş demektir.', t),
    field('lat-switch', 'Son kaynak devri süresi',
      s.evidence.sourceSwitchLatencyMs === null ? NA : `${s.evidence.sourceSwitchLatencyMs} ms`,
      s.evidence.sourceSwitchLatencyMs === null ? 'UNAVAILABLE' : 'OBSERVED',
      'mediaAuthorityEvidence', 'HENÜZ ÖLÇÜLMEDİ ise sahte 0 gösterilmez.', t),
    field('lat-play', 'Son çalma başlatma süresi',
      s.evidence.playStartLatencyMs === null ? NA : `${s.evidence.playStartLatencyMs} ms`,
      s.evidence.playStartLatencyMs === null ? 'UNAVAILABLE' : 'OBSERVED',
      'mediaAuthorityEvidence', 'Yalnız DOĞRULANMIŞ başlatmalar ölçülür.', t),
    field('last-failure', 'Son hata',
      s.evidence.lastFailure ? `${s.evidence.lastFailure.command}: ${s.evidence.lastFailure.code}` : NA,
      s.evidence.lastFailure ? 'OBSERVED' : 'UNAVAILABLE', 'mediaAuthorityEvidence', '', t),
  ];

  const recovery: InspectorField[] = [
    field('rec-decision', 'Kurtarma kararı', s.recoveryDecision,
      'DERIVED', 'mediaRecovery.decideRecovery',
      'Kurtarma HER ZAMAN duraklatılmış yüklenir — otomatik çalma YOKTUR.', t),
    field('rec-items', 'Kurtarılabilir öğe', numText(s.recoveryItemCount),
      s.recoveryItemCount === null ? 'UNAVAILABLE' : 'OBSERVED', 'mediaRecovery',
      'Kayıt sınırlıdır (en fazla 60 öğe) — büyük blob diske yazılmaz.', t),
    field('rec-count', 'Kurtarma sayısı (native)', av ? numText(s.recoveryCountNative) : NA,
      klassFor(av, s.recoveryCountNative), 'CarosPlaybackService.recoveryCount', '', t),
    field('rec-js', 'Kurtarma denemesi / tamamlanan (JS)',
      `${s.evidence.counters.recoveryCount} / ${s.evidence.counters.recoverySucceeded}`,
      s.evidence.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OBSERVED',
      'mediaAuthorityEvidence.recoveryCount / recoverySucceeded',
      'DENEME artıp TAMAMLANAN artmıyorsa kurtarma her açılışta yarıda kalıyordur: '
      + 'kalıcı kayıttaki deneme sayacı sıfırlanmaz ve 3 denemeden sonra kurtarma '
      + 'KALICI olarak kapanır (attempts_exhausted).', t),
  ];

  /* ── PAKET B · Kuyruk kurtarma ─────────────────────────────────────────── */
  const queueRecovery: InspectorField[] = [
    field('qr-outcome', 'Son kurtarma sonucu', s.recoveryOutcome,
      s.recoveryAtMs === null ? 'UNAVAILABLE' : 'OBSERVED', 'queueRecoveryRuntime',
      'recovered · no_action · deferred · rejected · failed. HENÜZ ÇALIŞMADI ise sapma hiç oluşmamıştır.', t),
    field('qr-action', 'Uygulanan eylem', s.recoveryAction || NA,
      s.recoveryAction ? 'OBSERVED' : 'UNAVAILABLE', 'queueRecovery.decideQueueRecovery',
      'Kurtarma ASLA oynatıcıya komut göndermez — yalnız UI projeksiyonunu hizalar.', t),
    field('qr-code', 'Karar kodu', s.recoveryCode || NA,
      s.recoveryCode ? 'OBSERVED' : 'UNAVAILABLE', 'queueRecovery',
      s.recoveryReason || 'Henüz karar üretilmedi.', t),
    field('qr-breaker', 'Devre kesici (açık imza)', String(s.recoveryBreakersOpen),
      'OBSERVED', 'queueRecovery.recordAttempt',
      '0\'dan büyükse tekrarlayan başarısızlık sonrası kurtarma DURDURULMUŞTUR (sonsuz döngü koruması).', t),
    field('qr-ledger', 'Sapma defteri (imza)', String(s.recoveryLedgerSize),
      'OBSERVED', 'queueRecovery.RecoveryLedger', 'Bounded: en fazla 8 imza tutulur.', t),
    field('qr-gate-user', 'Kullanıcı komutu uçuyor', boolText(s.userCommandInFlight),
      'OBSERVED', 'mediaCommandGateway.isUserCommandInFlight',
      'EVET ise kurtarma ERTELENİR — kullanıcı komutu her zaman önceliklidir.', t),
    field('qr-gate-handover', 'Kaynak devri sürüyor', boolText(s.handoverInFlight),
      'OBSERVED', 'mediaCommandGateway.isHandoverInFlight',
      'EVET ise kurtarma BAŞLAMAZ (yarım devir üstüne yazılmaz).', t),
    field('qr-generation', 'Otorite generation', numText(s.authorityGeneration),
      s.authorityGeneration === null ? 'UNAVAILABLE' : 'OBSERVED',
      'mediaCommandGateway.getAuthorityGeneration',
      'Karar ile uygulama arasında değişirse kurtarma BAYAT sayılır ve atılır.', t),
  ];

  /* ── PAKET B · Olay izi ────────────────────────────────────────────────── */
  const events: InspectorField[] = [
    field('ev-total', 'Toplam olay', String(s.eventTotal),
      'OBSERVED', 'mediaAuthorityEvents',
      'Servis/odak/komut/devir/kurtarma olaylarının sıralı izi (monotonic saat).', t),
    field('ev-dropped', 'Düşen olay', String(s.eventDropped),
      'OBSERVED', 'mediaAuthorityEvents',
      'Tampon dolduğu için düşen kayıt. 0\'dan büyükse "hiç olmadı" ile karıştırılmamalıdır.', t),
    field('ev-capacity', 'Tampon kapasitesi', String(s.eventCapacity),
      'OBSERVED', 'mediaAuthorityEvents', 'Sabit boyutlu halka — sınırsız büyüme YOK.', t),
    field('ev-last', 'Son olay',
      s.recentEvents.length > 0
        ? `${s.recentEvents[s.recentEvents.length - 1].type}${
          s.recentEvents[s.recentEvents.length - 1].detail
            ? ` · ${s.recentEvents[s.recentEvents.length - 1].detail}` : ''}`
        : NA,
      s.recentEvents.length > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'mediaAuthorityEvents',
      'Olay adları sabit kümedir; başlık/sanatçı/URL bu ize GİREMEZ.', t),
  ];

  /* ── PAKET B · Cihaz doğrulama ─────────────────────────────────────────── */
  const v = s.validationSummary;
  const validation: InspectorField[] = [
    field('dv-coverage', 'Kapsam (koşulan / toplam senaryo)',
      `${v.coveredScenarios} / ${v.totalScenarios}`,
      v.coveredScenarios > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'deviceValidationStore',
      'Koşulmayan senaryo KOŞULMADI sayılır — sahte yeşil ÜRETİLMEZ.', t),
    field('dv-pass', 'GEÇTİ', String(v.pass), 'OBSERVED', 'deviceValidationModel.summarize',
      'Yalnız cihazda ölçüm kaydedilen ve KANIT toplanan senaryolar.', t),
    field('dv-fail', 'DÜŞTÜ', String(v.fail), 'OBSERVED', 'deviceValidationModel.summarize', '', t),
    field('dv-blocked', 'ENGELLENDİ', String(v.blocked), 'OBSERVED',
      'deviceValidationModel.summarize',
      'Kanıtsız veya gözlemsiz "geçti" bildirimi buraya DÜŞÜRÜLÜR.', t),
    field('dv-notrun', 'KOŞULMADI', String(v.notRun), 'OBSERVED',
      'deviceValidationModel.summarize',
      'Cihazda hiç denenmemiş senaryolar. Bu sayı 0 olmadan saha doğrulaması tamamlanmış SAYILMAZ.', t),
    field('dv-active', 'Açık oturum',
      s.validationActiveScenario ? `${s.validationActiveState} · ${s.validationActiveScenario}` : 'YOK',
      s.validationActiveScenario ? 'OBSERVED' : 'UNAVAILABLE', 'deviceValidationStore',
      'Aynı anda tek oturum koşar (ölçüm karışması engellenir).', t),
    field('dv-sessions', 'Kayıtlı oturum', String(v.total), 'OBSERVED',
      'deviceValidationStore', 'Bounded ve versiyonlu kayıt (en fazla 40).', t),
  ];

  return [
    { id: 'authority', title: '1 · Otorite / Kaynak', fields: authority },
    { id: 'playback', title: '2 · Oynatma Gerçeği', fields: playback },
    { id: 'focus', title: '3 · Ses Odağı / Yol', fields: focus },
    { id: 'volume', title: '4 · Ses / Ducking', fields: volume },
    { id: 'queue', title: '5 · Kuyruk', fields: queue },
    { id: 'truth', title: '6 · Komut Kanıtı', fields: truth },
    { id: 'recovery', title: '7 · Süreç Kurtarma', fields: recovery },
    { id: 'queue-recovery', title: '8 · Kuyruk Kurtarma', fields: queueRecovery },
    { id: 'events', title: '9 · Olay İzi', fields: events },
    { id: 'device-validation', title: '10 · Cihaz Doğrulama', fields: validation },
  ];
}

/** Fail-closed hüküm: kanıt yoksa "sağlıklı" DENMEZ. */
export function deriveMediaAuthorityVerdict(s: MediaAuthorityRawSnapshot): {
  status: MediaAuthorityVerdict;
  reasons: readonly string[];
} {
  const reasons: string[] = [];

  if (s.evidence.counters.duplicateBackendDetected > 0) {
    reasons.push('Aynı anda birden fazla ses kaynağı gözlendi — tek-otorite sözleşmesi ihlal edildi.');
    return { status: 'DUPLICATE_BACKEND', reasons };
  }
  if (!s.isNativePlatform) {
    reasons.push('Web modunda native playback authority yoktur.');
    return { status: 'UNAVAILABLE', reasons };
  }
  if (!s.authorityAvailable) {
    reasons.push('CarosPlaybackService erişilemiyor — durum BİLİNMİYOR (duraklatıldı varsayılmaz).');
    return { status: 'UNAVAILABLE', reasons };
  }
  if (s.renderingVerified) {
    reasons.push('ExoPlayer render ediyor, ses odağı bizde ve etkin ses sıfırdan büyük.');
    return { status: 'RENDERING', reasons };
  }
  if (s.playing) {
    reasons.push('Oynatıcı "çalıyor" diyor ama ses kanıtı (odak/seviye) tamamlanmadı.');
    if (s.hasAudioFocus === false) reasons.push('Ses odağı BİZDE DEĞİL.');
    if (s.effectiveVolumeNative === 0) reasons.push('Etkin ses 0 — duck veya sessize alma etkin.');
    return { status: 'REQUESTED_ONLY', reasons };
  }
  if (s.userPaused === true) {
    reasons.push('Kullanıcı duraklattı — odak geri gelse bile otomatik başlatılmaz.');
    return { status: 'PAUSED_BY_USER', reasons };
  }
  if (s.pausedByFocus === true) {
    reasons.push(`Ses odağı kaybı nedeniyle duraklatıldı (${s.lastPauseReason || 'neden bilinmiyor'}).`);
    return { status: 'PAUSED_BY_FOCUS', reasons };
  }
  reasons.push('Kuyruk boş veya oynatma başlatılmadı.');
  return { status: 'IDLE', reasons };
}

/** Gözlem sınıfı sayacı — başlıktaki özet için. */
export function countByMediaAuthorityClass(
  cards: readonly MediaAuthorityCard[],
): Record<Observability, number> {
  const out: Record<Observability, number> = {
    OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0,
  };
  cards.forEach((c) => c.fields.forEach((f) => { out[f.klass] += 1; }));
  return out;
}

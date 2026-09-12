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
    field('video-speed', 'Araç hızı (km/h)',
      s.vehicleSpeedKmh === null ? 'ÖLÇÜLEMİYOR' : numText(s.vehicleSpeedKmh),
      s.vehicleSpeedKmh === null ? 'UNAVAILABLE' : 'OBSERVED', 'UnifiedVehicleStore.speed',
      'videoSafetyPolicy sınıflandırmasının girdisi. Sahte 0 YOK — ölçüm yoksa ÖLÇÜLEMİYOR.', t),
    field('video-gate', 'Video hız sınıflandırması (F7.2, ADVISORY)', s.videoVisibility,
      'DERIVED', 'videoSafetyPolicy.decideVideoVisibility',
      'SAHA BUGFIX (2026-09-03): bu yalnız gözlem etiketidir — video render/açma kararını ARTIK GATE\'LEMEZ, SESİ hiçbir zaman etkilemez.', t),
    field('duck-req', 'Duck isteği (istendi / bırakıldı)',
      `${numText(s.duckRequested)} / ${numText(s.duckReleased)}`,
      'OBSERVED', 'duckRequest.getDuckRequestCounters',
      'Fark kalıcı olarak büyüyorsa duck AÇIK kalmıştır (TTS/dinleme sızıntısı).', t),
    field('duck-req-failed', 'Duck isteği düşen', numText(s.duckFailed),
      'OBSERVED', 'duckRequest.getDuckRequestCounters',
      'Kapı yüklenemedi veya komut hata verdi — ducking O ANDA UYGULANMADI.', t),
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

  /* ── F2 · Yerel kütüphane ────────────────────────────────────────────
   * MusicIndex kütüphane truth'udur; BURASI onu yalnız OKUR. LAB ikinci
   * otorite değildir: burada hesaplanan hiçbir sayı üretim kararına geri beslenmez. */
  const libraryReady = s.libraryAvailability === 'READY';
  const library: InspectorField[] = [
    field('lib-availability', 'Kütüphane durumu', s.libraryAvailability,
      libraryReady ? 'OBSERVED' : 'UNAVAILABLE', 'musicIndex.getMusicLibrarySnapshot',
      'UNAVAILABLE = henüz başarılı tarama YOK. Boş kütüphane ile taranmamış kütüphane AYNI ŞEY DEĞİLDİR.', t),
    field('lib-revision', 'Kütüphane revizyonu', numText(s.libraryRevision),
      klassFor(libraryReady, s.libraryRevision), 'MusicIndex.revision',
      'Yalnız gerçek bir uzlaştırma sonrası artar. UNCHANGED turunda DEĞİŞMEZ.', t),
    field('lib-counts', 'Parça / albüm / sanatçı / klasör',
      libraryReady
        ? `${numText(s.libraryTrackCount)} / ${numText(s.libraryAlbumCount)} / ${numText(s.libraryArtistCount)} / ${numText(s.libraryFolderCount)}`
        : NA,
      klassFor(libraryReady, s.libraryTrackCount), 'MusicIndex projeksiyonları',
      'Yalnız ADET. Başlık, sanatçı, albüm ve dosya yolu bu ekrana GELMEZ.', t),
    field('lib-stale', 'Erişilemeyen (STALE) parça', numText(s.libraryStaleCount),
      klassFor(libraryReady, s.libraryStaleCount), 'MusicTrack.availability',
      'Volume ayrıldı veya izin kalktı. STALE = "şu an okunamıyor"; "silindi" DEĞİL ve bir OYNATMA durumu da DEĞİL.', t),
    field('lib-volumes', 'Kalıcı volume kaydı',
      s.libraryVolumes.length
        ? s.libraryVolumes.map((v) => `${v.name}[${v.available ? 'BAĞLI' : 'YOK'}${v.hasGeneration ? '·gen' : ''}${v.hasVersion ? '·ver' : ''}]`).join(' ')
        : NA,
      s.libraryVolumes.length ? 'OBSERVED' : 'UNAVAILABLE', 'mediaStoreRefreshState',
      'Yalnız volume kimlik token\'ı taşınır; mount yolu ve kullanıcı içeriği TAŞINMAZ.', t),
    field('lib-schema', 'Kalıcı durum şeması / izin',
      s.refreshPersistedSchema === null ? NA
        : `v${s.refreshPersistedSchema} · izin ${boolText(s.refreshPermissionPersisted)}`,
      klassFor(s.refreshPersistedSchema !== null, s.refreshPersistedSchema), 'mediaStoreRefreshState.parse',
      'Bozuk veya yabancı şema BÜTÜN olarak atılır → bir sonraki tur FULL_RECONCILE olur.', t),
    field('lib-decision', 'Son tarama kararı',
      s.refreshDecision ? `${s.refreshDecision} · ${s.refreshStatus}` : 'HENÜZ ÇALIŞMADI',
      s.refreshDecision ? 'OBSERVED' : 'UNAVAILABLE', 'mediaStoreRefreshExecutor',
      'UNCHANGED = sağlayıcıya HİÇ parça sorgusu gitmedi. FAILED = kalıcı generation İLERLEMEDİ.', t),
    field('lib-reason', 'Karar gerekçesi', s.refreshReason || NA,
      s.refreshReason ? 'DERIVED' : 'UNAVAILABLE', 'planMediaStoreRefresh + storageVolumeLifecycle',
      'Karar kanonik politikadan gelir; bu ekran onu yeniden hesaplamaz.', t),
    field('lib-queries', 'Bu turdaki parça sorgusu / alınan satır',
      s.refreshTrackQueries === null ? NA : `${numText(s.refreshTrackQueries)} / ${numText(s.refreshTracksReceived)}`,
      klassFor(s.refreshTrackQueries !== null, s.refreshTrackQueries), 'RefreshOutcome',
      'UNCHANGED turunda 0 OLMALIDIR; sıfırdan farklıysa politika kaçağı vardır.', t),
    field('lib-permission', 'İzin geçişi / generation desteği',
      s.refreshPermissionTransition
        ? `${s.refreshPermissionTransition} · gen ${boolText(s.refreshSupportsGeneration)}`
        : NA,
      s.refreshPermissionTransition ? 'OBSERVED' : 'UNAVAILABLE', 'storageVolumeLifecycle',
      'RESTORED → FULL_RECONCILE zorunludur. generation desteği YOKSA delta hiç denenmez (API < 30).', t),
    field('lib-volume-effects', 'STALE / budanan volume',
      `${s.refreshStaleVolumes.length ? s.refreshStaleVolumes.join(',') : NA} / ${s.refreshPrunedVolumes.length ? s.refreshPrunedVolumes.join(',') : NA}`,
      s.refreshStaleVolumes.length || s.refreshPrunedVolumes.length ? 'OBSERVED' : 'UNAVAILABLE', 'RefreshOutcome',
      'Budama YALNIZ sağlayıcı tam kimlik kümesini verdiğinde yapılır; silme ASLA tahmin edilmez.', t),
    field('lib-persist', 'Durum yazıldı / son başarı',
      `${boolText(s.refreshStatePersisted)} · ${s.refreshLastSuccessAtMs ? String(s.refreshLastSuccessAtMs) : NA}`,
      klassFor(s.refreshStatePersisted !== null, s.refreshStatePersisted), 'saveRefreshState',
      'Kalıcılık hatası fail-soft: bir fazladan FULL_RECONCILE maliyeti, doğruluk kaybı DEĞİL.', t),
    field('lib-counters', 'Tur sayaçları',
      `tur ${s.refreshCounters.rounds} · uygulandı ${s.refreshCounters.applied} · atlandı ${s.refreshCounters.skipped} · düştü ${s.refreshCounters.failed} · sorgu ${s.refreshCounters.trackQueries}`,
      'OBSERVED', 'mediaStoreRefreshExecutor sayaçları',
      'Sınırlı sayaçlar; hiçbir kullanıcı içeriği taşımaz.', t),
    field('lib-perf', 'Index p50/p95 · arama p50/p95',
      `${numText(s.indexP50Ms, ' ms')} / ${numText(s.indexP95Ms, ' ms')} · ${numText(s.searchP50Ms, ' ms')} / ${numText(s.searchP95Ms, ' ms')}`,
      klassFor(s.indexP50Ms !== null, s.indexP50Ms), 'musicIndexPerf',
      'Salt gözlem: bu ölçüm hiçbir cadence veya bütçe kararını DEĞİŞTİRMEZ.', t),
    field('lib-inflight', 'Tarama sürüyor', boolText(s.refreshInFlight),
      'OBSERVED', 'mediaStoreRefreshExecutor.inFlight',
      'Tek-uçuş: çakışan çağrılar aynı turu paylaşır, çift tarama olmaz.', t),
    field('lib-failure', 'Son hata kodu', s.refreshFailureCode || NA,
      s.refreshFailureCode ? 'OBSERVED' : 'UNAVAILABLE', 'RefreshOutcome.failureCode',
      'Hata varsa kütüphane ESKİ hâliyle kalır; boş liste gösterilmez.', t),
  ];

  /* ── F2 · Kapak önbelleği ─────────────────────────────────────────────── */
  const artwork: InspectorField[] = [
    field('art-tier', 'Native dosya katmanı', boolText(s.artworkNativeFileTier),
      klassFor(s.artworkNativeFileTier !== null, s.artworkNativeFileTier), 'artworkCache.nativeFileTier',
      'HAYIR = örneklenmiş decode yolu yok; base64 yalnız UYUMLULUK yedeğidir.', t),
    field('art-memory', 'Bellek girdisi / bayt',
      `${numText(s.artworkMemoryEntries)} / ${numText(s.artworkMemoryBytes)} (üst sınır ${numText(s.artworkMemoryMaxBytes)})`,
      klassFor(s.artworkMemoryEntries !== null, s.artworkMemoryEntries), 'artworkCache.snapshot',
      'Ana yolda bellekte URL referansı tutulur, görsel BAYTLARI değil.', t),
    field('art-disk', 'Disk girdisi / bayt',
      `${numText(s.artworkDiskEntries)} / ${numText(s.artworkDiskBytes)} (üst sınır ${numText(s.artworkDiskMaxBytes)})`,
      klassFor(s.artworkDiskEntries !== null, s.artworkDiskEntries), 'artworkDiskCache.snapshot',
      'Sınırlı kalıcı LRU. Üst sınır aşılırsa en eski girdi ATILIR ve dosyası SİLİNİR.', t),
    field('art-schema', 'Disk şeması / hidratasyon',
      s.artworkDiskSchema === null ? NA : `v${s.artworkDiskSchema} · ${boolText(s.artworkDiskHydrated)}`,
      klassFor(s.artworkDiskSchema !== null, s.artworkDiskSchema), 'artworkDiskCache',
      'Yabancı şema veya bozuk indeks BÜTÜN olarak atılır; yarısına güvenilmez.', t),
    field('art-inflight', 'Süren decode', numText(s.artworkInFlight),
      klassFor(s.artworkInFlight !== null, s.artworkInFlight), 'artworkCache.inFlight',
      'Aynı kapağı isteyen eşzamanlı satırlar TEK decode altında birleştirilir.', t),
    field('art-remote', 'Uzak kapak geçişi (F7.4)', numText(s.artworkRemoteResolved),
      klassFor(s.artworkRemoteResolved !== null, s.artworkRemoteResolved),
      'artworkCache.remoteResolved',
      'Sağlayıcı küçük resmi (http/https) doğrudan GEÇİRİLİR — decode edilmez, '
      + 'diske YAZILMAZ. Tazeleme WebView HTTP önbelleğinindir.', t),
  ];

  /* ── F3.2 · Dinleme bağlamı + gözlenen kuyruk kanıtı ──────────────────
   * LAB İKİNCİ OTORİTE DEĞİLDİR: hüküm ve sınıflandırma kanonik sahiplerden
   * (`observedQueueEvidence` · `sessionProjection` · `sessionTelemetry`)
   * OKUNUR; burada yeniden hesaplanmaz ve üretim kararına geri BESLENMEZ. */
  const f3 = s.f3;
  const c3 = f3.counters;
  const obs = f3.lastObserved;
  const listeningKlass: Observability = s.listeningHasSession ? 'OBSERVED' : 'UNAVAILABLE';

  const session3: InspectorField[] = [
    field('f3-status', 'F3 kanıt durumu', f3.status,
      f3.status === 'OBSERVED' ? 'OBSERVED' : 'UNAVAILABLE', 'sessionTelemetry',
      'UNAVAILABLE = hiç kanıt yayını olmadı. Bu bir sağlık hükmü DEĞİL, veri yokluğudur.', t),
    field('f3-session', 'Dinleme bağlamı var', boolText(s.listeningHasSession),
      'OBSERVED', 'listeningSession',
      'Bağlam kullanıcının NİYETİDİR; çalma hükmü 2. kartta verilir.', t),
    field('f3-intent', 'Niyet', s.listeningIntent || NA, listeningKlass, 'ListeningSession.intent',
      'EXTERNAL_UNKNOWN gözlenemeyen kaynakta MEŞRU ve dürüst cevaptır; niyet UYDURULMAZ.', t),
    field('f3-source', 'Başlangıç → şu anki kaynak',
      s.listeningHasSession ? `${s.listeningOriginSource ?? NA} → ${s.listeningCurrentSource ?? NA}` : NA,
      listeningKlass, 'ListeningSession.originSource/currentSource',
      'currentSource YALNIZ doğrulanmış devir commit kapısından yazılır.', t),
    field('f3-restored', 'Kayıttan geri yüklendi', boolText(s.listeningRestored),
      klassFor(s.listeningRestored !== null, s.listeningRestored), 'ListeningSession.restored',
      'Kalıcı kayıt CANLI gözlem DEĞİLDİR; geri yükleme ASLA oynatma iddiası üretmez.', t),
    field('f3-continuity', 'Süreklilik', s.listeningContinuity,
      listeningKlass, 'sessionContinuity',
      'BROKEN = kanıtlı eşleşme yok. CarOS bu durumda benzer bir parça BAŞLATMAZ.', t),
    field('f3-queuepos', 'Kuyruk konumu',
      s.listeningQueueIndex === null ? NA : `${s.listeningQueueIndex} / ${numText(s.listeningQueueLength)}`,
      klassFor(s.listeningQueueIndex !== null, s.listeningQueueIndex), 'PlayQueue (desired)',
      'İSTENEN sıradaki konum; sağlayıcıda uygulandığı ayrıca hizalamayla ölçülür.', t),
    /* ── MUSIC F7.6 · Kuyruk SAHİPLİĞİ ────────────────────────────────── */
    field('f76-owner', 'İstenen kuyruk sahibi · kaynak',
      `PlayQueue · ${s.desiredQueueSource}`,
      s.desiredQueueLength > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'playQueue.getDesiredQueue',
      'Sağlayıcı sırası da artık BURADADIR; medya katmanının kendi kuyruğu YOKTUR.', t),
    field('f76-shape', 'İstenen kuyruk (uzunluk · indeks · köken)',
      `${numText(s.desiredQueueLength)} · ${numText(s.desiredQueueIndex)} · ${s.desiredQueueOrigins}`,
      s.desiredQueueLength > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'playQueue entries',
      'K = kütüphane · S = sağlayıcı · R = kurtarma. Öğe KİMLİKLERİ bu ekrana GELMEZ.', t),
    field('f76-excluded', 'Sağlayıcı sınırı · kuyruk dışı satır',
      numText(s.providerQueueExcluded), 'OBSERVED',
      'providerQueueContext.excludedIds',
      'Karışık arama sonucunda BAŞKA sağlayıcıya ait satırlar kuyruğa ALINMAZ; '
      + 'bu sessizce yapılmaz, burada sayılır.', t),
    field('f76-projection', 'Katman sunum önbelleği (kuyruk DEĞİL)',
      numText(s.layerProjectionSize), 'OBSERVED', 'carosMediaLayer projeksiyonu',
      'Sıra/imleç TAŞIMAZ. Kanonik uzunluktan sapması önbelleğin bayatladığını '
      + 'veya bazı satırların UI tanımının çözülemediğini gösterir.', t),
  ];

  const observed3: InspectorField[] = [
    field('f3-obs-availability', 'Gözlenen kuyruk kanıtı',
      obs ? obs.availability : 'YAYIN YOK',
      obs && obs.availability === 'AVAILABLE' ? 'OBSERVED' : 'UNAVAILABLE',
      'observedQueueEvidence',
      'UNAVAILABLE = sağlayıcı timeline BİLDİRMİYOR. Boş kuyruk ile AYNI ŞEY DEĞİLDİR.', t),
    field('f3-obs-reason', 'Kanıt yoksa gerekçe', obs?.unavailableReason ?? NA,
      obs?.unavailableReason ? 'OBSERVED' : 'UNAVAILABLE', 'observedQueueDerivation',
      'source_reports_no_timeline = sağlayıcı çok öğeli kuyruk semantiğini hiç desteklemiyor.', t),
    field('f3-obs-provenance', 'Kanıt kökeni', obs ? obs.provenance : NA,
      klassFor(obs !== null, obs), 'ObservedQueueEvidence.provenance',
      'NATIVE_MEDIA3 = Media3 timeline. DesiredQueue\'dan gözlem TÜRETİLMEZ.', t),
    field('f3-obs-completeness', 'Bütünlük', obs ? obs.completeness : NA,
      klassFor(obs !== null, obs), 'ObservedQueueEvidence.completeness',
      'PREFIX = native\'e pencere yazıldı; kısaltılmış liste FULL diye SUNULMAZ.', t),
    field('f3-obs-shape', 'Öğe adedi / revizyon / indeks var',
      obs ? `${obs.entryCount} · rev ${obs.revision === null ? NA : obs.revision} · ${boolText(obs.hasCurrentIndex)}` : NA,
      klassFor(obs !== null, obs), 'ObservedQueueEvidence',
      'Yalnız ADET ve revizyon taşınır; öğe KİMLİKLERİ bu ekrana GELMEZ.', t),
    field('f3-obs-age', 'Kanıt yaşı / canlılık',
      s.observedAgeMs === null ? NA
        : `${s.observedAgeMs} ms (üst sınır ${s.observedMaxAgeMs} ms) · ${s.observedLive ? 'CANLI' : 'BAYAT'}`,
      s.observedLive ? 'OBSERVED' : s.observedAgeMs === null ? 'UNAVAILABLE' : 'STALE',
      'observedQueueEvidence.OBSERVED_QUEUE_MAX_AGE_MS',
      'Bayat kanıt CANLI gözlem sayılmaz; hizalama BİLİNMİYOR\'a düşer.', t),
    field('f3-obs-counters', 'Yayın / canlı / yok / red / bayat okuma',
      `${c3.observedPublished} · ${c3.observedAvailable} · ${c3.observedUnavailable} · ${c3.observedRejected} · ${c3.observedStaleReads}`,
      c3.observedPublished > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'sessionTelemetry sayaclari',
      'Red > 0 ise native yük BOZUK geliyordur (sınır aşımı / geçersiz zaman).', t),
    field('f3-align', 'Hizalama (istenen ↔ gözlenen)',
      `${s.listeningAlignment}${f3.lastAlignment && f3.lastAlignment !== s.listeningAlignment ? ` (son: ${f3.lastAlignment})` : ''}`,
      listeningKlass, 'queueReconciliation.alignDesiredObserved',
      s.listeningAlignmentReason
        || 'PROVIDER_DRIFT / UNSUPPORTED kullanıcıya yanlış sıra gösterme riskidir.', t),
    field('f3-align-applied', 'İstenen sıra uygulandı sayılır', boolText(s.listeningDesiredApplied),
      klassFor(s.listeningDesiredApplied !== null, s.listeningDesiredApplied),
      'QueueAlignmentResult.desiredApplied',
      'HAYIR ise UI sıralamanız uygulandı İDDİA EDEMEZ.', t),
    field('f3-align-counters', 'Birebir / önek / sapma / desteksiz / bilinmiyor',
      `${c3.alignMatched} · ${c3.alignPrefix} · ${c3.alignDrift} · ${c3.alignUnsupported} · ${c3.alignUnknown}`,
      'OBSERVED', 'sessionTelemetry sayaclari', 'Sınırlı sayaclar; kullanıcı içeriği taşımaz.', t),
    field('f3-item-agreement', 'Geçerli öğe mutabakatı', s.listeningItemAgreement,
      listeningKlass, 'sessionProjection.currentItemAgreement',
      'DISAGREE = native başka parçada. Kullanıcının DUYDUĞU native olandır.', t),
  ];

  const handover3: InspectorField[] = [
    field('f3-ho-counters', 'Devir: istendi / doğrulandı / doğrulanmadı / düştü / geri alındı',
      `${c3.handoverRequested} · ${c3.handoverVerified} · ${c3.handoverUnverified} · ${c3.handoverFailed} · ${c3.handoverRollback}`,
      c3.handoverRequested > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'sessionTelemetry sayaclari',
      'YALNIZ doğrulanmış devir oturuma yazılabilir; kabul edilmiş komut YETMEZ.', t),
    field('f3-commit', 'Oturum commit / bayat / yinelenen / reddedilen',
      `${c3.sessionCommitted} · ${c3.commitStaleDropped} · ${c3.commitDuplicateDropped} · ${c3.commitRejected}`,
      c3.sessionCommitted > 0 || c3.commitRejected > 0 || c3.commitStaleDropped > 0
        ? 'OBSERVED' : 'UNAVAILABLE',
      'listeningSessionRuntime.commitCarriedSourceAfterHandover',
      'Yinelenen doğrulanmış sonuç IDEMPOTENT düşer; bayat sonuç ASLA yazılmaz.', t),
    field('f3-commit-at', 'Son commit anı', f3.lastCommitAtMs === null ? NA : String(f3.lastCommitAtMs),
      klassFor(f3.lastCommitAtMs !== null, f3.lastCommitAtMs), 'sessionTelemetry',
      'Ölçülmemiş alan boş kalır — sahte tarih ÜRETİLMEZ.', t),
    field('f3-drop-reason', 'Son düşme gerekçesi', f3.lastDropReason ?? NA,
      f3.lastDropReason ? 'OBSERVED' : 'UNAVAILABLE', 'sessionTelemetry.noteCommitDropped',
      'Hangi kapıda düştüğü TEŞHİStir; gizlenmez.', t),
    field('f3-fidelity', 'Kimlik kanıt derecesi (en zayıf halka)', f3.lastIdentityFidelity ?? NA,
      f3.lastIdentityFidelity ? 'DERIVED' : 'UNAVAILABLE', 'mediaIdentityMatching',
      'Otomatik taşıma YALNIZ EXACT/STRONG ile yapılır; WEAK/UNKNOWN taşınmaz.', t),
    field('f3-fulfillment', 'Sağlayıcı karşılama', f3.lastFulfillment ?? NA,
      f3.lastFulfillment ? 'OBSERVED' : 'UNAVAILABLE', 'providerFulfillment',
      'UNAVAILABLE = yeni kaynak hiç aday sunamadı.', t),
    field('f3-continuity-counters', 'Süreklilik: taşındı / kısmi / koptu / bilinmiyor',
      `${c3.continuityCarried} · ${c3.continuityDegraded} · ${c3.continuityBroken} · ${c3.continuityUnknown}`,
      'OBSERVED', 'sessionTelemetry sayaclari',
      'Kısmi taşıma DEGRADED\'dır; tam taşıma gibi sunulmaz.', t),
    field('f4-queue-commands', 'Kuyruk komutu: uygulandı / reddedildi',
      `${c3.queueCommandApplied} · ${c3.queueCommandRejected}`,
      c3.queueCommandApplied > 0 || c3.queueCommandRejected > 0 ? 'OBSERVED' : 'UNAVAILABLE',
      'listeningSessionRuntime kuyruk komut kapısı',
      'Yetenek yokluğu nedeniyle reddedilen komut da sayılır — sessizce yutulan istek teşhis edilemez.', t),
    field('f3-ho-recent', 'Son devirler',
      f3.recentHandovers.length
        ? f3.recentHandovers.slice(-5).map(
          (h) => `${h.target}:${h.outcome}${h.committed ? '+commit' : ''}${h.failureCode ? `(${h.failureCode})` : ''}`,
        ).join(' ')
        : NA,
      f3.recentHandovers.length ? 'OBSERVED' : 'UNAVAILABLE', 'sessionTelemetry halkası',
      `Bounded: en fazla ${f3.handoverCapacity} kayıt. Parça/başlık/URI TAŞINMAZ.`, t),
  ];

  /* ── F5 · Birleşik arama ──────────────────────────────────────────────
   * LAB arama TETİKLEMEZ ve sıralamayı yeniden hesaplamaz; son turun kanıtını
   * OKUR. Sorgu metni bu ekrana GELMEZ (yalnız uzunluk). */
  const se = s.search;
  const sc = se.counters;
  const searchObserved: Observability = se.status === 'OBSERVED' ? 'OBSERVED' : 'UNAVAILABLE';
  const search: InspectorField[] = [
    field('f5-status', 'Arama kanıt durumu', se.status, searchObserved, 'searchTelemetry',
      'UNAVAILABLE = bu oturumda hiç arama yapılmadı. Sağlık hükmü DEĞİL, veri yokluğu.', t),
    field('f5-generation', 'Sorgu kuşağı', String(se.lastGeneration),
      searchObserved, 'musicSearchCoordinator.generation',
      'Her arama kuşağı ilerletir; eski kuşağın geç sonucu yeni durumu EZEMEZ.', t),
    field('f5-state', 'Son arama durumu', se.lastState ?? NA,
      se.lastState ? 'OBSERVED' : 'UNAVAILABLE', 'SearchSnapshot.state',
      'COMPLETE yalnız TÜM uygun kaynaklar bitince verilir; DEGRADED = en az bir kaynak düştü.', t),
    field('f5-query-shape', 'Sorgu uzunluğu / sonuç adedi',
      se.lastQueryLength === null ? NA : `${se.lastQueryLength} karakter · ${numText(se.lastFinalCount)} sonuç`,
      klassFor(se.lastQueryLength !== null, se.lastQueryLength), 'searchTelemetry',
      'GİZLİLİK: sorgu METNİ taşınmaz — yalnız uzunluğu.', t),
    field('f5-eligible', 'Uygun kaynaklar',
      se.lastEligibleSources.length ? se.lastEligibleSources.join(' · ') : NA,
      se.lastEligibleSources.length ? 'OBSERVED' : 'UNAVAILABLE', 'decideEligibility',
      'Yalnız supportsSearch=true VE gözlenen şekilde kullanılabilir kaynaklara sorgu gider.', t),
    field('f5-skips', 'Atlanan: desteklemiyor / kullanılamıyor',
      `${sc.providerUnsupportedSkips} · ${sc.providerUnavailableSkips}`,
      searchObserved, 'searchTelemetry sayaçları',
      'İki AYRI teşhis: kaynak arama semantiğini hiç desteklemiyor mu, yoksa şu an mı erişilemiyor.', t),
    field('f5-source-runs', 'Son kaynak turları',
      se.recentSourceRuns.length
        ? se.recentSourceRuns.slice(-6).map(
          (r) => `${r.providerId}:${r.outcome}(${r.resultCount}${r.elapsedMs === null ? '' : `,${Math.round(r.elapsedMs)}ms`})`,
        ).join(' ')
        : NA,
      se.recentSourceRuns.length ? 'OBSERVED' : 'UNAVAILABLE', 'searchTelemetry halkası',
      `Bounded: en fazla ${se.sourceRunCapacity} kayıt. Parça başlığı/URI TAŞINMAZ.`, t),
    field('f5-latency', 'Yerel p50/p95 · sağlayıcı p50/p95',
      `${numText(se.localSearchP50Ms, ' ms')} / ${numText(se.localSearchP95Ms, ' ms')} · ${numText(se.providerSearchP50Ms, ' ms')} / ${numText(se.providerSearchP95Ms, ' ms')}`,
      klassFor(se.localSearchP50Ms !== null || se.providerSearchP50Ms !== null, se.localSearchP50Ms),
      'searchTelemetry',
      'Host ölçümü CİHAZ performansı DEĞİLDİR; saha doğrulaması ayrı borçtur.', t),
    field('f5-timings', 'İlk sonuç p50 · tamamlanma p50/p95 · projeksiyon p50',
      `${numText(se.firstResultP50Ms, ' ms')} · ${numText(se.completeSearchP50Ms, ' ms')} / ${numText(se.completeSearchP95Ms, ' ms')} · ${numText(se.projectionP50Ms, ' ms')}`,
      klassFor(se.firstResultP50Ms !== null, se.firstResultP50Ms), 'searchTelemetry',
      'İlk sonuç kullanıcının beklediği andır; tamamlanma tüm kaynakların bitişidir.', t),
    field('f5-index', 'Arama indeksi (türetilmiş)',
      s.searchIndexRows === null ? 'KURULMADI' : `${s.searchIndexRows} satır · rev ${numText(s.searchIndexRevision)}`,
      klassFor(s.searchIndexRows !== null, s.searchIndexRows), 'localSearchIndex.peek',
      'İKİNCİ library truth DEĞİLDİR: MusicIndex revizyonu değişince yeniden kurulur.', t),
    field('f5-index-perf', 'İndeks arama p50/p95 · kurulum sayısı',
      `${numText(se.indexLookupP50Ms, ' ms')} / ${numText(se.indexLookupP95Ms, ' ms')} · ${sc.indexBuilds}`,
      klassFor(se.indexLookupP50Ms !== null, se.indexLookupP50Ms), 'searchTelemetry',
      'Kurulum sayısı sürekli artıyorsa kütüphane revizyonu gereksiz yere ilerliyordur.', t),
    field('f5-dedup', 'Ham / normalize / birleşen / ayrı bırakılan',
      `${sc.rawResults} · ${sc.normalizedResults} · ${sc.dedupMerged} · ${sc.dedupAmbiguousKept}`,
      searchObserved, 'searchDedup',
      'Ayrı bırakılan = metinde benzeyip KİMLİK kanıtı yetmeyen. Yanlış birleştirme çift göstermekten kötüdür.', t),
    field('f5-ranking', 'Son sıralama gerekçesi',
      se.lastRankingSignals.length ? se.lastRankingSignals.join(' · ') : NA,
      se.lastRankingSignals.length ? 'DERIVED' : 'UNAVAILABLE', 'searchRanking.scoreResult',
      'Sıralama açıklanabilir olmalıdır: sağlayıcı popülerliği ve AI tahmini KULLANILMAZ.', t),
    field('f5-guards', 'Bayat düşürülen / iptal',
      `${sc.staleResultDrops} · ${sc.cancellations}`,
      searchObserved, 'musicSearchCoordinator kuşak kapısı',
      'Bayat düşürme bir ARIZA değil, koruma kanıtıdır: eski sorgu yeniyi kirletemedi.', t),
    field('f5-registry', 'Kayıtlı / dışarıda bırakılan sağlayıcı',
      `${numText(se.registeredProviders)} · ${numText(se.excludedProviders)}`,
      klassFor(se.registeredProviders > 0, se.registeredProviders), 'searchRegistry',
      'Dışarıda bırakma gerekçesi ürün politikası (WORLDWIDE kapalı) veya modül yokluğudur — yetenek UYDURULMAZ.', t),
    field('f5-voice', 'Sesli: sorgu / çalındı / belirsiz tutuldu',
      `${sc.voiceQueries} · ${sc.voiceAutoPlayed} · ${sc.voiceAmbiguousHeld}`,
      sc.voiceQueries > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'voiceSearchIntent',
      'Belirsiz tutuldu bir ARIZA değil korumadır: araçta yanlış parça başlatmak "bulamadım"dan kötüdür.', t),
    field('f5-voice-latency', 'Sesli arama p50 · seçim p50',
      `${numText(se.voiceSearchP50Ms, ' ms')} · ${numText(se.voiceSelectionP50Ms, ' ms')}`,
      klassFor(se.voiceSearchP50Ms !== null, se.voiceSearchP50Ms), 'searchTelemetry',
      'Sesli hat KANONİK koordinatörü kullanır; ikinci bir orkestrasyon yoktur.', t),
    field('f5-legacy', 'Eski arama yolu çağrısı', String(sc.legacySearchCalls),
      sc.legacySearchCalls > 0 ? 'STALE' : 'OBSERVED', 'carosMediaLayer.searchMedia (deprecated)',
      '0 OLMALIDIR. Sıfırdan büyükse bir yerde hâlâ ikinci bir arama orkestrasyonu çağrılıyordur.', t),
    field('f5-discovery', 'Keşif: bölüm / satır / bastırılan',
      se.discoverySections === null ? NA
        : `${numText(se.discoverySections)} · ${numText(se.discoveryRows)} · ${numText(se.discoverySuppressedSections)}`,
      klassFor(se.discoverySections !== null, se.discoverySections), 'discoveryRuntime',
      'Bastırılan = KANITI OLMADIĞI için üretilmeyen bölüm. Boş başlık ÇİZİLMEZ, sahte öneri ÜRETİLMEZ.', t),
    field('f5-discovery-perf', 'Keşif projeksiyonu p50',
      numText(se.discoveryProjectionP50Ms, ' ms'),
      klassFor(se.discoveryProjectionP50Ms !== null, se.discoveryProjectionP50Ms), 'searchTelemetry',
      'Kütüphane revizyonu değişmedikçe yeniden gruplama YAPILMAZ (önbellekli projeksiyon).', t),
    field('f5-failures', 'Sağlayıcı düşüşü / seçim reddi',
      `${sc.providerFailures} · ${sc.selectionRejected}`,
      searchObserved, 'searchTelemetry',
      'Seçim reddi = bayat MediaRef; arama sonucu bir çalma GARANTİSİ değildir.', t),
  ];


  /* ── F6 · Ses Deneyimi / DSP ────────────────────────────────────
     LAB burada HÜKÜM ÜRETMEZ: yetenek, uygulanan kazanç ve bypass gerekçesi
     kanonik otoriteden (audioExperienceAuthority + native efekt katmanı)
     okunur. Bu ekranda hesaplanan hiçbir değer üretime geri beslenmez. */
  const dc = s.dspCaps;
  const dn = s.dspNative;
  const dt = s.dspTelemetry;
  const dspProbed = dc.probed;
  const dspNativeOk = dn !== null && dn.available;

  const dsp: InspectorField[] = [
    field('f6-probed', 'DSP yeteneği ölçüldü', boolText(dspProbed),
      dspProbed ? 'OBSERVED' : 'UNAVAILABLE', 'audioDspCapabilities',
      dspProbed ? 'Yetenekler CİHAZDAN okundu.'
        : `Ölçülmedi (${dc.unavailableReason || 'neden bildirilmedi'}) — hiçbir kontrol çizilmez, hiçbir yazım yapılmaz.`, t),
    field('f6-eq', 'Ekolayzer · bant sayısı',
      dspProbed ? `${boolText(dc.supportsEqualizer)} · ${dc.eqBandCount}` : NA,
      klassFor(dspProbed, dc.eqBandCount), 'Equalizer.getNumberOfBands',
      'Bant sayısı CİHAZIN bildirdiğidir; "premium görünsün" diye artırılmaz.', t),
    field('f6-eq-range', 'Bant kazanç aralığı',
      dc.supportsEqualizer ? `${dc.eqMinGainDb} … ${dc.eqMaxGainDb} dB` : NA,
      klassFor(dc.supportsEqualizer, dc.eqMaxGainDb), 'Equalizer.getBandLevelRange',
      'Kullanıcı ayarı hem cihaz aralığına hem ürün tavanına (±9 dB) kırpılır.', t),
    field('f6-loudness', 'Loudness · tavan',
      dspProbed ? `${boolText(dc.supportsLoudness)} · ${dc.loudnessMaxDb} dB` : NA,
      klassFor(dspProbed, dc.loudnessMaxDb), 'LoudnessEnhancer',
      'Loudness kullanıcı sesi DEĞİLDİR, duck DEĞİLDİR, EQ DEĞİLDİR — sınırlı ayrı bir kazançtır.', t),
    field('f6-balance', 'Denge · fader',
      dspProbed ? `${boolText(dc.supportsBalance)} · ${boolText(dc.supportsFader)}` : NA,
      klassFor(dspProbed, dc.supportsBalance), 'CarosBalanceAudioProcessor',
      `Fader KAPALI: ${dc.faderUnsupportedReason || 'gerekçe bildirilmedi'}. Uygulama ses yolu stereodur; sahte ön/arka kanal ÜRETİLMEZ.`, t),
    field('f6-vendor', 'Virtualizer · üretici DSP',
      dspProbed ? `${boolText(dc.supportsVirtualizer)} · ${boolText(dc.supportsHardwareDsp)}` : NA,
      dspProbed ? 'DERIVED' : 'UNAVAILABLE', 'AudioEffect.queryEffects',
      'Üretici DSP TÜRETİLMİŞ bir gözlemdir (AOSP dışı equalizer implementasyonu); kesin donanım iddiası DEĞİLDİR.', t),
    field('f6-session', 'Audio session · kuşak',
      dspNativeOk ? `${dn.audioSessionId} · ${dn.generation}` : NA,
      klassFor(dspNativeOk, dn ? dn.audioSessionId : null), 'CarosAudioEffects.snapshot',
      'Kuşak değişince ESKİ oturumun ayarı yeni oturuma YAZILAMAZ (stale_session).', t),
    field('f6-attached', 'EQ · loudness · işlemci bağlı',
      dspNativeOk ? `${boolText(dn.equalizerAttached)} · ${boolText(dn.loudnessAttached)} · ${boolText(dn.processorActive)}` : NA,
      klassFor(dspNativeOk, dn ? dn.equalizerAttached : null), 'CarosAudioEffects.snapshot',
      'İşlemci yalnız stereo PCM akışta aktiftir; desteklenmeyen formatta tampon HİÇ dokunulmadan geçer.', t),
    field('f6-bypass', 'Bypass · gerekçe',
      dn ? `${boolText(dn.bypass)}${dn.bypassReason ? ` · ${dn.bypassReason}` : ''}` : NA,
      dn ? (dn.bypass ? 'STALE' : 'OBSERVED') : 'UNAVAILABLE', 'CarosAudioEffects.bypassReason',
      'Bypass bir ARIZA DEĞİL, güvenlik davranışıdır: efekt kurulamazsa ses rengi düzleşir, OYNATMA DEVAM EDER.', t),
    field('f6-config', 'Etkin · preset',
      `${boolText(s.dspConfig.enabled)} · ${s.dspConfig.presetId}`,
      dspProbed ? 'OBSERVED' : 'UNAVAILABLE', 'audioExperienceAuthority.getConfig',
      'Preset gerçek bir EQ eğrisidir; ölçülmemiş "AI/Studio" iddiası taşımaz.', t),
    field('f6-bands', 'İstenen bant kazançları (dB)',
      s.dspConfig.bandGainsDb.length > 0 ? s.dspConfig.bandGainsDb.join(' · ') : NA,
      klassFor(s.dspConfig.bandGainsDb.length > 0, s.dspConfig.bandGainsDb.length),
      'audioExperienceAuthority.getConfig',
      'İSTENEN değerdir. Cihazda GERÇEKTEN yazılan için alt satıra bakılır.', t),
    field('f6-applied', 'Uygulanan bant kazançları (dB)',
      dn && dn.appliedBandsMilliBel.length > 0
        ? dn.appliedBandsMilliBel.map((mb) => mb / 100).join(' · ')
        : NA,
      klassFor(dspNativeOk, dn ? dn.appliedBandsMilliBel.length : null), 'Equalizer.setBandLevel',
      'İstenen ile uygulanan farklıysa cihaz kırpmıştır — bu bir hata değil, cihaz sınırıdır.', t),
    field('f6-preamp', 'Güvenlik preamp değeri (istenen · uygulanan)',
      `${s.dspPreampDb} dB · ${dn ? dn.appliedPreampLinear.toFixed(3) : NA}`,
      klassFor(dspProbed, s.dspPreampDb), 'computeSafetyPreampDb',
      'Clipping koruması. KULLANICI SESİ DEĞİLDİR ve kullanıcı sesine hiçbir zaman yazılmaz (§8).', t),
    field('f6-channels', 'Kanal kazancı (sol · sağ)',
      `${s.dspChannelGains.left.toFixed(2)} · ${s.dspChannelGains.right.toFixed(2)}`,
      klassFor(dc.supportsBalance, s.dspChannelGains.left), 'balanceToChannelGains',
      'Denge YALNIZ uzak kanalı kısar; hiçbir kanal 1.0 üstüne çıkarılmaz → denge tek başına clipping ÜRETEMEZ.', t),
    field('f6-apply', 'Yazım: istendi · birleştirildi · gönderildi · kabul · red',
      `${dt.applyRequested} · ${dt.applyCoalesced} · ${dt.applySent} · ${dt.applyAccepted} · ${dt.applyRejected}`,
      dt.applyRequested > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'audioExperienceTelemetry',
      'Birleştirme (coalescing) slider sürüklemesinin native köprüyü basmasını engeller.', t),
    field('f6-stale', 'Bayat oturum reddi · yeniden ölçüm',
      `${dt.staleRejections} · ${dt.revalidations}`,
      dt.staleRejections > 0 ? 'STALE' : 'OBSERVED', 'audioExperienceTelemetry',
      'Bayat red bir korumadır: eski oturumun DSP ayarı yeni oturuma sızmaz (§17).', t),
    field('f6-latency', 'Yazım gecikmesi ort · maks · sorgu',
      `${numText(dt.applyLatencyAvgMs, ' ms')} · ${dt.applyLatencyMaxMs} ms · ${dt.probeLatencyLastMs} ms`,
      dt.applyLatencyCount > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'audioExperienceTelemetry',
      'Host ölçümüdür; gerçek DSP attach gecikmesi yalnız cihazda anlam taşır.', t),
    field('f6-failures', 'Attach · apply düşüşü · son kod',
      dn ? `${dn.attachFailureCount} · ${dn.applyFailureCount} · ${dn.lastFailureCode || '—'}` : NA,
      klassFor(dspNativeOk, dn ? dn.attachFailureCount : null), 'CarosAudioEffects.snapshot',
      'Efekt düşüşü oynatmayı DURDURMAZ; yalnız bypass üretir (§16 fail-closed).', t),
    field('f6-persist', 'Kalıcı yazım · reddedilen kayıt',
      `${dt.persistWrites} · ${dt.persistRejected}`,
      dt.persistWrites > 0 || dt.persistRejected > 0 ? 'OBSERVED' : 'UNAVAILABLE',
      'audioExperienceTelemetry',
      'Kalıcı ayar CANLI GERÇEK DEĞİLDİR (§13): her yüklemede cihaz yetenekleriyle yeniden kırpılır.', t),
  ];

  /* ── MUSIC F8 · SÜRÜŞ-FARKINDA MÜZİK ZEKÂSI ────────────────────────────
   * LAB burada KARAR ÜRETMEZ: bağlam salt okunur, son karar telemetriden
   * gelir. Kullanıcıya gösterilmeyen skor/gerekçe YALNIZ buradadır. */
  const f8: InspectorField[] = [
    field('f8-runtime', 'Zekâ katmanı', s.f8Started ? 'ÇALIŞIYOR' : 'KAPALI',
      s.f8Started ? 'OBSERVED' : 'UNAVAILABLE', 'musicIntelligenceRuntime',
      'Timer KURMAZ: yalnız dinleme oturumu değiştikçe kanıt yazar.', t),
    field('f8-context', 'Bağlam (hareket · gün · evre)',
      `${s.f8Motion} · ${s.f8Daypart} · ${s.f8Journey}`,
      s.f8Bucket === 'UNKNOWN' ? 'UNAVAILABLE' : 'DERIVED', 'drivingContextModel',
      'Hız VDL · yolculuk tripLog · rehberlik navigation truth\'udur — F8 yalnız sınıflandırır.', t),
    field('f8-bucket', 'Kanıt kovası', s.f8Bucket,
      s.f8Bucket === 'UNKNOWN' ? 'UNAVAILABLE' : 'DERIVED', 'drivingContextModel.bucket',
      'UNKNOWN kovaya tercih YAZILMAZ ve bu kovada otomatik eylem YAPILMAZ.', t),
    field('f8-confidence', 'Bağlam güveni', s.f8ContextConfidence,
      s.f8ContextConfidence === 'NONE' ? 'UNAVAILABLE' : 'DERIVED', 'drivingContextModel.confidence',
      'NONE = hız ölçülemiyor. Otomatik devam YALNIZ HIGH güvende meşrudur.', t),
    field('f8-evidence', 'Kullanılan bağlam kanıtı', s.f8Evidence,
      s.f8Evidence === 'YOK' ? 'UNAVAILABLE' : 'OBSERVED', 'drivingContext.evidence',
      'Sinyalin ADI ve durumu taşınır; DEĞERİ (konum/hedef) taşınmaz.', t),
    field('f8-missing', 'Eksik sinyal', s.f8Missing,
      s.f8Missing === 'YOK' ? 'OBSERVED' : 'UNAVAILABLE', 'drivingContext.missing',
      'Eksik sinyal gizlenmez: neyin ölçülemediği burada görünür.', t),
    field('f8-pref', 'Tercih kanıtı (satır / üst sınır)',
      `${numText(s.f8PreferenceEntries)} / ${numText(s.f8PreferenceCap)}`,
      s.f8PreferenceEntries > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'preferenceEvidence',
      'Sınırlı ve yerel. Ad · URI · konum · sağlayıcı içerik kimliği SAKLANMAZ.', t),
    field('f8-pref-kept', 'Korunmuş dinleme (toplam)', numText(s.f8PreferenceKeptTotal),
      s.f8PreferenceKeptTotal > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'preferenceEvidence.kept',
      '"Başlatıldı" tercih kanıtı DEĞİLDİR; yalnız korunan dinleme sayılır.', t),
    field('f8-pref-best', 'Bu kovadaki en güçlü aday', s.f8BucketBest,
      s.f8BucketBest === 'YOK' ? 'UNAVAILABLE' : 'DERIVED', 'bestPreferenceFor',
      'Niyet TÜRÜ ve sayaç gösterilir; parça/albüm ADI gösterilmez.', t),
    field('f8-action', 'Son karar', s.f8Telemetry.lastAction ?? NA,
      s.f8Telemetry.lastAction === null ? 'UNAVAILABLE' : 'OBSERVED', 'intelligenceTelemetry',
      'HOLD = dokunma · SUGGEST = kullanıcıya öner · AUTO_RESUME = kanonik devam.', t),
    field('f8-reason', 'Karar gerekçesi', s.f8Telemetry.lastReason ?? NA,
      s.f8Telemetry.lastReason === null ? 'UNAVAILABLE' : 'OBSERVED', 'intelligenceTelemetry',
      'Neden önerildi / neden bastırıldı — kullanıcıya GÖSTERİLMEZ.', t),
    field('f8-suppressed', 'Bastıran kapılar',
      s.f8Telemetry.lastSuppressed.length > 0 ? s.f8Telemetry.lastSuppressed.join(' · ') : 'YOK',
      s.f8Telemetry.lastSuppressed.length > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'IntelligenceDecision.suppressedBy',
      'Sessiz bastırma YOKTUR: eylemi engelleyen her kapı burada listelenir.', t),
    field('f8-explicit', 'Açık kullanıcı niyeti (yaş)',
      s.f8ExplicitIntentAgeMs === null ? NA : `${numText(Math.round(s.f8ExplicitIntentAgeMs / 1000))} sn`,
      s.f8ExplicitIntentAgeMs === null ? 'UNAVAILABLE' : 'OBSERVED', 'noteExplicitUserIntent',
      'Kullanıcı seçtiyse F8 SUSAR — otomasyon açık niyetin önüne GEÇEMEZ.', t),
    field('f8-decisions', 'Değerlendirme · HOLD · ÖNERİ · OTOMATİK',
      `${numText(s.f8Telemetry.counters.evaluations)} · ${numText(s.f8Telemetry.counters.hold)} · `
      + `${numText(s.f8Telemetry.counters.suggest)} · ${numText(s.f8Telemetry.counters.autoResume)}`,
      s.f8Telemetry.counters.evaluations > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'intelligenceTelemetry',
      'Otomatik eylem sayısının HOLD yanında küçük kalması BEKLENEN davranıştır.', t),
    field('f8-applied', 'Uygulandı · başarısız · açık-niyet iptali',
      `${numText(s.f8Telemetry.counters.applied)} · ${numText(s.f8Telemetry.counters.applyFailed)} · `
      + `${numText(s.f8Telemetry.counters.explicitOverrides)}`,
      s.f8Telemetry.counters.evaluations > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'intelligenceTelemetry',
      'Uygulama kanonik F3/F7 yolundan geçer; F8 doğrudan çalmaz.', t),
    field('f8-noted', 'Kanıt yazımı (başladı · korundu · bırakıldı · kovasız)',
      `${numText(s.f8Telemetry.counters.notedStarted)} · ${numText(s.f8Telemetry.counters.notedKept)} · `
      + `${numText(s.f8Telemetry.counters.notedAbandoned)} · ${numText(s.f8Telemetry.counters.droppedUnknownBucket)}`,
      s.f8Telemetry.counters.notedStarted > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'preferenceEvidence',
      'Bağlamı bilinmeyen dinleme kanıt olarak YAZILMAZ (kovasız sayacı).', t),
    field('f8-latency', 'Karar süresi p50 · p95',
      `${numText(s.f8Telemetry.decideP50Ms === null ? null : Math.round(s.f8Telemetry.decideP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f8Telemetry.decideP95Ms === null ? null : Math.round(s.f8Telemetry.decideP95Ms * 100) / 100, ' ms')}`,
      s.f8Telemetry.samples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'intelligenceTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte ayrıca beklenir.', t),
  ];

  /* ── MUSIC F9 · MAVİ MÜZİK NİYETİ ──────────────────────────────────────
   * LAB burada niyet ÇÖZMEZ ve komut GÖNDERMEZ; yalnız son yönlendirmenin
   * kanıtını gösterir. Kullanıcıya okunmayan teknik neden kodu BURADADIR. */
  const f9: InspectorField[] = [
    field('f9-intent', 'Çözülen niyet', s.f9Telemetry.lastKind ?? NA,
      s.f9Telemetry.lastKind === null ? 'UNAVAILABLE' : 'OBSERVED', 'musicIntentResolver',
      'Çözüm YEREL ve deterministiktir — bulut/LLM gerektirmez.', t),
    field('f9-route', 'Kanonik yürütücü', s.f9Telemetry.lastRoute ?? NA,
      s.f9Telemetry.lastRoute === null ? 'UNAVAILABLE' : 'OBSERVED', 'musicIntentRouter',
      'Mavi requester\'dır: yürütme F0/F3/F5/F7/F8 sahiplerindedir.', t),
    field('f9-status', 'Komut gerçeği', s.f9Telemetry.lastStatus ?? NA,
      s.f9Telemetry.lastStatus === null ? 'UNAVAILABLE' : 'OBSERVED', 'CommandTruth → MusicIntentStatus',
      'ACCEPTED_UNVERIFIED = gönderildi, ses DOĞRULANMADI.', t),
    field('f9-claim', 'Söylenebilir iddia sınıfı', s.f9Telemetry.lastClaim ?? NA,
      s.f9Telemetry.lastClaim === null ? 'UNAVAILABLE' : 'DERIVED', 'claimGradeFor',
      'CONFIRMED dışında "çalıyor/durdurdum" DENEMEZ — kilitle korunur.', t),
    field('f9-reason', 'Teknik neden kodu', s.f9Telemetry.lastReasonCode ?? NA,
      s.f9Telemetry.lastReasonCode === null ? 'UNAVAILABLE' : 'OBSERVED', 'MusicIntentOutcome.reasonCode',
      'Bu kod KULLANICIYA OKUNMAZ; konuşma katmanı insan diline çevirir.', t),
    field('f9-source', 'Kaynak niteleyicisi', s.f9Telemetry.lastSourcePreference ?? 'YOK',
      s.f9Telemetry.lastSourcePreference === null ? 'UNAVAILABLE' : 'OBSERVED', 'MusicIntent.source',
      'Kaynak yalnız FİLTREdir; F5 sıralama otoritesi DEĞİŞMEZ.', t),
    field('f9-source-held', 'Açık kaynakta sonuç yok → sessiz geçiş YAPILMADI',
      numText(s.f9Telemetry.counters.sourceHeld),
      s.f9Telemetry.counters.sourceHeld > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicIntentRouter',
      'Kullanıcı kaynağı söylediyse başka kaynağa SESSİZCE geçilmez — teklif edilir.', t),
    field('f9-ambiguous', 'Netleştirme (belirsiz) adedi',
      numText(s.f9Telemetry.counters.ambiguous),
      s.f9Telemetry.counters.dispatched > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'F5 auto-play kanıt eşiği',
      'Belirsizde İLK SONUÇ körlemesine çalınmaz; kullanıcıya sorulur.', t),
    field('f9-context', 'Bağlam kanıtı kullanıldı mı',
      s.f9Telemetry.lastUsedContextEvidence === null ? NA
        : boolText(s.f9Telemetry.lastUsedContextEvidence),
      s.f9Telemetry.lastUsedContextEvidence === null ? 'UNAVAILABLE' : 'OBSERVED',
      'F8 evaluateForExplicitRequest',
      'Açık istek F8 kapılarını aşar; KANIT kapısı aşılmaz (yoksa dürüstçe söylenir).', t),
    field('f9-contextual', 'Bağlamsal istek · karşılandı · kanıtsız',
      `${numText(s.f9Telemetry.counters.contextualRequests)} · `
      + `${numText(s.f9Telemetry.counters.contextualFulfilled)} · `
      + `${numText(s.f9Telemetry.counters.contextualNoEvidence)}`,
      s.f9Telemetry.counters.contextualRequests > 0 ? 'OBSERVED' : 'UNAVAILABLE',
      'musicIntentTelemetry',
      'Kanıtsız istekte "sana uygun bir şey buldum" DENMEZ.', t),
    field('f9-queue', 'Kuyruk komutu · desteklenmeyen',
      `${numText(s.f9Telemetry.counters.queueCommands)} · `
      + `${numText(s.f9Telemetry.counters.queueUnsupported)}`,
      s.f9Telemetry.counters.queueCommands > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'PlayQueue authority',
      'Sağlayıcı kuyruk düzenlemeyi desteklemiyorsa komut REDDEDİLİR (sahte başarı yok).', t),
    field('f9-truth-mix', 'Doğrulandı · doğrulanmadı · reddedildi',
      `${numText(s.f9Telemetry.counters.verified)} · `
      + `${numText(s.f9Telemetry.counters.acceptedUnverified)} · `
      + `${numText(s.f9Telemetry.counters.rejected)}`,
      s.f9Telemetry.counters.dispatched > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicIntentTelemetry',
      'Doğrulanmamış komut BAŞARI cümlesi kurdurmaz.', t),
    field('f9-stale', 'Bayat tur düşürüldü · iddia uyuşmazlığı',
      `${numText(s.f9Telemetry.counters.staleDrops)} · `
      + `${numText(s.f9Telemetry.counters.claimMismatch)}`,
      s.f9Telemetry.counters.staleDrops > 0 || s.f9Telemetry.counters.claimMismatch > 0
        ? 'OBSERVED' : 'UNAVAILABLE', 'musicIntentRouter · nesil kapısı',
      'İddia uyuşmazlığı 0 OLMALIDIR; >0 ise dürüstlük kilidi düşmüş demektir.', t),
    field('f9-latency', 'Niyet çözümü p50/p95 · yürütme p50/p95',
      `${numText(s.f9Telemetry.resolveP50Ms === null ? null : Math.round(s.f9Telemetry.resolveP50Ms * 100) / 100, ' ms')} / `
      + `${numText(s.f9Telemetry.resolveP95Ms === null ? null : Math.round(s.f9Telemetry.resolveP95Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f9Telemetry.dispatchP50Ms === null ? null : Math.round(s.f9Telemetry.dispatchP50Ms), ' ms')} / `
      + `${numText(s.f9Telemetry.dispatchP95Ms === null ? null : Math.round(s.f9Telemetry.dispatchP95Ms), ' ms')}`,
      s.f9Telemetry.resolveSamples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicIntentTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte beklenir.', t),
    /* ── MUSIC F14 · Canlı Ses → F9 Kablolama ────────────────────────────
     * ÖLÇÜLEN GERÇEK (F14 denetimi): F9'un `dispatchMusicIntent`i bugüne
     * kadar Now Playing/Discovery/F13 gibi UI kaynaklarından çağrılıyordu;
     * gerçek Mavi mikrofon girdisi buraya ULAŞMIYORDU. Bu alanlar YALNIZ
     * ses girişinden gelen tetiklemeyi sayar — F9'un kendi rota/durum/iddia
     * sayaçları (üstteki alanlar) HER dispatch için zaten dolar. */
    field('f14-attempts', 'Ses bypass denemesi · isabet · ıska',
      `${numText(s.f14Telemetry.counters.bypassAttempts)} · `
      + `${numText(s.f14Telemetry.counters.bypassHits)} · `
      + `${numText(s.f14Telemetry.counters.bypassMisses)}`,
      s.f14Telemetry.counters.bypassAttempts > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicVoiceWiringTelemetry',
      'Iska: F9 metni tanımadı → mevcut AI/yerel zincire dürüstçe düşüldü.', t),
    field('f14-gate', 'Kapı: eski-tip yeniden yorum · dar-güvenli kalıp',
      `${numText(s.f14Telemetry.counters.legacyTypeReroute)} · `
      + `${numText(s.f14Telemetry.counters.narrowSafeBypass)}`,
      'OBSERVED', 'musicVoiceWiringTelemetry',
      'Dar-güvenli: yalnız kuyruk/bağlamsal/koleksiyon kalıbı — genel arama YAKALANMAZ.', t),
    field('f14-duplicate-guard', 'Eski çift-yürütme yolu (routeIntent) çağrıldı mı',
      numText(s.f14Telemetry.counters.legacyRouteIntentCalls),
      s.f14Telemetry.counters.legacyRouteIntentCalls > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'intentEngine.routeIntent',
      'HER ZAMAN 0 OLMALIDIR — >0 ise tek-yürütme güvencesinde BOŞLUK var demektir.', t),
  ];

  /* ── MUSIC F10 · KARAKTER (MOOD/ENERGY) KANITI ─────────────────────────
   * ÖLÇÜLEN GERÇEK: bugün hiçbir sağlayıcı gerçek enerji/tempo ölçümü VERMİYOR
   * (MediaStore projeksiyonunda GENRE/YEAR yok · Piped'da trait yok · Spotify
   * `audio-features` çağrılmıyor). Bu kart, kanıtın NE KADAR ZAYIF olduğunu
   * gizlemeden gösterir — LAB burada seçim YAPMAZ. */
  const f10: InspectorField[] = [
    field('f10-ref', 'Çalanın karakter kanıtı (köken · güven)',
      `${s.f10ReferenceProvenance} · ${s.f10ReferenceConfidence}`,
      s.f10ReferenceProvenance === 'NONE' ? 'UNAVAILABLE' : 'DERIVED',
      'traitRuntime.peekReferenceEvidence',
      'HEURISTIC_TEXT/DERIVED_DURATION = ölçüm DEĞİL, çıkarım. Göreceli istek bunu ister.', t),
    field('f10-ref-bpm', 'Çalanın GERÇEK BPM etiketi',
      s.f10ReferenceBpm === null ? NA : String(s.f10ReferenceBpm),
      s.f10ReferenceBpm === null ? 'UNAVAILABLE' : 'OBSERVED', 'ID3 TBPM / Vorbis BPM',
      'BPM YALNIZ gömülü etiketten/ölçümden gelir; süre veya türden ÜRETİLMEZ.', t),
    field('f10-sources', 'Kaynak trait yeteneği (ÖLÇÜLEN)', s.f10SourceAvailability,
      'OBSERVED', 'traitSources.PROVIDER_TRAIT_AVAILABILITY',
      'UNVERIFIED = sözleşme doğrulanmadı → varmış gibi DAVRANILMAZ.', t),
    field('f10-schema', 'Kanıt şeması sürümü', String(s.f10SchemaVersion),
      'OBSERVED', 'traitRuntime.TRAIT_SCHEMA_VERSION',
      'Şema/eşik değişince eski önbellek satırları GEÇERSİZLEŞİR (bayat kanıt yok).', t),
    field('f10-ref-energy', 'Çalanın enerji tahmini',
      s.f10ReferenceEnergy === null ? NA
        : String(Math.round(s.f10ReferenceEnergy * 100) / 100),
      s.f10ReferenceEnergy === null ? 'UNAVAILABLE' : 'DERIVED', 'MusicTraitEvidence.energy',
      'Kanıt yoksa "daha sakin" isteği REDDEDİLİR — sahte kıyas yapılmaz.', t),
    field('f10-direction', 'Son istenen yön', s.f10Telemetry.lastDirection ?? NA,
      s.f10Telemetry.lastDirection === null ? 'UNAVAILABLE' : 'OBSERVED', 'traitSelectionModel',
      'CALMER/MORE_ENERGETIC göreceli · FOR_DRIVE/NIGHT_CALM bağlam hedefli.', t),
    field('f10-status', 'Seçim sonucu', s.f10Telemetry.lastStatus ?? NA,
      s.f10Telemetry.lastStatus === null ? 'UNAVAILABLE' : 'OBSERVED', 'TraitSelectionResult',
      'NO_REFERENCE = çalanın kanıtı yok · NO_EVIDENCE = adaylarda kanıt yok.', t),
    field('f10-reason', 'Fail-closed / seçim neden kodu', s.f10Telemetry.lastReasonCode ?? NA,
      s.f10Telemetry.lastReasonCode === null ? 'UNAVAILABLE' : 'OBSERVED', 'reasonCode',
      'Bu kod KULLANICIYA OKUNMAZ; konuşma katmanı insan diline çevirir.', t),
    field('f10-confidence', 'Seçim güveni · seçilen kanıt kökeni',
      `${s.f10Telemetry.lastConfidence ?? NA} · ${s.f10Telemetry.lastProvenance ?? NA}`,
      s.f10Telemetry.lastConfidence === null ? 'UNAVAILABLE' : 'DERIVED',
      'weakerConfidence(referans, aday)',
      'Karar en ZAYIF halkası kadar güçlüdür; sezgiselden MEDIUM+ güven DOĞMAZ.', t),
    field('f10-pool', 'Aday · kanıtsız elenen · yön dışı elenen',
      `${numText(s.f10Telemetry.lastConsidered)} · ${numText(s.f10Telemetry.lastRejectedNoEvidence)} · `
      + `${numText(s.f10Telemetry.lastRejectedWrongDirection)}`,
      s.f10Telemetry.lastConsidered === null ? 'UNAVAILABLE' : 'OBSERVED', 'traitSelectionModel',
      'Sessiz düşürme YOK: kanıtsız adaylar sayılarak elenir.', t),
    field('f10-evidence-mix',
      'Kanıt kökeni (ses ölçümü · sağlayıcı · gömülü etiket · kütüphane · süre · sezgisel · yok)',
      `${numText(s.f10Telemetry.counters.evidenceMeasured)} · `
      + `${numText(s.f10Telemetry.counters.evidenceProvider)} · `
      + `${numText(s.f10Telemetry.counters.evidenceEmbedded)} · `
      + `${numText(s.f10Telemetry.counters.evidenceLibrary)} · `
      + `${numText(s.f10Telemetry.counters.evidenceDuration)} · `
      + `${numText(s.f10Telemetry.counters.evidenceHeuristic)} · `
      + `${numText(s.f10Telemetry.counters.evidenceNone)}`,
      s.f10Telemetry.counters.evidenceNone > 0 || s.f10Telemetry.counters.evidenceHeuristic > 0
        ? 'OBSERVED' : 'UNAVAILABLE', 'traitTelemetry',
      'F17 öncesi "gömülü etiket" kendi sütunu olmadığı için "yok" sayılıyordu — '
      + 'düzeltildi. Sağlayıcı sütunu HÂLÂ 0 olmalıdır (bağlı kaynak YOK).', t),
    field('f10-claims', 'Kesin dil · temkinli dil',
      `${numText(s.f10Telemetry.counters.confidentClaims)} · `
      + `${numText(s.f10Telemetry.counters.tentativeClaims)}`,
      s.f10Telemetry.counters.requests > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'allowsConfidentClaim',
      'Yalnız sezgisel kanıt varken KESİN dil sayacı 0 kalmalıdır.', t),
    field('f10-outcomes', 'İstek · seçildi · referans yok · kanıt yok · aday yok',
      `${numText(s.f10Telemetry.counters.requests)} · ${numText(s.f10Telemetry.counters.selected)} · `
      + `${numText(s.f10Telemetry.counters.noReference)} · ${numText(s.f10Telemetry.counters.noEvidence)} · `
      + `${numText(s.f10Telemetry.counters.noCandidate)}`,
      s.f10Telemetry.counters.requests > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'traitTelemetry',
      'Fail-closed: kanıt yoksa yanlış parça seçmek yerine reddedilir.', t),
    field('f10-cache', 'Kanıt önbelleği (satır · isabet · ıska)',
      `${numText(s.f10CacheSize)} · ${numText(s.f10Telemetry.counters.cacheHits)} · `
      + `${numText(s.f10Telemetry.counters.cacheMisses)}`,
      s.f10CacheSize > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'traitRuntime (LRU)',
      'Sınırlı: düşük-uç head unit\'te her istekte tüm kütüphane taranmaz.', t),
    field('f10-latency', 'Seçim süresi p50 · p95 · iddia uyuşmazlığı',
      `${numText(s.f10Telemetry.selectP50Ms === null ? null : Math.round(s.f10Telemetry.selectP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f10Telemetry.selectP95Ms === null ? null : Math.round(s.f10Telemetry.selectP95Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f10Telemetry.counters.claimMismatch)}`,
      s.f10Telemetry.samples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'traitTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR. Uyuşmazlık 0 OLMALIDIR.', t),
  ];

  /* ── MUSIC F13 · FAVORİLER / KOLEKSİYON ────────────────────────────────
   * ÖLÇÜLEN GERÇEK (F13 denetimi): kart yalnız `musicCollectionAuthority`nin
   * sayaç/adet çıktısını gösterir — parça/sanatçı adı YOKTUR (rule 6). LAB
   * bu kartla mutasyon TETİKLEMEZ (rule 4). */
  const f13: InspectorField[] = [
    field('f13-schema', 'Koleksiyon şeması sürümü', String(s.f13SchemaVersion),
      'OBSERVED', 'musicCollectionEntry.COLLECTION_SCHEMA_VERSION',
      'Şema değişince eski kalıcı kayıtlar fail-closed olarak REDDEDİLİR.', t),
    field('f13-total', 'Toplam favori (yerel · sağlayıcı)',
      `${numText(s.f13Total)} (${numText(s.f13Local)} · ${numText(s.f13Provider)})`,
      s.f13Total > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicCollectionAuthority.getFavoritesCount',
      'Yalnız ADET — parça adı/URI burada YOKTUR (gizlilik sınırı).', t),
    field('f13-mutations', 'Ekleme · çıkarma · toggle çağrısı',
      `${numText(s.f13Telemetry.counters.added)} · ${numText(s.f13Telemetry.counters.removed)} · `
      + `${numText(s.f13Telemetry.counters.toggled)}`,
      s.f13Telemetry.counters.toggled > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicCollectionTelemetry',
      'Toggle sayacı add/remove\'dan AYRI tutulur — hangi yoldan geldiği kaybolmaz.', t),
    field('f13-idempotent', 'Zaten favori · zaten değil (idempotent sonuç)',
      `${numText(s.f13Telemetry.counters.alreadyPresent)} · ${numText(s.f13Telemetry.counters.alreadyAbsent)}`,
      'OBSERVED', 'musicCollectionTelemetry',
      'Yinelenen ekleme/çıkarma DUPLICATE KAYIT üretmez — bu sayaçlar bunu KANITLAR.', t),
    field('f13-rejects', 'Reddedilen (kimliksiz · liste dolu)',
      `${numText(s.f13Telemetry.counters.rejectedNoIdentity)} · `
      + `${numText(s.f13Telemetry.counters.rejectedCollectionFull)}`,
      'OBSERVED', 'musicCollectionTelemetry',
      'Kimliksiz favori UYDURULMAZ — dürüstçe reddedilir, sayılır.', t),
    field('f13-persistence', 'Kalıcılık: yazma hatası · reddedilen kayıt · göç düşüşü',
      `${numText(s.f13Telemetry.counters.persistWriteFailures)} · `
      + `${numText(s.f13Telemetry.counters.persistLoadRejectedRecords)} · `
      + `${numText(s.f13Telemetry.counters.migrationDrops)}`,
      'OBSERVED', 'musicCollectionTelemetry',
      'Kalıcılık başarısız olsa da oynatma ETKİLENMEZ (fail-soft, §13).', t),
    field('f13-unresolved', 'Çözülemeyen yerel favori araması', numText(s.f13Telemetry.counters.unresolvedLocalLookups),
      'OBSERVED', 'musicCollectionTelemetry',
      'Silinmiş/taşınmış yerel dosya için sahte parça GÖSTERİLMEZ.', t),
    field('f13-last-mutation', 'Son mutasyon sonucu', s.f13Telemetry.lastMutationStatus ?? NA,
      s.f13Telemetry.lastMutationStatus === null ? 'UNAVAILABLE' : 'OBSERVED', 'musicCollectionTelemetry',
      'ADDED/REMOVED/ALREADY_* — hangi parça olduğu BURADA YOKTUR.', t),
    field('f13-latency', 'Projeksiyon süresi p50 · p95',
      `${numText(s.f13Telemetry.projectionP50Ms === null ? null : Math.round(s.f13Telemetry.projectionP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f13Telemetry.projectionP95Ms === null ? null : Math.round(s.f13Telemetry.projectionP95Ms * 100) / 100, ' ms')}`,
      s.f13Telemetry.projectionSamples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicCollectionTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte beklenir.', t),
  ];

  /* ── MUSIC F15 · PLAYLIST OTORİTESİ ─────────────────────────────────────
   * ÖLÇÜLEN GERÇEK (F15 denetimi): kart yalnız `musicPlaylistAuthority`nin
   * sayaç/adet çıktısını gösterir — playlist adı/parça adı/URI YOKTUR
   * (rule 6). LAB bu kartla mutasyon TETİKLEMEZ (rule 4). */
  const f15: InspectorField[] = [
    field('f15-schema', 'Playlist şeması sürümü', String(s.f15SchemaVersion),
      'OBSERVED', 'musicPlaylistEntry.PLAYLIST_SCHEMA_VERSION',
      'Şema değişince eski kalıcı kayıtlar fail-closed olarak REDDEDİLİR.', t),
    field('f15-total', 'Toplam playlist · toplam öğe',
      `${numText(s.f15PlaylistTotal)} · ${numText(s.f15ItemTotal)}`,
      s.f15PlaylistTotal > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicPlaylistAuthority.getPlaylistsCount',
      'Yalnız ADET — playlist adı/parça adı burada YOKTUR (gizlilik sınırı).', t),
    field('f15-distribution', 'Öğe dağılımı (yerel · sağlayıcı)',
      `${numText(s.f15Telemetry.lastLocalItemCount)} · ${numText(s.f15Telemetry.lastProviderItemCount)}`,
      s.f15Telemetry.lastLocalItemCount === null ? 'UNAVAILABLE' : 'OBSERVED', 'musicPlaylistTelemetry',
      'Karma-sağlayıcı playlist mümkündür — bu yalnız TOPLAM dağılımdır.', t),
    field('f15-mutations', 'Oluşturma · yeniden adlandırma · silme',
      `${numText(s.f15Telemetry.counters.created)} · ${numText(s.f15Telemetry.counters.renamed)} · `
      + `${numText(s.f15Telemetry.counters.deleted)}`,
      'OBSERVED', 'musicPlaylistTelemetry',
      'Playlist yaşam döngüsü sayaçları — hangi playlist olduğu BURADA YOKTUR.', t),
    field('f15-item-mutations', 'Öğe ekleme · çıkarma · sıralama',
      `${numText(s.f15Telemetry.counters.itemAdded)} · ${numText(s.f15Telemetry.counters.itemRemoved)} · `
      + `${numText(s.f15Telemetry.counters.reordered)}`,
      'OBSERVED', 'musicPlaylistTelemetry',
      'Sıralama dizinin KENDİSİdir — ikinci bir "sortIndex" alanı YOKTUR.', t),
    field('f15-idempotent', 'Zaten vardı · zaten yoktu (idempotent sonuç)',
      `${numText(s.f15Telemetry.counters.itemAlreadyPresent)} · ${numText(s.f15Telemetry.counters.itemAlreadyAbsent)}`,
      'OBSERVED', 'musicPlaylistTelemetry',
      'Yinelenen ekleme DUPLICATE KAYIT üretmez — bu sayaçlar bunu KANITLAR.', t),
    field('f15-rejects', 'Reddedilen (kimliksiz · bulunamadı · ad boş · sınır)',
      `${numText(s.f15Telemetry.counters.rejectedNoIdentity)} · ${numText(s.f15Telemetry.counters.rejectedNotFound)} · `
      + `${numText(s.f15Telemetry.counters.rejectedNameEmpty)} · `
      + `${numText(s.f15Telemetry.counters.rejectedPlaylistLimit + s.f15Telemetry.counters.rejectedItemLimit)}`,
      'OBSERVED', 'musicPlaylistTelemetry',
      'Kimliksiz/adsız playlist mutasyonu UYDURULMAZ — dürüstçe reddedilir, sayılır.', t),
    field('f15-unresolved', 'Çözülemeyen yerel öğe araması', numText(s.f15Telemetry.counters.unresolvedLocalLookups),
      'OBSERVED', 'musicPlaylistTelemetry',
      'Silinmiş/taşınmış yerel dosya için sahte parça GÖSTERİLMEZ.', t),
    field('f15-persistence', 'Kalıcılık: yazma hatası · reddedilen kayıt',
      `${numText(s.f15Telemetry.counters.persistWriteFailures)} · `
      + `${numText(s.f15Telemetry.counters.persistLoadRejectedRecords)}`,
      'OBSERVED', 'musicPlaylistTelemetry',
      'Kalıcılık başarısız olsa da oynatma ETKİLENMEZ (fail-soft).', t),
    field('f15-last-mutation', 'Son mutasyon sonucu', s.f15Telemetry.lastMutationStatus ?? NA,
      s.f15Telemetry.lastMutationStatus === null ? 'UNAVAILABLE' : 'OBSERVED', 'musicPlaylistTelemetry',
      'CREATED/ITEM_ADDED/REORDERED/... — hangi playlist/parça olduğu BURADA YOKTUR.', t),
    field('f15-latency', 'Projeksiyon süresi p50 · p95',
      `${numText(s.f15Telemetry.projectionP50Ms === null ? null : Math.round(s.f15Telemetry.projectionP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f15Telemetry.projectionP95Ms === null ? null : Math.round(s.f15Telemetry.projectionP95Ms * 100) / 100, ' ms')}`,
      s.f15Telemetry.projectionSamples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicPlaylistTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte beklenir.', t),
  ];

  /* ── MUSIC F16 · ŞARKI SÖZLERİ OTORİTESİ ─────────────────────────────────
   * ÖLÇÜLEN GERÇEK (F16 denetimi): kart yalnız `musicLyricsAuthority`nin
   * sayaç/adet çıktısını gösterir — söz metni/satır/URI YOKTUR (rule 6).
   * LAB bu kartla mutasyon TETİKLEMEZ (rule 4). */
  const f16: InspectorField[] = [
    field('f16-schema', 'Lyrics şeması sürümü', String(s.f16SchemaVersion),
      'OBSERVED', 'musicLyricsEntry.LYRICS_SCHEMA_VERSION',
      'Şema değişince eski kalıcı kayıtlar fail-closed olarak REDDEDİLİR.', t),
    field('f16-cache-size', 'Önbellek satırı (LRU, bounded)', numText(s.f16CacheSize),
      s.f16CacheSize > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicLyricsAuthority.getLyricsCacheSize',
      'Yalnız ADET — hangi parçanın sözü olduğu burada YOKTUR (gizlilik sınırı).', t),
    field('f16-resolved', 'Çözülen: düz · senkron · yok · bilinmiyor',
      `${numText(s.f16Telemetry.counters.resolvedAvailablePlain)} · `
      + `${numText(s.f16Telemetry.counters.resolvedAvailableSynced)} · `
      + `${numText(s.f16Telemetry.counters.resolvedUnavailable)} · `
      + `${numText(s.f16Telemetry.counters.resolvedUnknown)}`,
      'OBSERVED', 'musicLyricsTelemetry',
      'PLAIN/SYNCED ayrımı ve "bulunamadı" — hangi parça olduğu BURADA YOKTUR.', t),
    field('f16-cache-hit', 'Önbellek isabet · ıska · bayat düşürme',
      `${numText(s.f16Telemetry.counters.cacheHits)} · ${numText(s.f16Telemetry.counters.cacheMisses)} · `
      + `${numText(s.f16Telemetry.counters.cacheStaleDropped)}`,
      'OBSERVED', 'musicLyricsTelemetry',
      'Dosya değişince (generationModified) bayat kanıt DÜŞÜRÜLÜR — bu sayaç bunu KANITLAR.', t),
    field('f16-rejects', 'Reddedilen (kimliksiz · ayrıştırma hatası)',
      `${numText(s.f16Telemetry.counters.identityMismatchRejected)} · `
      + `${numText(s.f16Telemetry.counters.parseFailures)}`,
      'OBSERVED', 'musicLyricsTelemetry',
      'Kimliksiz/bozuk veri UYDURULMAZ — dürüstçe reddedilir, sayılır.', t),
    field('f16-fake-sync-prevented', 'Uydurma senkron ENGELLENDİ (MPEG-frame reddi)',
      numText(s.f16Telemetry.counters.fakeSyncPrevented),
      'OBSERVED', 'musicLyricsTelemetry',
      'SYLT milisaniye DIŞI zamanlama taşıyorsa TAHMİN edilmez — bu sayaç bunu KANITLAR.', t),
    field('f16-persistence', 'Kalıcılık: yazma hatası · reddedilen kayıt',
      `${numText(s.f16Telemetry.counters.persistWriteFailures)} · `
      + `${numText(s.f16Telemetry.counters.persistLoadRejectedRecords)}`,
      'OBSERVED', 'musicLyricsTelemetry',
      'Kalıcılık başarısız olsa da oynatma ETKİLENMEZ (fail-soft).', t),
    field('f16-last', 'Son çözüm (biçim · kaynak sınıfı)',
      `${s.f16Telemetry.lastFormat ?? NA} · ${s.f16Telemetry.lastSource ?? NA}`,
      s.f16Telemetry.lastFormat === null && s.f16Telemetry.lastSource === null ? 'UNAVAILABLE' : 'OBSERVED',
      'musicLyricsTelemetry', 'PLAIN/SYNCED ve ID3_USLT/ID3_SYLT/VORBIS_LYRICS/NONE — parça adı YOKTUR.', t),
    field('f16-sync-latency', 'Aktif satır projeksiyon süresi p50 · p95',
      `${numText(s.f16Telemetry.syncProjectionP50Ms === null ? null : Math.round(s.f16Telemetry.syncProjectionP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f16Telemetry.syncProjectionP95Ms === null ? null : Math.round(s.f16Telemetry.syncProjectionP95Ms * 100) / 100, ' ms')}`,
      s.f16Telemetry.syncProjectionSamples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'musicLyricsTelemetry',
      'İkili arama (O(log n)) — HOST süresi CİHAZ performansı DEĞİLDİR, saha ölçümü kütükte beklenir.', t),
  ];

  /* ── MUSIC F17 · SES ÖLÇÜMÜ (SONIC AUDIO INTELLIGENCE) ───────────────────
   * ÖLÇÜLEN GERÇEK: F10.1 bir ETİKET okumasıydı; F17 dosyayı DECODE edip
   * dalga formunu ölçer. Kart yalnız sayısal ölçümü ve sayaçları gösterir —
   * parça adı/URI YOKTUR (rule 6) ve LAB analiz TETİKLEMEZ (rule 4). */
  const f17: InspectorField[] = [
    field('f17-schema', 'Ölçüm şeması · tempo güven eşiği',
      `${String(s.f17SchemaVersion)} · ${String(s.f17TempoConfidenceMin)}`,
      'OBSERVED', 'sonicDescriptor',
      'Şema artınca eski ölçümler bir daha OKUNMAZ; eşiğin altındaki tepe tempo SAYILMAZ.', t),
    field('f17-cache', 'Ölçüm önbelleği (LRU, bounded) · kuşak · koşuyor',
      `${numText(s.f17CacheSize)} · ${numText(s.f17Generation)} · ${s.f17Running ? 'EVET' : 'HAYIR'}`,
      s.f17CacheSize > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'sonicAnalysisRuntime',
      'Yalnız ADET — hangi parçanın ölçümü olduğu burada YOKTUR (gizlilik sınırı).', t),
    field('f17-admission', 'Kabul: istek · ölçüldü · ertelendi · atlandı',
      `${numText(s.f17Telemetry.counters.requested)} · ${numText(s.f17Telemetry.counters.admitted)} · `
      + `${numText(s.f17Telemetry.counters.deferred)} · ${numText(s.f17Telemetry.counters.bypassed)}`,
      'OBSERVED', 'sonicAdmissionModel',
      'Baskı altında karar ATLAMAKTIR: kaba/yarım ölçüm kanıt SAYILMAZ (§7).', t),
    field('f17-last-admission', 'Son kabul kararı · gerekçe · tur boyu · cihaz sınıfı',
      `${s.f17Telemetry.lastDecision ?? NA} · ${s.f17Telemetry.lastReason ?? NA} · `
      + `${numText(s.f17Telemetry.lastBatchSize)} · ${s.f17Telemetry.lastTier ?? NA}`,
      s.f17Telemetry.lastDecision === null ? 'UNAVAILABLE' : 'OBSERVED', 'sonicTelemetry',
      'Tur boyu cihaz sınıfından ve termal baskıdan gelir; sabit DEĞİLDİR.', t),
    field('f17-measured', 'Ölçülen dosya · tempo kabul · tempo zayıf (düşürüldü)',
      `${numText(s.f17Telemetry.counters.measured)} · ${numText(s.f17Telemetry.counters.tempoAccepted)} · `
      + `${numText(s.f17Telemetry.counters.tempoRejectedWeak)}`,
      s.f17Telemetry.counters.measured > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'sonicTelemetry',
      'Zayıf otokorelasyon tepesi "tempo bulundu" DEĞİLDİR — bu sayaç uydurma BPM yasağını kanıtlar.', t),
    field('f17-failures', 'Başarısız: kod · zaman aşımı · kısa · sessiz · iptal · bozuk alan',
      `${numText(s.f17Telemetry.counters.failedUnsupported)} · ${numText(s.f17Telemetry.counters.failedTimeout)} · `
      + `${numText(s.f17Telemetry.counters.failedTooShort)} · ${numText(s.f17Telemetry.counters.failedSilent)} · `
      + `${numText(s.f17Telemetry.counters.cancelled)} · ${numText(s.f17Telemetry.counters.rejectedMalformed)}`,
      'OBSERVED', 'sonicTelemetry',
      'Bozuk dosya · desteklenmeyen kodek · sessizlik → kanıt YOK. Sahte ölçüm ÜRETİLMEZ.', t),
    field('f17-repeat-guard', 'Tekrar analiz engellendi · bayat düşürüldü · eski kuşak sonucu atıldı',
      `${numText(s.f17Telemetry.counters.reanalysisPrevented)} · `
      + `${numText(s.f17Telemetry.counters.cacheStaleDropped)} · `
      + `${numText(s.f17Telemetry.counters.staleResultDropped)}`,
      'OBSERVED', 'sonicAnalysisRuntime',
      'Aynı dosya tekrar tekrar ÇÖZÜLMEZ; iptal edilen turun sonucu yeni gerçeğe YAZILAMAZ (§17).', t),
    field('f17-native', 'Native yok · native hata',
      `${numText(s.f17Telemetry.counters.nativeUnavailable)} · ${numText(s.f17Telemetry.counters.nativeErrors)}`,
      'OBSERVED', 'sonicAnalysisRuntime',
      'Tarayıcı/demo modda ölçüm YOKTUR ve varmış gibi davranılmaz (fail-soft).', t),
    field('f17-reference', 'Çalan parçanın ölçümü (tempo · güven · süre)',
      s.f17ReferenceMeasured
        ? `${numText(s.f17ReferenceTempoBpm, ' BPM')} · ${numText(s.f17ReferenceTempoConfidence)} · `
          + `${numText(s.f17ReferenceAnalyzedMs, ' ms')}`
        : NA,
      s.f17ReferenceMeasured ? 'OBSERVED' : 'UNAVAILABLE', 'sonicAnalysisRuntime',
      'Ölçüm yoksa UNAVAILABLE — "bilinmiyor" bir sayıya DÖNÜŞTÜRÜLMEZ.', t),
    field('f17-reference-level', 'Çalan parçanın seviyesi (RMS · crest · spektral merkez)',
      s.f17ReferenceMeasured
        ? `${numText(s.f17ReferenceRmsDbfs, ' dBFS')} · ${numText(s.f17ReferenceCrestDb, ' dB')} · `
          + `${numText(s.f17ReferenceCentroidHz, ' Hz')}`
        : NA,
      s.f17ReferenceMeasured ? 'OBSERVED' : 'UNAVAILABLE', 'sonicAnalysisRuntime',
      'Bunlar GERÇEK ölçümdür; "mood" DEĞİLDİR — dalga formundan ruh hâli çıkarılmaz.', t),
    field('f17-run-latency', 'Analiz turu süresi p50 · p95',
      `${numText(s.f17Telemetry.runP50Ms === null ? null : Math.round(s.f17Telemetry.runP50Ms), ' ms')} · `
      + `${numText(s.f17Telemetry.runP95Ms === null ? null : Math.round(s.f17Telemetry.runP95Ms), ' ms')}`,
      s.f17Telemetry.samples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'sonicTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte beklenir.', t),
  ];

  /* ── MUSIC F18 · KESİNTİSİZ AKIŞ (SMART RADIO) ───────────────────────────
   * ÖLÇÜLEN GERÇEK: Smart Radio bir KUYRUK OTORİTESİ DEĞİLDİR; yalnız aday
   * sırası üretir ve yürütmeyi kanonik F3 zincirine verir. Kart bunu ve
   * iddianın KANITA bağlı olduğunu gösterir. LAB plan ÜRETMEZ (rule 4). */
  const f18: InspectorField[] = [
    field('f18-bounds', 'Sınırlar: en fazla öğe · tarama · ölçüm eşiği',
      `${numText(s.f18MaxLength)} · ${numText(s.f18MaxScan)} · ${numText(s.f18MeasuredClaimMinCount)}`,
      'OBSERVED', 'smartRadioModel',
      'Akış KALICI DEĞİLDİR: her istek SINIRLI bir liste üretir — "sonsuz radyo state" YOKTUR.', t),
    field('f18-outcomes', 'İstek · plan üretildi · aday yok · kütüphane boş',
      `${numText(s.f18Telemetry.counters.requests)} · ${numText(s.f18Telemetry.counters.planned)} · `
      + `${numText(s.f18Telemetry.counters.noCandidate)} · ${numText(s.f18Telemetry.counters.emptyLibrary)}`,
      'OBSERVED', 'smartRadioTelemetry',
      'Aday yoksa sıra UYDURULMAZ — istek dürüstçe reddedilir ve sayılır.', t),
    field('f18-claim-mix', 'İddia sınıfı (ölçülmüş · zayıf · kanıtsız)',
      `${numText(s.f18Telemetry.counters.claimMeasured)} · ${numText(s.f18Telemetry.counters.claimWeak)} · `
      + `${numText(s.f18Telemetry.counters.claimFallback)}`,
      s.f18Telemetry.counters.planned > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'smartRadioModel',
      '"Buna benzeyenler" cümlesi YALNIZ ölçülmüş sınıfta kurulur; kanıtsızda kişiselleştirme İDDİA EDİLMEZ.', t),
    field('f18-execution', 'Yürütme: sıraya eklendi · yeni akış · reddedildi',
      `${numText(s.f18Telemetry.counters.appended)} · ${numText(s.f18Telemetry.counters.started)} · `
      + `${numText(s.f18Telemetry.counters.executionRejected)}`,
      'OBSERVED', 'listeningSessionRuntime',
      'Ses varken EKLENİR (çalan parça baştan ALINMAZ); yalnız sessizken yeni akış kurulur.', t),
    field('f18-queue-limit', 'Kaynak sırayı desteklemedi · açık niyet korundu',
      `${numText(s.f18Telemetry.counters.queueUnsupported)} · `
      + `${numText(s.f18Telemetry.counters.explicitIntentDeferred)}`,
      'OBSERVED', 'sourceCapabilities',
      'YouTube iframe / Spotify Connect gibi kaynaklarda ekleme "olmuş gibi" GÖSTERİLMEZ (F7.6).', t),
    field('f18-repetition', 'Tekrar: elenen · geri alınan · sanatçı aralaması',
      `${numText(s.f18Telemetry.counters.recentExcluded)} · `
      + `${numText(s.f18Telemetry.counters.recentReadmitted)} · `
      + `${numText(s.f18Telemetry.counters.artistSpacing)}`,
      'OBSERVED', 'smartRadioModel',
      'Tekrar SINIRLI azaltılır; havuz yetmezse geri alınır ve SAYILIR (sessiz düşürme yok).', t),
    field('f18-last', 'Son plan (durum · iddia · çekirdek · uzunluk · ölçülmüş)',
      s.f18Telemetry.lastStatus === null ? NA
        : `${s.f18Telemetry.lastStatus} · ${s.f18Telemetry.lastClaim ?? NA} · `
          + `${s.f18Telemetry.lastSeed ?? NA} · ${numText(s.f18Telemetry.lastLength)} · `
          + `${numText(s.f18Telemetry.lastMeasured)}`,
      s.f18Telemetry.lastStatus === null ? 'UNAVAILABLE' : 'OBSERVED', 'smartRadioTelemetry',
      'Hangi parçaların seçildiği BURADA YOKTUR — yalnız adet ve sınıf (gizlilik sınırı).', t),
    field('f18-latency', 'Plan süresi p50 · p95',
      `${numText(s.f18Telemetry.planP50Ms === null ? null : Math.round(s.f18Telemetry.planP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f18Telemetry.planP95Ms === null ? null : Math.round(s.f18Telemetry.planP95Ms * 100) / 100, ' ms')}`,
      s.f18Telemetry.samples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'smartRadioTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte beklenir.', t),
  ];

  /* ── MUSIC F19 · SEVİYE TUTARLILIĞI (LOUDNESS / REPLAYGAIN) ──────────────
   * ÖLÇÜLEN GERÇEK: `volumePolicy.sourceNormalization` alanı F19'a kadar HİÇ
   * beslenmiyordu (daima 1). Kart hangi kanıtın kullanıldığını ve ne kadar
   * KISILDIĞINI gösterir. LAB normalizasyon UYGULAMAZ (rule 4). */
  const f19: InspectorField[] = [
    field('f19-started', 'Seviye katmanı çalışıyor', s.f19Started ? 'EVET' : 'HAYIR',
      s.f19Started ? 'OBSERVED' : 'UNAVAILABLE', 'SystemBoot · music-loudness',
      'Düşerse normalizasyon olmaz ama müzik ETKİLENMEZ (fail-soft).', t),
    field('f19-bounds', 'Referans · en fazla kısma · duyulur eşik',
      `${numText(s.f19ReferenceDbfs, ' dBFS')} · ${numText(s.f19MaxAttenuationDb, ' dB')} · `
      + `${numText(s.f19MinAdjustmentDb, ' dB')}`,
      'OBSERVED', 'loudnessEvidence',
      'Referans bir LUFS hedefi DEĞİLDİR (düz RMS) — saha kalibrasyonu kütükte beklenir.', t),
    field('f19-evidence', 'Son kanıt kaynağı', s.f19Provenance,
      s.f19Provenance === 'NONE' ? 'UNAVAILABLE' : 'OBSERVED', 'loudnessRuntime',
      'ETİKET (ReplayGain/R128) ölçümden GÜÇLÜDÜR; ikisi de yoksa çarpan tam 1.0 kalır.', t),
    field('f19-factor', 'Uygulanan çarpan · kısma · kanıtın istediği',
      `${numText(Math.round(s.f19Factor * 1000) / 1000)} · ${numText(s.f19AppliedDb, ' dB')} · `
      + `${numText(s.f19RequestedDb, ' dB')}`,
      s.f19Provenance === 'NONE' ? 'UNAVAILABLE' : 'OBSERVED', 'computeNormalization',
      'Çarpan YALNIZ kısar (≤ 1): yükseltmek headroom tüketir ve clipping üretir.', t),
    field('f19-bypass', 'Nötr bırakma nedeni · tavana takıldı',
      `${s.f19BypassReason ?? 'UYGULANDI'} · ${s.f19Clamped ? 'EVET' : 'HAYIR'}`,
      'OBSERVED', 'loudnessEvidence',
      'BOOST_NOT_SUPPORTED bilinçli bir SINIRDIR: sessiz parça yükseltilmez.', t),
    field('f19-evidence-mix', 'Kanıt kökeni (ReplayGain · R128 · ölçülmüş RMS · yok)',
      `${numText(s.f19Telemetry.counters.evidenceReplayGain)} · `
      + `${numText(s.f19Telemetry.counters.evidenceR128)} · `
      + `${numText(s.f19Telemetry.counters.evidenceMeasured)} · `
      + `${numText(s.f19Telemetry.counters.evidenceNone)}`,
      'OBSERVED', 'loudnessTelemetry',
      'Hiçbiri LUFS DEĞİLDİR ve öyle sunulmaz — etiket ya da düz RMS ölçümü.', t),
    field('f19-outcomes', 'Değerlendirilen · uygulanan · nötr · aynı kaldı',
      `${numText(s.f19Telemetry.counters.evaluated)} · ${numText(s.f19Telemetry.counters.applied)} · `
      + `${numText(s.f19Telemetry.counters.neutral)} · `
      + `${numText(s.f19Telemetry.counters.unchangedSkipped)}`,
      'OBSERVED', 'loudnessTelemetry',
      'Aynı parçada çarpan yeniden YAZILMAZ — gereksiz yazım "pumping" üretirdi.', t),
    field('f19-cache', 'Etiket önbelleği (bounded) · yazım hatası',
      `${numText(s.f19GainTagCacheSize)} · ${numText(s.f19Telemetry.counters.applyFailures)}`,
      'OBSERVED', 'loudnessRuntime',
      'Yalnız ADET — hangi parçanın etiketi olduğu burada YOKTUR (gizlilik sınırı).', t),
    field('f19-latency', 'Karar süresi p50 · p95',
      `${numText(s.f19Telemetry.applyP50Ms === null ? null : Math.round(s.f19Telemetry.applyP50Ms * 100) / 100, ' ms')} · `
      + `${numText(s.f19Telemetry.applyP95Ms === null ? null : Math.round(s.f19Telemetry.applyP95Ms * 100) / 100, ' ms')}`,
      s.f19Telemetry.samples > 0 ? 'OBSERVED' : 'UNAVAILABLE', 'loudnessTelemetry',
      'HOST süresi CİHAZ performansı DEĞİLDİR — saha ölçümü kütükte beklenir.', t),
  ];

  /* ── MUSIC F20 · PARÇA GEÇİŞİ (GAPLESS / FADE) ───────────────────────────
   * ÖLÇÜLEN GERÇEK: gapless ZATEN vardır (ExoPlayer); gerçek crossfade bu
   * mimaride MÜMKÜN DEĞİLDİR (tek player). Kart bunu gizlemeden gösterir. */
  const f20: InspectorField[] = [
    field('f20-started', 'Geçiş politikası çalışıyor', s.f20Started ? 'EVET' : 'HAYIR',
      s.f20Started ? 'OBSERVED' : 'UNAVAILABLE', 'SystemBoot · music-transition',
      'Düşerse geçiş politikası uygulanmaz ama müzik ETKİLENMEZ (fail-soft).', t),
    field('f20-capabilities', 'Yetenek (gapless · fade · crossfade · beat)',
      s.f20Capabilities.length === 0 ? NA
        : s.f20Capabilities.map((c) => `${c.id}:${c.state}`).join(' · '),
      s.f20Capabilities.length === 0 ? 'UNAVAILABLE' : 'OBSERVED', 'transitionModel',
      'GERÇEK crossfade ve beat hizalama DESTEKLENMEZ — varmış gibi gösterilmez.', t),
    field('f20-preference', 'Kullanıcı tercihi (açık mı · süre)',
      `${s.f20FadeEnabled ? 'AÇIK' : 'KAPALI'} · ${numText(s.f20PreferredFadeMs, ' ms')}`,
      'OBSERVED', 'transitionRuntime',
      'Varsayılan KAPALIDIR: duyulur davranış değişikliği kullanıcının kararıdır.', t),
    field('f20-last-policy', 'Son karar (tür · gerekçe · süre · kanıtlı mı)',
      `${s.f20Kind} · ${s.f20Reason} · ${numText(s.f20FadeOutMs, ' ms')} · `
      + `${s.f20EvidenceBacked ? 'EVET' : 'HAYIR'}`,
      s.f20Kind === 'UNKNOWN' ? 'UNAVAILABLE' : 'OBSERVED', 'decideTransition',
      'Süre yalnız GERÇEK ölçümden ayarlanır; vuruş hizalama İDDİA EDİLMEZ.', t),
    field('f20-decisions', 'Karar: boşluksuz · fade · uygulanmadı',
      `${numText(s.f20Telemetry.counters.gapless)} · ${numText(s.f20Telemetry.counters.fade)} · `
      + `${numText(s.f20Telemetry.counters.none)}`,
      'OBSERVED', 'transitionTelemetry',
      'Albüm devamlılığında fade UYGULANMAZ — eserin kendisi bozulmaz.', t),
    field('f20-skips', 'Uygulanmama nedeni (kapalı · canlı · duck)',
      `${numText(s.f20Telemetry.counters.skippedDisabled)} · `
      + `${numText(s.f20Telemetry.counters.skippedLive)} · `
      + `${numText(s.f20Telemetry.counters.skippedDuck)}`,
      'OBSERVED', 'transitionTelemetry',
      'Canlı yayında ve Caros konuşurken geçiş UYGULANMAZ (duck ile çakışmaz).', t),
    field('f20-push', 'Native yazım: kabul · red · düştü · değişmedi',
      `${numText(s.f20Telemetry.counters.pushAccepted)} · `
      + `${numText(s.f20Telemetry.counters.pushRejected)} · `
      + `${numText(s.f20Telemetry.counters.pushFailed)} · `
      + `${numText(s.f20Telemetry.counters.unchangedSkipped)}`,
      'OBSERVED', 'mediaCommandGateway.setTransitionPolicy',
      'Aynı politika iki kez YAZILMAZ; reddedilen yazım "uygulandı" SAYILMAZ.', t),
    field('f20-native', 'Native geçiş kazancı · etkin mi · gapless',
      `${numText(s.f20NativeGain)} · ${s.f20NativeActive === null ? NA : (s.f20NativeActive ? 'EVET' : 'HAYIR')} · `
      + `${s.f20GaplessSupported === null ? NA : (s.f20GaplessSupported ? 'EVET' : 'HAYIR')}`,
      s.f20NativeGain === null ? 'UNAVAILABLE' : 'OBSERVED', 'CarosPlaybackService',
      'Geçiş kazancı playback TRUTH DEĞİLDİR: `playing`/`renderingVerified` ondan etkilenmez.', t),
    field('f20-persistence', 'Kalıcılık: yazma hatası · reddedilen kayıt',
      `${numText(s.f20Telemetry.counters.persistWriteFailures)} · `
      + `${numText(s.f20Telemetry.counters.persistLoadRejected)}`,
      'OBSERVED', 'transitionRuntime',
      'Şema değişince eski tercih REDDEDİLİR (§13) ve varsayılana düşülür.', t),
  ];

  /* ── MUSIC F21 · SÜREKLİLİK / KURTARMA ───────────────────────────────────
   * ÖLÇÜLEN GERÇEK: geri yükleme ASLA çalmaz (`playbackClaim: NONE`) ve
   * süreklilik `UNKNOWN` başlar. F21 buna iki şey ekledi: süresi dolmuş uzak
   * adresin DÜŞÜRÜLMESİ ve fail-closed otomatik devam kararı. */
  const f21: InspectorField[] = [
    field('f21-session', 'Oturum kayıttan geri yüklendi mi · çalınabilir girdi',
      `${s.f21SessionRestored ? 'EVET' : 'HAYIR'} · ${numText(s.f21PlayableEntries)}`,
      'OBSERVED', 'listeningSession',
      'Geri yüklenmiş oturum CANLI GÖZLEM DEĞİLDİR — süreklilik doğrulanana kadar BİLİNMİYOR.', t),
    field('f21-ignition', 'Kontak kanıtı', s.f21Ignition,
      s.f21Ignition === 'UNKNOWN' ? 'UNAVAILABLE' : 'OBSERVED', 'recoverySources',
      'CarOS\'ta ayrı bir kontak hattı YOKTUR: kanıt yalnız RPM/akü geriliminden gelir — UYDURULMAZ.', t),
    field('f21-network', 'Ağ · kaynak ağ gerektiriyor mu · kaynak',
      `${s.f21Online ? 'VAR' : 'YOK'} · ${s.f21RequiresNetwork ? 'EVET' : 'HAYIR'} · `
      + `${s.f21QueueSource ?? NA}`,
      'OBSERVED', 'recoverySources',
      'Yerel dosya çevrimdışı da çalar; ağ gerektiren kaynakta dürüstçe teklif edilir.', t),
    field('f21-auto-resume-policy', 'UI\'sız otomatik devam politikası',
      s.f21AutoResumePolicy ? 'AÇIK' : 'KAPALI',
      'OBSERVED', 'recoveryRuntime.POLICY_ALLOWS_AUTO_RESUME',
      'KAPALI: kullanıcı dokunmadan ses BAŞLAMAZ (kütük #1121). Karar tek yerde ve görünürdür.', t),
    field('f21-restore',
      'Geri yükleme: açılış girişi · deneme · başarılı · reddedilen · native canlı (atlandı)',
      `${numText(s.f21Telemetry.counters.bootRestoreRuns)} · `
      + `${numText(s.f21Telemetry.counters.restoreAttempts)} · `
      + `${numText(s.f21Telemetry.counters.restoreSucceeded)} · `
      + `${numText(s.f21Telemetry.counters.restoreRejected)} · `
      + `${numText(s.f21Telemetry.counters.bootRestoreSkippedNativeLive)}`,
      'OBSERVED', 'recoveryTelemetry',
      'Açılış girişi EXACTLY-ONCE\'tur: ilk sütun 1\'i AŞARSA ARIZADIR. '
      + 'Native oturum canlıyken geri yükleme ATLANIR (duplicate kuyruk yok). '
      + 'Bozuk/yabancı şemalı kayıt BÜTÜN olarak reddedilir.', t),
    field('f21-entries', 'Girdi sınıfı: yerel · çalmada çözülen · bayat düşürülen',
      `${numText(s.f21Telemetry.counters.entriesLocal)} · `
      + `${numText(s.f21Telemetry.counters.entriesResolveAtPlay)} · `
      + `${numText(s.f21Telemetry.counters.entriesExpiringDropped + s.f21Telemetry.counters.entriesUnknownDropped)}`,
      'OBSERVED', 'recoveryModel.classifyEntryFreshness',
      'Süresi dolmuş uzak adres CANLI SAYILMAZ — geri yüklemede düşürülür ve SAYILIR.', t),
    field('f21-auto-resume', 'Karar: bekle · teklif · devam et',
      `${numText(s.f21Telemetry.counters.autoResumeHold)} · `
      + `${numText(s.f21Telemetry.counters.autoResumeOffer)} · `
      + `${numText(s.f21Telemetry.counters.autoResumeResume)}`,
      'OBSERVED', 'decideAutoResume',
      'FAIL-CLOSED: kontak ölçülemiyorsa (UNKNOWN) otomatik devam ASLA verilmez.', t),
    field('f21-last', 'Son karar · gerekçe · kontak · ağ',
      s.f21Telemetry.lastDecision === null ? NA
        : `${s.f21Telemetry.lastDecision} · ${s.f21Telemetry.lastReason ?? NA} · `
          + `${s.f21Telemetry.lastIgnition ?? NA} · `
          + `${s.f21Telemetry.lastOnline === null ? NA : (s.f21Telemetry.lastOnline ? 'VAR' : 'YOK')}`,
      s.f21Telemetry.lastDecision === null ? 'UNAVAILABLE' : 'OBSERVED', 'recoveryTelemetry',
      'Hangi parça olduğu BURADA YOKTUR — yalnız karar ve kanıt (gizlilik sınırı).', t),
    field('f21-blocked', 'Kontak ölçülemedi · çevrimdışı engellendi · son red',
      `${numText(s.f21Telemetry.counters.ignitionUnknown)} · `
      + `${numText(s.f21Telemetry.counters.offlineBlocked)} · `
      + `${s.f21Telemetry.lastRestoreRejection ?? NA}`,
      'OBSERVED', 'recoveryTelemetry',
      'Ölçülemeyen kontak bir ARIZA değil, dürüst bir BİLİNMİYORdur.', t),
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
    { id: 'library', title: '11 · Yerel Kütüphane (F2)', fields: library },
    { id: 'artwork', title: '12 · Kapak Önbelleği (F2)', fields: artwork },
    { id: 'listening-session', title: '13 · Dinleme Bağlamı (F3)', fields: session3 },
    { id: 'observed-queue', title: '14 · Gözlenen Kuyruk Kanıtı (F3)', fields: observed3 },
    { id: 'handover-commit', title: '15 · Devir → Oturum Commit (F3)', fields: handover3 },
    { id: 'unified-search', title: '16 · Birleşik Arama (F5)', fields: search },
    { id: 'audio-experience', title: '17 · Ses Deneyimi / DSP (F6)', fields: dsp },
    { id: 'driving-intelligence', title: '18 · Sürüş-Farkında Müzik (F8)', fields: f8 },
    { id: 'mavi-music-intent', title: '19 · Mavi Müzik Niyeti (F9)', fields: f9 },
    { id: 'music-traits', title: '20 · Karakter / Enerji Kanıtı (F10)', fields: f10 },
    { id: 'music-collection', title: '21 · Favoriler / Koleksiyon (F13)', fields: f13 },
    { id: 'music-playlist', title: '22 · Playlist Otoritesi (F15)', fields: f15 },
    { id: 'music-lyrics', title: '23 · Şarkı Sözleri Otoritesi (F16)', fields: f16 },
    { id: 'music-sonic', title: '24 · Ses Ölçümü / Sonic (F17)', fields: f17 },
    { id: 'music-radio', title: '25 · Kesintisiz Akış / Smart Radio (F18)', fields: f18 },
    { id: 'music-loudness', title: '26 · Seviye Tutarlılığı (F19)', fields: f19 },
    { id: 'music-transition', title: '27 · Parça Geçişi (F20)', fields: f20 },
    { id: 'music-recovery', title: '28 · Süreklilik / Kurtarma (F21)', fields: f21 },
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

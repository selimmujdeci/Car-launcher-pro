/**
 * appControlExecutor — `parseAppControl` sonucunu MEVCUT sahiplerine yaptırır.
 *
 *  · karışık / tekrar → `mediaCommandGateway` (tek medya komut kapısı, kanıt döner)
 *  · sarma → `carosMediaLayer.seek` (aktif backend'e yönlendirir)
 *  · tema → `useCarTheme` (gündüz/gece tercihi korunur, geri okunur)
 *  · sürücü → `driverProfileService.switchDriver`
 *
 * Yeni otorite/durum YOK. Cümle YALNIZ sonuçtan kurulur: kanıt yoksa "yaptım"
 * denmez, kaynak desteklemiyorsa dürüstçe söylenir.
 */
import type { AppControl, CoreThemeName } from './appControlCommands';
import { matchDriverName } from './appControlCommands';

export interface AppControlOutcome {
  readonly ok: boolean;
  readonly text: string;
}

const THEME_LABEL: Record<CoreThemeName, string> = {
  expedition: 'Expedition', horizon: 'Horizon', tesla: 'Tesla', pro: 'Pro',
};

function fmtDelta(sec: number): string {
  const a = Math.abs(sec);
  return a % 60 === 0 ? `${a / 60} dakika` : `${a} saniye`;
}

export async function executeAppControl(c: AppControl): Promise<AppControlOutcome> {
  switch (c.op) {
    case 'shuffle':
    case 'repeat': {
      const gw = await import('../media/authority/mediaCommandGateway');
      const truth = c.op === 'shuffle' ? await gw.setShuffle(c.on) : await gw.setRepeat(c.mode);
      if (truth.outcome === 'FAILED' || truth.outcome === 'TIMED_OUT') {
        return { ok: false, text: c.op === 'shuffle'
          ? 'Bu kaynakta karışık çalmayı değiştiremiyorum.'
          : 'Bu kaynakta tekrar modunu değiştiremiyorum.' };
      }
      if (c.op === 'shuffle') return { ok: true, text: c.on ? 'Karışık çalma açık.' : 'Karışık çalma kapalı.' };
      return { ok: true, text: c.mode === 'one' ? 'Bu şarkı tekrarlanacak.'
        : c.mode === 'all' ? 'Liste tekrarlanacak.' : 'Tekrar kapalı.' };
    }

    case 'seek':
    case 'restart': {
      const [{ getMediaState }, layer] = await Promise.all([
        import('../mediaService'), import('../media/carosMediaLayer'),
      ]);
      const st = getMediaState();
      if (!st.track || st.source === 'unknown') return { ok: false, text: 'Şu an çalan bir parça yok.' };
      if (c.op === 'restart') { layer.seek(0); return { ok: true, text: 'Şarkıyı baştan başlatıyorum.' }; }
      const pos = Number.isFinite(st.track.positionSec) ? st.track.positionSec : null;
      if (pos === null) return { ok: false, text: 'Parçanın konumunu okuyamadım.' };
      const dur = st.track.durationSec > 0 ? st.track.durationSec : null;
      if (dur === null && c.deltaSec > 0) return { ok: false, text: 'Bu yayında ileri saramıyorum.' };
      const target = Math.max(0, dur !== null ? Math.min(dur - 1, pos + c.deltaSec) : pos + c.deltaSec);
      layer.seek(target);
      return { ok: true, text: `${fmtDelta(c.deltaSec)} ${c.deltaSec > 0 ? 'ileri' : 'geri'} alıyorum.` };
    }

    case 'theme': {
      const { useCarTheme, isDay, toDay } = await import('../../store/useCarTheme');
      const st = useCarTheme.getState();
      const target = isDay(st.theme) ? toDay(c.theme) : c.theme;
      st.setTheme(target);
      const after = useCarTheme.getState().theme;
      return after === target
        ? { ok: true, text: `${THEME_LABEL[c.theme]} teması açıldı.` }
        : { ok: false, text: 'Temayı değiştiremedim.' };
    }

    case 'info': {
      const [{ getMediaState }, nav, { useStore }] = await Promise.all([
        import('../mediaService'), import('../navigationService'), import('../../store/useStore'),
      ]);
      if (c.what === 'now_playing') {
        const m = getMediaState();
        /* Radyo/akışın MediaSource karşılığı yok ('unknown') — ÇALIYORSA adı söylenir
           (smoke 2026-09-26: Kral FM çalarken "çalan parça yok" diyordu). */
        if (!m.track?.title || (m.source === 'unknown' && !m.playing)) return { ok: false, text: 'Şu an çalan bir parça yok.' };
        const who = m.track.artist ? `, ${m.track.artist}` : '';
        return { ok: true, text: m.playing ? `Çalan: ${m.track.title}${who}.` : `Duraklatıldı. Son parça: ${m.track.title}${who}.` };
      }
      if (c.what === 'eta' || c.what === 'remaining') {
        const n = nav.getNavigationState();
        if (n.status === nav.NavStatus.IDLE || n.status === nav.NavStatus.ERROR) return { ok: false, text: 'Şu an aktif bir rota yok.' };
        /* Ön izleme: sürüş başlamadı, canlı ETA/kalan yok — ama kurulan rotanın ölçülen
           toplamı var; onu "rota" diye söyle (smoke 2026-09-26: "hesaplayamadım" diyordu). */
        if (n.status === nav.NavStatus.PREVIEW) {
          const { getRouteState } = await import('../routingService');
          const r = getRouteState();
          const dm = r.totalDistanceMeters, ds = r.totalDurationSeconds;
          if (dm > 0 && ds > 0) {
            const km = dm / 1000;
            const kmTxt = km < 1 ? `${Math.round(dm)} metre` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} kilometre`;
            return { ok: true, text: `Rota ${kmTxt}, yaklaşık ${Math.max(1, Math.round(ds / 60))} dakika. Henüz yola çıkılmadı.` };
          }
        }
        if (c.what === 'eta') {
          if (!(typeof n.etaSeconds === 'number' && n.etaSeconds > 0)) return { ok: false, text: 'Varış süresini henüz hesaplayamadım.' };
          return { ok: true, text: `Yaklaşık ${Math.max(1, Math.round(n.etaSeconds / 60))} dakika sonra varıyoruz.` };
        }
        if (!(typeof n.distanceMeters === 'number' && n.distanceMeters > 0)) return { ok: false, text: 'Kalan mesafeyi henüz hesaplayamadım.' };
        const km = n.distanceMeters / 1000;
        return { ok: true, text: km < 1 ? `${Math.round(n.distanceMeters)} metre kaldı.` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} kilometre kaldı.` };
      }
      const s = useStore.getState().settings;
      if (c.what === 'driver') {
        const d = s.driverProfiles?.find((x) => x.id === s.activeDriverProfileId);
        return d ? { ok: true, text: `Sürücü ${d.name}.` } : { ok: false, text: 'Seçili bir sürücü profili yok.' };
      }
      return Number.isFinite(s.volume) ? { ok: true, text: `Ses yüzde ${s.volume}.` } : { ok: false, text: 'Ses seviyesini okuyamadım.' };
    }

    case 'driver': {
      const [{ useStore }, svc] = await Promise.all([
        import('../../store/useStore'), import('../driverProfileService'),
      ]);
      const drivers = useStore.getState().settings.driverProfiles ?? [];
      if (drivers.length === 0) return { ok: false, text: 'Kayıtlı sürücü profili yok. Ayarlardan ekleyebilirsin.' };
      const names = drivers.map((d) => d.name).join(', ');
      if (c.name === null) return { ok: false, text: `Hangi sürücü? Kayıtlı sürücüler: ${names}.` };
      const hit = matchDriverName(c.name, drivers);
      if (!hit) return { ok: false, text: `${c.name} adında bir sürücü yok. Kayıtlı sürücüler: ${names}.` };
      if (useStore.getState().settings.activeDriverProfileId === hit.id) {
        return { ok: true, text: `Sürücü zaten ${hit.name}.` };
      }
      return svc.switchDriver(hit.id)
        ? { ok: true, text: `Sürücü ${hit.name} oldu, ayarları uygulandı.` }
        : { ok: false, text: 'Sürücüyü değiştiremedim.' };
    }
  }
}

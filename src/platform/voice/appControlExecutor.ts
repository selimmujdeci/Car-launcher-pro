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

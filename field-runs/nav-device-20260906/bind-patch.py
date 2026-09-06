from pathlib import Path
root=Path('C:/Temp/caros-nav-device-20260906')
for name,start,end,callback in [('FullMapView','    const onPanStart =','  }, [mapStatus]);','applyRecenter'),('MiniMapWidget','    const onStart = (e:','  }, [mapReady, reinitKey, recenterOnVehicle]);','recenterOnVehicle')]:
 p=root/f'src/components/map/{name}.tsx';s=p.read_text(encoding='utf-8');s="import { bindMapUserInteraction } from '../../platform/map/bindMapUserInteraction';\n"+s
 a=s.index(start);b=s.index(end,a)
 s=s[:a]+f'    return bindMapUserInteraction(map, notifyUserPanStart, () => notifyUserPanEnd({callback}));\n'+s[b:]
 p.write_text(s,encoding='utf-8',newline='\n')

(()=>performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/mapSource|cameraFollow|mapStyle|thermal|Adaptive/.test(n)))()

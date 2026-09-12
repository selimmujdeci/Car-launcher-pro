# diff_catalog.py — prod kataloğu ile klon kataloğunu KARŞILAŞTIRIR.
import json, io, sys, collections

prod = json.load(io.open(sys.argv[1], encoding='utf-8-sig'))
clone = json.load(io.open(sys.argv[2], encoding='utf-8-sig'))

ROLES = ('anon', 'authenticated', 'service_role')
# Platform kaynaklı gürültüyü ele: yalnız ürün rolleri ve public şema.
def key(r):
    k = r['kind']
    if k == 'grant':
        if r['n'] not in ROLES:
            return None
        return ('grant', r['t'], r['n'], r['d1'])
    if k == 'ext':
        if r['n'] in ('pg_stat_statements', 'supabase_vault', 'pg_cron', 'pg_graphql',
                      'pgjwt', 'pg_net', 'pgsodium', 'supabase_functions', 'plpgsql'):
            return None
        return ('ext', r['n'])
    if k == 'col':
        return ('col', r['t'], r['n'], r['d1'], r['d2'], r['d3'])
    if k == 'con':
        return ('con', r['t'], r['n'], r['d1'])
    if k == 'idx':
        return ('idx', r['t'], r['n'], r['d1'])
    if k == 'fn':
        return ('fn', r['n'], ' '.join(r['d1'].split()))
    if k == 'trg':
        return ('trg', r['d2'], r['t'], r['n'], ' '.join(r['d1'].split()))
    if k == 'rls':
        return ('rls', r['t'], str(r['d1']).lower()[0])
    if k == 'pol':
        return ('pol', r['t'], r['n'], r['d1'], ' '.join(r['d2'].split()), ' '.join(r['d3'].split()))
    if k == 'polr':
        return ('polr', r['t'], r['n'], r['d1'])
    if k == 'enum':
        return ('enum', r['n'], r['ord'], r['d1'])
    if k == 'pub':
        return ('pub', r['n'], r['t'])
    if k == 'tab':
        return ('tab', r['t'])
    return None

P = set(filter(None, (key(r) for r in prod)))
C = set(filter(None, (key(r) for r in clone)))

only_p = sorted(P - C)
only_c = sorted(C - P)

cnt = collections.Counter(k[0] for k in only_p)
cnt2 = collections.Counter(k[0] for k in only_c)
print('PROD toplam anahtar : %d' % len(P))
print('KLON toplam anahtar : %d' % len(C))
print('PRODDA VAR, KLONDA YOK : %d  %s' % (len(only_p), dict(cnt)))
print('KLONDA VAR, PRODDA YOK : %d  %s' % (len(only_c), dict(cnt2)))
print()
for lbl, lst in (('PRODDA VAR / KLONDA YOK', only_p), ('KLONDA VAR / PRODDA YOK', only_c)):
    if not lst:
        continue
    print('### ' + lbl)
    for k in lst[:80]:
        s = ' | '.join(str(x)[:120] for x in k)
        print('   ' + s[:260])
    if len(lst) > 80:
        print('   ... (+%d)' % (len(lst) - 80))
    print()
print('SONUÇ:', 'ŞEMA EŞLEŞTİ (fark yok)' if not only_p and not only_c else 'FARK VAR')

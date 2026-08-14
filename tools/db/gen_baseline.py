# gen_baseline.py — prod kataloğundan (salt-okunur okunmuş) BASELINE SQUASH üretir.
import json, io, collections, sys

SRC = 'prod_full.json'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'prod_baseline.sql'
ROLES = ('anon', 'authenticated', 'service_role')

rows = json.load(io.open(SRC, encoding='utf-8-sig'))
by = collections.defaultdict(list)
for r in rows:
    by[r['kind']].append(r)

def q(ident):
    return '"%s"' % ident.replace('"', '""')

out = []
w = out.append

w("-- =====================================================================")
w("-- 00000000000000_prod_baseline.sql — PROD BASELINE SQUASH")
w("--")
w("-- ÜRETİM YÖNTEMİ: canlı `Carospro` projesinin katalogları SALT-OKUNUR")
w("-- okunup (Management API `read_only:true` → `supabase_read_only_user`)")
w("-- bu dosya OTOMATİK üretildi. Elle yazılmadı, prod'dan TÜRETİLDİ.")
w("--")
w("-- NE İŞE YARAR:")
w("--   · PROD'DA ÇALIŞTIRILMAZ — prod zaten bu durumdadır. Prod'un migration")
w("--     defterine `applied` olarak İŞARETLENİR (baseline squash).")
w("--   · YENİ/TEMİZ bir ortamda ise prod'un bugünkü halini SIFIRDAN kurar.")
w("--")
w("-- KAPSAM: public şeması (tablolar · kısıtlar · indeksler · fonksiyonlar ·")
w("-- trigger'lar · RLS + politikalar · rol ayrıcalıkları · realtime yayını)")
w("-- + auth.users üzerindeki ürün trigger'ı + zamanlanmış temizlik işi.")
w("-- VERİ İÇERMEZ.")
w("-- =====================================================================")
w("")

# ── extensions ───────────────────────────────────────────────────────────
w("-- ── Eklentiler ───────────────────────────────────────────────────────")
for e in sorted(by['ext'], key=lambda r: r['n']):
    if e['n'] in ('plpgsql',):
        continue
    if e['n'] in ('pg_stat_statements', 'supabase_vault', 'pg_cron'):
        w("-- platform eklentisi (Supabase kurar): %s %s" % (e['n'], e['d1']))
        continue
    w('CREATE EXTENSION IF NOT EXISTS %s;' % q(e['n']))
w("")

# ── enums ────────────────────────────────────────────────────────────────
enums = collections.defaultdict(list)
for e in by['enum']:
    enums[e['n']].append((float(e['ord']), e['d1']))
if enums:
    w("-- ── Enum tipleri ─────────────────────────────────────────────────────")
    for name in sorted(enums):
        labels = [l for _, l in sorted(enums[name])]
        w("DO $$ BEGIN")
        w("  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace")
        w("                  WHERE n.nspname='public' AND t.typname='%s') THEN" % name)
        w("    CREATE TYPE public.%s AS ENUM (%s);" % (q(name), ', '.join("'%s'" % l for l in labels)))
        w("  END IF;")
        w("END $$;")
    w("")

# ── tables + columns ─────────────────────────────────────────────────────
cols = collections.defaultdict(list)
for c in by['col']:
    cols[c['t']].append(c)
for t in cols:
    cols[t].sort(key=lambda r: int(r['ord']))

w("-- ── Tablolar ─────────────────────────────────────────────────────────")
for t in sorted(cols):
    lines = []
    for c in cols[t]:
        seg = '  %s %s' % (q(c['n']), c['d1'])
        if c['d3']:
            seg += ' DEFAULT %s' % c['d3']
        if c['d2']:
            seg += ' NOT NULL'
        lines.append(seg)
    w('CREATE TABLE IF NOT EXISTS public.%s (' % q(t))
    w(',\n'.join(lines))
    w(');')
w("")

# ── constraints ──────────────────────────────────────────────────────────
w("-- ── Kısıtlar (PK → UNIQUE → CHECK → FK) ──────────────────────────────")
for c in sorted(by['con'], key=lambda r: (r['ord'], r['t'], r['n'])):
    w("DO $$ BEGIN")
    w("  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='%s'" % c['n'])
    w("                  AND conrelid='public.%s'::regclass) THEN" % c['t'])
    w("    ALTER TABLE public.%s ADD CONSTRAINT %s %s;" % (q(c['t']), q(c['n']), c['d1']))
    w("  END IF;")
    w("END $$;")
w("")

# ── indexes ──────────────────────────────────────────────────────────────
w("-- ── İndeksler (kısıt destekli olanlar hariç) ─────────────────────────")
for i in sorted(by['idx'], key=lambda r: (r['t'], r['n'])):
    ddl = i['d1']
    if ddl.upper().startswith('CREATE UNIQUE INDEX '):
        ddl = ddl.replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ', 1)
    elif ddl.upper().startswith('CREATE INDEX '):
        ddl = ddl.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ', 1)
    w(ddl + ';')
w("")

# ── functions (prod'daki oluşturma sırası = oid sırası) ──────────────────
w("-- ── Fonksiyonlar (gövdeler prod'dan BİREBİR alındı) ──────────────────")
for f in sorted(by['fn'], key=lambda r: int(r['ord'])):
    w(f['d1'].rstrip().rstrip(';') + ';')
    w("")

# ── triggers ─────────────────────────────────────────────────────────────
w("-- ── Trigger'lar ──────────────────────────────────────────────────────")
for tg in sorted(by['trg'], key=lambda r: (r['d2'], r['t'], r['n'])):
    tgt = '%s.%s' % (tg['d2'], q(tg['t']))
    w("DROP TRIGGER IF EXISTS %s ON %s;" % (q(tg['n']), tgt))
    w(tg['d1'] + ';')
w("")

# ── RLS ──────────────────────────────────────────────────────────────────
w("-- ── RLS ──────────────────────────────────────────────────────────────")
for r in sorted(by['rls'], key=lambda x: x['t']):
    if r['d1'] in ('True', 'true', 't'):
        w('ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY;' % q(r['t']))
    else:
        w('-- RLS KAPALI (prod böyle): %s' % r['t'])
w("")

# ── policies ─────────────────────────────────────────────────────────────
polr = {(r['t'], r['n']): r for r in by['polr']}
w("-- ── RLS politikaları ─────────────────────────────────────────────────")
for p in sorted(by['pol'], key=lambda r: (r['t'], r['n'])):
    meta = polr.get((p['t'], p['n']), {})
    roles = meta.get('d1') or 'public'
    perm = (meta.get('d2') or 'PERMISSIVE').upper()
    stmt = ['CREATE POLICY %s ON public.%s' % (q(p['n']), q(p['t']))]
    stmt.append('  AS %s' % ('PERMISSIVE' if perm.startswith('PERM') or perm in ('TRUE', 'T') else 'RESTRICTIVE'))
    stmt.append('  FOR %s' % p['d1'])
    stmt.append('  TO %s' % ', '.join(q(x.strip()) if x.strip() != 'public' else 'public'
                                      for x in roles.split(',')))
    if p['d2']:
        stmt.append('  USING (%s)' % p['d2'])
    if p['d3']:
        stmt.append('  WITH CHECK (%s)' % p['d3'])
    w('DROP POLICY IF EXISTS %s ON public.%s;' % (q(p['n']), q(p['t'])))
    w('\n'.join(stmt) + ';')
w("")

# ── grants ───────────────────────────────────────────────────────────────
gr = collections.defaultdict(set)
for g in by['grant']:
    if g['n'] in ROLES:
        gr[(g['t'], g['n'])].add(g['d1'])
w("-- ── Rol ayrıcalıkları (prod'daki ACL'lerin BİREBİR karşılığı) ────────")
w("-- Önce sıfırla, sonra prod'daki kümeyi ver → hedef ortamın varsayılan")
w("-- ayrıcalıklarından BAĞIMSIZ olarak prod ile aynı sonucu üretir.")
for t in sorted(cols):
    w('REVOKE ALL ON TABLE public.%s FROM anon, authenticated, service_role;' % q(t))
    for role in ROLES:
        privs = sorted(gr.get((t, role), ()))
        if privs:
            w('GRANT %s ON TABLE public.%s TO %s;' % (', '.join(privs), q(t), role))
w("")

# ── realtime publication ─────────────────────────────────────────────────
pubs = [p for p in by['pub'] if p['n'] == 'supabase_realtime']
if pubs:
    w("-- ── Realtime yayını ──────────────────────────────────────────────────")
    w("DO $$ BEGIN")
    w("  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN")
    w("    CREATE PUBLICATION supabase_realtime;")
    w("  END IF;")
    w("END $$;")
    for p in sorted(pubs, key=lambda r: r['t']):
        w("DO $$ BEGIN")
        w("  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr")
        w("                   JOIN pg_publication pb ON pb.oid=pr.prpubid")
        w("                  WHERE pb.pubname='supabase_realtime'")
        w("                    AND pr.prrelid='public.%s'::regclass) THEN" % p['t'])
        w("    ALTER PUBLICATION supabase_realtime ADD TABLE public.%s;" % q(p['t']))
        w("  END IF;")
        w("END $$;")
    w("")

# ── cron ─────────────────────────────────────────────────────────────────
w("-- ── Zamanlanmış iş (prod'da canlı: günlük telemetri temizliği) ───────")
w("DO $$ BEGIN")
w("  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')")
w("     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE command='SELECT cleanup_old_telemetry()') THEN")
w("    PERFORM cron.schedule('cleanup-old-telemetry', '0 3 * * *', 'SELECT cleanup_old_telemetry()');")
w("  END IF;")
w("EXCEPTION WHEN OTHERS THEN")
w("  RAISE NOTICE 'baseline: cron işi kurulamadı (%), platformda pg_cron yok olabilir', SQLERRM;")
w("END $$;")
w("")

# ── storage (bucket + politikalar) ───────────────────────────────────────
try:
    st = json.load(io.open('prod_storage.json', encoding='utf-8-sig'))
    st = st if isinstance(st, list) else [st]
except Exception:
    st = []
if st:
    w("-- ── Storage: bucket'lar ve nesne politikaları (prod'dan okundu) ──────")
    for b in [r for r in st if r['kind'] == 'bucket']:
        fsl = b['d'] if b['d'] != '-' else 'NULL'
        mimes = ("ARRAY[%s]" % ', '.join("'%s'" % m for m in b['e'].split(','))) if b['e'] != '-' else 'NULL'
        w("INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)")
        w("VALUES ('%s', '%s', %s, %s, %s)" % (b['a'], b['b'], str(b['c']).lower(), fsl, mimes))
        w("ON CONFLICT (id) DO NOTHING;")
    for p in [r for r in st if r['kind'] == 'policy']:
        qual, chk = (p['e'].split(' ||CHECK|| ') + [''])[:2]
        w('DROP POLICY IF EXISTS %s ON storage.%s;' % (q(p['b']), q(p['a'])))
        stmt = ['CREATE POLICY %s ON storage.%s' % (q(p['b']), q(p['a'])),
                '  FOR %s' % p['c'],
                '  TO %s' % ', '.join(q(x.strip()) for x in p['d'].split(','))]
        if qual.strip():
            stmt.append('  USING (%s)' % qual.strip())
        if chk.strip():
            stmt.append('  WITH CHECK (%s)' % chk.strip())
        w('\n'.join(stmt) + ';')
    w("")

io.open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print('YAZILDI:', OUT, len('\n'.join(out)), 'bayt')
print('tablo=%d  kısıt=%d  indeks=%d  fonksiyon=%d  trigger=%d  politika=%d'
      % (len(cols), len(by['con']), len(by['idx']), len(by['fn']), len(by['trg']), len(by['pol'])))

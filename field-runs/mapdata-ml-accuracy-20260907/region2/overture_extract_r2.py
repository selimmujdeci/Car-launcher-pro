"""MAPDATA — #1321 ikinci bölge (farklı urban morphology) · yalnız BUILDINGS.

Salt okunur, üretim kodunu değiştirmez. Bölge 1 (Tarsus, düşük yoğunluklu
müstakil/bahçeli parsel dokusu) ile karşılaştırma için Mersin şehir merkezi
(yoğun apartman bloğu dokusu) seçildi — belediye merkez noktası, bina aranarak
DEĞİL, tarafsız bir referans koordinat olarak.
"""
import duckdb, json, time
from pathlib import Path

HERE = Path(__file__).parent
REL = "s3://overturemaps-us-west-2/release/2026-08-19.0"

# Mersin sehir merkezi (Buyuksehir Belediyesi civari) - yogun apartman dokusu.
# Bina aranarak degil, bilinen bir kentsel merkez referansi olarak secildi.
CENTER = (34.6339, 36.8121)
HALF_LON = 0.0035   # ~310 m (bu enlemde 1 derece lon ~ 89 km)
HALF_LAT = 0.0028   # ~310 m (1 derece lat ~ 111 km)
BBOX = (CENTER[0]-HALF_LON, CENTER[1]-HALF_LAT, CENTER[0]+HALF_LON, CENTER[1]+HALF_LAT)

def connect():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    con.execute("CREATE OR REPLACE SECRET s (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    return con

def bbox_where(b):
    return f"bbox.xmin < {b[2]} AND bbox.xmax > {b[0]} AND bbox.ymin < {b[3]} AND bbox.ymax > {b[1]}"

def rows(con, sql):
    cur = con.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]

def jsonify(v):
    if isinstance(v, (str, int, float, bool)) or v is None: return v
    if isinstance(v, (list, tuple)): return [jsonify(x) for x in v]
    if isinstance(v, dict): return {k: jsonify(x) for k, x in v.items()}
    return str(v)

def main():
    con = connect()
    t0 = time.time()
    print("region2 buildings...", BBOX)
    b = rows(con, f"""
        SELECT id, names.primary AS name, height, num_floors, subtype, class, version,
               to_json(sources) AS sources_json,
               ST_AsGeoJSON(geometry) AS geojson,
               bbox.xmin AS xmin, bbox.ymin AS ymin, bbox.xmax AS xmax, bbox.ymax AS ymax
        FROM read_parquet('{REL}/theme=buildings/type=building/*.parquet')
        WHERE {bbox_where(BBOX)}
    """)
    (HERE / "overture-buildings-r2.json").write_text(
        json.dumps(jsonify(b), ensure_ascii=False, indent=2), encoding="utf-8")
    elapsed = round(time.time()-t0, 1)
    print(f"  buildings={len(b)} t={elapsed}s")
    (HERE / "overture-run-r2.json").write_text(json.dumps({
        "release": "2026-08-19.0", "bbox": BBOX, "center": CENTER,
        "region": "Mersin merkez — yoğun apartman dokusu",
        "elapsedSec": elapsed, "count": len(b),
    }, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()

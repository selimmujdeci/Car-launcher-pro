"""MAPDATA-F1 — Tarsus çok kaynaklı ölçüm · Overture çekimi (SALT OKUNUR).

Üretim kodunu DEĞİŞTİRMEZ. Yalnız bu klasöre kanıt yazar.
Kaynak: Overture Maps Foundation public S3 (CDLA-Permissive-2.0).
Karşılaştırma tabanı: field-runs/map-data-coverage-20260907/ (OSM + OpenFreeMap).
"""
import duckdb, json, time, sys
from pathlib import Path

HERE = Path(__file__).parent
REL = "s3://overturemaps-us-west-2/release/2026-08-19.0"
RELEASE_ID = "2026-08-19.0"

# Kanonik z14 karo 9778/6381 bbox'ı — önceki denetimle BİREBİR aynı alan.
TILE_BBOX = (34.8486328125, 36.91476428895592, 34.87060546875, 36.93233006150314)
# Yakın çevre ~400x400 m.
NEAR_BBOX = (34.85985, 36.9157, 34.86435, 36.9193)
# Uydu görüntüsünde görülüp OSM/production'da BULUNAMAYAN üç çatı örneği.
ROOFS = [
    (34.861475229263306, 36.918384129749924),
    (34.86132502555847, 36.9179295146294),
    (34.8616361618042, 36.91821257719264),
]


def connect():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    con.execute("CREATE OR REPLACE SECRET s (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    return con


def bbox_where(b, alias=""):
    p = f"{alias}." if alias else ""
    return (f"{p}bbox.xmin < {b[2]} AND {p}bbox.xmax > {b[0]} "
            f"AND {p}bbox.ymin < {b[3]} AND {p}bbox.ymax > {b[1]}")


def rows(con, sql):
    cur = con.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def jsonify(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, (list, tuple)):
        return [jsonify(x) for x in v]
    if isinstance(v, dict):
        return {k: jsonify(x) for k, x in v.items()}
    return str(v)


def save(name, obj):
    (HERE / name).write_text(json.dumps(jsonify(obj), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {name}")


def main():
    con = connect()
    out = {"release": RELEASE_ID, "retrievedFrom": REL, "tileBbox": TILE_BBOX, "nearBbox": NEAR_BBOX}
    t0 = time.time()

    print("buildings...")
    b = rows(con, f"""
        SELECT id, names.primary AS name, height, num_floors, subtype, class, version,
               to_json(sources) AS sources_json,
               ST_AsGeoJSON(geometry) AS geojson,
               bbox.xmin AS xmin, bbox.ymin AS ymin, bbox.xmax AS xmax, bbox.ymax AS ymax
        FROM read_parquet('{REL}/theme=buildings/type=building/*.parquet')
        WHERE {bbox_where(TILE_BBOX)}
    """)
    save("overture-buildings.json", b)
    print(f"  buildings={len(b)} t={round(time.time()-t0,1)}s")

    print("transportation segments...")
    t = rows(con, f"""
        SELECT id, names.primary AS name, subtype, class, version,
               to_json(sources) AS sources_json,
               ST_AsGeoJSON(geometry) AS geojson
        FROM read_parquet('{REL}/theme=transportation/type=segment/*.parquet')
        WHERE {bbox_where(TILE_BBOX)}
    """)
    save("overture-segments.json", t)
    print(f"  segments={len(t)} t={round(time.time()-t0,1)}s")

    print("addresses...")
    try:
        a = rows(con, f"""
            SELECT id, number, street, postcode, unit, country, version,
                   to_json(sources) AS sources_json,
                   ST_AsGeoJSON(geometry) AS geojson
            FROM read_parquet('{REL}/theme=addresses/type=address/*.parquet')
            WHERE {bbox_where(TILE_BBOX)}
        """)
    except Exception as e:
        a = {"error": str(e)}
    save("overture-addresses.json", a)
    print(f"  addresses={len(a) if isinstance(a, list) else a} t={round(time.time()-t0,1)}s")

    print("places...")
    p = rows(con, f"""
        SELECT id, names.primary AS name, to_json(categories) AS categories_json,
               confidence, version, to_json(sources) AS sources_json,
               ST_AsGeoJSON(geometry) AS geojson
        FROM read_parquet('{REL}/theme=places/type=place/*.parquet')
        WHERE {bbox_where(TILE_BBOX)}
    """)
    save("overture-places.json", p)
    print(f"  places={len(p)} t={round(time.time()-t0,1)}s")

    print("roof point-in-polygon test...")
    roof_hits = []
    for i, (lon, lat) in enumerate(ROOFS):
        hits = rows(con, f"""
            SELECT id, to_json(sources) AS sources_json, ST_AsGeoJSON(geometry) AS geojson
            FROM read_parquet('{REL}/theme=buildings/type=building/*.parquet')
            WHERE bbox.xmin < {lon + 0.0005} AND bbox.xmax > {lon - 0.0005}
              AND bbox.ymin < {lat + 0.0005} AND bbox.ymax > {lat - 0.0005}
              AND ST_Contains(geometry, ST_Point({lon}, {lat}))
        """)
        roof_hits.append({"index": i, "lon": lon, "lat": lat, "matches": hits})
        print(f"  roof[{i}] matches={len(hits)}")
    save("overture-roof-probe.json", roof_hits)

    out["elapsedSec"] = round(time.time() - t0, 1)
    out["counts"] = {
        "buildings": len(b), "segments": len(t),
        "addresses": len(a) if isinstance(a, list) else 0, "places": len(p),
    }
    save("overture-run.json", out)
    print("DONE", out["elapsedSec"], "s")


if __name__ == "__main__":
    sys.exit(main())

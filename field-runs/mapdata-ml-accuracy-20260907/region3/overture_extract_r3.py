"""MAPDATA ML rescue — üçüncü doku: Erdemli kuzey çeperi, düşük yoğunluklu banliyö.

Sürümü sabit Overture bina kayıtlarını salt okunur çeker. Çıktı yalnız benchmark
kanıtıdır; production ingestion değildir.
"""
import duckdb, json, time
from pathlib import Path

HERE = Path(__file__).parent
REL = "s3://overturemaps-us-west-2/release/2026-08-19.0"
CENTER = (34.2940, 36.6350)
HALF_LON = 0.0040
HALF_LAT = 0.0032
BBOX = (CENTER[0]-HALF_LON, CENTER[1]-HALF_LAT,
        CENTER[0]+HALF_LON, CENTER[1]+HALF_LAT)

def main():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    con.execute("CREATE OR REPLACE SECRET s (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    t0 = time.time()
    cur = con.execute(f"""
        SELECT id, names.primary AS name, height, num_floors, subtype, class, version,
               to_json(sources) AS sources_json, ST_AsGeoJSON(geometry) AS geojson,
               bbox.xmin AS xmin, bbox.ymin AS ymin, bbox.xmax AS xmax, bbox.ymax AS ymax
        FROM read_parquet('{REL}/theme=buildings/type=building/*.parquet')
        WHERE bbox.xmin < {BBOX[2]} AND bbox.xmax > {BBOX[0]}
          AND bbox.ymin < {BBOX[3]} AND bbox.ymax > {BBOX[1]}
    """)
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    (HERE / "overture-buildings-r3.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    (HERE / "overture-run-r3.json").write_text(json.dumps({
        "release": "2026-08-19.0", "bbox": BBOX, "center": CENTER,
        "region": "Erdemli kuzey çeperi — düşük yoğunluklu banliyö",
        "elapsedSec": round(time.time()-t0, 1), "count": len(rows),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"count": len(rows), "bbox": BBOX}, ensure_ascii=False))

if __name__ == "__main__":
    main()

"""CarOS Pro MapData — üç sabit AOI için salt-okunur kaynak shootout'u.

Bu araç üretim hattı değildir. Yalnız resmî ve herkese açık erişim yollarını
kullanır; MapStore, renderer, routing, search veya CEH'e yazmaz. Ağ çıktıları
bu klasör altında sürümlü kanıt olarak saklanır ve sonraki çalıştırmalarda
önbellekten okunur.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import statistics
import sys
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
DERIVED = HERE / "derived"
RAW.mkdir(parents=True, exist_ok=True)
DERIVED.mkdir(parents=True, exist_ok=True)

MEASURED_DATE = date(2026, 9, 7)
OVERTURE_RELEASE = "2026-08-19.0"
OVERTURE_ROOT = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}"
OVERTURE_STAC = "https://stac.overturemaps.org/catalog.json"
OSM_ENDPOINT = "https://api.openstreetmap.org/api/0.6/map"
GEONAMES_URL = "https://download.geonames.org/export/dump/TR.zip"
USER_AGENT = "CarOS-Pro-MapData-Bounded-Benchmark/1.0 (research; three small AOIs)"

REGIONS = (
    {"id": "TARSUS", "label": "Tarsus", "bbox": (34.85985, 36.9157, 34.86435, 36.9193)},
    {"id": "MERSIN", "label": "Mersin dense urban", "bbox": (34.6304, 36.8093, 34.6374, 36.8149)},
    {"id": "ERDEMLI", "label": "Erdemli low-density", "bbox": (34.29, 36.6318, 34.298, 36.6382)},
)

POI_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "craft", "healthcare")
PHONEISH = re.compile(r"^\+?[0-9][0-9 ()/.-]{8,}$")
OSM_RECORD_ID = re.compile(r"^w(\d+)(?:@\d+)?$")


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    return str(value)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(jsonable(value), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def http_get(url: str, timeout: int = 90) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def in_bbox(lon: float, lat: float, bbox: tuple[float, float, float, float]) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def bbox_overlaps(row: dict[str, Any], bbox: tuple[float, float, float, float]) -> bool:
    return (
        float(row["xmin"]) < bbox[2]
        and float(row["xmax"]) > bbox[0]
        and float(row["ymin"]) < bbox[3]
        and float(row["ymax"]) > bbox[1]
    )


def normalized_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    folded = unicodedata.normalize("NFKD", value.casefold().replace("ı", "i"))
    asciiish = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return " ".join(re.findall(r"[a-z0-9]+", asciiish))


def median(values: Iterable[float | None]) -> float | None:
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return statistics.median(clean) if clean else None


def percentile(values: Iterable[float | None], ratio: float) -> float | None:
    clean = sorted(float(value) for value in values if value is not None and math.isfinite(float(value)))
    if not clean:
        return None
    index = min(len(clean) - 1, max(0, round((len(clean) - 1) * ratio)))
    return clean[index]


def planar_xy(point: list[float] | tuple[float, float], lat0: float) -> tuple[float, float]:
    return point[0] * 111_320.0 * math.cos(math.radians(lat0)), point[1] * 111_320.0


def distance_m(a: list[float] | tuple[float, float], b: list[float] | tuple[float, float]) -> float:
    lat0 = (a[1] + b[1]) / 2
    ax, ay = planar_xy(a, lat0)
    bx, by = planar_xy(b, lat0)
    return math.hypot(ax - bx, ay - by)


def point_segment_distance_m(
    point: list[float] | tuple[float, float],
    start: list[float] | tuple[float, float],
    end: list[float] | tuple[float, float],
) -> float:
    lat0 = (point[1] + start[1] + end[1]) / 3
    px, py = planar_xy(point, lat0)
    ax, ay = planar_xy(start, lat0)
    bx, by = planar_xy(end, lat0)
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def point_line_distance_m(point: list[float], line: list[list[float]]) -> float | None:
    if len(line) < 2:
        return None
    return min(point_segment_distance_m(point, line[i - 1], line[i]) for i in range(1, len(line)))


def line_samples(line: list[list[float]]) -> list[list[float]]:
    samples: list[list[float]] = []
    for index, point in enumerate(line):
        samples.append(point)
        if index:
            previous = line[index - 1]
            samples.append([(previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2])
    return samples


def line_length_m(line: list[list[float]]) -> float:
    return sum(distance_m(line[index - 1], line[index]) for index in range(1, len(line)))


def line_to_lines_distances(line: list[list[float]], references: Iterable[list[list[float]]]) -> list[float]:
    refs = [reference for reference in references if len(reference) >= 2]
    if not refs:
        return []
    out: list[float] = []
    for sample in line_samples(line):
        distances = [point_line_distance_m(sample, reference) for reference in refs]
        out.append(min(value for value in distances if value is not None))
    return out


def element_position(coords: list[list[float]]) -> list[float] | None:
    if not coords:
        return None
    return [sum(point[0] for point in coords) / len(coords), sum(point[1] for point in coords) / len(coords)]


def parse_tags(element: ET.Element) -> dict[str, str]:
    return {
        child.attrib["k"]: child.attrib.get("v", "")
        for child in element.findall("tag")
        if "k" in child.attrib
    }


def parse_osm(xml_payload: bytes) -> dict[str, Any]:
    root = ET.fromstring(xml_payload)
    node_coords: dict[str, list[float]] = {}
    nodes: list[dict[str, Any]] = []
    for node in root.findall("node"):
        node_id = node.attrib.get("id")
        if not node_id:
            continue
        position = [float(node.attrib["lon"]), float(node.attrib["lat"])]
        node_coords[node_id] = position
        nodes.append({
            "id": f"node/{node_id}",
            "timestamp": node.attrib.get("timestamp"),
            "position": position,
            "tags": parse_tags(node),
        })

    ways: list[dict[str, Any]] = []
    for way in root.findall("way"):
        way_id = way.attrib.get("id")
        if not way_id:
            continue
        refs = [nd.attrib["ref"] for nd in way.findall("nd") if nd.attrib.get("ref") in node_coords]
        coords = [node_coords[ref] for ref in refs]
        ways.append({
            "id": f"way/{way_id}",
            "timestamp": way.attrib.get("timestamp"),
            "refs": refs,
            "coordinates": coords,
            "position": element_position(coords),
            "tags": parse_tags(way),
        })

    relations: list[dict[str, Any]] = []
    for relation in root.findall("relation"):
        relation_id = relation.attrib.get("id")
        if not relation_id:
            continue
        relations.append({
            "id": f"relation/{relation_id}",
            "timestamp": relation.attrib.get("timestamp"),
            "tags": parse_tags(relation),
            "members": [dict(member.attrib) for member in relation.findall("member")],
        })

    roads = [way for way in ways if way["tags"].get("highway")]
    buildings = [way for way in ways if way["tags"].get("building")]
    buildings += [relation for relation in relations if relation["tags"].get("building")]
    addresses = [
        item for item in (*nodes, *ways)
        if item["tags"].get("addr:housenumber")
    ]
    pois = [
        item for item in (*nodes, *ways)
        if any(item["tags"].get(key) for key in POI_KEYS)
    ]
    places = [item for item in (*nodes, *ways) if item["tags"].get("place")]
    boundaries = [
        item for item in (*ways, *relations)
        if item["tags"].get("boundary") == "administrative"
    ]
    restrictions = [
        relation for relation in relations
        if relation["tags"].get("type") == "restriction"
    ]
    return {
        "roads": roads,
        "buildings": buildings,
        "addresses": addresses,
        "pois": pois,
        "places": places,
        "boundaries": boundaries,
        "turnRestrictions": restrictions,
    }


def load_osm(region: dict[str, Any]) -> dict[str, Any]:
    path = RAW / f"osm-{region['id'].lower()}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    bbox_value = ",".join(str(value) for value in region["bbox"])
    url = f"{OSM_ENDPOINT}?{urllib.parse.urlencode({'bbox': bbox_value})}"
    payload = http_get(url)
    parsed = parse_osm(payload)
    snapshot = {
        "sourceId": "OSM",
        "region": region["id"],
        "bbox": region["bbox"],
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "retrievedFrom": url,
        "rawPayloadSha256": sha256_bytes(payload),
        "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        **parsed,
    }
    write_json(path, snapshot)
    time.sleep(1)
    return snapshot


def load_overture_client() -> tuple[Any, Any]:
    """Load the official client without adding a repository dependency.

    A task-scoped path may point at an isolated ``pip --target`` directory.
    The benchmark fails closed if the official client is unavailable; it never
    falls back to a global S3 scan or an undocumented endpoint.
    """

    client_path = os.environ.get("CAROS_OVERTURE_CLIENT_PATH")
    if client_path:
        sys.path.insert(0, client_path)
    try:
        from overturemaps.core import get_latest_release, record_batch_reader
        from shapely import wkb
    except ImportError as error:
        raise RuntimeError(
            "Official overturemaps client is required. Install it into an isolated "
            "directory and set CAROS_OVERTURE_CLIENT_PATH to that directory."
        ) from error
    latest = get_latest_release()
    if latest != OVERTURE_RELEASE:
        raise RuntimeError(
            f"Release drift: benchmark pins {OVERTURE_RELEASE}, STAC latest is {latest}. "
            "Review and update the evidence release before rerunning."
        )
    return record_batch_reader, wkb


def overture_row(raw: dict[str, Any], overture_type: str, wkb: Any) -> dict[str, Any]:
    bbox = raw.get("bbox") or {}
    names = raw.get("names") or {}
    geometry = wkb.loads(raw["geometry"]) if raw.get("geometry") else None
    row: dict[str, Any] = {
        "id": raw.get("id"),
        "version": raw.get("version"),
        "sources_json": raw.get("sources") or [],
        "geojson": json.dumps(geometry.__geo_interface__) if geometry is not None else None,
        "xmin": bbox.get("xmin"),
        "ymin": bbox.get("ymin"),
        "xmax": bbox.get("xmax"),
        "ymax": bbox.get("ymax"),
    }
    if overture_type == "segment":
        row.update({
            "name": names.get("primary"),
            "subtype": raw.get("subtype"),
            "class": raw.get("class"),
            "subclass": raw.get("subclass"),
            "connectors_json": raw.get("connectors") or [],
            "access_restrictions_json": raw.get("access_restrictions") or [],
            "prohibited_transitions_json": raw.get("prohibited_transitions") or [],
            "road_flags_json": raw.get("road_flags") or [],
            "road_surface_json": raw.get("road_surface") or [],
            "speed_limits_json": raw.get("speed_limits") or [],
            "width_rules_json": raw.get("width_rules") or [],
        })
    elif overture_type == "address":
        row.update({key: raw.get(key) for key in ("number", "street", "postcode", "unit", "country")})
    elif overture_type == "place":
        row.update({
            "name": names.get("primary"),
            "categories_json": raw.get("categories") or {},
            "confidence": raw.get("confidence"),
            "operating_status": raw.get("operating_status"),
            "addresses_json": raw.get("addresses") or [],
            "phones_json": raw.get("phones") or [],
        })
    elif overture_type == "division_area":
        row.update({
            "name": names.get("primary"),
            **{
                key: raw.get(key)
                for key in (
                    "subtype", "class", "is_land", "is_territorial", "division_id",
                    "country", "region", "admin_level",
                )
            },
        })
    return row


def query_overture_cached(
    region: dict[str, Any],
    overture_type: str,
    record_batch_reader: Any,
    wkb: Any,
) -> list[dict[str, Any]]:
    path = RAW / f"overture-{region['id'].lower()}-{overture_type}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["rows"]
    reader = record_batch_reader(
        overture_type,
        bbox=region["bbox"],
        release=OVERTURE_RELEASE,
        connect_timeout=30,
        request_timeout=180,
        stac=True,
    )
    rows = [] if reader is None else [
        overture_row(raw, overture_type, wkb)
        for raw in reader.read_all().to_pylist()
    ]
    write_json(path, {
        "sourceId": "OVERTURE",
        "release": OVERTURE_RELEASE,
        "region": region["id"],
        "bbox": region["bbox"],
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "retrievedFrom": OVERTURE_STAC,
        "accessMethod": "official overturemaps-py 1.0.2; STAC-limited bbox query",
        "rows": rows,
    })
    return rows


def load_overture() -> dict[str, list[dict[str, Any]]]:
    record_batch_reader, wkb = load_overture_client()
    output = {"segments": [], "addresses": [], "places": [], "divisions": []}
    type_to_key = {
        "segment": "segments",
        "address": "addresses",
        "place": "places",
        "division_area": "divisions",
    }
    for region in REGIONS:
        for overture_type, key in type_to_key.items():
            output[key].extend(query_overture_cached(region, overture_type, record_batch_reader, wkb))
    return output


def parse_json_field(row: dict[str, Any], key: str, fallback: Any) -> Any:
    value = row.get(key)
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def row_geometry(row: dict[str, Any]) -> dict[str, Any] | None:
    return parse_json_field(row, "geojson", None)


def geometry_intersects_bbox(
    row: dict[str, Any],
    bbox: tuple[float, float, float, float],
) -> bool:
    """Apply an exact geometry test after the STAC/Parquet bbox pushdown.

    Administrative areas can have very broad bounding boxes (for example,
    countries with distant territories). The coarse storage bbox is useful for
    I/O pruning but is not evidence that the geometry intersects the AOI.
    """

    geometry = row_geometry(row)
    if not geometry:
        return False
    from shapely.geometry import box, shape

    return bool(shape(geometry).intersects(box(*bbox)))


def rows_for_region(
    rows: list[dict[str, Any]],
    bbox: tuple[float, float, float, float],
) -> list[dict[str, Any]]:
    # The same broad feature can be returned by more than one AOI query. GERS ID
    # is the stable observation identity, so deduplicate without overwriting it.
    unique: dict[str, dict[str, Any]] = {}
    for row in rows:
        if geometry_intersects_bbox(row, bbox):
            unique.setdefault(str(row.get("id")), row)
    return list(unique.values())


def source_refs(row: dict[str, Any]) -> list[dict[str, Any]]:
    refs = parse_json_field(row, "sources_json", [])
    return refs if isinstance(refs, list) else []


def source_datasets(row: dict[str, Any]) -> set[str]:
    return {
        str(ref.get("dataset"))
        for ref in source_refs(row)
        if isinstance(ref, dict) and ref.get("dataset")
    }


def mapped_osm_way_ids(row: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for ref in source_refs(row):
        match = OSM_RECORD_ID.match(str(ref.get("record_id") or ""))
        if match:
            out.add(f"way/{match.group(1)}")
    return out


def feature_updated_times(row: dict[str, Any]) -> list[str]:
    return sorted({
        str(ref["update_time"])
        for ref in source_refs(row)
        if isinstance(ref, dict) and ref.get("update_time")
    })


def closest_named_road(
    position: list[float],
    roads: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, float | None]:
    candidates: list[tuple[float, dict[str, Any]]] = []
    for road in roads:
        if not road["tags"].get("name"):
            continue
        distance = point_line_distance_m(position, road["coordinates"])
        if distance is not None:
            candidates.append((distance, road))
    if not candidates:
        return None, None
    distance, road = min(candidates, key=lambda item: item[0])
    return road, distance


def summarize_osm(osm: dict[str, Any]) -> dict[str, Any]:
    roads = osm["roads"]
    addresses = osm["addresses"]
    pois = osm["pois"]
    names = [road["tags"].get("name") for road in roads if road["tags"].get("name")]
    node_degrees: Counter[str] = Counter()
    for road in roads:
        node_degrees.update(road["refs"])

    address_rows = []
    for address in addresses:
        tags = address["tags"]
        position = address.get("position")
        nearest, nearest_distance = closest_named_road(position, roads) if position else (None, None)
        street = tags.get("addr:street")
        address_rows.append({
            "id": address["id"],
            "housenumber": tags.get("addr:housenumber"),
            "street": street,
            "nearestNamedRoad": nearest["tags"].get("name") if nearest else None,
            "nearestNamedRoadDistanceM": nearest_distance,
            "explicitStreetMatchesNearest": bool(
                street and nearest and normalized_name(street) == normalized_name(nearest["tags"].get("name"))
            ),
        })

    poi_categories = [
        next((f"{key}={poi['tags'][key]}" for key in POI_KEYS if poi["tags"].get(key)), "UNKNOWN")
        for poi in pois
    ]
    timestamps = [
        item.get("timestamp") for item in (*roads, *addresses, *pois)
        if item.get("timestamp")
    ]
    return {
        "roads": {
            "wayCount": len(roads),
            "namedWayCount": len(names),
            "uniqueNames": sorted(set(names)),
            "classCounts": dict(sorted(Counter(road["tags"].get("highway", "UNKNOWN") for road in roads).items())),
            "junctionNodesDegree2Plus": sum(1 for degree in node_degrees.values() if degree >= 2),
            "junctionNodesDegree3Plus": sum(1 for degree in node_degrees.values() if degree >= 3),
            "bridgeWays": sum(road["tags"].get("bridge") not in (None, "no") for road in roads),
            "tunnelWays": sum(road["tags"].get("tunnel") not in (None, "no") for road in roads),
            "linkWays": sum(str(road["tags"].get("highway", "")).endswith("_link") for road in roads),
            "roundaboutWays": sum(road["tags"].get("junction") == "roundabout" for road in roads),
            "lanesKnownWays": sum(bool(road["tags"].get("lanes")) for road in roads),
            "maxspeedKnownWays": sum(bool(road["tags"].get("maxspeed")) for road in roads),
            "onewayKnownWays": sum(bool(road["tags"].get("oneway")) for road in roads),
            "turnRestrictionRelations": len(osm["turnRestrictions"]),
        },
        "addresses": {
            "addressCount": len(addresses),
            "housenumberCount": len(addresses),
            "explicitStreetCount": sum(bool(row["street"]) for row in address_rows),
            "nearestNamedRoadWithin30m": sum(
                row["nearestNamedRoadDistanceM"] is not None and row["nearestNamedRoadDistanceM"] <= 30
                for row in address_rows
            ),
            "explicitStreetMatchesNearest": sum(row["explicitStreetMatchesNearest"] for row in address_rows),
            "phoneLikeOrTooLongHousenumber": sum(
                bool(PHONEISH.match(str(row["housenumber"] or "")))
                or len(str(row["housenumber"] or "")) > 8
                for row in address_rows
            ),
            "rows": address_rows,
        },
        "pois": {
            "count": len(pois),
            "namedCount": sum(bool(poi["tags"].get("name")) for poi in pois),
            "categoryCount": len(set(poi_categories)),
            "topCategories": dict(Counter(poi_categories).most_common(12)),
        },
        "places": {
            "count": len(osm["places"]),
            "namedCount": sum(bool(item["tags"].get("name")) for item in osm["places"]),
        },
        "boundaries": {
            "objectsInMapResponse": len(osm["boundaries"]),
            "note": "Map API ilişkileri AOI dışında tamamlayabilir; bu sayı tam boundary coverage ölçüsü değildir.",
        },
        "freshness": {
            "oldestObservedRecord": min(timestamps) if timestamps else None,
            "latestObservedRecord": max(timestamps) if timestamps else None,
        },
    }


def road_class_matches(osm_highway: str, overture_class: str | None) -> bool:
    if not overture_class:
        return False
    normalized = osm_highway.removesuffix("_link")
    aliases = {"living_street": "residential"}
    return aliases.get(normalized, normalized) == overture_class


def summarize_roads(
    rows: list[dict[str, Any]],
    osm: dict[str, Any],
) -> dict[str, Any]:
    overture_roads = [row for row in rows if row.get("subtype") == "road"]
    osm_roads = osm["roads"]
    osm_by_id = {road["id"]: road for road in osm_roads}
    all_osm_lines = [road["coordinates"] for road in osm_roads]
    connector_degrees: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    update_times: list[str] = []
    agreement_distances: list[float] = []
    class_comparable = 0
    class_conflicts = 0
    name_added: list[str] = []
    name_conflicts: list[dict[str, Any]] = []
    non_osm_rows: list[dict[str, Any]] = []
    identical_geometry_hashes: Counter[str] = Counter()

    for row in overture_roads:
        datasets = source_datasets(row)
        source_counts.update(datasets or {"UNKNOWN"})
        update_times.extend(feature_updated_times(row))
        connector_refs = parse_json_field(row, "connectors_json", [])
        if isinstance(connector_refs, list):
            connector_degrees.update(
                str(ref.get("connector_id"))
                for ref in connector_refs
                if isinstance(ref, dict) and ref.get("connector_id")
            )
        geometry = row_geometry(row) or {}
        coordinates = geometry.get("coordinates") if geometry.get("type") == "LineString" else None
        if isinstance(coordinates, list):
            digest = hashlib.sha256(json.dumps(coordinates, separators=(",", ":")).encode()).hexdigest()
            identical_geometry_hashes[digest] += 1

        mapped = [osm_by_id[item] for item in mapped_osm_way_ids(row) if item in osm_by_id]
        if mapped and isinstance(coordinates, list):
            agreement_distances.extend(line_to_lines_distances(coordinates, [item["coordinates"] for item in mapped]))
        if mapped:
            comparable = [item for item in mapped if item["tags"].get("highway")]
            if comparable:
                class_comparable += 1
                if not any(road_class_matches(item["tags"]["highway"], row.get("class")) for item in comparable):
                    class_conflicts += 1
            ov_name = normalized_name(row.get("name"))
            osm_names = {normalized_name(item["tags"].get("name")) for item in mapped if item["tags"].get("name")}
            if ov_name and not osm_names:
                name_added.append(str(row["name"]))
            elif ov_name and osm_names and ov_name not in osm_names:
                name_conflicts.append({
                    "overtureId": row["id"],
                    "overtureName": row.get("name"),
                    "osmNames": sorted(item["tags"].get("name") for item in mapped if item["tags"].get("name")),
                })
        if "OpenStreetMap" not in datasets:
            non_osm_rows.append(row)

    novel_candidates = []
    for row in non_osm_rows:
        geometry = row_geometry(row) or {}
        coordinates = geometry.get("coordinates") if geometry.get("type") == "LineString" else None
        if not isinstance(coordinates, list):
            continue
        distances = line_to_lines_distances(coordinates, all_osm_lines)
        entry = {
            "id": row["id"],
            "name": row.get("name"),
            "class": row.get("class"),
            "sourceDatasets": sorted(source_datasets(row)),
            "lengthM": line_length_m(coordinates),
            "medianDistanceToOsmM": median(distances),
            "maxDistanceToOsmM": max(distances) if distances else None,
        }
        if entry["lengthM"] >= 20 and (entry["medianDistanceToOsmM"] or 0) > 15:
            novel_candidates.append(entry)

    def has_json_items(row: dict[str, Any], key: str) -> bool:
        value = parse_json_field(row, key, [])
        return isinstance(value, list) and len(value) > 0

    def has_flag(row: dict[str, Any], flag: str) -> bool:
        value = parse_json_field(row, "road_flags_json", [])
        if not isinstance(value, list):
            return False
        return any(flag in (item.get("values") or []) for item in value if isinstance(item, dict))

    names = [row.get("name") for row in overture_roads if row.get("name")]
    distinct_osm_way_ids = set().union(*(mapped_osm_way_ids(row) for row in overture_roads)) if overture_roads else set()
    duplicate_geometry_count = sum(count - 1 for count in identical_geometry_hashes.values() if count > 1)
    return {
        "rawSegmentCount": len(overture_roads),
        "nonRoadSegmentCount": len(rows) - len(overture_roads),
        "distinctMappedOsmWayIds": len(distinct_osm_way_ids),
        "osmWaysRepresentedInCurrentAoi": len(distinct_osm_way_ids & set(osm_by_id)),
        "sourceDatasetRecordCounts": dict(sorted(source_counts.items())),
        "osmAndTomTomEnrichedSegments": sum(
            {"OpenStreetMap", "TomTom"}.issubset(source_datasets(row)) for row in overture_roads
        ),
        "nonOsmSourceSegments": len(non_osm_rows),
        "novelGeometryCandidates": novel_candidates,
        "independentlyVerifiedRealNewRoads": None,
        "geometryAgreementToMappedOsm": {
            "sampleCount": len(agreement_distances),
            "medianDirectedDistanceM": median(agreement_distances),
            "p95DirectedDistanceM": percentile(agreement_distances, 0.95),
            "maxDirectedDistanceM": max(agreement_distances) if agreement_distances else None,
        },
        "exactGeometryDuplicateRate": duplicate_geometry_count / len(overture_roads) if overture_roads else None,
        "class": {
            "counts": dict(sorted(Counter(str(row.get("class") or "UNKNOWN") for row in overture_roads).items())),
            "comparableSegments": class_comparable,
            "conflictingSegments": class_conflicts,
        },
        "names": {
            "namedSegmentCount": len(names),
            "uniqueNames": sorted(set(names)),
            "uniqueNameCount": len(set(names)),
            "additionalOnMappedOsmSegments": sorted(set(name_added)),
            "conflicts": name_conflicts,
        },
        "topology": {
            "uniqueConnectorIds": len(connector_degrees),
            "sharedConnectorIdsDegree2Plus": sum(degree >= 2 for degree in connector_degrees.values()),
            "decisionConnectorIdsDegree3Plus": sum(degree >= 3 for degree in connector_degrees.values()),
            "note": "Overture segmentasyonu ile OSM way segmentasyonu eşdeğer birim değildir.",
        },
        "navigationAttributes": {
            "bridgeFlagSegments": sum(has_flag(row, "is_bridge") for row in overture_roads),
            "tunnelFlagSegments": sum(has_flag(row, "is_tunnel") for row in overture_roads),
            "linkFlagSegments": sum(has_flag(row, "is_link") or row.get("subclass") == "link" for row in overture_roads),
            "speedLimitSegments": sum(has_json_items(row, "speed_limits_json") for row in overture_roads),
            "accessRestrictionSegments": sum(has_json_items(row, "access_restrictions_json") for row in overture_roads),
            "prohibitedTransitionSegments": sum(has_json_items(row, "prohibited_transitions_json") for row in overture_roads),
            "surfaceSegments": sum(has_json_items(row, "road_surface_json") for row in overture_roads),
            "widthRuleSegments": sum(has_json_items(row, "width_rules_json") for row in overture_roads),
            "laneCountField": "NOT_IN_OVERTURE_SEGMENT_SCHEMA",
        },
        "freshness": {
            "release": OVERTURE_RELEASE,
            "oldestSourceUpdate": min(update_times) if update_times else None,
            "latestSourceUpdate": max(update_times) if update_times else None,
        },
    }


def summarize_addresses(rows: list[dict[str, Any]], osm: dict[str, Any]) -> dict[str, Any]:
    osm_addresses = osm["addresses"]
    unique_candidates = []
    phone_like = 0
    association_complete = 0
    for row in rows:
        number = str(row.get("number") or "")
        street = str(row.get("street") or "")
        if PHONEISH.match(number) or len(number) > 8:
            phone_like += 1
        if number and street:
            association_complete += 1
        geometry = row_geometry(row) or {}
        position = geometry.get("coordinates") if geometry.get("type") == "Point" else None
        duplicate = False
        for osm_address in osm_addresses:
            osm_number = normalized_name(osm_address["tags"].get("addr:housenumber"))
            osm_street = normalized_name(osm_address["tags"].get("addr:street"))
            if normalized_name(number) != osm_number or normalized_name(street) != osm_street:
                continue
            osm_position = osm_address.get("position")
            if position and osm_position and distance_m(position, osm_position) <= 30:
                duplicate = True
                break
        if not duplicate:
            unique_candidates.append(row.get("id"))
    return {
        "addressCount": len(rows),
        "housenumberCount": sum(bool(row.get("number")) for row in rows),
        "streetAndNumberCount": association_complete,
        "uniqueIncrementalCandidateCount": len(unique_candidates),
        "uniqueIncrementalCandidateIds": unique_candidates,
        "phoneLikeOrTooLongHousenumber": phone_like,
        "independentlyVerifiedIncrementalAddresses": None if unique_candidates else 0,
    }


def cluster_duplicate_places(rows: list[dict[str, Any]]) -> set[str]:
    by_name: defaultdict[str, list[tuple[str, list[float]]]] = defaultdict(list)
    for row in rows:
        name = normalized_name(row.get("name"))
        geometry = row_geometry(row) or {}
        position = geometry.get("coordinates") if geometry.get("type") == "Point" else None
        if name and isinstance(position, list):
            by_name[name].append((str(row["id"]), position))
    duplicates: set[str] = set()
    for items in by_name.values():
        kept: list[tuple[str, list[float]]] = []
        for item in items:
            if any(distance_m(item[1], other[1]) <= 25 for other in kept):
                duplicates.add(item[0])
            else:
                kept.append(item)
    return duplicates


def summarize_places(rows: list[dict[str, Any]], osm: dict[str, Any]) -> dict[str, Any]:
    osm_pois = osm["pois"]
    duplicates = cluster_duplicate_places(rows)
    exact_name_matches = 0
    spatial_matches = 0
    unique_candidates: list[dict[str, Any]] = []
    confidence_values: list[float] = []
    source_counts: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    source_updates: list[str] = []
    suspicious: list[dict[str, Any]] = []

    for row in rows:
        name = str(row.get("name") or "")
        norm_name = normalized_name(name)
        confidence = row.get("confidence")
        if isinstance(confidence, (int, float)) and math.isfinite(confidence):
            confidence_values.append(float(confidence))
        source_counts.update(source_datasets(row) or {"UNKNOWN"})
        source_updates.extend(feature_updated_times(row))
        category = parse_json_field(row, "categories_json", {})
        primary = category.get("primary") if isinstance(category, dict) else None
        categories[str(primary or "UNKNOWN")] += 1
        geometry = row_geometry(row) or {}
        position = geometry.get("coordinates") if geometry.get("type") == "Point" else None

        best_same_name: float | None = None
        best_any: float | None = None
        if isinstance(position, list):
            for poi in osm_pois:
                poi_position = poi.get("position")
                if not poi_position:
                    continue
                current = distance_m(position, poi_position)
                best_any = current if best_any is None else min(best_any, current)
                if norm_name and norm_name == normalized_name(poi["tags"].get("name")):
                    best_same_name = current if best_same_name is None else min(best_same_name, current)
        if best_same_name is not None and best_same_name <= 75:
            exact_name_matches += 1
            continue
        if best_any is not None and best_any <= 20:
            spatial_matches += 1
        entry = {
            "id": row["id"],
            "name": row.get("name"),
            "category": primary,
            "confidence": confidence,
            "operatingStatus": row.get("operating_status"),
            "sourceDatasets": sorted(source_datasets(row)),
            "nearestOsmPoiDistanceM": best_any,
            "hasAddress": bool(parse_json_field(row, "addresses_json", [])),
        }
        unique_candidates.append(entry)
        if (
            not norm_name
            or not primary
            or row.get("operating_status") == "closed_permanently"
            or (isinstance(confidence, (int, float)) and confidence < 0.5)
            or bool(PHONEISH.match(name))
            or "http" in name.casefold()
            or len(name) > 120
        ):
            suspicious.append(entry)

    qualified = [
        row for row in unique_candidates
        if row["id"] not in duplicates
        and normalized_name(row["name"])
        and row["category"]
        and row["operatingStatus"] != "closed_permanently"
        and isinstance(row["confidence"], (int, float))
        and row["confidence"] >= 0.7
        and not bool(PHONEISH.match(str(row["name"] or "")))
        and "http" not in str(row["name"] or "").casefold()
        and len(str(row["name"] or "")) <= 120
    ]
    return {
        "count": len(rows),
        "namedCount": sum(bool(row.get("name")) for row in rows),
        "categoryCount": len(categories),
        "topCategories": dict(categories.most_common(15)),
        "sourceDatasetRecordCounts": dict(sorted(source_counts.items())),
        "exactNameWithin75mOsmDuplicates": exact_name_matches,
        "spatialWithin20mButNameUnmatched": spatial_matches,
        "uniqueIncrementalCandidateCount": len(unique_candidates),
        "qualityQualifiedCandidateCount": len(qualified),
        "independentlyVerifiedIncrementalPois": None,
        "withinSourceDuplicateCount": len(duplicates),
        "withinSourceDuplicateRate": len(duplicates) / len(rows) if rows else None,
        "addressBearingPlaceCount": sum(bool(parse_json_field(row, "addresses_json", [])) for row in rows),
        "closedPermanentCount": sum(row.get("operating_status") == "closed_permanently" for row in rows),
        "lowConfidenceBelow050Count": sum(
            isinstance(row.get("confidence"), (int, float)) and row["confidence"] < 0.5
            for row in rows
        ),
        "confidence": {
            "knownCount": len(confidence_values),
            "median": median(confidence_values),
            "p10": percentile(confidence_values, 0.10),
            "p90": percentile(confidence_values, 0.90),
        },
        "suspiciousOrLowQualityCount": len({str(row["id"]) for row in suspicious}),
        "qualifiedSample": qualified[:20],
        "freshness": {
            "release": OVERTURE_RELEASE,
            "oldestSourceUpdate": min(source_updates) if source_updates else None,
            "latestSourceUpdate": max(source_updates) if source_updates else None,
        },
    }


def summarize_divisions(rows: list[dict[str, Any]]) -> dict[str, Any]:
    source_counts: Counter[str] = Counter()
    for row in rows:
        source_counts.update(source_datasets(row) or {"UNKNOWN"})
    return {
        "intersectingAreaCount": len(rows),
        "areas": [
            {
                "id": row["id"],
                "name": row.get("name"),
                "subtype": row.get("subtype"),
                "adminLevel": row.get("admin_level"),
                "class": row.get("class"),
                "isLand": row.get("is_land"),
                "isTerritorial": row.get("is_territorial"),
                "sourceDatasets": sorted(source_datasets(row)),
            }
            for row in rows
        ],
        "sourceDatasetRecordCounts": dict(sorted(source_counts.items())),
        "independentOfOsm": not any("OpenStreetMap" in source_datasets(row) for row in rows),
    }


def load_geonames() -> dict[str, Any]:
    output_path = RAW / "geonames-aoi.json"
    if output_path.exists():
        return json.loads(output_path.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="caros-geonames-") as directory:
        archive_path = Path(directory) / "TR.zip"
        payload = http_get(GEONAMES_URL, timeout=180)
        archive_path.write_bytes(payload)
        matches: dict[str, list[dict[str, Any]]] = {region["id"]: [] for region in REGIONS}
        with zipfile.ZipFile(archive_path) as archive:
            text = archive.read("TR.txt").decode("utf-8")
        for line in text.splitlines():
            fields = line.split("\t")
            if len(fields) < 19:
                continue
            lat, lon = float(fields[4]), float(fields[5])
            for region in REGIONS:
                if in_bbox(lon, lat, region["bbox"]):
                    matches[region["id"]].append({
                        "geonameId": fields[0], "name": fields[1], "asciiName": fields[2],
                        "alternateNames": fields[3], "position": [lon, lat],
                        "featureClass": fields[6], "featureCode": fields[7],
                        "admin1": fields[10], "admin2": fields[11],
                        "population": int(fields[14] or 0), "modificationDate": fields[18],
                    })
        result = {
            "sourceId": "GEONAMES",
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
            "retrievedFrom": GEONAMES_URL,
            "archiveSha256": sha256_bytes(payload),
            "license": "CC-BY-4.0",
            "attribution": "GeoNames",
            "cadence": "daily extract",
            "regions": matches,
        }
        write_json(output_path, result)
        return result


def summarize_geonames(rows: list[dict[str, Any]], osm: dict[str, Any]) -> dict[str, Any]:
    osm_candidates = [*osm["places"], *osm["pois"]]
    matched = 0
    unique: list[dict[str, Any]] = []
    for row in rows:
        row_name = normalized_name(row["name"])
        duplicate = False
        for candidate in osm_candidates:
            if row_name != normalized_name(candidate["tags"].get("name")):
                continue
            position = candidate.get("position")
            if position and distance_m(row["position"], position) <= 100:
                duplicate = True
                break
        if duplicate:
            matched += 1
        else:
            unique.append(row)
    classes = Counter(row["featureClass"] for row in rows)
    return {
        "count": len(rows),
        "featureClassCounts": dict(sorted(classes.items())),
        "osmExactNameWithin100mDuplicates": matched,
        "uniqueIncrementalCandidateCount": len(unique),
        "independentlyVerifiedIncrementalPlaces": None if unique else 0,
        "latestRecordModificationDate": max((row["modificationDate"] for row in rows), default=None),
        "candidateRows": unique,
    }


def main() -> int:
    started = time.time()
    osm_by_region = {region["id"]: load_osm(region) for region in REGIONS}
    overture = load_overture()
    geonames = load_geonames()
    previous_buildings = json.loads(
        (HERE.parent / "mapdata-source-benchmark-20260907" / "shootout.json").read_text(encoding="utf-8")
    )
    buildings_by_region = {row["id"]: row for row in previous_buildings["regions"]}

    region_results = []
    for region in REGIONS:
        region_id = region["id"]
        osm = osm_by_region[region_id]
        segments = rows_for_region(overture["segments"], region["bbox"])
        addresses = rows_for_region(overture["addresses"], region["bbox"])
        places = rows_for_region(overture["places"], region["bbox"])
        divisions = rows_for_region(overture["divisions"], region["bbox"])
        region_results.append({
            "id": region_id,
            "label": region["label"],
            "bbox": region["bbox"],
            "osm": summarize_osm(osm),
            "overture": {
                "buildings": buildings_by_region[region_id],
                "roads": summarize_roads(segments, osm),
                "addresses": summarize_addresses(addresses, osm),
                "places": summarize_places(places, osm),
                "divisions": summarize_divisions(divisions),
            },
            "geonames": summarize_geonames(geonames["regions"][region_id], osm),
        })

    result = {
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "elapsedSec": round(time.time() - started, 1),
        "scope": "Three fixed AOIs reused from MAPDATA #1321/source benchmark; production-unbound measurement only.",
        "methodWarnings": [
            "Overture segment and OSM way are different segmentation units; raw counts are not gain.",
            "POI/road unique candidates are not independently verified real-world truth.",
            "Overture ML buildings retain GAP_EVIDENCE only after GEOMETRY RESCUE FAIL.",
            "OSM map API was used only for three bounded research snapshots, never as a production bulk adapter.",
        ],
        "sources": {
            "osm": {"endpoint": OSM_ENDPOINT, "license": "ODbL-1.0"},
            "overture": {"release": OVERTURE_RELEASE, "root": OVERTURE_ROOT},
            "geonames": {"url": GEONAMES_URL, "license": "CC-BY-4.0"},
        },
        "regions": region_results,
    }
    write_json(DERIVED / "benchmark.json", result)
    print(json.dumps({
        "elapsedSec": result["elapsedSec"],
        "regions": [
            {
                "id": row["id"],
                "osmRoads": row["osm"]["roads"]["wayCount"],
                "overtureRoadSegments": row["overture"]["roads"]["rawSegmentCount"],
                "nonOsmRoadSegments": row["overture"]["roads"]["nonOsmSourceSegments"],
                "osmAddresses": row["osm"]["addresses"]["addressCount"],
                "overtureAddresses": row["overture"]["addresses"]["addressCount"],
                "osmPois": row["osm"]["pois"]["count"],
                "overturePlaces": row["overture"]["places"]["count"],
                "qualifiedPlaceCandidates": row["overture"]["places"]["qualityQualifiedCandidateCount"],
                "geonames": row["geonames"]["count"],
            }
            for row in region_results
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

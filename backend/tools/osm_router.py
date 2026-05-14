"""OSM + NetworkX local hazard-aware pathfinding.

Loads a pre-built road network graph for the configured city.
Applies dynamic hazard penalties on edges and computes multiple
candidate routes: shortest, safest, and balanced.

Zero API cost, zero rate limits, sub-200ms per route.
"""
from __future__ import annotations

import logging
import math
import pickle
from pathlib import Path
from typing import Any, List, Optional

import networkx as nx
from langchain_core.tools import tool

from backend.core.config import settings

logger = logging.getLogger(__name__)

_graph: Optional[nx.MultiDiGraph] = None
_graph_loaded = False


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def load_graph() -> None:
    """Load the pre-built road graph from pickle."""
    global _graph, _graph_loaded
    graph_path = settings.city.data_dir / "road_graph.pkl"
    if not graph_path.exists():
        logger.warning(
            "Road graph not found at %s. "
            "Run 'python -m backend.tools.osm_router --build' to generate it.",
            graph_path,
        )
        _graph_loaded = True
        return

    try:
        with open(graph_path, "rb") as f:
            _graph = pickle.load(f)
        logger.info(
            "Road graph loaded: %d nodes, %d edges",
            _graph.number_of_nodes(),
            _graph.number_of_edges(),
        )
    except Exception as e:
        logger.error("Road graph load failed: %s", e)
    _graph_loaded = True


def is_in_hazard_zone(lat: float, lon: float, hazard: dict) -> bool:
    geom = hazard.get("geometry", {})
    geo_type = geom.get("type")

    if geo_type == "circle":
        center = geom["center"]
        return haversine(lat, lon, center[0], center[1]) <= geom.get("radius_km", 0.5)

    if geo_type == "polygon":
        coords = geom.get("coordinates", [])
        n = len(coords)
        inside = False
        j = n - 1
        for i in range(n):
            if ((coords[i][1] > lon) != (coords[j][1] > lon)) and (
                lat
                < (coords[j][0] - coords[i][0])
                * (lon - coords[i][1])
                / (coords[j][1] - coords[i][1])
                + coords[i][0]
            ):
                inside = not inside
            j = i
        return inside

    return False


def _apply_hazard_penalties(hazard_zones: list[dict]) -> list[tuple]:
    """Modify edge weights in the graph based on hazard zones. Returns modified edges for rollback."""
    if _graph is None:
        return []

    modified = []
    for u, v, key, data in _graph.edges(keys=True, data=True):
        mid_lat = (_graph.nodes[u]["y"] + _graph.nodes[v]["y"]) / 2
        mid_lon = (_graph.nodes[u]["x"] + _graph.nodes[v]["x"]) / 2
        original_weight = data.get("travel_time", data.get("length", 1))

        for hz in hazard_zones:
            if is_in_hazard_zone(mid_lat, mid_lon, hz):
                if hz.get("blocked"):
                    _graph[u][v][key]["travel_time"] = float("inf")
                elif hz.get("penalty_multiplier"):
                    _graph[u][v][key]["travel_time"] = (
                        original_weight * hz["penalty_multiplier"]
                    )
                modified.append((u, v, key, original_weight))
                break

    return modified


def _restore_edges(modified: list[tuple]) -> None:
    if _graph is None:
        return
    for u, v, key, original in modified:
        _graph[u][v][key]["travel_time"] = original


def _compute_single_route(
    origin: tuple[float, float],
    destination: tuple[float, float],
    hazard_zones: list[dict],
) -> dict[str, Any]:
    """Compute a single route on the OSM graph with hazard penalties."""
    if _graph is None:
        return _haversine_fallback(origin, destination)

    try:
        import osmnx as ox
    except ImportError:
        return _haversine_fallback(origin, destination)

    orig_node = ox.nearest_nodes(_graph, origin[1], origin[0])
    dest_node = ox.nearest_nodes(_graph, destination[1], destination[0])

    modified = _apply_hazard_penalties(hazard_zones)
    try:
        path_nodes = nx.shortest_path(
            _graph, orig_node, dest_node, weight="travel_time"
        )
        path_coords = [
            [_graph.nodes[n]["y"], _graph.nodes[n]["x"]] for n in path_nodes
        ]

        total_length_m = 0.0
        total_time_s = 0.0
        for i in range(len(path_nodes) - 1):
            u, v = path_nodes[i], path_nodes[i + 1]
            edge_data = _graph[u][v]
            first_key = next(iter(edge_data))
            ed = edge_data[first_key]
            total_length_m += ed.get("length", 0)
            tt = ed.get("travel_time", 0)
            if tt != float("inf"):
                total_time_s += tt

        avoided = [
            hz.get("label", hz.get("id", "?"))
            for hz in hazard_zones
            if hz.get("blocked") or hz.get("penalty_multiplier")
        ]

        return {
            "status": "ok",
            "path": path_coords,
            "distance_km": round(total_length_m / 1000, 2),
            "eta_minutes": round(total_time_s / 60, 1),
            "origin": list(origin),
            "destination": list(destination),
            "avoided_hazards": avoided,
        }

    except nx.NetworkXNoPath:
        return {
            "status": "no_safe_route",
            "path": [list(origin), list(destination)],
            "distance_km": round(haversine(*origin, *destination), 2),
            "eta_minutes": None,
            "origin": list(origin),
            "destination": list(destination),
            "avoided_hazards": [],
            "note": "No path found — all routes cross blocked hazard zones",
        }
    finally:
        _restore_edges(modified)


def _haversine_fallback(
    origin: tuple[float, float], destination: tuple[float, float]
) -> dict[str, Any]:
    dist = haversine(*origin, *destination)
    return {
        "status": "no_graph",
        "path": [list(origin), list(destination)],
        "distance_km": round(dist, 2),
        "eta_minutes": round(dist / 0.5, 1),
        "origin": list(origin),
        "destination": list(destination),
        "avoided_hazards": [],
        "note": (
            "OSM graph not loaded — straight-line estimate only. "
            "Run 'python -m backend.tools.osm_router --build' to generate the graph."
        ),
    }


@tool
def compute_osm_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    hazard_zones: Optional[List[dict]] = None,
    strategy: str = "all_hazards",
) -> dict:
    """Compute a hazard-aware route on the local OSM road network.

    Args:
        origin_lat, origin_lng: Starting point coordinates
        dest_lat, dest_lng: Destination coordinates
        hazard_zones: List of hazard zone dicts with geometry and blocked/penalty info
        strategy: "all_hazards" (avoid all), "blocked_only" (ignore penalty zones),
                  or "no_avoidance" (raw shortest path)

    Returns path coordinates, distance, ETA, and which hazards were avoided.
    """
    if not _graph_loaded:
        load_graph()

    origin = (origin_lat, origin_lng)
    destination = (dest_lat, dest_lng)
    zones = hazard_zones or []

    if strategy == "blocked_only":
        zones = [h for h in zones if h.get("blocked")]
    elif strategy == "no_avoidance":
        zones = []

    return _compute_single_route(origin, destination, zones)


@tool
def compute_multi_candidate_routes(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    hazard_zones: Optional[List[dict]] = None,
) -> dict:
    """Compute multiple candidate routes with different hazard avoidance strategies.

    Returns up to 3 routes:
    1. Primary: avoids all hazard zones (blocked + penalty)
    2. Relaxed: avoids only blocked zones (crosses penalty zones at reduced speed)
    3. Raw: no hazard avoidance (shortest possible path)

    Use this to give the Route Optimizer Agent multiple options to evaluate.
    """
    if not _graph_loaded:
        load_graph()

    origin = (origin_lat, origin_lng)
    destination = (dest_lat, dest_lng)
    zones = hazard_zones or []

    candidates = []

    primary = _compute_single_route(origin, destination, zones)
    primary["label"] = "Primary (all hazards avoided)"
    candidates.append(primary)

    blocked_only = [h for h in zones if h.get("blocked")]
    if blocked_only != zones:
        relaxed = _compute_single_route(origin, destination, blocked_only)
        relaxed["label"] = "Relaxed (penalty zones allowed)"
        candidates.append(relaxed)

    if zones:
        raw = _compute_single_route(origin, destination, [])
        raw["label"] = "Raw (no avoidance)"
        candidates.append(raw)

    return {
        "candidate_count": len(candidates),
        "candidates": candidates,
    }


def build_graph_for_city() -> None:
    """Download and save OSM road network for the configured city."""
    try:
        import osmnx as ox
    except ImportError:
        print("ERROR: osmnx is required to build the graph. pip install osmnx")
        return

    city = settings.city
    print(f"Downloading road network for {city.name} ({city.lat}, {city.lng}, r={city.radius_km}km)...")

    G = ox.graph_from_point(
        (city.lat, city.lng),
        dist=int(city.radius_km * 1000),
        network_type="drive",
    )
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    out_path = city.data_dir / "road_graph.pkl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        pickle.dump(G, f)

    print(f"Saved: {out_path} ({G.number_of_nodes()} nodes, {G.number_of_edges()} edges)")


if __name__ == "__main__":
    import sys
    if "--build" in sys.argv:
        build_graph_for_city()
    else:
        print("Usage: python -m backend.tools.osm_router --build")

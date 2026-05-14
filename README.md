# ResQRoute — AI-Driven Rescue Route Optimization

Agentic AI disaster response platform. Five autonomous LangGraph agents (plus per-base
Field Commanders) reason over real-time traffic, weather, hazard, and news data to
dispatch the safest, fastest rescue response — with live citizen alerts and a
continuous re-evaluation loop.

## Stack

- **LLM:** Google Gemini (via Vertex AI service account) with LangGraph ReAct agents
- **Routing:** OSMnx + NetworkX road graph (~298K nodes, ~734K edges for Bengaluru)
  combined with TomTom Routing for traffic-aware ETA validation
- **Real-time data:** Open-Meteo (weather), GDACS (disaster alerts), USGS (earthquakes),
  GNews (corroboration), TomTom (traffic flow/incidents), Google Maps Geocoding (fallback)
- **Backend:** FastAPI + asyncio event bus + WebSocket fan-out
- **Frontend:** Next.js 14 (App Router) + Mapbox GL JS + Tailwind CSS

## Architecture

```
Citizen / SOS / External alert
         |
         v
   Event Bus (asyncio pub/sub)
         |
         v
   Supervisor (LangGraph)
         |
   +-----+-----+-----+-----+-----+
   v     v     v     v     v     v
  Sit  Hazard Comms Disp  Route  Re-eval
  Awar Assess           Strat  Optim  (background)
                         |
                         v
                   Field Commanders (per base)
                   ACCEPT / DECLINE / COUNTER-PROPOSE
                         |
                         v
                   Mission Tracker
                         |
                         v
                   WebSocket -> Frontend
```

## Agents

| Agent | Tools | Decision |
|-------|-------|----------|
| Situation Awareness | geocoder, weather, news, GDACS, USGS, hazard_db | Classify incident, extract entities, corroborate |
| Hazard Assessment | hazard_db CRUD, weather, traffic flow/incidents, GDACS | CREATE / UPGRADE / DOWNGRADE / CLEAR zones |
| Dispatch Strategist | rescue_bases, hazard_zones, OSM router, TomTom router | Pick best base by ETA + specialization + safety |
| Field Commander (per base) | rescue_bases, hazard_zones, weather, traffic | ACCEPT / DECLINE / COUNTER-PROPOSE proposed mission |
| Route Optimizer | multi-candidate OSM, TomTom route/traffic/incidents, weather | Choose route balancing safety, speed, traffic |
| Communications | broadcast, hazard_zones, geocoder | Compose + broadcast geofenced citizen alert |

## Running Locally

### Prerequisites
- Python 3.9+ (tested on 3.9.6)
- Node 20+
- Vertex AI service account JSON in `credentials/vertex-sa.json`
- API keys for TomTom, Mapbox, GNews in `.env`

### Backend
```bash
cd resqroute
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# One-time: build OSM road graph (~2 minutes)
python -m backend.tools.osm_router --build

# Run server
GOOGLE_APPLICATION_CREDENTIALS=./credentials/vertex-sa.json \
  uvicorn backend.api.main:app --host 0.0.0.0 --port 8001
```

### Frontend
```bash
cd resqroute/frontend
npm install
npm run dev -- -p 3000
```

Open `http://localhost:3000`.

### Tests
```bash
cd resqroute
GOOGLE_APPLICATION_CREDENTIALS=./credentials/vertex-sa.json \
  .venv/bin/python -m pytest tests/ -v
```

## Demo Scenarios

The Authority dashboard has a `Demo Scenarios` panel that launches scripted incidents:

| Scenario | What it shows |
|----------|--------------|
| `koramangala_flood` | Multi-citizen flood correlation, hazard zone declared, dispatch negotiation, route around zone |
| `whitefield_fire` | High-severity (5) fire, Field Commander reasoning under capacity constraints |
| `indiranagar_sos` | SOS short-circuit, full 5-agent pipeline + negotiation |

You can also POST `/demo/run` with a `scenario_id` directly.

## Key Endpoints

- `GET /health` — system status and agent/tool registry
- `GET /authority/dashboard` — combined events + active missions + stats
- `GET /authority/agent-log?limit=N` — recent agent reasoning + tool calls
- `GET /missions/active` — currently active missions with negotiation history
- `GET /missions/{id}/negotiation` — full negotiation trail
- `GET /hazards/` — active hazard zones
- `GET /metrics/overview` — agent/tool latency, success rate, collaboration graph
- `POST /citizen/report` — submit a citizen disaster report
- `POST /citizen/sos` — trigger SOS distress signal
- `POST /demo/run` — launch a scripted demo scenario
- `WS /ws` — Authority: all agent events
- `WS /ws/citizen/{id}` — Citizen: geofenced public alerts

## What Makes This Agentic (Not a Pipeline)

| Aspect | Pipeline | This system |
|--------|----------|------------|
| Tool selection | Hardcoded | LLM picks which tools to call |
| Negotiation | Fixed distance rules | LLM reasons accept/decline/counter |
| Route choice | Shortest path | LLM evaluates 3 candidates + live traffic |
| Hazard zones | Threshold-triggered | LLM reasons on correlation + confidence |
| Re-routing | Never | Background loop reasons about conditions every 2 min |
| Citizen alerts | Templates | LLM composes context-appropriate messages |

## Project Layout

```
resqroute/
  backend/
    agents/         # LLM agents (one file per agent)
    api/            # FastAPI app + routes
    core/           # config, event bus, mission tracker, metrics
    tools/          # 17 typed LangChain tools
    data/cities/bengaluru/   # rescue bases, hazard zones, OSM graph
  credentials/      # Vertex AI service account (gitignored)
  frontend/         # Next.js + Mapbox PWA
  tests/            # pytest smoke + unit tests
  .env              # API keys (gitignored)
  requirements.txt
```

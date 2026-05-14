import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-warm-white text-body-text">
      {/* ── NAV ───────────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b-[3px] border-mid-green bg-forest px-6 sm:px-12">
        <Link href="/" className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center bg-mid-green"
            style={{
              clipPath:
                "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
            }}
          >
            <span className="font-serif text-sm font-semibold text-warm-white">
              R
            </span>
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight text-warm-white">
            Res<em className="not-italic text-light-green italic">Q</em>Route
          </span>
        </Link>

        <ul className="hidden items-center md:flex">
          {[
            ["#how", "How It Works"],
            ["#agents", "Agents"],
            ["#data", "Data Sources"],
            ["#why", "Why Agentic"],
            ["#stack", "Stack"],
          ].map(([href, label]) => (
            <li key={href}>
              <Link
                href={href}
                className="block h-16 px-5 text-[13px] leading-[64px] tracking-wide text-white/60 transition hover:text-warm-white"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Link
            href="/citizen"
            className="hidden border border-white/20 px-4 py-1.5 text-[13px] font-medium text-white/70 transition hover:border-white/50 hover:text-warm-white sm:inline-block"
          >
            Citizen App
          </Link>
          <Link
            href="/authority"
            className="bg-warm-white px-5 py-2 text-[13px] font-semibold text-forest transition hover:bg-mint"
          >
            Open Command Centre
          </Link>
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section
        id="hero"
        className="relative grid min-h-screen items-center overflow-hidden bg-forest pt-16 lg:grid-cols-2"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 60% 50%, rgba(46,139,99,.12) 0%, transparent 60%), radial-gradient(ellipse at 30% 80%, rgba(20,61,46,.4) 0%, transparent 50%)",
          }}
        />

        {/* Topo SVG */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 900 700"
          preserveAspectRatio="xMidYMid slice"
        >
          <g stroke="rgba(46,139,99,.12)" fill="none" strokeWidth="1">
            <ellipse cx="650" cy="350" rx="280" ry="200" />
            <ellipse cx="650" cy="350" rx="240" ry="165" />
            <ellipse cx="650" cy="350" rx="200" ry="130" />
            <ellipse cx="650" cy="350" rx="160" ry="100" />
            <ellipse cx="650" cy="350" rx="120" ry="72" />
            <ellipse cx="650" cy="350" rx="80" ry="50" />
            <ellipse cx="200" cy="600" rx="180" ry="120" />
            <ellipse cx="200" cy="600" rx="140" ry="90" />
            <ellipse cx="200" cy="600" rx="100" ry="60" />
          </g>
        </svg>

        <div className="relative z-10 px-6 py-20 sm:px-12 lg:px-16">
          <div className="mb-8 inline-flex items-center gap-2.5 border border-light-green/30 bg-mid-green/20 px-3.5 py-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-light-green live-pulse" />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[.12em] text-light-green">
              Live · Bengaluru · Multi-Agent System
            </span>
          </div>

          <h1 className="font-serif text-[clamp(40px,5.5vw,72px)] font-light leading-[1.08] tracking-tight text-warm-white">
            <strong className="block font-semibold">Rescue routes.</strong>
            Decided by agents —<br />
            <em className="font-light italic text-light-green">
              not algorithms.
            </em>
          </h1>

          <p className="mt-6 max-w-[480px] text-base font-light leading-[1.8] text-white/65">
            A multi-agent AI system for India&apos;s disaster response
            infrastructure. Six autonomous agents coordinate rescue operations —
            routing around flood zones, fire perimeters, and collapsed roads —
            in real time, with full reasoning transparency.
          </p>

          <div className="mt-10 flex flex-wrap gap-3.5">
            <Link
              href="/authority"
              className="bg-warm-white px-7 py-3.5 text-sm font-semibold tracking-wide text-forest transition hover:-translate-y-0.5 hover:bg-mint hover:shadow-[0_6px_24px_rgba(0,0,0,.2)]"
            >
              Open Command Centre →
            </Link>
            <Link
              href="/citizen"
              className="border border-white/25 px-7 py-3.5 text-sm font-normal tracking-wide text-white/85 transition hover:border-white/60 hover:text-warm-white"
            >
              Citizen App
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-14 flex border-t border-white/10 pt-8">
            {[
              { num: "6", suffix: "", label: "Autonomous Agents" },
              { num: "200", suffix: "ms", prefix: "<", label: "Route Compute" },
              { num: "9", suffix: "+", label: "Live Data Sources" },
              { num: "0", suffix: "", label: "Hardcoded Decisions" },
            ].map((s, i, arr) => (
              <div
                key={s.label}
                className={
                  "pr-8 mr-8" +
                  (i === arr.length - 1
                    ? " border-r-0 mr-0 pr-0"
                    : " border-r border-white/10")
                }
              >
                <div className="font-serif text-[28px] font-light leading-none text-warm-white sm:text-[32px]">
                  {s.prefix && <span>{s.prefix}</span>}
                  <span className="font-semibold text-light-green">
                    {s.num}
                  </span>
                  <span>{s.suffix}</span>
                </div>
                <div className="mt-1.5 text-[10px] font-normal uppercase tracking-[.06em] text-white/45">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — admin preview mock */}
        <div className="relative z-10 hidden h-full items-center px-12 py-20 lg:flex">
          <div className="dark-scope w-full overflow-hidden border border-admin-rule bg-onyx shadow-[-24px_24px_80px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-2.5 border-b border-admin-rule bg-onyx-2 px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-danger" />
                <span className="h-2.5 w-2.5 rounded-full bg-safety-org" />
                <span className="h-2.5 w-2.5 rounded-full bg-cleared" />
              </div>
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
                ResQRoute — Command Centre
              </span>
              <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-safety-org">
                <span className="h-1.5 w-1.5 rounded-full bg-safety-org live-pulse-orange" />
                Active Incident
              </div>
            </div>
            <div className="grid grid-cols-[180px_1fr]">
              <div className="border-r border-admin-rule bg-[#141a21] py-3.5">
                {[
                  ["Live Operations", true],
                  ["Missions", false],
                  ["Agent Reasoning", false],
                  ["Hazard Zones", false],
                  ["Resources", false],
                  ["Reports", false],
                ].map(([label, active]) => (
                  <div
                    key={label as string}
                    className={
                      "flex items-center gap-2.5 border-l-2 px-4 py-2 text-[11px] tracking-wide " +
                      (active
                        ? "border-safety-org bg-safety-org/15 text-safety-org"
                        : "border-transparent text-steel-light")
                    }
                  >
                    <span className="h-1 w-1 rounded-full bg-current" />
                    {label as string}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2.5 p-3.5">
                <div className="relative h-40 overflow-hidden border border-admin-rule bg-[#1a2332] map-grid">
                  <span className="absolute right-2.5 top-2 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light">
                    Koramangala — Live
                  </span>
                  <div
                    className="absolute h-[45px] w-[70px] rounded-full border border-dashed border-danger/50 bg-danger/10"
                    style={{ top: 50, left: 100 }}
                  />
                  <div
                    className="absolute h-[3px] w-[180px] rounded-sm bg-safety-org"
                    style={{ top: 88, left: 30, transform: "rotate(-20deg)" }}
                  />
                  <div className="absolute bottom-6 left-6 h-2.5 w-2.5 rounded-full bg-cleared shadow-[0_0_8px_var(--cleared)]" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Active Missions", "3", "text-safety-org"],
                    ["Severity", "HIGH", "text-danger"],
                    ["Agents", "6/6", "text-cleared"],
                  ].map(([lbl, val, cls]) => (
                    <div
                      key={lbl}
                      className="border border-admin-rule bg-slate px-3 py-2.5"
                    >
                      <div className="font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
                        {lbl}
                      </div>
                      <div
                        className={`mt-1 font-serif text-xl font-normal leading-none ${cls}`}
                      >
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border border-admin-rule bg-slate px-3 py-2.5">
                  <div className="font-mono text-[9px] uppercase tracking-[.12em] text-safety-org">
                    Route Optimizer — Reasoning
                  </div>
                  <p className="mt-2 text-[10px] leading-[1.6] text-admin-muted">
                    Calling OSMnx graph with flood zone penalties on Sarjapur
                    Rd. TomTom shows{" "}
                    <span className="text-admin-text">severe congestion</span>{" "}
                    on Outer Ring Road — re-weighting edges. Candidate A:
                    14.2km via Koramangala 80ft, ETA{" "}
                    <span className="text-admin-text">11 min</span>. Selecting:
                    safest exposure to hazard zone, minimal traffic…
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ANNOUNCE STRIP ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-4 bg-deep-green px-12 py-3">
        <span className="bg-light-green px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[.08em] text-deep-green">
          Avinya 2.0
        </span>
        <span className="text-[13px] text-white/85">
          Built at the{" "}
          <strong className="font-semibold text-warm-white">
            National Level Intercollegiate Hackathon
          </strong>{" "}
          — SJC Institute of Technology, Chikkaballapur · 14–15 May 2026 · All
          five phases completed.
        </span>
      </div>

      {/* ── HOW IT WORKS ──────────────────────────────────────── */}
      <section
        id="how"
        className="border-y border-rule-color bg-mint-white px-6 py-24 sm:px-12"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 grid items-end gap-12 md:grid-cols-2">
            <div>
              <div className="kicker mb-4">How It Works</div>
              <h2 className="serif-h text-[clamp(28px,3.5vw,44px)]">
                From incident to route —<br />
                <em>in seconds.</em>
              </h2>
            </div>
            <p className="text-[15px] font-light leading-[1.8] text-muted-text">
              Each agent acts autonomously. None follows a script. The
              Supervisor coordinates — it does not command. Every decision is
              logged with the LLM&apos;s full reasoning.
            </p>
          </div>

          <div className="grid gap-px border border-rule-color bg-rule-color md:grid-cols-5">
            {[
              {
                num: "01",
                title: "Incident Detected",
                desc: "Citizen reports, SOS signals, and feeds from GDACS, Open-Meteo, USGS, and GNews arrive simultaneously.",
                tag: "Situation Agent",
              },
              {
                num: "02",
                title: "Hazard Zone Declared",
                desc: "Agent correlates reports with live weather and traffic anomalies — reasoning, not thresholds, triggers the zone.",
                tag: "Hazard Agent",
              },
              {
                num: "03",
                title: "Dispatch Negotiation",
                desc: "Field Commanders accept, counter-propose, or decline — live LLM reasoning based on capacity and specialisation.",
                tag: "Dispatch Agent",
                active: true,
              },
              {
                num: "04",
                title: "Route Computed",
                desc: "2–3 candidates on the OSMnx graph with hazard penalties. TomTom validates traffic. LLM selects with justification.",
                tag: "Route Agent",
              },
              {
                num: "05",
                title: "Citizen Alerted",
                desc: "LLM-composed messages (not templates) broadcast with geofenced radius determined by disaster type and severity.",
                tag: "Comms Agent",
              },
            ].map((s) => (
              <div
                key={s.num}
                className={
                  "p-7 " +
                  (s.active
                    ? "border-b-[3px] border-mid-green bg-forest"
                    : "bg-warm-white")
                }
              >
                <div
                  className={
                    "font-serif text-[40px] font-light leading-none " +
                    (s.active ? "text-white/15" : "text-rule-color")
                  }
                >
                  {s.num}
                </div>
                <div
                  className={
                    "mt-3.5 text-[13px] font-semibold leading-tight " +
                    (s.active ? "text-warm-white" : "text-forest")
                  }
                >
                  {s.title}
                </div>
                <div
                  className={
                    "mt-2 text-[12px] font-light leading-relaxed " +
                    (s.active ? "text-white/60" : "text-muted-text")
                  }
                >
                  {s.desc}
                </div>
                <span
                  className={
                    "mt-3 inline-block border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.1em] " +
                    (s.active
                      ? "border-light-green/30 text-light-green"
                      : "border-rule-color text-mid-green")
                  }
                >
                  {s.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENTS ────────────────────────────────────────────── */}
      <section id="agents" className="bg-warm-white px-6 py-24 sm:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-8">
            <div>
              <div className="kicker mb-4">The Agent Swarm</div>
              <h2 className="serif-h text-[clamp(28px,3.5vw,44px)]">
                Six agents.<br />
                One <em>mission.</em>
              </h2>
            </div>
            <p className="max-w-md text-[15px] font-light leading-[1.8] text-muted-text">
              Each agent is a LangGraph ReAct agent with a goal, a toolkit, and
              authority to negotiate with the others. The Supervisor watches.
              It does not direct.
            </p>
          </div>

          <div className="grid gap-px border border-rule-color bg-rule-color md:grid-cols-3">
            {[
              {
                num: "Agent I",
                name: "Situation Awareness",
                desc: "Ingests citizen reports, GDACS feeds, USGS seismic data, GNews headlines — and builds the unified operational picture every other agent reasons from.",
                tools: ["GDACS API", "GNews API", "USGS API", "Geocoder", "Vision"],
              },
              {
                num: "Agent II",
                name: "Hazard Assessment",
                desc: "Declares, upgrades, or dismisses hazard zones through LLM reasoning. Correlates citizen reports with live weather and traffic anomalies — no fixed thresholds.",
                tools: ["Open-Meteo", "TomTom Traffic", "Hazard DB"],
              },
              {
                num: "Agent III",
                name: "Dispatch Strategist",
                desc: "Evaluates rescue bases by specialisation, availability, and workload. Proposes assignments. Re-evaluates when Field Commanders counter-propose or decline.",
                tools: ["Resource DB", "Hazard DB", "Directions"],
              },
              {
                num: "Agent IV",
                name: "Route Optimizer",
                desc: "Generates 2–3 candidate paths on the OSMnx hazard-weighted road graph. Validates each against TomTom live traffic. The LLM chooses with full written justification.",
                tools: ["OSMnx Graph", "TomTom Flow", "TomTom ETA", "Google Maps ↩"],
              },
              {
                num: "Agent V",
                name: "Communications",
                desc: "Composes severity-appropriate alerts using LLM-generated text — never templates. Determines broadcast radius and tone based on disaster type and population.",
                tools: ["Broadcast", "Geocoder", "Hazard DB"],
              },
              {
                num: "Agent VI",
                name: "Supervisor",
                desc: "Orchestrates the swarm via an async event bus. Can override, redirect, or escalate. Triggers continuous re-evaluation when conditions shift mid-mission.",
                tools: ["Event Bus", "All Agent APIs", "Field Commanders"],
                supervisor: true,
              },
            ].map((a) => (
              <article
                key={a.name}
                className={
                  "group relative bg-warm-white p-8 transition hover:bg-mint-white " +
                  (a.supervisor ? "md:col-span-3" : "")
                }
              >
                <span className="absolute inset-x-0 top-0 h-[3px] bg-transparent transition group-hover:bg-mid-green" />
                <div className="font-serif text-[11px] italic uppercase tracking-[.1em] text-rule-color">
                  {a.num}
                </div>
                <h3 className="mt-3 font-serif text-[20px] font-semibold leading-tight text-forest">
                  {a.name}
                </h3>
                <p className="mt-2.5 text-[13px] font-light leading-[1.7] text-muted-text">
                  {a.desc}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {a.tools.map((t) => (
                    <span
                      key={t}
                      className="border border-rule-color bg-mint-white px-2 py-0.5 font-mono text-[9px] tracking-wide text-muted-text"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                {a.supervisor && (
                  <div className="mt-6 grid gap-6 border-t border-rule-color pt-6 md:grid-cols-2">
                    <div>
                      <div className="text-[12px] font-semibold text-forest">
                        Continuous Re-evaluation
                      </div>
                      <div className="mt-1 text-[12px] font-light leading-relaxed text-muted-text">
                        A background loop asks the Hazard Agent: &ldquo;have
                        conditions changed?&rdquo; If yes, active missions are
                        re-routed automatically.
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold text-forest">
                        Field Commander Sub-agents
                      </div>
                      <div className="mt-1 text-[12px] font-light leading-relaxed text-muted-text">
                        Field Commanders are LLM agents too. They reason about
                        team capacity, disaster type, and specialisation before
                        accepting or declining a mission.
                      </div>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── DATA SOURCES ──────────────────────────────────────── */}
      <section
        id="data"
        className="border-y border-rule-color bg-mint-white px-6 py-24 sm:px-12"
      >
        <div className="mx-auto max-w-6xl">
          <div className="kicker mb-4">Intelligence Layer</div>
          <h2 className="serif-h text-[clamp(28px,3.5vw,44px)]">
            Nine live sources.<br />
            <em>Zero fake fallbacks.</em>
          </h2>

          <div className="mt-14 grid gap-12 lg:grid-cols-2">
            <div className="border border-rule-color">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 bg-forest px-5 py-3 font-mono text-[9px] uppercase tracking-[.14em] text-white/55">
                <span>Source</span>
                <span>Cost</span>
                <span>Status</span>
              </div>
              {[
                {
                  name: "GDACS Disaster Feed",
                  sub: "Earthquakes · Floods · Cyclones · Droughts — global",
                  cost: "Free",
                  paid: false,
                  live: true,
                },
                {
                  name: "Open-Meteo",
                  sub: "Precipitation · Wind speed · Flood risk indices",
                  cost: "Free",
                  paid: false,
                  live: true,
                },
                {
                  name: "USGS Earthquake API",
                  sub: "Real-time global seismic data — magnitude, depth, location",
                  cost: "Free",
                  paid: false,
                  live: true,
                },
                {
                  name: "GNews API",
                  sub: "News corroboration for hazard validation (100 req/day)",
                  cost: "Free tier",
                  paid: false,
                  live: true,
                },
                {
                  name: "OSMnx + NetworkX Graph",
                  sub: "Hazard-weighted local pathfinding — sub-200ms",
                  cost: "Free",
                  paid: false,
                  live: true,
                },
                {
                  name: "TomTom Traffic Flow",
                  sub: "Live congestion · Road incidents · Closures (2,500 req/day)",
                  cost: "Free tier",
                  paid: true,
                  live: true,
                },
                {
                  name: "TomTom Routing API",
                  sub: "ETA validation against real-world traffic timing",
                  cost: "Free tier",
                  paid: true,
                  live: true,
                },
                {
                  name: "Google Maps Platform",
                  sub: "Routing fallback + Geocoding ($200/month free credit)",
                  cost: "Fallback",
                  paid: true,
                  live: false,
                },
                {
                  name: "Citizen Reports",
                  sub: "First-party · Text · Photo · GPS · SOS Button",
                  cost: "Primary",
                  paid: false,
                  live: true,
                },
              ].map((s) => (
                <div
                  key={s.name}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-rule-color bg-warm-white px-5 py-3 transition hover:bg-mint-white"
                >
                  <div>
                    <div className="text-[13px] font-medium text-forest">
                      {s.name}
                    </div>
                    <div className="mt-0.5 text-[11px] font-light text-muted-text">
                      {s.sub}
                    </div>
                  </div>
                  <span
                    className={
                      "border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.08em] " +
                      (s.paid
                        ? "border-warn-amber/40 bg-warn-pale text-warn-amber"
                        : "border-rule-color bg-safe-pale text-safe-green")
                    }
                  >
                    {s.cost}
                  </span>
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (s.live
                        ? "bg-mid-green live-pulse"
                        : "bg-warn-amber/60")
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-7">
              {[
                {
                  title: "Transparent about gaps",
                  body: "When a source is unreachable, the agent logs it explicitly: \"GDACS unreachable — operating on citizen data only.\" It never injects synthetic data. Every gap appears in the reasoning trace.",
                },
                {
                  title: "Corroboration over assumption",
                  body: "The Hazard Agent doesn't declare a zone on one report. It reasons about how many, at what distance, in what timeframe — then cross-checks with weather and traffic before acting.",
                },
                {
                  title: "Zero rate-limit failure modes",
                  body: "The OSMnx local graph handles all routing at zero API cost and sub-200ms latency. TomTom and Google Maps layer traffic truth on top, with quota-aware automatic switching.",
                },
              ].map((p) => (
                <div
                  key={p.title}
                  className="border-l-[3px] border-rule-color pl-5 transition hover:border-mid-green"
                >
                  <div className="font-serif text-[18px] font-semibold text-forest">
                    {p.title}
                  </div>
                  <div className="mt-2 text-[14px] font-light leading-[1.8] text-muted-text">
                    {p.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY AGENTIC ───────────────────────────────────────── */}
      <section id="why" className="bg-forest px-6 py-24 sm:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="kicker mb-4 text-light-green">Why Agentic</div>
          <h2 className="serif-h on-forest max-w-2xl text-[clamp(28px,3.5vw,44px)]">
            Not a pipeline<br />
            wearing an <em>agent mask.</em>
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] font-light leading-[1.8] text-white/65">
            Most systems label predetermined sequences as &ldquo;AI.&rdquo;
            ResQRoute agents genuinely reason — selecting tools, evaluating
            conflicts, negotiating with each other, and adapting without human
            intervention.
          </p>

          <div className="mt-12 overflow-hidden border border-white/10">
            <div className="grid grid-cols-[160px_1fr_1fr] bg-black/30 sm:grid-cols-[220px_1fr_1fr]">
              <div className="border-r border-white/10 px-5 py-3 font-mono text-[10px] uppercase tracking-[.14em] text-white/30">
                Decision
              </div>
              <div className="border-r border-white/10 px-5 py-3 font-mono text-[10px] uppercase tracking-[.14em] text-white/35">
                Rule-Based Pipeline
              </div>
              <div className="px-5 py-3 font-mono text-[10px] uppercase tracking-[.14em] text-light-green">
                ResQRoute Agents
              </div>
            </div>
            {[
              [
                "Tool selection",
                "Hardcoded call sequence",
                "LLM selects from registered toolkit per reasoning step",
              ],
              [
                "Hazard zones",
                "Fixed report-count threshold (≥3 = zone)",
                "LLM reasons: correlation, distance, timeframe, weather context",
              ],
              [
                "Dispatch",
                "Nearest base by distance formula",
                "Field Commanders accept, counter-propose, or decline with reasoning",
              ],
              [
                "Route selection",
                "Shortest path, single output",
                "LLM evaluates 3 candidates (hazard + traffic + ETA) holistically",
              ],
              [
                "Error handling",
                "try/except with silent fallback",
                "Agent reasons about failure, logs explicitly, adapts strategy",
              ],
              [
                "Re-routing",
                "Never — route fixed at dispatch",
                "Continuous monitoring; LLM decides if change warrants re-plan",
              ],
              [
                "Citizen alerts",
                "Template strings with variable substitution",
                "LLM composes context-appropriate message, tone, and broadcast radius",
              ],
            ].map(([d, p, a], i) => (
              <div
                key={i}
                className="grid grid-cols-[160px_1fr_1fr] border-t border-white/10 transition hover:bg-white/[0.03] sm:grid-cols-[220px_1fr_1fr]"
              >
                <div className="border-r border-white/10 px-5 py-3.5 font-serif text-[13px] italic text-white/50">
                  {d}
                </div>
                <div className="border-r border-white/10 px-5 py-3.5 text-[13px] font-light leading-[1.55] text-white/35">
                  {p}
                </div>
                <div className="px-5 py-3.5 text-[13px] font-light leading-[1.55] text-white/85">
                  {a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STACK ─────────────────────────────────────────────── */}
      <section
        id="stack"
        className="border-y border-rule-color bg-mint-white px-6 py-24 sm:px-12"
      >
        <div className="mx-auto max-w-6xl">
          <div className="kicker mb-4">Technology Stack</div>
          <h2 className="serif-h text-[clamp(28px,3.5vw,44px)]">
            Production-grade<br />
            <em>from day one.</em>
          </h2>
          <div className="mt-12 grid gap-px border border-rule-color bg-rule-color sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                layer: "Agent Framework",
                tech: "LangGraph ReAct",
                desc: "Tool-calling agents with genuine reasoning loops — not prompt chains. Gemini function-calling enabled.",
              },
              {
                layer: "LLM",
                tech: "Gemini 2.5 Flash",
                desc: "All six agents. Full reasoning traces. Multi-region pool for resilience and quota.",
              },
              {
                layer: "Routing Core",
                tech: "OSMnx + NetworkX",
                desc: "Hazard-weighted road graph. Sub-200ms pathfinding. Zero rate limits. City-configurable.",
              },
              {
                layer: "Traffic Layer",
                tech: "TomTom + Google Maps",
                desc: "Live congestion validation and ETA accuracy. Automatic quota-aware switching.",
              },
              {
                layer: "Backend",
                tech: "FastAPI · Python",
                desc: "Async event bus, WebSocket streaming, agent coordination. LangChain + LangGraph integration.",
              },
              {
                layer: "Frontend",
                tech: "Next.js 14 + Mapbox GL",
                desc: "App Router, dark map theme, real-time WebSocket, Tailwind CSS, design-token theming.",
              },
              {
                layer: "Disaster Intelligence",
                tech: "GDACS · USGS · Open-Meteo",
                desc: "All free, no API keys. Polled every 60s. GNews for news corroboration.",
              },
              {
                layer: "Observability",
                tech: "Full Reasoning Traces",
                desc: "Every agent decision logged with LLM reasoning, latency per tool call, and collaboration graph.",
              },
            ].map((s) => (
              <div
                key={s.layer}
                className="bg-warm-white p-7 transition hover:bg-mint-white"
              >
                <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
                  {s.layer}
                </div>
                <div className="mt-3 font-serif text-[17px] font-semibold text-forest">
                  {s.tech}
                </div>
                <div className="mt-1.5 text-[12px] font-light leading-[1.65] text-muted-text">
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <section
        id="cta"
        className="relative overflow-hidden bg-deep-green px-6 py-24 sm:px-12"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 80% 50%, rgba(46,139,99,.2) 0%, transparent 60%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[.2em] text-light-green">
              Live Now
            </div>
            <h2 className="mt-4 font-serif text-[clamp(28px,4vw,48px)] font-normal leading-[1.12] tracking-tight text-warm-white">
              Step into the<br />
              <em className="italic text-light-green">command centre.</em>
            </h2>
            <p className="mt-5 max-w-md text-[15px] font-light leading-[1.8] text-white/65">
              The full agent swarm is running. Open the operator console to
              watch six agents reason in real time — or open the citizen app to
              file a report and trigger the pipeline yourself.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <Link
                href="/authority"
                className="bg-warm-white px-7 py-3.5 text-sm font-semibold tracking-wide text-forest transition hover:-translate-y-0.5 hover:bg-mint"
              >
                Open Command Centre →
              </Link>
              <Link
                href="/citizen"
                className="border border-white/25 px-7 py-3.5 text-sm font-normal tracking-wide text-white/80 transition hover:border-white/60 hover:text-warm-white"
              >
                Citizen App
              </Link>
            </div>
          </div>

          <div className="border border-light-green/20 bg-forest p-7">
            <div className="font-mono text-[10px] uppercase tracking-[.14em] text-light-green">
              Live System Surface
            </div>
            <ul className="mt-5 space-y-1.5">
              {[
                ["Agent Reasoning Panel", "/authority"],
                ["Live Mission Board", "/authority"],
                ["Hazard Zone Map", "/authority"],
                ["Observability Metrics", "/authority"],
                ["Citizen Report + Photo", "/citizen"],
                ["Geofenced Alert Stream", "/citizen"],
              ].map(([label, href]) => (
                <li
                  key={label}
                  className="flex items-center justify-between border border-light-green/15 bg-black/20 px-4 py-2.5"
                >
                  <span className="text-[12px] font-medium text-warm-white">
                    {label}
                  </span>
                  <Link
                    href={href}
                    className="font-mono text-[10px] uppercase tracking-[.1em] text-light-green hover:text-warm-white"
                  >
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className="bg-forest px-6 py-14 sm:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 border-b border-white/10 pb-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
            <div>
              <div className="font-serif text-[22px] font-semibold text-warm-white">
                Res<em className="not-italic italic text-light-green">Q</em>
                Route
              </div>
              <p className="mt-3 max-w-xs text-[13px] font-light leading-[1.75] text-white/50">
                AI-powered rescue route optimization for India&apos;s disaster
                response infrastructure. Six autonomous agents. Nine live data
                sources. Zero hardcoded decisions.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 border border-light-green/20 bg-mid-green/20 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-light-green live-pulse" />
                <span className="font-mono text-[10px] tracking-[.1em] text-light-green">
                  Bengaluru — City Configurable
                </span>
              </div>
            </div>

            <FooterCol
              title="Platform"
              links={[
                ["Command Centre", "/authority"],
                ["Citizen App", "/citizen"],
                ["Agent Reasoning", "/authority"],
                ["Mission Board", "/authority"],
              ]}
            />
            <FooterCol
              title="Agents"
              links={[
                ["Situation Awareness", "#agents"],
                ["Hazard Assessment", "#agents"],
                ["Dispatch Strategist", "#agents"],
                ["Route Optimizer", "#agents"],
                ["Communications", "#agents"],
              ]}
            />
            <FooterCol
              title="Data Sources"
              links={[
                ["GDACS · USGS", "#data"],
                ["Open-Meteo", "#data"],
                ["TomTom Traffic", "#data"],
                ["Google Maps Platform", "#data"],
                ["Mapbox GL JS", "#data"],
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <span className="font-mono text-xs tracking-wide text-white/30">
              © 2026 ResQRoute
            </span>
            <span className="font-mono text-xs text-white/30">
              <strong className="font-medium text-white/55">
                Avinya 2.0 · SJC Institute of Technology
              </strong>{" "}
              · Chikkaballapur · 14–15 May 2026
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[.18em] text-white/35">
        {title}
      </div>
      <ul className="mt-4 space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-[13px] font-light text-white/45 transition hover:text-white/85"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

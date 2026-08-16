import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bird,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Expand,
  Gauge,
  Globe2,
  Laptop,
  LayoutDashboard,
  Monitor,
  Network,
  Pin,
  Radio,
  Server,
  ShieldCheck,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  scaledTrafficY,
  smoothTrafficPath,
  smoothTrafficValues,
  trafficScale,
} from "./traffic-chart.mjs";
import {
  petAnimationForState,
  petFrameAtElapsed,
  petFramePosition,
  petPlaybackForState,
  petSpriteGrid,
  petSpriteKey,
  resolvePetSpriteUrl,
  selectDisplayMachine,
  selectedMachineIdForFollowMode,
  shouldReducePetMotion,
} from "./pet-display.mjs";
import { fetchWithTimeout } from "./http.mjs";
import {
  connectionAfterFailure,
  displayConnectionConfiguration,
  resolveStatusAssetURLs,
} from "./status-connection.mjs";
import {
  appendHistorySample,
  historyCoverageMinutes,
  historyValuesInWindow,
  LOAD_TREND_WINDOW_MS,
  mergeHistorySamples,
} from "./status-history.mjs";
import {
  fleetMachineVisual,
  fleetLoadPresentation,
  loadParticlePhase,
  machineLoadPresentation,
} from "./load-model.mjs";
import { shouldReduceKioskMotion } from "./kiosk-motion.mjs";

const VIEWS = ["overview", "network", "machines", "load", "pet"];
const VIEW_LABELS = { overview: "Overview", network: "Network", machines: "Machines", load: "Load", pet: "Pet" };
const FLEET_COCKPIT_NAME = "OPL Fleet Cockpit";
const FLEET_GATEWAY_NAME = "OPL Fleet Telemetry Gateway";
const FLEET_AGENT_NAME = "OPL Fleet Agent";
const CONNECTION_STALE_GRACE_MS = 5_000;
const DISPLAY_CONNECTION = displayConnectionConfiguration();
const PET_STATE_LABELS = {
  idle: "IDLE",
  failed: "OFFLINE",
  waiting: "WAITING",
  running: "WORKING",
  review: "REVIEWING",
};
const EMPTY_STATUS = {
  productName: "OPL Fleet Cockpit · Ambient Ops",
  site: { name: FLEET_COCKPIT_NAME, timeZone: "Asia/Shanghai" },
  generatedAt: new Date().toISOString(),
  demo: false,
  overallStatus: "error",
  network: { status: "error", history: [] },
  codex: { status: "error", oneMinuteTps: 0, fiveMinuteTps: 0, cachePercent: 0, activeSessions: 0, cpuPercent: null, machineCount: 0 },
  fleet: { status: "error", oneMinuteTps: 0, fiveMinuteTps: 0, cachePercent: 0, activeSessions: 0, cpuPercent: null, machineCount: 0, liveMachineCount: 0, workingMachineCount: 0, tpsHistory: [] },
  machines: [],
};

export function App() {
  const pairingMatch = location.pathname.match(/^\/pair\/([a-zA-Z0-9_-]{32,80})$/);
  if (pairingMatch) return <PairingApproval requestId={pairingMatch[1]} />;
  const eink = location.pathname.startsWith("/display/eink");
  const [status, connection] = useStatus(DISPLAY_CONNECTION.statusEndpoint);
  if (eink) return <EinkDisplay status={status} connection={connection} />;
  return <Dashboard status={status} connection={connection} displayConnection={DISPLAY_CONNECTION} />;
}

function PairingApproval({ requestId }) {
  const [pairing, setPairing] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    fetchWithTimeout(`/api/v1/pairings/${requestId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (!stopped) {
          setPairing(payload);
          setState(payload.status);
        }
      })
      .catch((nextError) => {
        if (!stopped) {
          setError(nextError.message);
          setState("error");
        }
      });
    return () => { stopped = true; };
  }, [requestId]);

  const respond = async (action) => {
    setState("submitting");
    setError("");
    try {
      const response = await fetch(`/api/v1/pairings/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          verificationCode: pairing.verificationCode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setPairing(payload);
      setState(payload.status);
    } catch (nextError) {
      setError(nextError.message);
      setState("error");
    }
  };

  const finished = state === "approved" || state === "rejected";
  return (
    <main className="pairing-shell">
      <section className={`pairing-panel ${finished ? state : ""}`}>
        <div className="pairing-mark" aria-hidden="true">
          {state === "approved" ? <CheckCircle2 /> : state === "rejected" || state === "error" ? <XCircle /> : <ShieldCheck />}
        </div>
        {state === "loading" ? (
          <>
            <h1>Checking request</h1>
            <p>Reading the OPL Fleet Agent pairing request.</p>
          </>
        ) : null}
        {pairing && (state === "pending" || state === "submitting") ? (
          <>
            <h1>Connect OPL Fleet Agent</h1>
            <p>Approve this device only when the code matches OPL Fleet Agent.</p>
            <dl className="pairing-device">
              <div><dt>Device</dt><dd>{pairing.machineName}</dd></div>
              <div><dt>Platform</dt><dd>{pairing.platform}</dd></div>
              <div className="pairing-code-row"><dt>Pairing code</dt><dd>{pairing.verificationCode}</dd></div>
            </dl>
            {pairing.replacement ? <p className="pairing-warning">This replaces the existing key for the same machine ID.</p> : null}
            <div className="pairing-actions">
              <button type="button" className="pairing-secondary" disabled={state === "submitting"} onClick={() => respond("reject")}>Reject</button>
              <button type="button" className="pairing-primary" disabled={state === "submitting"} onClick={() => respond("approve")}>
                {state === "submitting" ? "Approving..." : "Allow device"}
              </button>
            </div>
          </>
        ) : null}
        {state === "approved" ? (
          <>
            <h1>Device connected</h1>
            <p>{pairing.machineName} can now send signed aggregate metrics. You can close this page.</p>
          </>
        ) : null}
        {state === "rejected" ? (
          <>
            <h1>Request rejected</h1>
            <p>No device key was added. You can close this page.</p>
          </>
        ) : null}
        {state === "error" ? (
          <>
            <h1>Pairing unavailable</h1>
            <p>{error || "This request expired or could not be read."}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}

function useStatus(statusEndpoint = "/api/v1/status") {
  const cached = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("home-status-last") || "null"); } catch { return null; }
  }, []);
  const [status, setStatus] = useState(cached || EMPTY_STATUS);
  const [connection, setConnection] = useState(cached ? "stale" : "loading");
  const lastSuccessAt = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer;
    const refresh = async () => {
      try {
        const response = await fetchWithTimeout(statusEndpoint, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = resolveStatusAssetURLs(await response.json(), statusEndpoint);
        if (stopped) return;
        setStatus((current) => {
          const merged = mergeStatusHistory(current, next);
          localStorage.setItem("home-status-last", JSON.stringify(merged));
          return merged;
        });
        lastSuccessAt.current = Date.now();
        setConnection("live");
      } catch {
        if (!stopped) {
          setConnection(connectionAfterFailure(lastSuccessAt.current, Date.now(), CONNECTION_STALE_GRACE_MS));
        }
      } finally {
        if (!stopped) timer = setTimeout(refresh, 250);
      }
    };
    refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [statusEndpoint]);

  return [status, connection];
}

function Dashboard({ status, connection, displayConnection }) {
  const [view, setView] = useState(() => initialView(displayConnection));
  const [displayScope, setDisplayScope] = useState(() => {
    const stored = localStorage.getItem("ambient-ops-display-scope");
    if (stored === "fleet" || stored === "host") return stored;
    return displayConnection.embedded ? "host" : "fleet";
  });
  const [selectedMachineId, setSelectedMachineId] = useState(
    () => localStorage.getItem("ambient-ops-machine-id") || status.machines[0]?.machineId || null,
  );
  const [machineFollowMode, setMachineFollowMode] = useState(
    () => {
      const storedMode = localStorage.getItem("ambient-ops-machine-mode");
      if (storedMode === "auto" || storedMode === "fixed") return storedMode;
      return localStorage.getItem("ambient-ops-machine-id") ? "fixed" : "auto";
    },
  );
  const pointerStart = useRef(null);
  const selectedMachine = selectDisplayMachine(status.machines, selectedMachineId, machineFollowMode);
  const scopedNetwork = networkForDisplay(status, displayScope, selectedMachine);
  const scopedCodex = codexForDisplay(status, displayScope, selectedMachine);
  const fleet = fleetForStatus(status);

  useEffect(() => {
    window.AmbientOpsNative?.statusChanged?.(connection);
  }, [connection]);

  useEffect(() => {
    if (displayConnection.embedded) return;
    const next = `/display/${view}`;
    if (location.pathname !== next) history.replaceState(null, "", next);
  }, [displayConnection.embedded, view]);

  useEffect(() => {
    if (selectedMachineId) {
      localStorage.setItem("ambient-ops-machine-id", selectedMachineId);
    }
    localStorage.setItem("ambient-ops-machine-mode", machineFollowMode);
  }, [machineFollowMode, selectedMachineId]);

  useEffect(() => {
    if (machineFollowMode !== "fixed" || !selectedMachineId || selectedMachine) return;
    const fallback = selectDisplayMachine(status.machines, null, "auto");
    if (!fallback) return;
    setSelectedMachineId(fallback.machineId);
    setMachineFollowMode("auto");
  }, [machineFollowMode, selectedMachine, selectedMachineId, status.machines]);

  useEffect(() => {
    localStorage.setItem("ambient-ops-display-scope", displayScope);
  }, [displayScope]);

  const switchBy = useCallback((offset) => {
    setView((current) => VIEWS[(VIEWS.indexOf(current) + offset + VIEWS.length) % VIEWS.length]);
  }, []);

  const onPointerDown = (event) => {
    if (event.target.closest("button, select, input, a")) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event) => {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    pointerStart.current = null;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.4) switchBy(dx < 0 ? 1 : -1);
  };

  const goToMachine = (machineId) => {
    setSelectedMachineId(machineId);
    setMachineFollowMode("fixed");
    setDisplayScope("host");
    setView("machines");
  };
  const selectMachine = (machineId) => {
    setSelectedMachineId(machineId);
    setMachineFollowMode("fixed");
  };
  const changeMachineFollowMode = (nextMode) => {
    setSelectedMachineId((current) => (
      selectedMachineIdForFollowMode(current, selectedMachine, nextMode)
    ));
    setMachineFollowMode(nextMode);
  };

  return (
    <div className="app-shell" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <Header status={status} connection={connection} displayScope={displayScope} onDisplayScope={setDisplayScope} />
      <main className="view-stage">
        {view === "overview" ? <Overview status={status} network={scopedNetwork} codex={scopedCodex} displayScope={displayScope} selected={selectedMachine} onMachine={goToMachine} onAllMachines={() => setView("machines")} /> : null}
        {view === "network" ? <NetworkView network={scopedNetwork} displayScope={displayScope} /> : null}
        {view === "machines" ? (
          <MachinesView
            machines={status.machines}
            selected={selectedMachine}
            displayScope={displayScope}
            onSelect={selectMachine}
            onFocus={goToMachine}
          />
        ) : null}
        {view === "load" ? (
          <LoadView
            machines={status.machines}
            selected={selectedMachine}
            fleet={fleet}
            displayScope={displayScope}
            followMode={machineFollowMode}
            onFollowMode={changeMachineFollowMode}
            onSelect={selectMachine}
          />
        ) : null}
        {view === "pet" ? (
          <PetView
            machines={status.machines}
            selected={selectedMachine}
            fleet={fleet}
            displayScope={displayScope}
            followMode={machineFollowMode}
            onFollowMode={changeMachineFollowMode}
            onSelect={selectMachine}
          />
        ) : null}
      </main>
      <BottomNav view={view} setView={setView} status={status} connection={connection} />
    </div>
  );
}

function initialView(displayConnection = DISPLAY_CONNECTION) {
  if (VIEWS.includes(displayConnection.requestedView)) return displayConnection.requestedView;
  const route = location.pathname.split("/").pop();
  return VIEWS.includes(route) ? route : "overview";
}

function Header({ status, connection, displayScope, onDisplayScope }) {
  const now = useClock();
  const direct = status.provider?.scope === "machine";
  return (
    <header className="top-header">
      <div className="header-identity">
        <h1>Fleet Cockpit</h1>
        <ScopeSwitch value={displayScope} onChange={onDisplayScope} />
        <span className="header-site-name">{status.site?.name || FLEET_COCKPIT_NAME}</span>
      </div>
      <div className="header-status">
        {status.demo ? <span className="mode-label">DEMO</span> : null}
        <StatusLabel status={connection === "live" ? status.overallStatus : "stale"} />
        <span className="divider" />
        <span className="source-label">
          {status.provider?.productName || (direct ? FLEET_AGENT_NAME : FLEET_GATEWAY_NAME)}
        </span>
        <FullscreenButton />
      </div>
      <time>{formatTime(now, status.site?.timeZone)}</time>
    </header>
  );
}

function ScopeSwitch({ value, onChange }) {
  return (
    <div className="scope-switch" role="group" aria-label="Display scope">
      {[
        ["fleet", "FLEET"],
        ["host", "HOST"],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={value === id ? "active" : ""}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function LoadView({ machines, selected, fleet, displayScope, followMode, onFollowMode, onSelect }) {
  if (displayScope === "fleet") return <FleetLoadView machines={machines} fleet={fleet} />;
  return <HostLoadView machines={machines} selected={selected} followMode={followMode} onFollowMode={onFollowMode} onSelect={onSelect} />;
}

function HostLoadView({ machines, selected, followMode, onFollowMode, onSelect }) {
  if (!selected) return <section className="load-view"><EmptyState /></section>;
  const Icon = machineIcon(selected.platform);
  const load = machineLoadPresentation(selected);
  const state = load.state;
  const shortTrendValues = historyValuesInWindow(selected.tpsHistory, 5 * 60 * 1_000);
  const loadTrendValues = historyValuesInWindow(selected.tpsHistory, LOAD_TREND_WINDOW_MS);
  const loadTrendMinutes = historyCoverageMinutes(selected.tpsHistory);
  const loadTrendAverage = loadTrendValues.length
    ? loadTrendValues.reduce((total, value) => total + value, 0) / loadTrendValues.length
    : Number(selected.fiveMinutes.tps || 0);

  return (
    <section className={`load-view load-state-${state.id}`}>
      <div className="load-canvas">
        <div className="load-canvas-head">
          <div className="load-machine-picker">
            <Icon size={17} />
            <PetMachineControl machines={machines} selected={selected} followMode={followMode} onFollowMode={onFollowMode} onSelect={onSelect} ariaLabel="Load host" />
          </div>
          <div className="load-canvas-title">
            <span>HOST LOAD</span>
            <strong>{state.label}</strong>
            <small>{loadStateDescription(state.id)}</small>
          </div>
        </div>
        <div className="load-field-header">
          <span>AGGREGATE WORK FIELD</span>
          <div className="load-field-legend" aria-hidden="true">
            <i className="density" /> DENSITY
            <i className="rhythm" /> RHYTHM
          </div>
        </div>
        <LoadPixelField state={state} machineName={selected.machineName} load={load} />
        <div className="load-canvas-footer">
          <LoadScale score={load.score} />
          <span>{load.sceneProfile?.clusterCount ? "AGGREGATE FLOW" : "STANDBY STATION"} · {formatTps(load.tps)} TPS</span>
        </div>
      </div>
      <aside className="load-side-metrics">
        <div className="load-side-primary">
          <span>1 MINUTE</span>
          <div><strong>{formatTps(load.tps)}</strong><small>TPS</small></div>
          <Sparkline values={shortTrendValues} color="green" />
        </div>
        <div className="load-side-stats">
          <LoadStat label="ACTIVE" value={load.sessions} unit="SESSIONS" accent="green" />
          <LoadStat label="CPU" value={load.cpu === null ? "N/A" : `${Math.round(load.cpu)}%`} unit="HOST" accent={load.cpu === null ? "muted" : load.cpu > 80 ? "amber" : "green"} />
          <LoadStat label="CACHE" value={`${selected.cachePercent || 0}%`} />
        </div>
        <div className="load-side-trend">
          <div><span>{loadTrendMinutes >= 30 ? "30 MIN TREND" : loadTrendMinutes > 0 ? `${loadTrendMinutes} MIN TREND` : "LIVE TREND"}</span><small>{formatTps(loadTrendAverage)} TPS AVG</small></div>
          <Sparkline values={loadTrendValues} color="green" />
          <div className="load-side-axis">{loadTrendAxis(loadTrendMinutes).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
        </div>
        <div className="load-side-host">
          <span className={`load-host-freshness ${selected.status}`}><i /> HOST · {hostFreshness(selected)}</span>
          <span className="load-host-platform">{selected.platform}</span>
          <span className="load-side-note"><Cpu size={14} /> {load.cpu === null ? "CPU unavailable until TPS host telemetry is enabled." : "Host CPU is optional telemetry."}</span>
        </div>
      </aside>
    </section>
  );
}

function FleetLoadView({ machines, fleet }) {
  const load = fleetLoadPresentation(fleet);
  const state = load.state;
  const shortTrendValues = historyValuesInWindow(fleet.tpsHistory, 5 * 60 * 1_000);
  const loadTrendValues = historyValuesInWindow(fleet.tpsHistory, LOAD_TREND_WINDOW_MS);
  const loadTrendMinutes = historyCoverageMinutes(fleet.tpsHistory);
  const loadTrendAverage = loadTrendValues.length
    ? loadTrendValues.reduce((total, value) => total + value, 0) / loadTrendValues.length
    : Number(fleet.fiveMinuteTps || 0);
  const liveNodes = Math.max(0, Number(fleet.liveMachineCount) || 0);
  const totalNodes = Math.max(liveNodes, Number(fleet.machineCount) || machines.length);
  const cpuReported = Math.max(0, Number(fleet.cpuReportedMachineCount) || 0);
  const status = liveNodes > 0 ? "live" : totalNodes > 0 ? "stale" : "error";

  return (
    <section className={`load-view fleet-load-view load-state-${state.id}`}>
      <div className="load-canvas">
        <div className="load-canvas-head fleet-load-head">
          <div className="fleet-load-identity">
            <Network size={17} />
            <div><strong>{totalNodes} NODES</strong><span>{fleet.workingMachineCount || 0} WORKING</span></div>
          </div>
          <div className="load-canvas-title">
            <span>FLEET LOAD</span>
            <strong>{state.label}</strong>
            <small>{fleetLoadDescription(state.id)}</small>
          </div>
        </div>
        <div className="load-field-header">
          <span>FLEET ACTIVITY FIELD</span>
          <div className="load-field-legend" aria-hidden="true">
            <i className="density" /> NODES
            <i className="rhythm" /> FLOW
          </div>
        </div>
        <FleetPulseField state={state} machines={machines} fleet={fleet} load={load} />
        <div className="load-canvas-footer">
          <LoadScale score={load.score} />
          <span>{fleet.workingMachineCount || 0}/{liveNodes || 0} WORKING · {formatTps(load.tps)} TPS</span>
        </div>
      </div>
      <aside className="load-side-metrics">
        <div className="load-side-primary">
          <span>1 MINUTE</span>
          <div><strong>{formatTps(load.tps)}</strong><small>TPS</small></div>
          <Sparkline values={shortTrendValues} color="green" />
        </div>
        <div className="load-side-stats">
          <LoadStat label="ACTIVE" value={load.sessions} unit="SESSIONS" accent="green" />
          <LoadStat label="NODES" value={`${liveNodes}/${totalNodes}`} unit="LIVE / TOTAL" accent={liveNodes === totalNodes && totalNodes > 0 ? "green" : "amber"} />
          <LoadStat
            label="CPU"
            value={load.cpu === null ? "N/A" : `${Math.round(load.cpu)}%`}
            unit={cpuReported ? `${cpuReported}/${liveNodes || totalNodes} HOSTS` : "NO REPORTS"}
            accent={load.cpu === null ? "muted" : load.cpu > 80 ? "amber" : "green"}
          />
        </div>
        <div className="load-side-trend">
          <div><span>{loadTrendMinutes >= 30 ? "30 MIN TREND" : loadTrendMinutes > 0 ? `${loadTrendMinutes} MIN TREND` : "LIVE TREND"}</span><small>{formatTps(loadTrendAverage)} TPS AVG</small></div>
          <Sparkline values={loadTrendValues} color="green" />
          <div className="load-side-axis">{loadTrendAxis(loadTrendMinutes).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
        </div>
        <div className="load-side-host fleet-load-freshness">
          <span className={`load-host-freshness ${status}`}><i /> {fleet.workingMachineCount || 0} WORKING · {liveNodes} CONNECTED</span>
        </div>
      </aside>
    </section>
  );
}

function fleetLoadDescription(stateId) {
  return {
    quiet: "fleet standing by",
    active: "nodes in motion",
    heavy: "parallel fleet work",
    constrained: "host pressure detected",
  }[stateId] || "fleet activity";
}

function FleetPulseField({ state, machines, fleet, load }) {
  const canvasRef = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const reduceMotion = shouldReduceKioskMotion(navigator.userAgent, prefersReducedMotion);
  const visualNodes = useMemo(() => fleetVisualNodes(machines), [machines]);
  const visual = useMemo(() => ({
    ...load.sceneProfile,
    stateId: state.id,
    nodes: visualNodes,
    liveNodes: Number(fleet.liveMachineCount) || 0,
    workingNodes: Number(fleet.workingMachineCount) || 0,
  }), [fleet.liveMachineCount, fleet.workingMachineCount, load.sceneProfile, state.id, visualNodes]);
  const visualRef = useRef(visual);
  visualRef.current = visual;
  useFleetPulseMotion(canvasRef, visualRef, reduceMotion);

  const nodeSummary = visualNodes
    .map((node) => `${node.name}: ${formatTps(node.tps)} TPS, ${node.sessions} sessions`)
    .join("; ");

  return (
    <div className={`load-pixel-field fleet-pulse-field load-pixel-${state.id}`} role="img" aria-label={`${state.label} fleet activity across ${fleet.machineCount || machines.length} nodes. ${nodeSummary}`}>
      <canvas ref={canvasRef} className="load-pixel-canvas" aria-hidden="true" />
    </div>
  );
}

function fleetVisualNodes(machines) {
  const ordered = [...machines].sort((left, right) => {
    const statusRank = { live: 0, stale: 1, error: 2 };
    const statusDifference = (statusRank[left.status] ?? 3) - (statusRank[right.status] ?? 3);
    if (statusDifference) return statusDifference;
    return String(left.machineName || left.machineId || "").localeCompare(String(right.machineName || right.machineId || ""));
  });
  if (ordered.length <= 6) return ordered.map(fleetNodeFromMachine);
  const groups = Array.from({ length: 6 }, () => []);
  ordered.forEach((machine, index) => groups[index % groups.length].push(machine));
  return groups.map((group, index) => {
    const tps = group.reduce((total, machine) => total + Number(machine.oneMinute?.tps || 0), 0);
    const sessions = group.reduce((total, machine) => total + Number(machine.activeSessions || 0), 0);
    const cpu = averageReported(group.map((machine) => machine.cpuPercent));
    return {
      id: `group-${index}`,
      name: `${group.length} nodes`,
      status: group.some((machine) => machine.status === "live") ? "live" : group.some((machine) => machine.status === "stale") ? "stale" : "error",
      ...fleetMachineVisual({ tps, sessions, cpu }),
    };
  });
}

function fleetNodeFromMachine(machine) {
  return {
    id: machine.machineId,
    name: machine.machineName,
    status: machine.status,
    ...fleetMachineVisual(machine),
  };
}

function averageReported(values) {
  const reported = values.map(finiteMetric).filter((value) => value !== null);
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) / reported.length : null;
}

function finiteMetric(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

function useFleetPulseMotion(canvasRef, visualRef, reduceMotion) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const field = canvas?.parentElement;
    if (!canvas || !field) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    let width = 0;
    let height = 0;
    const resize = () => {
      const bounds = field.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(field);
    let assetReady = false;
    const workstation = new Image();
    workstation.decoding = "async";
    workstation.onload = () => { assetReady = true; };
    workstation.src = `${import.meta.env.BASE_URL}load/fleet-workstation.webp`;
    const startedAt = performance.now();
    let animationFrame = null;
    let lastPaintAt = -Infinity;
    const paint = (timestamp) => {
      const frameBudget = reduceMotion ? 140 : 34;
      if (timestamp - lastPaintAt >= frameBudget) {
        lastPaintAt = timestamp;
        paintFleetPulseCanvas(context, width, height, timestamp - startedAt, visualRef.current, assetReady ? workstation : null);
      }
      animationFrame = requestAnimationFrame(paint);
    };
    paint(startedAt);
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      workstation.onload = null;
    };
  }, [canvasRef, reduceMotion, visualRef]);
}

function paintFleetPulseCanvas(context, width, height, elapsed, visual, workstation) {
  if (width <= 1 || height <= 1) return;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#05090d";
  context.fillRect(0, 0, width, height);
  const pixel = Math.max(2, Math.round(Math.min(width, height) / 85));
  drawWorkstationGrid(context, width, height, pixel, clampVisual(visual.activity));
  const nodes = visual.nodes.length ? visual.nodes : [{ id: "standby", status: "error", tps: 0, sessions: 0, cpu: null }];
  const positions = fleetNodePositions(nodes.length, width, height);
  const links = fleetNodeLinks(nodes.length);

  for (const [fromIndex, toIndex] of links) {
    const from = positions[fromIndex];
    const to = positions[toIndex];
    drawFleetLink(
      context,
      from,
      to,
      nodes[fromIndex],
      nodes[toIndex],
      elapsed,
      pixel,
      fromIndex * 13 + toIndex,
    );
  }
  positions.forEach((position, index) => {
    drawFleetNodeFlow(context, position, nodes[index], elapsed, pixel, index, width);
  });
  positions.forEach((position, index) => {
    drawFleetNode(context, position, nodes[index], elapsed, workstation, pixel, index);
  });
  context.globalAlpha = 1;
}

function fitCanvasLabel(context, value, maxWidth) {
  const label = String(value || "");
  if (context.measureText(label).width <= maxWidth) return label;
  let end = label.length;
  while (end > 1 && context.measureText(`${label.slice(0, end)}...`).width > maxWidth) end -= 1;
  return `${label.slice(0, end)}...`;
}

function fleetNodeColor(node, active) {
  if (node.pressure === "critical") return "#ef6a62";
  if (node.pressure === "high") return "#f59e0b";
  if (node.loadClass === "heavy") return "#f7c45c";
  if (node.loadClass === "active") return "#39d891";
  if (node.loadClass === "light") return "#38bdf8";
  if (active) return "#39d891";
  return node.status === "stale" ? "#8e99a3" : "#59636d";
}

function fleetNodeSecondaryColor(node, active) {
  if (node.pressure === "critical") return "#ffbd58";
  if (node.pressure === "high") return "#ef6a62";
  if (node.loadClass === "heavy") return "#ff8f70";
  if (node.loadClass === "active") return "#38bdf8";
  if (node.loadClass === "light") return "#8bd7ff";
  return active ? "#39d891" : "#59636d";
}

function fleetNodePositions(count, width, height) {
  const total = Math.max(1, Math.min(6, count));
  const rows = total <= 3 ? 1 : 2;
  const top = rows === 1 ? height * .5 : height * .29;
  const bottom = height * .72;
  const size = rows === 1
    ? Math.max(58, Math.min(total <= 2 ? 108 : 88, height * .76, width * (total <= 2 ? .28 : .22)))
    : Math.max(38, Math.min(58, height * .43, width * .18));
  return Array.from({ length: total }, (_, index) => {
    const row = rows === 1 ? 0 : index < Math.ceil(total / 2) ? 0 : 1;
    const rowStart = rows === 1 || row === 0 ? 0 : Math.ceil(total / 2);
    const rowCount = rows === 1
      ? total
      : row === 0 ? Math.ceil(total / 2) : total - Math.ceil(total / 2);
    const column = index - rowStart;
    return {
      x: width * (.12 + (column + .5) * .76 / Math.max(1, rowCount)),
      y: row === 0 ? top : bottom,
      size,
      labelWidth: width * .66 / Math.max(1, rowCount),
    };
  });
}

function fleetNodeLinks(count) {
  if (count <= 1) return [];
  const links = [];
  const firstRowCount = Math.ceil(count / 2);
  for (let index = 0; index < firstRowCount - 1; index += 1) links.push([index, index + 1]);
  for (let index = firstRowCount; index < count - 1; index += 1) links.push([index, index + 1]);
  if (count > 3) {
    for (let index = 0; index < count - firstRowCount; index += 1) links.push([index, firstRowCount + index]);
    if (count >= 5) links.push([1, count - 1]);
  }
  return links;
}

function drawFleetLink(context, from, to, fromNode, toNode, elapsed, pixel, seed) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return;
  const start = { x: from.x + dx * .14, y: from.y + dy * .14 };
  const end = { x: to.x - dx * .14, y: to.y - dy * .14 };
  const fromActive = nodeWorking(fromNode);
  const toActive = nodeWorking(toNode);
  const active = fromActive || toActive;
  const intensity = Math.max(clampVisual(fromNode.intensity), clampVisual(toNode.intensity));
  const duration = Math.max(520, (Number(fromNode.travelMs) + Number(toNode.travelMs)) / 2 || 2_600);
  const packetCount = Math.max(0, Math.min(14, Math.round((Number(fromNode.packetCount) + Number(toNode.packetCount)) * .3)));
  const fromColor = fleetNodeColor(fromNode, fromActive);
  const toColor = fleetNodeColor(toNode, toActive);
  context.save();
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, fromColor);
  gradient.addColorStop(1, toColor);
  context.strokeStyle = active ? gradient : "rgba(91, 105, 116, .18)";
  context.globalAlpha = active ? .22 + intensity * .34 : 1;
  context.lineWidth = active ? Math.max(1, pixel * (.65 + intensity * .65)) : 1;
  context.setLineDash([pixel * 3, pixel * 2]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.setLineDash([]);
  if (active) {
    for (let index = 0; index < packetCount; index += 1) {
      const phase = loadParticlePhase(elapsed, duration * (1 + (index % 3) * .09), index / packetCount + seed * .071);
      const x = start.x + (end.x - start.x) * phase;
      const y = start.y + (end.y - start.y) * phase;
      context.globalAlpha = (.28 + intensity * .64) * Math.sin(Math.PI * phase);
      context.fillStyle = index % 2 === 0 ? fromColor : toColor;
      const packetSize = pixel * (index % 4 === 0 ? 2.5 : 1.5);
      const tail = Math.max(pixel, Math.round(pixel * (1 + intensity * 4)));
      context.fillRect(Math.round(x - tail), Math.round(y - pixel / 2), tail, pixel);
      context.fillRect(Math.round(x), Math.round(y - pixel / 2), packetSize, pixel * 2);
    }
  }
  context.restore();
}

function drawFleetNodeFlow(context, position, node, elapsed, pixel, index, width) {
  if (!nodeWorking(node)) return;
  const intensity = clampVisual(node.intensity);
  const spriteSize = position.size || 54;
  const baseY = position.y + spriteSize * .37;
  const left = Math.max(pixel * 3, position.x - spriteSize * (.72 + intensity * .18));
  const right = Math.min(width - pixel * 3, position.x + spriteSize * (.72 + intensity * .18));
  const nodeLeft = position.x - spriteSize * .35;
  const nodeRight = position.x + spriteSize * .35;
  const duration = Math.max(420, Number(node.travelMs) || 3_200);
  const trackCount = Math.max(1, Math.min(4, Number(node.trackCount) || 1));
  const packetsPerTrack = Math.max(1, Math.min(7, Math.ceil(node.packetCount / trackCount)));
  const primaryColor = fleetNodeColor(node, true);
  const secondaryColor = fleetNodeSecondaryColor(node, true);

  context.save();
  for (let track = 0; track < trackCount; track += 1) {
    const trackY = baseY + (track - (trackCount - 1) / 2) * Math.max(pixel * 1.5, spriteSize * .055);
    context.globalAlpha = .1 + intensity * .34;
    context.lineWidth = Math.max(1, pixel * .6);
    context.strokeStyle = track % 2 === 0 ? secondaryColor : primaryColor;
    context.beginPath();
    context.moveTo(left, trackY);
    context.lineTo(nodeLeft, trackY);
    context.moveTo(nodeRight, trackY);
    context.lineTo(right, trackY);
    context.stroke();

    for (let packet = 0; packet < packetsPerTrack; packet += 1) {
      const phase = loadParticlePhase(elapsed, duration * (1 + track * .08), packet / packetsPerTrack + track * .17 + index * .19);
      const inboundX = left + (nodeLeft - left) * phase;
      const outboundX = nodeRight + (right - nodeRight) * phase;
      const packetHeight = Math.max(1, pixel * (packet % 3 === 0 ? 2 : 1));
      const tail = Math.max(pixel, Math.round(pixel * (1 + intensity * (packet % 3 === 0 ? 5 : 3))));
      context.globalAlpha = .08 + intensity * .23;
      context.fillStyle = secondaryColor;
      context.fillRect(Math.round(inboundX - tail), Math.round(trackY - packetHeight / 2), tail, packetHeight);
      context.fillStyle = primaryColor;
      context.fillRect(Math.round(outboundX - tail), Math.round(trackY - packetHeight / 2), tail, packetHeight);
      context.globalAlpha = .35 + intensity * .55 + Math.sin(Math.PI * phase) * .1;
      context.fillStyle = secondaryColor;
      context.fillRect(Math.round(inboundX), Math.round(trackY - packetHeight / 2), pixel * 2, packetHeight);
      context.fillStyle = primaryColor;
      context.fillRect(Math.round(outboundX), Math.round(trackY - packetHeight / 2), pixel * 2, packetHeight);
    }
  }

  const haloCount = Math.max(1, Math.min(3, Math.ceil(trackCount / 2)));
  for (let halo = 0; halo < haloCount; halo += 1) {
    const pulsePhase = loadParticlePhase(elapsed, Math.max(520, duration * .9), index * .37 + halo / haloCount);
    const pulseSize = spriteSize * (.56 + pulsePhase * (.34 + intensity * .25));
    context.globalAlpha = (1 - pulsePhase) * (.1 + intensity * .32);
    context.strokeStyle = halo % 2 === 0 ? primaryColor : secondaryColor;
    context.lineWidth = Math.max(1, pixel * .65);
    context.strokeRect(
      Math.round(position.x - pulseSize / 2),
      Math.round(position.y - pulseSize * .47),
      Math.round(pulseSize),
      Math.round(pulseSize * .94),
    );
  }
  context.restore();
}

function drawFleetNode(context, position, node, elapsed, workstation, pixel, index) {
  const active = nodeWorking(node);
  const color = fleetNodeColor(node, active);
  const secondaryColor = fleetNodeSecondaryColor(node, active);
  const intensity = clampVisual(node.intensity);
  const pulse = .5 + .5 * Math.sin(elapsed / Math.max(210, 900 - intensity * 470) + index * 1.7);
  const spriteSize = position.size || 54;
  context.save();
  context.globalAlpha = node.status === "live" ? .96 : .34;
  context.fillStyle = color;
  context.globalAlpha *= active ? .06 + intensity * .13 + pulse * (.05 + intensity * .08) : .035;
  context.fillRect(position.x - spriteSize * .58, position.y - spriteSize * .52, spriteSize * 1.16, spriteSize * .96);
  context.globalAlpha = node.status === "live" ? .92 : .32;
  if (workstation) {
    context.imageSmoothingEnabled = false;
    context.drawImage(workstation, Math.round(position.x - spriteSize / 2), Math.round(position.y - spriteSize / 2), spriteSize, spriteSize);
  } else {
    drawFleetFallbackNode(context, position, spriteSize, color, pixel);
  }
  context.globalAlpha = node.status === "live" ? .52 + pulse * .28 : .62;
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.strokeRect(
    Math.round(position.x - spriteSize * .48),
    Math.round(position.y - spriteSize * .46),
    Math.round(spriteSize * .96),
    Math.round(spriteSize * .9),
  );
  context.globalAlpha = 1;
  context.fillStyle = color;
  const lightSize = Math.max(2, pixel);
  context.fillRect(Math.round(position.x + spriteSize * .31), Math.round(position.y + spriteSize * .28), lightSize, lightSize);
  if (active) {
    const scanPhase = loadParticlePhase(elapsed, Math.max(340, 1_050 - intensity * 430), index * .23);
    context.globalAlpha = .42 + pulse * .4;
    context.fillStyle = color;
    context.fillRect(
      Math.round(position.x - spriteSize * .19),
      Math.round(position.y - spriteSize * .25 + spriteSize * .18 * scanPhase),
      Math.round(spriteSize * .34),
      Math.max(1, pixel),
    );
    const blockCount = Math.max(2, Math.min(7, Math.round(2 + intensity * 5)));
    for (let block = 0; block < blockCount; block += 1) {
      const blockPhase = loadParticlePhase(elapsed, Math.max(420, 1_420 - intensity * 520), block * .21 + index * .13);
      context.globalAlpha = .26 + blockPhase * .58;
      context.fillStyle = block % 3 === 0 ? secondaryColor : color;
      context.fillRect(
        Math.round(position.x - spriteSize * .18 + block * pixel * 1.65),
        Math.round(position.y + spriteSize * .2),
        pixel * 2,
        pixel,
      );
    }
    context.globalAlpha = .45 + pulse * .5;
    context.fillRect(Math.round(position.x - spriteSize * .2), Math.round(position.y - spriteSize * .13), pixel * 2, pixel);
  }
  const labelY = position.y + spriteSize * .63;
  const labelWidth = Math.max(44, Number(position.labelWidth) || spriteSize * 1.4);
  context.globalAlpha = node.status === "live" ? .62 + intensity * .26 : .34;
  context.fillStyle = color;
  context.font = `700 ${Math.max(7, Math.min(10, spriteSize * .12))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(fitCanvasLabel(context, node.name || "Unknown", labelWidth), position.x, labelY);
  context.restore();
}

function drawFleetFallbackNode(context, position, size, color, pixel) {
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, pixel / 2);
  context.strokeRect(position.x - size * .28, position.y - size * .3, size * .56, size * .38);
  context.strokeRect(position.x - size * .36, position.y + size * .12, size * .72, size * .2);
}

function nodeWorking(node) {
  return node.status === "live" && (Number(node.tps || 0) > 0 || Number(node.sessions || 0) > 0);
}

function LoadScale({ score }) {
  return (
    <div className="load-scale" aria-label={`Relative load ${Math.round(score * 100)} percent`}>
      <div className="load-scale-bar"><i style={{ width: `${Math.max(3, score * 100)}%` }} /></div>
      <div><span>QUIET</span><span>ACTIVE</span><span>HEAVY</span><span>LIMIT</span></div>
    </div>
  );
}

function loadStateDescription(stateId) {
  return {
    quiet: "standby station",
    active: "focused work",
    heavy: "parallel work",
    constrained: "pressure building",
  }[stateId] || "work field";
}

function LoadPixelField({ state, machineName, load }) {
  const canvasRef = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const reduceMotion = shouldReduceKioskMotion(navigator.userAgent, prefersReducedMotion);
  const profile = load.sceneProfile;
  const visual = useMemo(() => ({ ...profile, stateId: state.id }), [profile, state.id]);
  const visualRef = useRef(visual);
  visualRef.current = visual;

  useLoadPixelMotion(canvasRef, visualRef, reduceMotion);

  return (
    <div
      className={`load-pixel-field load-pixel-${state.id}`}
      role="img"
      aria-label={`${state.label} pixel workload animation for ${machineName}`}
      style={{
        "--pixel-score": load.score,
      }}
    >
      <canvas ref={canvasRef} className="load-pixel-canvas" aria-hidden="true" />
    </div>
  );
}

function useLoadPixelMotion(canvasRef, visualRef, reduceMotion) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const field = canvas?.parentElement;
    if (!canvas || !field) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let width = 0;
    let height = 0;
    const resize = () => {
      const bounds = field.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(field);
    const startedAt = window.performance.now();
    let animationFrame = null;
    let lastPaintAt = -Infinity;
    let assetReady = false;
    const workstation = new Image();
    workstation.decoding = "async";
    workstation.onload = () => { assetReady = true; };
    workstation.src = `${import.meta.env.BASE_URL}load/operator-workbench.webp`;

    const paint = (timestamp) => {
      const frameBudget = reduceMotion ? 140 : 34;
      if (timestamp - lastPaintAt < frameBudget) {
        animationFrame = window.requestAnimationFrame(paint);
        return;
      }
      lastPaintAt = timestamp;
      const elapsed = timestamp - startedAt;
      paintWorkbenchCanvas(context, width, height, elapsed, visualRef.current, assetReady ? workstation : null);
      animationFrame = window.requestAnimationFrame(paint);
    };

    paint(startedAt);
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      workstation.onload = null;
    };
  }, [canvasRef, visualRef, reduceMotion]);
}

function paintWorkbenchCanvas(context, width, height, elapsed, visual, workstation) {
  if (width <= 1 || height <= 1) return;
  const activity = clampVisual(visual.activity);
  const parallel = clampVisual(visual.parallel);
  const pressure = clampVisual(visual.pressure);
  const queueDepth = clampVisual(visual.queueDepth);
  const heat = clampVisual(visual.heat);
  const tempo = Math.max(.2, Number(visual.tempo) || .2);
  const pixel = Math.max(2, Math.round(Math.min(width, height) / 86));
  const centerY = Math.round(height * .53);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#05090d";
  context.fillRect(0, 0, width, height);
  drawWorkstationGrid(context, width, height, pixel, activity);

  const spriteSize = Math.round(Math.min(height * 1.34, width * .48));
  const spriteX = Math.round(Math.max(4, width * .015));
  const spriteY = Math.round((height - spriteSize) / 2 + Math.sin(elapsed / 1_700) * (0.4 + activity * .9));
  if (workstation) {
    context.imageSmoothingEnabled = false;
    context.drawImage(workstation, spriteX, spriteY, spriteSize, spriteSize);
  } else {
    drawFallbackWorkstation(context, spriteX, spriteY, spriteSize, pixel);
  }

  const screen = {
    x: spriteX + spriteSize * .56,
    y: spriteY + spriteSize * .205,
    width: spriteSize * .225,
    height: spriteSize * .205,
  };
  drawScreenActivity(context, screen, elapsed, activity, pressure, pixel);

  const emitterX = Math.min(width * .59, spriteX + spriteSize * .79);
  const emitterY = spriteY + spriteSize * .36;
  drawWorkPackets(context, width, height, emitterX, emitterY, elapsed, visual, pixel);
  drawPressureQueue(context, emitterX, emitterY, elapsed, queueDepth, pressure, pixel);
  drawComputerHeat(context, spriteX, spriteY, spriteSize, elapsed, heat, pressure, pixel);
  drawStationFloor(context, width, height, centerY, pixel, activity);
  context.globalAlpha = 1;
}

function drawWorkstationGrid(context, width, height, pixel, activity) {
  const step = pixel * 6;
  context.fillStyle = "rgba(34, 52, 62, .36)";
  for (let x = step; x < width; x += step) context.fillRect(x, 0, 1, height);
  for (let y = step; y < height; y += step) context.fillRect(0, y, width, 1);
  context.fillStyle = `rgba(56, 189, 248, ${.018 + activity * .03})`;
  context.fillRect(Math.round(width * .53), 0, 1, height);
}

function drawScreenActivity(context, screen, elapsed, activity, pressure, pixel) {
  const pulse = .55 + .45 * Math.sin(elapsed / Math.max(190, 640 - activity * 330));
  context.save();
  context.globalAlpha = .72;
  context.fillStyle = "#071318";
  context.fillRect(screen.x, screen.y, screen.width, screen.height);
  const rows = 4 + Math.round(activity * 4);
  for (let row = 0; row < rows; row += 1) {
    const widthFactor = .25 + pixelNoise(row + 7) * (.45 + activity * .25);
    context.fillStyle = row % 3 === 0 ? "#38bdf8" : row % 3 === 1 ? "#39d891" : "#9ee7bd";
    context.globalAlpha = .42 + pulse * .25;
    context.fillRect(
      Math.round(screen.x + pixel * 1.8),
      Math.round(screen.y + pixel * (1.6 + row * 2.2)),
      Math.max(pixel, Math.round(screen.width * widthFactor)),
      Math.max(1, Math.round(pixel * .72)),
    );
    if (row % 2 === 0) {
      context.globalAlpha *= .58;
      context.fillRect(
        Math.round(screen.x + screen.width * (.7 + pixelNoise(row + 30) * .17)),
        Math.round(screen.y + pixel * (1.6 + row * 2.2)),
        pixel,
        Math.max(1, Math.round(pixel * .72)),
      );
    }
  }
  const cursorY = screen.y + screen.height - pixel * 2.2;
  context.globalAlpha = pressure > .1 ? .45 + pulse * .35 : .8;
  context.fillStyle = pressure > .68 ? "#ffbd58" : "#39d891";
  if (Math.floor(elapsed / Math.max(160, 440 - activity * 220)) % 2 === 0) {
    context.fillRect(Math.round(screen.x + pixel * 2), Math.round(cursorY), pixel * 2, Math.max(1, Math.round(pixel * .72)));
  }
  context.restore();
}

function drawWorkPackets(context, width, height, emitterX, emitterY, elapsed, visual, pixel) {
  const activity = clampVisual(visual.activity);
  const pressure = clampVisual(visual.pressure);
  const parallel = clampVisual(visual.parallel);
  const tempo = Math.max(.2, Number(visual.tempo) || .2);
  const flowCount = Math.max(0, Math.min(4, Math.round(visual.clusterCount || 0)));
  if (flowCount === 0) return;
  const density = clampVisual(visual.taskDensity);
  const travelMs = Math.max(760, Number(visual.travelMs) || 3_100);
  const count = Math.round(28 + density * 138 + parallel * 46);
  const endX = Math.max(emitterX + pixel * 10, width - pixel * 4);
  const travel = Math.max(pixel * 10, endX - emitterX);
  const spread = height * (.1 + activity * .38);
  for (let index = 0; index < count; index += 1) {
    const seed = index * 8.173 + 1.7;
    const duration = travelMs * (.82 + (index % 7) * .055);
    const phase = loadParticlePhase(elapsed, duration, pixelNoise(seed) + index / count);
    const progress = phase * (1.08 - phase * .08);
    const x = emitterX + travel * progress;
    const band = index % flowCount;
    const bandOffset = (band - (flowCount - 1) / 2) * spread * (.32 / Math.max(1, flowCount - 1));
    const fan = (pixelNoise(seed + 1.3) - .5) * spread * (.18 + progress * .68);
    const wave = Math.sin(elapsed / (230 + (index % 5) * 47) + seed) * pixel * (.8 + activity * 2.8);
    const y = emitterY + bandOffset + fan + wave;
    const size = pixel * (index % 13 === 0 ? 2 : index % 5 === 0 ? 1.5 : 1);
    const hot = pressure > .28 && progress > .38;
    const color = hot
      ? pressure > .74 && progress > .58 ? "#ff5d6c" : "#ffbd58"
      : index % 4 === 0 ? "#38bdf8" : index % 7 === 0 ? "#9ee7bd" : "#39d891";
    const envelope = Math.min(1, phase / .055, (1 - phase) / .1);
    const alpha = envelope * (.42 + activity * .42 + (index % 4) * .035);
    const tailLength = Math.round(pixel * (1.5 + tempo * 1.7 + (index % 3)));
    context.fillStyle = color;
    context.globalAlpha = Math.min(.3, alpha * .34);
    context.fillRect(Math.round(x - tailLength), Math.round(y), tailLength, pixel);
    context.globalAlpha = Math.min(.96, alpha);
    context.fillRect(Math.round(x), Math.round(y), Math.max(pixel, Math.round(size)), pixel);
    if (index % 9 === 0 && progress > .18) {
      context.globalAlpha *= .48;
      context.fillRect(
        Math.round(x - tailLength - pixel * 2),
        Math.round(y + (index % 2 ? pixel * 2 : -pixel * 2)),
        pixel,
        pixel,
      );
    }
  }
  context.globalAlpha = 1;
}

function drawPressureQueue(context, emitterX, emitterY, elapsed, queueDepth, pressure, pixel) {
  if (queueDepth <= .05) return;
  const count = Math.round(3 + queueDepth * 12);
  const wobble = Math.sin(elapsed / 260) * pixel * (1 + pressure * 2);
  for (let index = 0; index < count; index += 1) {
    const back = pixel * (3 + (index % 6) * 2);
    const y = emitterY + (index % 5 - 2) * pixel * 2 + wobble * (index % 2 ? .45 : .18);
    context.fillStyle = pressure > .74 ? "#ff5d6c" : "#ffbd58";
    context.globalAlpha = .28 + (index % 3) * .12;
    context.fillRect(Math.round(emitterX - back), Math.round(y), pixel * (index % 4 === 0 ? 2 : 1), pixel);
  }
  context.globalAlpha = 1;
}

function drawComputerHeat(context, spriteX, spriteY, spriteSize, elapsed, heat, pressure, pixel) {
  if (heat <= .05) return;
  const x = spriteX + spriteSize * .83;
  const y = spriteY + spriteSize * .34;
  const pulse = .35 + .3 * Math.sin(elapsed / 220);
  context.fillStyle = pressure > .7 ? "#ff5d6c" : "#ffbd58";
  context.globalAlpha = .22 + heat * .35 + pulse * heat;
  for (let index = 0; index < 3; index += 1) {
    context.fillRect(Math.round(x + index * pixel * 2), Math.round(y + (index % 2) * pixel * 2), pixel, pixel * (2 + index));
  }
  context.globalAlpha = 1;
}

function drawStationFloor(context, width, height, centerY, pixel, activity) {
  context.fillStyle = `rgba(12, 21, 26, ${.78 - activity * .08})`;
  context.fillRect(0, Math.round(height * .88), width, Math.max(1, pixel));
  context.fillStyle = "rgba(56, 189, 248, .14)";
  context.fillRect(pixel * 2, Math.round(height * .88) - pixel, Math.round(width * .28), 1);
  context.fillStyle = "rgba(57, 216, 145, .12)";
  context.fillRect(Math.round(width * .67), Math.round(height * .88) - pixel, Math.round(width * .24), 1);
}

function drawFallbackWorkstation(context, x, y, size, pixel) {
  const top = y + size * .22;
  const left = x + size * .52;
  context.fillStyle = "#101c22";
  context.fillRect(Math.round(left), Math.round(top), Math.round(size * .28), Math.round(size * .2));
  context.fillStyle = "#38bdf8";
  context.fillRect(Math.round(left + pixel * 2), Math.round(top + pixel * 2), Math.round(size * .2), pixel);
  context.fillStyle = "#17252b";
  context.fillRect(Math.round(x + size * .18), Math.round(y + size * .42), Math.round(size * .55), Math.round(size * .15));
  context.fillStyle = "#39d891";
  context.fillRect(Math.round(x + size * .1), Math.round(y + size * .28), pixel * 3, pixel * 5);
}

function pixelNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clampVisual(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function LoadStat({ label, value, unit, accent = "" }) {
  return (
    <div className={`load-side-stat ${accent}`}>
      <span>{label}</span>
      <div><strong>{value}</strong>{unit ? <small>{unit}</small> : null}</div>
    </div>
  );
}

function Overview({ status, network, codex, displayScope, selected, onMachine, onAllMachines }) {
  return (
    <>
      <DeviceOverview network={network} codex={codex} displayScope={displayScope} />
      <div className="overview-grid">
        <Panel className="internet-panel" title={displayScope === "fleet" ? "Internet" : "Host Network"} icon={Globe2} action={<span className="panel-action">{displayScope === "fleet" ? "WAN" : selected?.machineName || "HOST"} <StatusLabel status={network.status} compact /></span>}>
          <ThroughputSummary network={network} />
          <TrafficChart points={network.history} allowSampleData={displayScope === "fleet" && status.demo} emptyLabel={displayScope === "fleet" ? "Waiting for WAN samples" : "Waiting for host samples"} />
          <div className="chart-legend">
            <Legend color="blue" label="Download" />
            <Legend color="green" label="Upload" />
            <span className="chart-scale">Scale: auto</span>
          </div>
        </Panel>
        <div className="right-column">
          <Panel className="codex-panel" title={displayScope === "fleet" ? "Fleet Agents" : selected?.machineName || "Host Agent"} icon={Bot} action={<StatusLabel status={codex.status} />}>
            <CodexSummary codex={codex} />
            <Sparkline values={codex.tpsHistory?.map((sample) => sample.tps) || []} color="green" compact />
          </Panel>
          <Panel className="machine-panel" title={`Machines (${status.machines.length})`} icon={Monitor} action={<button className="panel-link" type="button" onClick={onAllMachines}>All <ChevronRight size={20} /></button>}>
            <MachineList machines={status.machines} onMachine={onMachine} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function DeviceOverview({ network, codex, displayScope }) {
  const cpu = finiteMetric(codex.cpuPercent);
  return (
    <section className="device-overview">
      <div className="device-primary-metrics">
        <DeviceMetric label="Download" value={formatMetric(network.downloadMbps)} unit="Mbps" accent="download" />
        <DeviceMetric label="Upload" value={formatMetric(network.uploadMbps)} unit="Mbps" accent="upload" />
        <DeviceMetric label={displayScope === "fleet" ? "Fleet Agents" : "Host Agent"} value={formatTps(codex.oneMinuteTps)} unit="TPS" accent="codex" />
      </div>
      <section className="device-airview">
        <AirViewChart points={network.history} allowSampleData={network.source === "demo"} emptyLabel={displayScope === "fleet" ? "Waiting for WAN samples" : "Waiting for host samples"} />
      </section>
      <div className="device-summary-grid">
        <DeviceStat label="CODEX 5M" value={formatTps(codex.fiveMinuteTps)} unit="TPS" />
        <DeviceStat label="ACTIVE" value={codex.activeSessions || 0} />
        {displayScope === "fleet"
          ? <DeviceStat label="NODES" value={`${codex.liveMachineCount || 0}/${codex.machineCount || 0}`} accent={codex.liveMachineCount === codex.machineCount && codex.machineCount > 0 ? "green" : "amber"} />
          : <DeviceStat label="CPU" value={cpu === null ? "N/A" : Math.round(cpu)} unit={cpu === null ? "" : "%"} accent={cpu !== null && cpu > 80 ? "amber" : "green"} />}
      </div>
    </section>
  );
}

function DeviceMetric({ label, value, unit, accent, className = "" }) {
  const density = metricDensity(value);
  return (
    <div className={`device-metric ${accent || ""} ${className}`} data-density={density}>
      <span>{label}</span>
      <div><strong>{value}</strong>{unit ? <small>{unit}</small> : null}</div>
    </div>
  );
}

function DeviceStat({ label, value, unit, accent = "" }) {
  return (
    <div className="device-stat">
      <span>{label}</span>
      <div><strong className={accent}>{value}</strong>{unit ? <small>{unit}</small> : null}</div>
    </div>
  );
}

function AirViewChart({ points = [], allowSampleData = false, emptyLabel = "Waiting for WAN samples" }) {
  const chartId = useId().replace(/:/g, "");
  const fillId = `${chartId}-airview-fill`;
  const uploadFillId = `${chartId}-airview-upload-fill`;
  const downloadStrokeId = `${chartId}-airview-download-stroke`;
  const uploadStrokeId = `${chartId}-airview-upload-stroke`;
  const data = trafficData(points, allowSampleData);
  if (data.length === 0) return <div className="airview-empty">{emptyLabel}</div>;
  const downloadValues = smoothTrafficValues(data.map((point) => point.downloadMbps || 0));
  const uploadValues = smoothTrafficValues(data.map((point) => point.uploadMbps || 0));
  const max = trafficScale([downloadValues, uploadValues]);
  const download = smoothTrafficPath(downloadValues, max, 1000, 100);
  const upload = smoothTrafficPath(uploadValues, max, 1000, 100);
  const lastDownloadY = scaledTrafficY(downloadValues.at(-1), max, 100);
  const lastUploadY = scaledTrafficY(uploadValues.at(-1), max, 100);
  return (
    <div className="airview-frame">
      <div className="airview-meta" aria-hidden="true">
        <span>{formatScale(max)} Mbps</span>
        <span>{historyWindowSeconds(data)}s</span>
      </div>
      <svg
        className="airview-chart"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Live WAN throughput, ${formatMetric(downloadValues.at(-1))} Mbps download and ${formatMetric(uploadValues.at(-1))} Mbps upload`}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".2" /><stop offset="1" stopColor="#38bdf8" stopOpacity=".015" /></linearGradient>
          <linearGradient id={uploadFillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b264eb" stopOpacity=".12" /><stop offset="1" stopColor="#b264eb" stopOpacity="0" /></linearGradient>
          <linearGradient id={downloadStrokeId} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#70b9ff" stopOpacity=".58" /><stop offset=".7" stopColor="#70b9ff" stopOpacity=".88" /><stop offset="1" stopColor="#8bc7ff" /></linearGradient>
          <linearGradient id={uploadStrokeId} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a85fe1" stopOpacity=".54" /><stop offset=".7" stopColor="#b264eb" stopOpacity=".86" /><stop offset="1" stopColor="#c47df5" /></linearGradient>
        </defs>
        <g className="airview-grid">
          <line x1="0" y1="25" x2="1000" y2="25" />
          <line x1="0" y1="50" x2="1000" y2="50" />
          <line x1="0" y1="75" x2="1000" y2="75" />
          <line x1="200" y1="0" x2="200" y2="100" />
          <line x1="400" y1="0" x2="400" y2="100" />
          <line x1="600" y1="0" x2="600" y2="100" />
          <line x1="800" y1="0" x2="800" y2="100" />
        </g>
        <line className="airview-baseline" x1="0" y1="99" x2="1000" y2="99" />
        <path className="airview-fill" fill={`url(#${fillId})`} d={`${download} L 1000 100 L 0 100 Z`} />
        <path className="airview-upload-fill" fill={`url(#${uploadFillId})`} d={`${upload} L 1000 100 L 0 100 Z`} />
        <path className="airview-download" style={{ stroke: `url(#${downloadStrokeId})` }} d={download} />
        <path className="airview-upload" style={{ stroke: `url(#${uploadStrokeId})` }} d={upload} />
        <line className="airview-cursor" x1="998" y1="0" x2="998" y2="100" />
        <g className="airview-live-edge">
          <circle className="airview-halo download" cx="998" cy={lastDownloadY} r="7" />
          <circle className="airview-dot download" cx="998" cy={lastDownloadY} r="3.2" />
          <circle className="airview-halo upload" cx="998" cy={lastUploadY} r="5.5" />
          <circle className="airview-dot upload" cx="998" cy={lastUploadY} r="2.5" />
        </g>
      </svg>
    </div>
  );
}

function NetworkView({ network, displayScope }) {
  const clients = networkClientsMetric(network);
  const latency = networkLatencyMetric(network);
  return (
    <>
      <DeviceNetworkView network={network} displayScope={displayScope} />
      <div className="network-view">
        <section className="network-hero">
          <div className="section-heading"><Globe2 size={26} /><h2>{displayScope === "fleet" ? "Internet" : "Host Network"}</h2><StatusLabel status={network.status} /></div>
          <ThroughputSummary network={network} large />
          <div className="network-facts">
            {displayScope === "fleet" ? <Fact label="Connected clients" value={clients.value} /> : null}
            {displayScope === "fleet" ? <Fact label="Probe latency" value={`${latency.value}${latency.unit ? ` ${latency.unit}` : ""}`} accent={latency.accent} /> : null}
            <Fact label="Data source" value={networkSourceLabel(network, displayScope)} />
            <Fact label="Last update" value={formatAge(network.updatedAt)} />
          </div>
        </section>
        <section className="network-chart-wrap">
          <div className="section-heading"><Activity size={24} /><h2>{displayScope === "fleet" ? "WAN throughput" : "Host throughput"}</h2><span>Last {historyWindowSeconds(network.history)}s</span></div>
          <TrafficChart points={network.history} detailed allowSampleData={network.source === "demo"} emptyLabel={displayScope === "fleet" ? "Waiting for WAN samples" : "Waiting for host samples"} />
          <div className="chart-legend"><Legend color="blue" label="Download" /><Legend color="green" label="Upload" /></div>
        </section>
      </div>
    </>
  );
}

function DeviceNetworkView({ network, displayScope }) {
  const clients = networkClientsMetric(network);
  const latency = networkLatencyMetric(network);
  return (
    <section className="device-network-view">
      <div className="device-network-metrics">
        <DeviceMetric label="Download" value={formatMetric(network.downloadMbps)} unit="Mbps" accent="download" />
        <DeviceMetric label="Upload" value={formatMetric(network.uploadMbps)} unit="Mbps" accent="upload" />
      </div>
      <section className="device-airview network-airview"><AirViewChart points={network.history} allowSampleData={network.source === "demo"} emptyLabel={displayScope === "fleet" ? "Waiting for WAN samples" : "Waiting for host samples"} /></section>
      <div className="device-summary-grid network-summary">
        {displayScope === "fleet" ? <DeviceStat label="CLIENTS" value={clients.value} /> : <DeviceStat label="SOURCE" value={network.source === "host" ? "HOST" : "N/A"} />}
        {displayScope === "fleet" ? <DeviceStat label="LATENCY" value={latency.value} unit={latency.unit} accent={latency.accent} /> : <DeviceStat label="UPDATED" value={network.updatedAt ? formatDuration(Math.max(0, Math.round((Date.now() - new Date(network.updatedAt).valueOf()) / 1000))).toUpperCase() : "N/A"} />}
      </div>
    </section>
  );
}

function MachinesView({ machines, selected, displayScope, onSelect, onFocus }) {
  return (
    <>
      {displayScope === "fleet"
        ? <DeviceFleetMachinesView machines={machines} onFocus={onFocus} />
        : <DeviceMachinesView machines={machines} selected={selected} displayScope={displayScope} onSelect={onSelect} />}
      <div className="machines-view">
        <section className="machine-directory">
          <div className="section-heading"><Monitor size={26} /><h2>Machines</h2><span>{machines.length} agents</span></div>
          <MachineList machines={machines} onMachine={onSelect} selectedId={selected?.machineId} expanded />
        </section>
        <section className="machine-detail">
          {selected ? <MachineDetail machine={selected} /> : <EmptyState />}
        </section>
      </div>
    </>
  );
}

function DeviceFleetMachinesView({ machines, onFocus }) {
  const ordered = [...machines].sort((left, right) => {
    const rank = { error: 0, stale: 1, live: 2 };
    const statusDifference = (rank[left.status] ?? 3) - (rank[right.status] ?? 3);
    return statusDifference || Number(right.oneMinute?.tps || 0) - Number(left.oneMinute?.tps || 0);
  });
  const working = machines.filter(isMachineWorking).length;
  if (!ordered.length) return <section className="device-fleet-machines-view"><EmptyState /></section>;
  return (
    <section className="device-fleet-machines-view">
      <div className="fleet-machine-directory-head">
        <span>{machines.length} NODES</span>
        <strong>{working} WORKING</strong>
      </div>
      <div className="fleet-machine-directory">
        {ordered.map((machine) => {
          const Icon = machineIcon(machine.platform);
          const activity = machineActivity(machine);
          const cpu = finiteMetric(machine.cpuPercent);
          return (
            <button type="button" key={machine.machineId} onClick={() => onFocus(machine.machineId)}>
              <Icon />
              <div className="fleet-machine-name"><strong>{machine.machineName}</strong><span className={machine.status}>{machine.status.toUpperCase()} · {activity.label}</span></div>
              <div className="fleet-machine-value"><strong>{formatTps(machine.oneMinute?.tps)}</strong><span>TPS</span></div>
              <div className="fleet-machine-facts"><span>{machine.activeSessions || 0} ACTIVE</span><span>{cpu === null ? "CPU N/A" : `${Math.round(cpu)}% CPU`}</span></div>
              <ChevronRight />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DeviceMachinesView({ machines, selected, displayScope, onSelect }) {
  if (!selected) return <section className="device-machines-view"><EmptyState /></section>;
  const activity = machineActivity(selected);
  return (
    <section className="device-machines-view">
      <div className="device-machine-tabs" aria-label={displayScope === "fleet" ? "Fleet machines" : "Host selector"}>
        {machines.map((machine) => (
          <button
            className={selected.machineId === machine.machineId ? "selected" : ""}
            key={machine.machineId}
            onClick={() => onSelect(machine.machineId)}
            title={machine.machineName}
          >
            <i className={machine.status} />
            <span>{machine.machineName}</span>
          </button>
        ))}
      </div>
      <div className="device-machine-body">
        <div className="device-machine-primary">
          <span className={`device-machine-activity ${activity.active ? "working" : "idle"}`}>
            <strong>{activity.label}</strong> · {activity.detail}
          </span>
          <DeviceMetric label="1 min" value={formatTps(selected.oneMinute.tps)} unit="TPS" accent={activity.active ? "codex" : "idle"} className="machine-tps-primary" />
        </div>
        <div className="device-machine-secondary">
          <DeviceStat label="5 MIN" value={formatTps(selected.fiveMinutes.tps)} unit="TPS" />
          <DeviceStat label="CACHE" value={selected.cachePercent || 0} unit="%" />
          <DeviceStat label="SESSIONS" value={selected.activeSessions} />
        </div>
      </div>
      <MachineTrendChart values={selected.tpsHistory?.map((sample) => sample.tps) || []} />
    </section>
  );
}

function PetView({ machines, selected, fleet, displayScope, followMode, onFollowMode, onSelect }) {
  if (displayScope === "fleet") return <FleetPetView machines={machines} fleet={fleet} />;
  return <HostPetView machines={machines} selected={selected} followMode={followMode} onFollowMode={onFollowMode} onSelect={onSelect} />;
}

function FleetPetView({ machines, fleet }) {
  const featured = [...machines]
    .sort((left, right) => {
      const statusRank = { error: 0, stale: 1, live: 2 };
      const difference = (statusRank[left.status] ?? 3) - (statusRank[right.status] ?? 3);
      return difference || Number(right.oneMinute?.tps || 0) - Number(left.oneMinute?.tps || 0);
    })
    .slice(0, 4);
  const overflow = Math.max(0, machines.length - featured.length);
  return (
    <section className="pet-view fleet-pet-view">
      <div className="pet-stage fleet-pet-stage">
        <div className="fleet-pet-grid">
          {featured.map((machine) => {
            const pet = machine.pet;
            const spriteUrl = resolvePetSpriteUrl(pet);
            return (
              <div className={`fleet-pet-node ${machine.status}`} key={machine.machineId}>
                {pet && spriteUrl ? (
                  <PetSprite key={petSpriteKey(machine, pet)} pet={pet} machineName={machine.machineName} spriteUrl={spriteUrl} />
                ) : (
                  <div className="fleet-pet-machine" aria-hidden="true"><Monitor /></div>
                )}
                <div><strong>{machine.machineName}</strong><span>{machineActivity(machine).label} · {formatTps(machine.oneMinute?.tps)} TPS</span></div>
              </div>
            );
          })}
        </div>
        {overflow ? <div className="fleet-pet-overflow">+{overflow} NODES</div> : null}
      </div>
      <div className="pet-metrics fleet-pet-metrics">
        <div className="pet-primary-metric">
          <span>FLEET · 1 MINUTE</span>
          <div><strong>{formatTps(fleet.oneMinuteTps)}</strong><small>TPS</small></div>
        </div>
        <div className="pet-secondary-metrics">
          <PetTokenStat label="ACTIVE" value={fleet.activeSessions || 0} detail="CONVERSATIONS" />
          <PetTokenStat label="WORKING" value={fleet.workingMachineCount || 0} detail={`${fleet.liveMachineCount || 0} CONNECTED`} />
          <PetTokenStat label="CPU" value={fleet.cpuPercent === null || fleet.cpuPercent === undefined ? "N/A" : `${Math.round(fleet.cpuPercent)}%`} detail={`${fleet.cpuReportedMachineCount || 0}/${fleet.liveMachineCount || fleet.machineCount || 0} HOSTS`} />
        </div>
        <div className="pet-host-status"><StatusLabel status={fleet.status} /><span>FLEET COMPANIONS</span></div>
      </div>
    </section>
  );
}

function HostPetView({ machines, selected, followMode, onFollowMode, onSelect }) {
  if (!selected) return <section className="pet-view"><EmptyState /></section>;
  const pet = selected.pet;
  const spriteUrl = resolvePetSpriteUrl(pet);
  const petState = pet?.state || "idle";
  return (
    <section className={`pet-view pet-state-${petState} ${pet ? "" : "pet-unconfigured"}`}>
      <div className="pet-stage">
        {pet && spriteUrl ? (
          <>
            <PetSprite
              key={petSpriteKey(selected, pet)}
              pet={pet}
              machineName={selected.machineName}
              spriteUrl={spriteUrl}
            />
            <div className="pet-identity">
              <strong>{pet.displayName}</strong>
              <span>{PET_STATE_LABELS[pet.state] || pet.state.toUpperCase()}</span>
            </div>
            <div className="pet-trend" aria-hidden="true">
              <MachineTrendChart values={selected.tpsHistory?.map((sample) => sample.tps) || []} emptyLabel={false} />
            </div>
          </>
        ) : pet ? (
          <div className="pet-empty">
            <Bird size={58} />
            <strong>Syncing pet</strong>
            <span>{selected.machineName}</span>
          </div>
        ) : (
          <div className="pet-empty">
            <Bird size={58} />
            <strong>No pet configured</strong>
            <span>{selected.machineName}</span>
          </div>
        )}
      </div>
      <div className="pet-metrics">
        <div className="pet-primary-metric">
          <span>1 MINUTE</span>
          <div><strong>{formatTps(selected.oneMinute.tps)}</strong><small>TPS</small></div>
        </div>
        <div className="pet-secondary-metrics">
          <PetTokenStat
            label="INPUT"
            value={formatTps(selected.oneMinute.inputTokens / 60)}
            unit="TPS"
            detail={`CACHE ${selected.cachePercent || 0}%`}
          />
          <PetTokenStat
            label="OUTPUT"
            value={formatTps(selected.oneMinute.outputTokens / 60)}
            unit="TPS"
            detail={`REASON ${formatTps(selected.oneMinute.reasoningOutputTokens / 60)} TPS`}
          />
          <PetTokenStat label="SESSIONS" value={selected.activeSessions} />
        </div>
        <div className={`pet-host-status ${machines.length > 1 ? "has-machine-picker" : ""}`}>
          <PetMachineControl
            machines={machines}
            selected={selected}
            followMode={followMode}
            onFollowMode={onFollowMode}
            onSelect={onSelect}
          />
          <StatusLabel status={selected.status} age={selected.ageSeconds} />
          <span>{selected.platform} · {formatAge(selected.generatedAt)}</span>
        </div>
      </div>
    </section>
  );
}

function PetTokenStat({ label, value, unit, detail }) {
  return (
    <div className="pet-token-stat">
      <div className="pet-token-label">
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </div>
      <div className="pet-token-value">
        <strong>{value}</strong>
        {unit ? <small>{unit}</small> : null}
      </div>
    </div>
  );
}

function PetMachineControl({ machines, selected, followMode, onFollowMode, onSelect, ariaLabel = "Pet host" }) {
  if (machines.length <= 1) {
    return (
      <div className="pet-machine-label">
        <i className={selected.status} />
        <strong>{selected.machineName}</strong>
      </div>
    );
  }
  const auto = followMode === "auto";
  return (
    <div className="pet-machine-control">
      <button
        type="button"
        className={auto ? "active" : ""}
        onClick={() => onFollowMode(auto ? "fixed" : "auto")}
        aria-label={auto ? "Fix selected machine" : "Automatically follow active machine"}
        title={auto ? "Auto follow" : "Fixed machine"}
      >
        {auto ? <Radio size={19} /> : <Pin size={19} />}
      </button>
      <label>
        <select
          aria-label={ariaLabel}
          value={selected.machineId}
          onChange={(event) => onSelect(event.target.value)}
        >
          {machines.map((machine) => (
            <option key={machine.machineId} value={machine.machineId}>
              {machine.machineName}
            </option>
          ))}
        </select>
        <ChevronDown size={17} />
      </label>
    </div>
  );
}

function PetSprite({ pet, machineName, spriteUrl }) {
  const frameRef = useRef(null);
  const [transientState, setTransientState] = useState(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const animationState = transientState || pet.state;
  const animation = petAnimationForState(animationState);
  const spriteGrid = petSpriteGrid(pet);
  const reduceMotion = shouldReducePetMotion(navigator.userAgent, prefersReducedMotion);

  useEffect(() => {
    const frameElement = frameRef.current;
    if (!frameElement) return undefined;

    const playback = petPlaybackForState(animationState, reduceMotion);
    const startedAt = window.performance.now();
    let animationFrame = null;
    let paintedFrameIndex = -1;
    const paintFrame = (timestamp) => {
      const frameIndex = petFrameAtElapsed(playback, timestamp - startedAt);
      if (frameIndex !== paintedFrameIndex) {
        frameElement.style.backgroundPosition = petFramePosition(
          playback.frames[frameIndex],
          pet,
        );
        paintedFrameIndex = frameIndex;
      }
      if (playback.loopStartIndex !== null && playback.frames.length > 1) {
        animationFrame = window.requestAnimationFrame(paintFrame);
      }
    };

    paintFrame(startedAt);
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [animationState, pet.spriteVersionNumber, reduceMotion]);

  const onPointerEnter = (event) => {
    if (event.pointerType === "mouse") setTransientState("jumping");
  };
  const onPointerLeave = (event) => {
    if (event.pointerType === "mouse") setTransientState(null);
  };

  return (
    <div
      className={`pet-sprite ${pet.state}`}
      role="img"
      aria-label={`${pet.displayName} on ${machineName}, ${PET_STATE_LABELS[pet.state] || pet.state}`}
      data-pet-animation={animation.name}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div
        ref={frameRef}
        className="pet-sprite-frame"
        aria-hidden="true"
        style={{
          backgroundImage: `url(${spriteUrl})`,
          backgroundSize: spriteGrid.backgroundSize,
        }}
      />
    </div>
  );
}

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [preferred, setPreferred] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mediaQuery = matchMedia(query);
    const onChange = (event) => setPreferred(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return preferred;
}

function MachineTrendChart({ values = [], emptyLabel = true }) {
  const fillId = useId().replace(/:/g, "");
  const hasActivity = values.some((value) => Number(value) > 0.005);
  if (!hasActivity) {
    return (
      <div className={`machine-trend-empty ${emptyLabel ? "" : "compact"}`} role="img" aria-label="No machine activity in the last five minutes">
        {emptyLabel ? <span>NO ACTIVITY · 5 MIN</span> : null}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="72" x2="1000" y2="72" />
          <circle cx="998" cy="72" r="3" />
        </svg>
      </div>
    );
  }
  const max = Math.max(1, ...values);
  const points = linePoints(values, max, 1000, 100);
  return (
    <svg className="machine-trend-chart" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Recent machine TPS trend">
      <defs>
        <linearGradient id={`${fillId}-machine-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#25d06f" stopOpacity=".26" />
          <stop offset="1" stopColor="#25d06f" stopOpacity=".03" />
        </linearGradient>
      </defs>
      <g className="machine-trend-grid"><line x1="0" y1="25" x2="1000" y2="25" /><line x1="0" y1="50" x2="1000" y2="50" /><line x1="0" y1="75" x2="1000" y2="75" /></g>
      <polygon fill={`url(#${fillId}-machine-fill)`} points={`0,100 ${points} 1000,100`} />
      <polyline points={points} />
    </svg>
  );
}

function MachineDetail({ machine }) {
  const Icon = machineIcon(machine.platform);
  const cachePercent = machine.cachePercent || 0;
  return (
    <>
      <div className="machine-detail-header">
        <Icon size={38} />
        <div><h2>{machine.machineName}</h2><span>{machine.platform} · {formatAge(machine.generatedAt)}</span></div>
        <StatusLabel status={machine.status} />
      </div>
      <div className="detail-metrics">
        <Metric label="1 minute" value={formatTps(machine.oneMinute.tps)} unit="TPS" accent="green" />
        <Metric label="5 minutes" value={formatTps(machine.fiveMinutes.tps)} unit="TPS" />
        <Metric label="Cache" value={cachePercent} unit="%" />
        <Metric label="Sessions" value={machine.activeSessions} />
      </div>
      <div className="token-breakdown">
        <TokenBar label="Input" value={machine.oneMinute.inputTokens} max={machine.oneMinute.inputTokens} color="blue" />
        <TokenBar label="Cached" value={machine.oneMinute.cachedInputTokens} max={machine.oneMinute.inputTokens} color="green" />
        <TokenBar label="Output" value={machine.oneMinute.outputTokens} max={machine.oneMinute.inputTokens} color="violet" />
        <TokenBar label="Reasoning" value={machine.oneMinute.reasoningOutputTokens} max={machine.oneMinute.inputTokens} color="amber" />
      </div>
      <Sparkline values={machine.tpsHistory?.map((sample) => sample.tps) || []} color="green" />
      {machine.error ? <div className="machine-error">{machine.error}</div> : null}
    </>
  );
}

function ThroughputSummary({ network, large = false }) {
  return (
    <div className={`throughput-summary ${large ? "large" : ""}`}>
      <Metric label="Download" value={formatMetric(network.downloadMbps)} unit="Mbps" accent="blue" />
      <div className="metric-separator" />
      <Metric label="Upload" value={formatMetric(network.uploadMbps)} unit="Mbps" accent="green" />
    </div>
  );
}

function CodexSummary({ codex }) {
  return (
    <div className="codex-summary">
      <Metric label="1 min" value={formatTps(codex.oneMinuteTps)} unit="TPS" accent="green" />
      <Metric label="5 min" value={formatTps(codex.fiveMinuteTps)} unit="TPS" accent="green" />
      <Metric label="Cache" value={codex.cachePercent} unit="%" accent="green" />
      <Metric label="Sessions" value={codex.activeSessions} accent="green" />
    </div>
  );
}

function MachineList({ machines, onMachine, selectedId, expanded = false }) {
  if (machines.length === 0) return <EmptyState />;
  return (
    <div className={`machine-list ${expanded ? "expanded" : ""}`}>
      {machines.map((machine) => {
        const Icon = machineIcon(machine.platform);
        return (
          <button className={`machine-row ${selectedId === machine.machineId ? "selected" : ""}`} key={machine.machineId} onClick={() => onMachine(machine.machineId)}>
            <Icon className="machine-icon" size={expanded ? 30 : 28} />
            <div className="machine-identity"><strong>{machine.machineName}</strong>{expanded ? <span>{machine.platform} · {formatAge(machine.generatedAt)}</span> : null}</div>
            <span className="machine-tps">{formatTps(machine.oneMinute.tps)} TPS</span>
            <Sparkline values={machine.tpsHistory?.map((sample) => sample.tps) || []} color="green" mini />
            <StatusLabel status={machine.status} age={machine.ageSeconds} compact />
            <ChevronRight className="row-chevron" size={22} />
          </button>
        );
      })}
    </div>
  );
}

function Panel({ title, icon: Icon, action, className = "", children }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header"><div><Icon size={25} /><h2>{title}</h2></div>{action}</div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Metric({ label, value, unit, accent }) {
  return (
    <div className={`metric ${accent || ""}`}>
      <span className="metric-label">{label}</span>
      <div><strong>{value}</strong>{unit ? <span>{unit}</span> : null}</div>
    </div>
  );
}

function Fact({ label, value, accent = "" }) {
  return <div className="fact"><span>{label}</span><strong className={accent}>{value}</strong></div>;
}

function TokenBar({ label, value, max, color }) {
  const percent = max ? Math.max(3, Math.min(100, (value / max) * 100)) : 3;
  return (
    <div className="token-bar">
      <div><span>{label}</span><strong>{formatCompact(value)}</strong></div>
      <i><b className={color} style={{ width: `${percent}%` }} /></i>
    </div>
  );
}

function TrafficChart({ points = [], detailed = false, allowSampleData = false, emptyLabel = "Waiting for WAN samples" }) {
  const chartId = useId().replace(/:/g, "");
  const downloadFillId = `${chartId}-download-fill`;
  const uploadFillId = `${chartId}-upload-fill`;
  const data = trafficData(points, allowSampleData);
  if (data.length === 0) {
    return <div className={`traffic-chart chart-empty ${detailed ? "detailed" : ""}`}><Activity size={32} /><strong>{emptyLabel}</strong><span>Values appear when the selected source reports aggregate throughput.</span></div>;
  }
  const downloadValues = smoothTrafficValues(data.map((point) => point.downloadMbps || 0));
  const uploadValues = smoothTrafficValues(data.map((point) => point.uploadMbps || 0));
  const max = trafficScale([downloadValues, uploadValues]);
  const download = smoothTrafficPath(downloadValues, max);
  const upload = smoothTrafficPath(uploadValues, max);
  const lastDownloadY = scaledTrafficY(downloadValues.at(-1), max, 300);
  const lastUploadY = scaledTrafficY(uploadValues.at(-1), max, 300);
  const windowSeconds = historyWindowSeconds(data);
  return (
    <div className={`traffic-chart ${detailed ? "detailed" : ""}`}>
      <div className="axis-labels"><span>{Math.ceil(max)}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div>
      <svg viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" aria-label="WAN throughput chart">
        <defs>
          <linearGradient id={downloadFillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2d8cff" stopOpacity=".2" /><stop offset="1" stopColor="#2d8cff" stopOpacity="0" /></linearGradient>
          <linearGradient id={uploadFillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38d891" stopOpacity=".18" /><stop offset="1" stopColor="#38d891" stopOpacity="0" /></linearGradient>
        </defs>
        <g className="grid-lines"><line x1="0" y1="0" x2="1000" y2="0" /><line x1="0" y1="150" x2="1000" y2="150" /><line x1="0" y1="299" x2="1000" y2="299" />{[0, 200, 400, 600, 800, 1000].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="300" />)}</g>
        <path className="download-fill" fill={`url(#${downloadFillId})`} d={`${download} L 1000 300 L 0 300 Z`} />
        <path className="upload-fill" fill={`url(#${uploadFillId})`} d={`${upload} L 1000 300 L 0 300 Z`} />
        <path className="download-line" d={download} />
        <path className="upload-line" d={upload} />
        <line className="traffic-cursor" x1="998" y1="0" x2="998" y2="300" />
        <circle className="traffic-dot download" cx="998" cy={lastDownloadY} r="5" />
        <circle className="traffic-dot upload" cx="998" cy={lastUploadY} r="4" />
      </svg>
      <div className="time-labels"><span>-{windowSeconds}s</span><span>-{Math.round(windowSeconds / 2)}s</span><span>0s</span></div>
    </div>
  );
}

function Sparkline({ values, color, mini = false, compact = false }) {
  const data = values.length > 1 ? values : [0, 0];
  const max = Math.max(...data, 1);
  const points = linePoints(data, max, 200, 50);
  return (
    <svg className={`sparkline ${mini ? "mini" : ""} ${compact ? "compact" : ""}`} viewBox="0 0 200 50" preserveAspectRatio="none" aria-hidden="true">
      <polyline className={color} points={points} />
    </svg>
  );
}

function linePoints(values, max, width = 1000, height = 300) {
  return values.map((value, index) => {
    const x = values.length === 1 ? 0 : index * width / (values.length - 1);
    const y = height - Math.min(height, Math.max(0, value / max * height * 0.92));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function loadTrendAxis(minutes) {
  if (minutes <= 0) return ["now"];
  if (minutes < 3) return [`-${minutes}m`, "now"];
  return [
    `-${minutes}m`,
    `-${Math.max(1, Math.round(minutes * 2 / 3))}m`,
    `-${Math.max(1, Math.round(minutes / 3))}m`,
    "now",
  ];
}

function trafficData(points, allowSampleData) {
  if (points.length > 1) return points;
  if (!allowSampleData) return [];
  return Array.from({ length: 60 }, (_, index) => ({
    downloadMbps: 700 + Math.sin(index / 5) * 80,
    uploadMbps: 115 + Math.cos(index / 7) * 16,
  }));
}

function historyWindowSeconds(points = []) {
  if (points.length > 1) {
    const first = new Date(points[0].at).valueOf();
    const last = new Date(points.at(-1).at).valueOf();
    if (Number.isFinite(first) && Number.isFinite(last) && last > first) {
      return Math.max(1, Math.round((last - first) / 1000));
    }
  }
  return Math.max(1, points.length - 1);
}

function networkUnavailableLabel(network) {
  return !network.source || network.source === "unconfigured" || network.status === "error" || network.status === "unavailable" ? "N/A" : "WAIT";
}

function networkSourceLabel(network, displayScope) {
  if (displayScope === "host") return network.source === "host" ? "Host telemetry" : "Unavailable";
  return network.source === "unifi"
    ? "UniFi Gateway"
    : network.source === "unifi-snmp-v3"
      ? "UniFi SNMPv3"
      : network.source === "demo" ? "Demonstration" : "Unconfigured";
}

function networkClientsMetric(network) {
  if (network.clients !== null && network.clients !== undefined && Number.isFinite(Number(network.clients))) {
    return { value: Math.max(0, Math.round(Number(network.clients))) };
  }
  return { value: networkUnavailableLabel(network) };
}

function networkLatencyMetric(network) {
  if (network.latencyMs === null || network.latencyMs === undefined || !Number.isFinite(Number(network.latencyMs))) {
    return { value: networkUnavailableLabel(network), unit: "", accent: "" };
  }
  const value = Math.max(0, Number(network.latencyMs));
  const accent = value < 30 ? "green" : value < 80 ? "amber" : "red";
  return { value: value.toFixed(2), unit: "ms", accent };
}

function machineActivity(machine) {
  if (machine?.status === "error") return { active: false, label: "OFFLINE", detail: machine.platform };
  if (machine?.status === "stale") return { active: false, label: "IDLE", detail: "STALE TELEMETRY" };
  const currentTps = Number(machine.oneMinute?.tps || 0);
  if (currentTps > 0.005) return { active: true, label: "WORKING", detail: machine.platform };

  const history = Array.isArray(machine.tpsHistory) ? machine.tpsHistory : [];
  const latestAt = new Date(history.at(-1)?.at || machine.generatedAt).valueOf();
  let lastActive = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const sample = history[index];
    if (Number(sample.tps) > 0.005 && Number.isFinite(new Date(sample.at).valueOf())) {
      lastActive = sample;
      break;
    }
  }
  if (lastActive && Number.isFinite(latestAt)) {
    const ageSeconds = Math.max(0, Math.round((latestAt - new Date(lastActive.at).valueOf()) / 1000));
    return { active: false, label: "IDLE", detail: `LAST ${formatDuration(ageSeconds).toUpperCase()} AGO` };
  }
  if (Number(machine.fiveMinutes?.tps || 0) > 0.005) {
    return { active: false, label: "IDLE", detail: "ACTIVE <5M" };
  }
  return { active: false, label: "IDLE", detail: "5M NO ACTIVITY" };
}

function isMachineWorking(machine) {
  return machine?.status === "live" && machineActivity(machine).active;
}

function BottomNav({ view, setView, status, connection }) {
  const items = [
    ["overview", LayoutDashboard],
    ["network", Globe2],
    ["machines", Monitor],
    ["load", Gauge],
    ["pet", Bird],
  ];
  const displayStatus = connection === "live" ? status.overallStatus : "stale";
  const showFreshness = displayStatus !== "live";
  return (
    <nav className={`bottom-nav ${showFreshness ? "has-alert" : ""}`}>
      <div className="nav-tabs">
        {items.map(([id, Icon]) => (
          <button
            key={id}
            aria-label={VIEW_LABELS[id]}
            aria-current={view === id ? "page" : undefined}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            <Icon size={24} />
            <span>{VIEW_LABELS[id]}</span>
          </button>
        ))}
      </div>
      {showFreshness ? <div className="freshness"><span>Data freshness</span><StatusLabel status={displayStatus} /><span className="divider" /><span>Updated: {formatAge(status.generatedAt, true)}</span></div> : null}
    </nav>
  );
}

function FullscreenButton() {
  if (navigator.userAgent.includes("AmbientOpsKiosk/")) return null;
  const enter = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch { /* Chrome kiosk and immersive mode can already be fullscreen. */ }
  };
  return <button className="icon-button" onClick={enter} title="全屏"><Expand size={20} /></button>;
}

function StatusLabel({ status = "error", compact = false, age }) {
  const label = status === "live" ? "LIVE" : status === "stale" ? "STALE" : status === "unavailable" ? "N/A" : "ERROR";
  return (
    <span className={`status-label ${status} ${compact ? "compact" : ""}`}>
      <i /> <span>{label}</span>{age && status !== "live" ? <small>{formatDuration(age)}</small> : null}
    </span>
  );
}

function Legend({ color, label }) {
  return <span className="legend"><i className={color} />{label}</span>;
}

function EmptyState() {
  return <div className="empty-state"><WifiOff size={38} /><strong>No agents</strong><span>Waiting for machine snapshots</span></div>;
}

function EinkDisplay({ status, connection }) {
  const now = useClock(30_000);
  return (
    <main className="eink-display">
      <header><div><h1>OPL FLEET COCKPIT</h1><time>{formatTime(now, status.site?.timeZone)}</time></div><StatusLabel status={connection === "live" ? status.overallStatus : "stale"} /></header>
      <section className="eink-network">
        <h2>INTERNET</h2>
        <Metric label="DOWNLOAD" value={formatMetric(status.network.downloadMbps)} unit="Mbps" />
        <Metric label="UPLOAD" value={formatMetric(status.network.uploadMbps)} unit="Mbps" />
      </section>
      <section className="eink-codex">
        <h2>CODEX</h2>
        <Metric label="1 MINUTE" value={formatTps(status.codex.oneMinuteTps)} unit="TPS" />
        <Metric label="ACTIVE" value={status.codex.activeSessions} unit="SESSIONS" />
      </section>
      <footer><span>{status.machines.length} MACHINES</span><span>UPDATED {formatAge(status.generatedAt, true).toUpperCase()}</span></footer>
    </main>
  );
}

function useClock(interval = 1000) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), interval); return () => clearInterval(timer); }, [interval]);
  return now;
}

function mergeStatusHistory(previous, next) {
  const previousMachines = new Map((previous?.machines || []).map((machine) => [machine.machineId, machine]));
  const machines = (next.machines || []).map((machine) => {
    const prior = previousMachines.get(machine.machineId);
    const sample = { at: machine.generatedAt, tps: Number(machine.oneMinute?.tps || 0) };
    const sourceHistory = mergeHistorySamples(prior?.tpsHistory, machine.tpsHistory);
    return { ...machine, tpsHistory: appendHistorySample(sourceHistory, sample) };
  });
  const incomingFleet = fleetForStatus(next);
  const previousFleet = fleetForStatus(previous || {});
  const fleetSourceHistory = mergeHistorySamples(previousFleet.tpsHistory, incomingFleet.tpsHistory);
  const fleetHistory = appendHistorySample(fleetSourceHistory, {
    at: next.generatedAt,
    tps: Number(incomingFleet.oneMinuteTps || 0),
  });
  const fleet = { ...incomingFleet, tpsHistory: fleetHistory };
  return {
    ...next,
    fleet,
    codex: { ...next.codex, tpsHistory: fleetHistory },
    machines,
  };
}

function fleetForStatus(status = {}) {
  const source = status.fleet || status.codex || {};
  const machines = status.machines || [];
  return {
    status: source.status || status.codex?.status || "error",
    oneMinuteTps: Number(source.oneMinuteTps ?? status.codex?.oneMinuteTps) || 0,
    fiveMinuteTps: Number(source.fiveMinuteTps ?? status.codex?.fiveMinuteTps) || 0,
    cachePercent: Number(source.cachePercent ?? status.codex?.cachePercent) || 0,
    activeSessions: Number(source.activeSessions ?? status.codex?.activeSessions) || 0,
    cpuPercent: finiteMetric(source.cpuPercent ?? status.codex?.cpuPercent),
    cpuReportedMachineCount: Number(source.cpuReportedMachineCount ?? status.codex?.cpuReportedMachineCount) || 0,
    memoryPercent: finiteMetric(source.memoryPercent ?? status.codex?.memoryPercent),
    memoryReportedMachineCount: Number(source.memoryReportedMachineCount ?? status.codex?.memoryReportedMachineCount) || 0,
    machineCount: Number(source.machineCount ?? status.codex?.machineCount) || machines.length,
    liveMachineCount: Number(source.liveMachineCount ?? status.codex?.liveMachineCount) || 0,
    staleMachineCount: Number(source.staleMachineCount ?? status.codex?.staleMachineCount) || 0,
    workingMachineCount: Number(source.workingMachineCount) || machines.filter((machine) => nodeWorking(fleetNodeFromMachine(machine))).length,
    tpsHistory: Array.isArray(source.tpsHistory) ? source.tpsHistory : [],
    loadVisualState: source.loadVisualState || null,
  };
}

function codexForDisplay(status, displayScope, machine) {
  if (displayScope === "fleet") return fleetForStatus(status);
  if (!machine) return EMPTY_STATUS.codex;
  return {
    status: machine.status,
    oneMinuteTps: Number(machine.oneMinute?.tps) || 0,
    fiveMinuteTps: Number(machine.fiveMinutes?.tps) || 0,
    cachePercent: Number(machine.cachePercent) || 0,
    activeSessions: Number(machine.activeSessions) || 0,
    cpuPercent: finiteMetric(machine.cpuPercent),
    cpuReportedMachineCount: finiteMetric(machine.cpuPercent) === null ? 0 : 1,
    machineCount: 1,
    liveMachineCount: machine.status === "live" ? 1 : 0,
    staleMachineCount: machine.status === "stale" ? 1 : 0,
    tpsHistory: machine.tpsHistory || [],
  };
}

function networkForDisplay(status, displayScope, machine) {
  if (displayScope === "fleet") return status.network || EMPTY_STATUS.network;
  if (status.provider?.scope === "machine" && status.network?.source === "host") return status.network;
  return machine?.network || {
    status: "unavailable",
    source: "host",
    downloadMbps: null,
    uploadMbps: null,
    history: [],
  };
}

function hostFreshness(machine) {
  if (machine?.status === "error") return "OFFLINE";
  if (machine?.status === "stale") return `STALE ${formatDuration(machine.ageSeconds || 0).toUpperCase()}`;
  return Number(machine?.ageSeconds || 0) < 5 ? "NOW" : formatDuration(machine.ageSeconds).toUpperCase();
}

function machineIcon(platform = "") {
  const lower = platform.toLowerCase();
  if (lower.includes("server") || lower.includes("linux")) return Server;
  if (lower.includes("windows")) return Monitor;
  return Laptop;
}

function formatMetric(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "N/A";
}

function formatScale(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: Number(value) < 10 ? 1 : 0 });
}

function metricDensity(value) {
  const length = String(value ?? "").replace(/\s/g, "").length;
  if (length >= 9) return "tight";
  if (length >= 7) return "compact";
  return "normal";
}

function formatTps(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: Number(value) >= 100 ? 0 : 1 });
}

function formatCompact(value) {
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

function formatAge(value, short = false) {
  if (!value) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).valueOf()) / 1000));
  if (seconds < 5) return short ? "now" : "Just now";
  return `${formatDuration(seconds)} ago`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

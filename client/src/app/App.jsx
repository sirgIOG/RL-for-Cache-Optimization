import { useEffect, useMemo, useState } from "react";
import {
  createWorkload,
  getRuns,
  getSimulationJob,
  getWorkloads,
  runSimulation,
} from "../services/api.js";
import { ComparisonChart } from "../components/charts/ComparisonChart.jsx";
import { TimelineChart } from "../components/charts/TimelineChart.jsx";
import { RunMetricsTable } from "../components/RunMetricsTable.jsx";

const sampleTrace = `10
20
30
10
40
20
50
10
60
20
30
10
70
20
80`;

const policyOrder = ["FIFO", "LRU", "LFU", "MRU", "RL"];

function formatHitRate(value) {
  return value == null ? "--" : `${(value * 100).toFixed(2)}%`;
}

function pickBestPolicy(entries) {
  if (entries.length === 0) {
    return ["--", { hitRate: 0, evictions: 0, averageLatency: 0 }];
  }

  return entries.reduce((best, current) => {
    const [bestPolicy, bestMetrics] = best;
    const [currentPolicy, currentMetrics] = current;

    if (currentMetrics.hitRate > bestMetrics.hitRate) {
      return current;
    }

    if (currentMetrics.hitRate < bestMetrics.hitRate) {
      return best;
    }

    if (currentPolicy === "RL" && bestPolicy !== "RL") {
      return current;
    }

    return best;
  });
}

export default function App() {
  const [view, setView] = useState("dashboard");
  const [workloads, setWorkloads] = useState([]);
  const [runs, setRuns] = useState([]);
  const [traceName, setTraceName] = useState("demo_trace");
  const [traceText, setTraceText] = useState(sampleTrace);
  const [selectedWorkload, setSelectedWorkload] = useState("");
  const [capacity, setCapacity] = useState(16);
  const [status, setStatus] = useState("Connecting...");
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingTrace, setIsSavingTrace] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const [activeJob, setActiveJob] = useState(null);

  async function refresh(preferredRunName = null) {
    const [workloadData, runData] = await Promise.all([getWorkloads(), getRuns()]);
    setWorkloads(workloadData);
    setRuns(runData);

    if (!selectedWorkload && workloadData.length > 0) {
      setSelectedWorkload(workloadData[0].name);
    }

    if (preferredRunName) {
      const preferredRun = runData.find((run) => run.name === preferredRunName);
      if (preferredRun) {
        setActiveRun(preferredRun);
        return;
      }
    }

    if (activeRun) {
      const currentRun = runData.find((run) => run.name === activeRun.name);
      if (currentRun) {
        setActiveRun(currentRun);
        return;
      }
    }

    if (runData.length > 0) {
      setActiveRun(runData[0]);
    }
  }

  useEffect(() => {
    refresh()
      .then(() => setStatus("Backend connected"))
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!activeJob?.id || activeJob.status === "completed" || activeJob.status === "failed") {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const nextJob = await getSimulationJob(activeJob.id);
        setActiveJob(nextJob);

        if (nextJob.status === "completed") {
          await refresh(nextJob.result?.name || nextJob.request?.runName || null);
          setStatus("Simulation complete");
          setIsRunning(false);
          setView("dashboard");
          window.clearInterval(intervalId);
        }

        if (nextJob.status === "failed") {
          setStatus(nextJob.error || "Simulation failed");
          setIsRunning(false);
          window.clearInterval(intervalId);
        }
      } catch (error) {
        setStatus(error.message);
        setIsRunning(false);
        window.clearInterval(intervalId);
      }
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [activeJob]);

  async function handleCreateWorkload(event) {
    event.preventDefault();
    try {
      setIsSavingTrace(true);
      setStatus("Saving workload...");
      const workload = await createWorkload({ name: traceName, traceText });
      await refresh();
      setSelectedWorkload(workload.name);
      setStatus(`Saved workload ${workload.name}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSavingTrace(false);
    }
  }

  async function handleRunSimulation() {
    if (!selectedWorkload) {
      setStatus("Select a workload first");
      return;
    }

    try {
      setIsRunning(true);
      setStatus("Queueing simulation...");
      const runName = `${selectedWorkload}-cap-${capacity}`;
      const job = await runSimulation({
        runName,
        workloadName: selectedWorkload,
        capacity: Number(capacity),
        policies: policyOrder,
      });
      setActiveJob(job);
      setStatus(job.status === "queued" ? "Simulation queued" : "Simulation running");
    } catch (error) {
      setStatus(error.message);
      setActiveJob(null);
    }
  }

  const selectedWorkloadSummary = useMemo(
    () => workloads.find((workload) => workload.name === selectedWorkload) || null,
    [workloads, selectedWorkload]
  );

  const comparisonData = useMemo(() => {
    if (!activeRun?.policies) {
      return [];
    }

    return Object.entries(activeRun.policies).map(([policy, metrics]) => ({
      policy,
      hitRate: Number((metrics.hitRate * 100).toFixed(2)),
      misses: metrics.missCount,
      evictions: metrics.evictions,
    }));
  }, [activeRun]);

  const timelineData = useMemo(() => {
    if (!activeRun?.policies) {
      return [];
    }

    const entries = Object.entries(activeRun.policies);
    const maxLength = Math.max(...entries.map(([, metrics]) => metrics.timeline.length), 0);

    return Array.from({ length: maxLength }, (_, index) => {
      const row = { step: index + 1 };
      for (const [policy, metrics] of entries) {
        row[policy] = Number(((metrics.timeline[index]?.hitRate || 0) * 100).toFixed(2));
      }
      return row;
    });
  }, [activeRun]);

  const summary = useMemo(() => {
    if (!activeRun?.policies) {
      return {
        bestPolicy: "--",
        bestHitRate: null,
        totalEvictions: 0,
        averageLatency: null,
      };
    }

    const entries = Object.entries(activeRun.policies);
    const [bestPolicy, bestMetrics] = pickBestPolicy(entries);

    const totalEvictions = entries.reduce((sum, [, metrics]) => sum + metrics.evictions, 0);
    const averageLatency =
      entries.reduce((sum, [, metrics]) => sum + metrics.averageLatency, 0) / Math.max(entries.length, 1);

    return {
      bestPolicy,
      bestHitRate: bestMetrics.hitRate,
      totalEvictions,
      averageLatency,
    };
  }, [activeRun]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Cache replacement platform</p>
          <h1>Dashboard and Simulation</h1>
          <p className="hero-copy">
            Browse precomputed results in the dashboard, then switch to simulation only when you
            want to create workloads or run a new experiment.
          </p>
        </div>
        <div className="hero-status">
          <span>Backend status</span>
          <strong>{status}</strong>
        </div>
      </header>

      <section className="topbar">
        <div className="tab-switcher">
          <button
            type="button"
            className={`tab-button ${view === "dashboard" ? "active" : ""}`}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`tab-button ${view === "simulation" ? "active" : ""}`}
            onClick={() => setView("simulation")}
          >
            Simulation
          </button>
        </div>

        <section className="summary-strip">
          <article className="summary-card">
            <span>Saved workloads</span>
            <strong>{workloads.length}</strong>
          </article>
          <article className="summary-card">
            <span>Saved runs</span>
            <strong>{runs.length}</strong>
          </article>
          <article className="summary-card">
            <span>Best policy</span>
            <strong>{summary.bestPolicy}</strong>
          </article>
          <article className="summary-card">
            <span>Best hit rate</span>
            <strong>{formatHitRate(summary.bestHitRate)}</strong>
          </article>
        </section>
      </section>

      {view === "dashboard" ? (
        <main className="dashboard-layout">
          <section className="primary-column">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Precomputed Results</p>
                  <h2>Policy Comparison</h2>
                </div>
              </div>
              <ComparisonChart data={comparisonData} />
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Precomputed Results</p>
                  <h2>Hit Rate Timeline</h2>
                </div>
              </div>
              <TimelineChart data={timelineData} />
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Metrics</p>
                  <h2>Run Breakdown</h2>
                </div>
              </div>
              <RunMetricsTable policies={activeRun?.policies} />
            </article>
          </section>

          <aside className="secondary-column">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Snapshot</p>
                  <h2>Active Run Summary</h2>
                </div>
              </div>
              <div className="summary-grid">
                <div className="mini-stat">
                  <span>Best policy</span>
                  <strong>{summary.bestPolicy}</strong>
                </div>
                <div className="mini-stat">
                  <span>Best hit rate</span>
                  <strong>{formatHitRate(summary.bestHitRate)}</strong>
                </div>
                <div className="mini-stat">
                  <span>Total evictions</span>
                  <strong>{summary.totalEvictions}</strong>
                </div>
                <div className="mini-stat">
                  <span>Avg latency</span>
                  <strong>{summary.averageLatency != null ? `${summary.averageLatency.toFixed(2)}ms` : "--"}</strong>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Saved Runs</p>
                  <h2>History</h2>
                </div>
              </div>
              <div className="history-list">
                {runs.length === 0 && <p className="empty-state">No simulation runs yet.</p>}
                {runs.map((run) => (
                  <button
                    key={run._id || run.name}
                    className={`history-row ${activeRun?.name === run.name ? "active" : ""}`}
                    type="button"
                    onClick={() => setActiveRun(run)}
                  >
                    <strong>{run.name}</strong>
                    <span>{run.workloadName}</span>
                    <small>Capacity {run.cacheConfig?.capacity}</small>
                  </button>
                ))}
              </div>
            </article>
          </aside>
        </main>
      ) : (
        <main className="simulation-layout">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Input</p>
                <h2>Create Workload</h2>
              </div>
            </div>
            <form className="stack" onSubmit={handleCreateWorkload}>
              <label className="field">
                <span>Workload name</span>
                <input value={traceName} onChange={(event) => setTraceName(event.target.value)} />
              </label>
              <label className="field">
                <span>Trace addresses</span>
                <textarea rows="14" value={traceText} onChange={(event) => setTraceText(event.target.value)} />
              </label>
              <div className="panel-actions">
                <span>{traceText.split(/\r?\n/).filter(Boolean).length} addresses ready</span>
                <button className="button-secondary" type="submit" disabled={isSavingTrace}>
                  {isSavingTrace ? "Saving..." : "Save workload"}
                </button>
              </div>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Execution</p>
                <h2>Run Simulation</h2>
              </div>
            </div>
            <div className="stack">
              <label className="field">
                <span>Saved workload</span>
                <select value={selectedWorkload} onChange={(event) => setSelectedWorkload(event.target.value)}>
                  <option value="">Select workload</option>
                  {workloads.map((workload) => (
                    <option key={workload.name} value={workload.name}>
                      {workload.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Cache capacity</span>
                <input
                  type="range"
                  min="2"
                  max="256"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                />
              </label>

              <div className="capacity-meta">
                <span>{capacity} lines</span>
                <span>{selectedWorkloadSummary?.accesses ?? 0} accesses</span>
              </div>

              <div className="policy-list">
                {policyOrder.map((policy) => (
                  <span key={policy} className={`policy-badge policy-${policy.toLowerCase()}`}>
                    {policy}
                  </span>
                ))}
              </div>

              <button className="button-primary" type="button" onClick={handleRunSimulation} disabled={isRunning}>
                {isRunning ? "Running simulation..." : "Run simulation"}
              </button>

              {activeJob ? (
                <div className="job-status-card">
                  <span className={`job-status-badge job-${activeJob.status}`}>{activeJob.status}</span>
                  <strong>{activeJob.request?.runName || activeJob.id}</strong>
                  <small>
                    {activeJob.status === "queued" && "Waiting for execution"}
                    {activeJob.status === "running" && "Processing workload and policies"}
                    {activeJob.status === "completed" && "Saved to dashboard history"}
                    {activeJob.status === "failed" && (activeJob.error || "Simulation failed")}
                  </small>
                </div>
              ) : null}
            </div>
          </article>
        </main>
      )}
    </div>
  );
}

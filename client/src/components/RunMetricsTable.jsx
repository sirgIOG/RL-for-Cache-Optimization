const policyAccentClass = {
  FIFO: "accent-fifo",
  LRU: "accent-lru",
  LFU: "accent-lfu",
  MRU: "accent-mru",
  RL: "accent-rl",
};

export function RunMetricsTable({ policies }) {
  return (
    <table className="metrics-table">
      <thead>
        <tr>
          <th>Policy</th>
          <th>Hit Rate</th>
          <th>Hits</th>
          <th>Misses</th>
          <th>Evictions</th>
          <th>Avg Latency</th>
        </tr>
      </thead>
      <tbody>
        {policies ? (
          Object.entries(policies).map(([policy, metrics]) => (
            <tr key={policy} className={policyAccentClass[policy] || ""}>
              <td className="policy-name">{policy === "RL" ? "RL (Reinforcement)" : policy}</td>
              <td className="policy-hit-rate">{(metrics.hitRate * 100).toFixed(2)}%</td>
              <td>{metrics.hitCount}</td>
              <td>{metrics.missCount}</td>
              <td>{metrics.evictions}</td>
              <td>{metrics.averageLatency.toFixed(2)}ms</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan="6">Run a simulation to see metrics.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const policyColors = {
  FIFO: "#facc15",
  LRU: "#3b82f6",
  LFU: "#ec4899",
  MRU: "#8b5cf6",
  RL: "#10b981",
};

function PremiumTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const hitRateEntry = payload.find((entry) => entry.dataKey === "hitRate");
  const evictionsEntry = payload.find((entry) => entry.dataKey === "evictions");
  const accent = policyColors[label] || "#44ddc1";

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__header" style={{ color: accent }}>
        {label}
      </div>
      {hitRateEntry ? (
        <div className="chart-tooltip__row">
          <span>Hit Rate %</span>
          <strong>{hitRateEntry.value}</strong>
        </div>
      ) : null}
      {evictionsEntry ? (
        <div className="chart-tooltip__row chart-tooltip__row--muted">
          <span>Evictions</span>
          <strong>{evictionsEntry.value}</strong>
        </div>
      ) : null}
    </div>
  );
}

export function ComparisonChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3348" vertical={false} />
        <XAxis dataKey="policy" stroke="#7d89a6" tickLine={false} axisLine={false} />
        <YAxis stroke="#7d89a6" tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "transparent" }}
          content={<PremiumTooltip />}
        />
        <Bar dataKey="hitRate" name="Hit Rate %" radius={[8, 8, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.policy} fill={policyColors[entry.policy] || "#44ddc1"} />
          ))}
        </Bar>
        <Bar dataKey="evictions" name="Evictions" fill="#40485f" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
  RL: "#44ddc1",
};

export function TimelineChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3348" vertical={false} />
        <XAxis dataKey="step" stroke="#7d89a6" tickLine={false} axisLine={false} />
        <YAxis stroke="#7d89a6" tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "rgba(34, 42, 61, 0.72)",
            border: "1px solid rgba(68, 70, 86, 0.3)",
            borderRadius: "16px",
            color: "#dae2fd",
            backdropFilter: "blur(12px)",
          }}
        />
        <Legend />
        {Object.entries(policyColors).map(([policy, color]) => (
          <Line
            key={policy}
            type="monotone"
            dataKey={policy}
            stroke={color}
            dot={false}
            strokeWidth={policy === "RL" ? 3 : 1.8}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

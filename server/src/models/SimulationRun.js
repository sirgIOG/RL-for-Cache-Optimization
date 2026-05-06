import mongoose from "mongoose";

const policyMetricsSchema = new mongoose.Schema(
  {
    hitRate: Number,
    hitCount: Number,
    missCount: Number,
    evictions: Number,
    averageLatency: Number,
    timeline: [
      {
        step: Number,
        hitRate: Number,
        hits: Number,
        misses: Number,
      },
    ],
  },
  { _id: false }
);

const simulationRunSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    workloadName: { type: String, required: true },
    cacheConfig: {
      capacity: { type: Number, required: true },
    },
    policies: {
      type: Map,
      of: policyMetricsSchema,
      default: {},
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export const SimulationRun = mongoose.model("SimulationRun", simulationRunSchema);

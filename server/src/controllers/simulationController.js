import { SimulationRun } from "../models/SimulationRun.js";
import { isDatabaseAvailable } from "../db/connect.js";
import { readRunsFromFile, writeRunToFile } from "../utils/fileStore.js";
import { loadWorkload } from "../services/workloadService.js";
import { simulatePolicies } from "../simulator/cacheSimulator.js";
import { SUPPORTED_POLICIES } from "../simulator/policies.js";
import { createSimulationJob, getSimulationJob } from "../services/simulationJobService.js";

async function executeSimulation({ runName, workloadName, capacity, policies, notes = "" }) {
  const workload = await loadWorkload(workloadName);
  const selectedPolicies = policies.filter((policy) => SUPPORTED_POLICIES.includes(policy));
  const metrics = await simulatePolicies(workload.accesses, Number(capacity), selectedPolicies);

  const payload = {
    name: runName || `${workloadName}-${Date.now()}`,
    workloadName,
    cacheConfig: { capacity: Number(capacity) },
    policies: metrics,
    notes,
  };

  return isDatabaseAvailable()
    ? await SimulationRun.create(payload)
    : await writeRunToFile(payload);
}

export async function runSimulation(req, res, next) {
  try {
    const {
      runName,
      workloadName,
      capacity = 16,
      policies = SUPPORTED_POLICIES,
      notes = "",
    } = req.body;

    const requestPayload = {
      runName: runName || `${workloadName}-${Date.now()}`,
      workloadName,
      capacity: Number(capacity),
      policies,
      notes,
    };

    const job = createSimulationJob(requestPayload, async () => executeSimulation(requestPayload));
    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
}

export async function getSimulationJobStatus(req, res, next) {
  try {
    const job = getSimulationJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ message: "Simulation job not found" });
      return;
    }

    res.json(job);
  } catch (error) {
    next(error);
  }
}

export async function getSimulationRuns(req, res, next) {
  try {
    const runs = isDatabaseAvailable()
      ? await SimulationRun.find().sort({ createdAt: -1 }).lean()
      : await readRunsFromFile();
    res.json(runs);
  } catch (error) {
    next(error);
  }
}

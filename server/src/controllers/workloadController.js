import { createWorkload, listWorkloads, loadWorkload } from "../services/workloadService.js";

export async function getWorkloads(req, res, next) {
  try {
    const workloads = await listWorkloads();
    res.json(workloads);
  } catch (error) {
    next(error);
  }
}

export async function createWorkloadHandler(req, res, next) {
  try {
    const workload = await createWorkload(req.body);
    res.status(201).json(workload);
  } catch (error) {
    next(error);
  }
}

export async function getWorkloadByName(req, res, next) {
  try {
    const workload = await loadWorkload(req.params.name);
    res.json(workload);
  } catch (error) {
    next(error);
  }
}

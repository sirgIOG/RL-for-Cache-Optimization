import { Router } from "express";
import {
  createWorkloadHandler,
  getWorkloadByName,
  getWorkloads,
} from "../controllers/workloadController.js";
import {
  getSimulationJobStatus,
  getSimulationRuns,
  runSimulation,
} from "../controllers/simulationController.js";

const router = Router();

router.get("/workloads", getWorkloads);
router.post("/workloads", createWorkloadHandler);
router.get("/workloads/:name", getWorkloadByName);

router.get("/simulations", getSimulationRuns);
router.get("/simulations/jobs/:jobId", getSimulationJobStatus);
router.post("/simulations/run", runSimulation);

export default router;

const jobs = new Map();
let nextJobId = 1;
let activeJobId = null;

function timestamp() {
  return new Date().toISOString();
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    request: job.request,
    result: job.result,
    error: job.error,
  };
}

async function processNextJob() {
  if (activeJobId !== null) {
    return;
  }

  const nextQueuedJob = [...jobs.values()].find((job) => job.status === "queued");
  if (!nextQueuedJob) {
    return;
  }

  activeJobId = nextQueuedJob.id;
  nextQueuedJob.status = "running";
  nextQueuedJob.updatedAt = timestamp();

  try {
    const result = await nextQueuedJob.worker();
    nextQueuedJob.status = "completed";
    nextQueuedJob.result = result;
    nextQueuedJob.updatedAt = timestamp();
  } catch (error) {
    nextQueuedJob.status = "failed";
    nextQueuedJob.error = error.message || "Simulation job failed";
    nextQueuedJob.updatedAt = timestamp();
  } finally {
    activeJobId = null;
    processNextJob().catch((error) => {
      console.error("Failed to process next simulation job");
      console.error(error);
    });
  }
}

export function createSimulationJob(request, worker) {
  const id = String(nextJobId++);
  const job = {
    id,
    status: "queued",
    createdAt: timestamp(),
    updatedAt: timestamp(),
    request,
    result: null,
    error: null,
    worker,
  };

  jobs.set(id, job);
  processNextJob().catch((error) => {
    console.error("Failed to start simulation queue");
    console.error(error);
  });

  return serializeJob(job);
}

export function getSimulationJob(jobId) {
  const job = jobs.get(String(jobId));
  if (!job) {
    return null;
  }

  return serializeJob(job);
}

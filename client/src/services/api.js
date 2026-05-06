const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (error) {
    throw new Error("Failed to reach the backend. Make sure the server is running on port 4000.");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(payload.message || "Request failed");
  }

  return response.json();
}

export function getWorkloads() {
  return request("/workloads");
}

export function createWorkload(payload) {
  return request("/workloads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getRuns() {
  return request("/simulations");
}

export function runSimulation(payload) {
  return request("/simulations/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSimulationJob(jobId) {
  return request(`/simulations/jobs/${jobId}`);
}

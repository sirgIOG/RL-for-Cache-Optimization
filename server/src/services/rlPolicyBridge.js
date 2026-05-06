import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "../..");

export async function resolveRlAction(state, capacity) {
  const scriptPath = path.resolve(serverRoot, "python/rl_inference_bridge.py");
  const modelPath = path.resolve(serverRoot, env.modelPath);

  return new Promise((resolve) => {
    const proc = spawn(env.pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", () => {
      if (stderr.trim()) {
        console.warn("RL bridge warning:", stderr.trim());
      }

      try {
        const parsed = JSON.parse(stdout || "{}");
        resolve(Number.isFinite(parsed.action) ? parsed.action : 0);
      } catch (error) {
        console.warn("RL bridge fallback triggered");
        resolve(0);
      }
    });

    proc.stdin.write(
      JSON.stringify({
        modelPath,
        capacity,
        state,
      })
    );
    proc.stdin.end();
  });
}

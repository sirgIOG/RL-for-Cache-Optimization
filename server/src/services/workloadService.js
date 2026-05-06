import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "../..");
const workloadDir = path.resolve(serverRoot, "uploads");

async function ensureWorkloadDir() {
  await fs.mkdir(workloadDir, { recursive: true });
}

function parseTraceText(traceText) {
  return traceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export async function listWorkloads() {
  await ensureWorkloadDir();
  const files = await fs.readdir(workloadDir);

  const workloads = await Promise.all(
    files
      .filter((file) => file.endsWith(".trace"))
      .map(async (file) => {
        const fullPath = path.join(workloadDir, file);
        const content = await fs.readFile(fullPath, "utf-8");
        const accesses = parseTraceText(content);
        return {
          name: file.replace(/\.trace$/, ""),
          accesses: accesses.length,
          uniqueAddresses: new Set(accesses).size,
        };
      })
  );

  return workloads.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkload({ name, traceText }) {
  await ensureWorkloadDir();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(workloadDir, `${safeName}.trace`);
  await fs.writeFile(filePath, traceText.trim(), "utf-8");
  const accesses = parseTraceText(traceText);
  return {
    name: safeName,
    accesses: accesses.length,
    uniqueAddresses: new Set(accesses).size,
  };
}

export async function loadWorkload(name) {
  await ensureWorkloadDir();
  const filePath = path.join(workloadDir, `${name}.trace`);
  const content = await fs.readFile(filePath, "utf-8");
  const accesses = parseTraceText(content);
  return { name, accesses, traceText: content };
}

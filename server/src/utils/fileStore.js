import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "../..");
const storageDir = path.resolve(serverRoot, "storage");
const runsFile = path.join(storageDir, "runs.json");

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
}

export async function readRunsFromFile() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(runsFile, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeRunToFile(run) {
  const runs = await readRunsFromFile();
  const enrichedRun = {
    ...run,
    _id: String(Date.now()),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  runs.unshift(enrichedRun);
  await fs.writeFile(runsFile, JSON.stringify(runs, null, 2), "utf-8");
  return enrichedRun;
}

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import router from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");

const app = express();

app.use(
  cors({
    origin: env.clientOrigin,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.resolve(serverRoot, "uploads")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api", router);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    message: error.message || "Internal server error",
  });
});

export default app;

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const env = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN,
  mongodbUri: process.env.MONGODB_URI,
  modelPath: process.env.MODEL_PATH,
  pythonBin: process.env.PYTHON_BIN,
};

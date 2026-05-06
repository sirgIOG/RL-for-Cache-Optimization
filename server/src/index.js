import app from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./db/connect.js";

async function start() {
  app.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
  });

  connectDatabase().catch((error) => {
    console.warn("Background database connection failed");
    console.warn(error.message);
  });
}

start();

import mongoose from "mongoose";
import { env } from "../config/env.js";

let dbAvailable = false;

export async function connectDatabase() {
  try {
    await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    dbAvailable = true;
    console.log("MongoDB connected");
  } catch (error) {
    dbAvailable = false;
    console.warn("MongoDB unavailable, using file persistence fallback");
    console.warn(error.message);
  }
}

export function isDatabaseAvailable() {
  return dbAvailable;
}

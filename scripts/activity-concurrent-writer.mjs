import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const database = new DatabaseSync(workerData.databasePath);
try {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000");
  parentPort.postMessage({ ready: true });
  const barrier = new Int32Array(workerData.barrier);
  Atomics.wait(barrier, 0, 0);
  try {
    database.exec(workerData.sql);
    parentPort.postMessage({ code: 0, diagnostic: "" });
  } catch (error) {
    parentPort.postMessage({ code: 1, diagnostic: error instanceof Error ? error.message : "Error de persistencia" });
  }
} finally {
  database.close();
}

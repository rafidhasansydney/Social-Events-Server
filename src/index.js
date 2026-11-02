import "dotenv/config";
import { createApp } from "./app.js";
import { ConfigurationError, readConfig } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { initializeModels } from "./models/index.js";

let server;
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  try {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectDB();
  } catch {
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  const config = readConfig();
  await connectDB(config);
  await initializeModels();
  const app = createApp({ clientUrl: config.clientUrl });
  await new Promise((resolve, reject) => {
    server = app.listen(config.port, resolve);
    server.once("error", reject);
  });
  console.log(`Server and database are ready on port ${config.port}.`);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(error.message);
  } else {
    console.error(
      "Server could not start. Check MongoDB access, database permissions and port availability.",
    );
  }
  process.exitCode = 1;
  await shutdown();
}

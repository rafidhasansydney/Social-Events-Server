import "dotenv/config";
import dns from "node:dns/promises";
import tls from "node:tls";
import { ConfigurationError, readConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";

async function checkTls(host, port) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host });
    let connected = false;
    socket.setTimeout(5000, () => socket.destroy(new Error("Connection timed out")));
    socket.once("secureConnect", () => {
      connected = true;
      socket.end();
      resolve({ ok: true });
    });
    socket.once("error", (error) => {
      if (!connected) resolve({ ok: false, code: error.code || "CONNECTION_TIMEOUT" });
    });
  });
}

try {
  const config = readConfig();
  const url = new URL(config.mongoUri);
  if (url.protocol === "mongodb+srv:") {
    const records = await dns.resolveSrv(`_mongodb._tcp.${url.hostname}`);
    console.log(`DNS: found ${records.length} database servers.`);
    if (!records.length) throw new Error("NO_DATABASE_SERVERS");
    const results = await Promise.all(records.map((record) => checkTls(record.name, record.port)));
    const failures = results.filter((result) => !result.ok);
    if (failures.length === results.length) {
      console.error("TLS: all servers rejected or could not complete the secure connection before authentication.");
      console.error(`Connection codes: ${[...new Set(failures.map((result) => result.code))].join(", ")}`);
      console.error("Check Atlas network access and the connection route. Credentials have not been verified.");
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    await connectDB(config);
    console.log("MongoDB: authentication and database ping succeeded.");
  }
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(error.message);
  } else if ([18, 8000].includes(error.code)) {
    console.error("MongoDB: authentication was rejected. Check the database username, password and permissions.");
  } else {
    console.error("MongoDB: connection check failed. Check DNS, Atlas network access and database availability.");
  }
  process.exitCode = 1;
} finally {
  await disconnectDB();
}

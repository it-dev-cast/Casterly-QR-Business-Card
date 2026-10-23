// A throwaway CardDesk for trying the interface without touching real data: an in-memory database and a
// stand-in nexusAuth with sample employees (the same one the tests use). Nothing is saved.
//
//   node scripts/sandbox.js        then open http://localhost:4310 and sign in as admin@casterly.com / admin-pass

import { newDb } from "pg-mem";
import { loadConfig } from "../server/config.js";
import { createStore } from "../server/db.js";
import { createNexusClient, createDirectory } from "../server/nexus.js";
import { createApp } from "../server/app.js";
import { startFakeNexus } from "../tests/fake-nexus.js";

const port = Number(process.env.PORT || 4310);
const nexus = await startFakeNexus();
const { Pool } = newDb().adapters.createPg();
const store = createStore(new Pool());
await store.migrate();

const config = loadConfig({
  skipEnvFile: true, port, databaseUrl: "in-memory",
  nexusUrl: nexus.url, nexusEmail: "service@casterly.com", nexusPassword: "service-pass",
});
const client = createNexusClient({ baseUrl: config.nexusUrl, email: config.nexusEmail, password: config.nexusPassword });
const directory = createDirectory(client, { ttlSeconds: config.nexusCacheSeconds });
createApp({ config, store, directory, nexus: client }).listen(port, () => {
  console.log(`CardDesk sandbox: http://localhost:${port}  (stand-in nexusAuth at ${nexus.url})`);
  console.log("Sign in as admin@casterly.com / admin-pass (admin) or ops@orbit.com / ops-pass (operator).");
});

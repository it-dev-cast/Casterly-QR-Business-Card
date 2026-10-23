import { loadConfig } from "./config.js";
import { createPool, createStore } from "./db.js";
import { createNexusClient, createDirectory } from "./nexus.js";
import { createApp, lanUrls } from "./app.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const store = createStore(createPool(config.databaseUrl, config.databaseSchema));
try {
  await store.migrate();
} catch (err) {
  console.error(`Can't use CardDesk's schema "${config.databaseSchema}" in the database: ${err.message}`);
  console.error("Run scripts/setup-database.sql once as the PostgreSQL admin (see README), then start again.");
  process.exit(1);
}

const client = createNexusClient({ baseUrl: config.nexusUrl, email: config.nexusEmail, password: config.nexusPassword });
const directory = createDirectory(client, { ttlSeconds: config.nexusCacheSeconds });

// Load employees once at start so problems with nexusAuth show up in the console straight away.
directory.list().then(
  (list) => console.log(`  nexusAuth: ${list.length} employees with a live card`),
  (err) => console.error(`  nexusAuth: ${err.message}`),
);

const app = createApp({ config, store, directory, nexus: client });
const server = app.listen(config.port, config.host, () => {
  console.log(`\nCardDesk is running`);
  console.log(`  Local:     http://localhost:${config.port}`);
  for (const url of lanUrls(config.port)) console.log(`  Network:   ${url}   (phones on the same Wi-Fi)`);
  console.log(`  Employees: nexusAuth at ${config.nexusUrl}`);
  console.log(`  Database:  schema "${config.databaseSchema}" in nexusAuth's database\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`Port ${config.port} is already in use. Set PORT in .env to use another port.`);
  else console.error(err);
  process.exit(1);
});

function shutdown() {
  server.close(() => store.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

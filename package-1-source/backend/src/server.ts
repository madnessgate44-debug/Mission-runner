import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { MissionStore } from "./store.js";

const config = loadConfig();
const store = new MissionStore(config.databaseUrl);
await store.migrate();
const app = await buildApp({ config, store });
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

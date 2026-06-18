import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = createApp();
const server = createServer(app);

server.listen(env.port, () => {
  console.log(`china-slot-api listening on ${env.port} (${env.nodeEnv})`);
});

import { app } from "./app";
import { env } from "./config/env";
import { closeDb } from "./db/utils";

const server = app.listen(env.port, () => {
  console.log(`Server listening on port ${env.port} (${env.nodeEnv})`);
});

// Stop taking requests, then close the DB pool, so Docker/Ctrl+C shut down cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      closeDb()
        .catch((err) => console.error("Error closing DB pool:", err))
        .finally(() => process.exit(0));
    });
  });
}

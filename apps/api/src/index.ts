import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { initRealtime } from "./lib/realtime.js";
import { initNotificationService } from "./services/notifications.js";
import { initPlanificateurSauvegarde } from "./services/planificateurSauvegarde.js";

const port = Number(process.env.PORT ?? 3001);

const httpServer = createServer(createApp());
initRealtime(httpServer);
initNotificationService();
initPlanificateurSauvegarde();

httpServer.listen(port, () => {
  console.log(`API Boulangerie Lomoto démarrée sur http://localhost:${port} (HTTP + Socket.io)`);
});

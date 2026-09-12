import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { initRealtime } from "./lib/realtime.js";
import { initNotificationService } from "./services/notifications.js";
import { initPlanificateurSauvegarde } from "./services/planificateurSauvegarde.js";
import { initPlanificateurAlertes } from "./services/planificateurAlertes.js";

const port = Number(process.env.PORT ?? 3001);

const httpServer = createServer(createApp());
initRealtime(httpServer);
initNotificationService();
initPlanificateurSauvegarde();
initPlanificateurAlertes();

httpServer.listen(port, () => {
  logger.info("API Boulangerie Lomoto démarrée", { url: `http://localhost:${port}`, transport: "HTTP + Socket.io" });
});

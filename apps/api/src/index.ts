import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { initRealtime } from "./lib/realtime.js";
import { initNotificationService } from "./services/notifications.js";
import { initPlanificateurSauvegarde } from "./services/planificateurSauvegarde.js";
import { initPlanificateurAlertes } from "./services/planificateurAlertes.js";
import { initPlanificateurLicence } from "./services/planificateurLicence.js";

const port = Number(process.env.PORT ?? 3001);

const httpServer = createServer(createApp());
initRealtime(httpServer);
initNotificationService();
initPlanificateurSauvegarde();
initPlanificateurAlertes();
// Démarré ici, avant même que le premier compte Administrateur puisse
// exister : le compteur d'essai de 30 jours (service central) démarre au
// premier contact réussi, pas à la fin de l'assistant de premier lancement.
initPlanificateurLicence();

httpServer.listen(port, () => {
  logger.info("API Boulangerie Lomoto démarrée", { url: `http://localhost:${port}`, transport: "HTTP + Socket.io" });
});

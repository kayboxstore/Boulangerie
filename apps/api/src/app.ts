import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { produitsRouter } from "./routes/produits.js";
import { rolesRouter } from "./routes/roles.js";
import { notificationsRouter } from "./routes/notifications.js";
import { clientsRouter, typeClientsRouter } from "./routes/clients.js";
import { commandesRouter } from "./routes/commandes.js";
import { commissionsRouter } from "./routes/commissions.js";
import { caisseRouter } from "./routes/caisse.js";
import { stocksRouter } from "./routes/stocks.js";
import { productionRouter } from "./routes/production.js";
import { fournisseursRouter } from "./routes/fournisseurs.js";
import { equipeRouter } from "./routes/equipe.js";
import { travailleursRouter } from "./routes/travailleurs.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "Boulangerie Lomoto API" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/produits", produitsRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/type-clients", typeClientsRouter);
  app.use("/api/commandes", commandesRouter);
  app.use("/api/commissions", commissionsRouter);
  app.use("/api/caisse", caisseRouter);
  app.use("/api/stocks", stocksRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/fournisseurs", fournisseursRouter);
  app.use("/api/equipe", equipeRouter);
  app.use("/api/travailleurs", travailleursRouter);

  // Gestion d'erreurs centralisée
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ erreur: "Erreur interne du serveur" });
  });

  return app;
}

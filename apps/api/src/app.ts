import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMAINE_A_REDIRIGER, DOMAINE_CANONIQUE, verifierOrigine } from "./lib/origines.js";
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
import { rapportsRouter } from "./routes/rapports.js";
import { rapportsPersonnelsRouter } from "./routes/rapports-personnels.js";
import { parametresRouter } from "./routes/parametres.js";
import { approbationsRouter } from "./routes/approbations.js";
import { delegationsRouter } from "./routes/delegations.js";
import { etatSystemeRouter } from "./routes/etat-systeme.js";
import { auditRouter } from "./routes/audit.js";
import { exportRouter } from "./routes/export.js";
import { assistantRouter } from "./routes/assistant.js";
import { premierLancementRouter } from "./routes/premierLancement.js";

export function createApp() {
  const app = express();

  // Render (et tout hébergeur derrière un reverse proxy) transmet la requête
  // en interne ; sans ceci, req.hostname/req.protocol refléteraient le proxy,
  // pas le domaine réellement visité par le navigateur.
  app.set("trust proxy", true);

  // Domaine canonique = www.boulangerie-lomoto.com (voir le commentaire dans
  // lib/origines.ts sur pourquoi c'est www et pas l'apex) : l'apex redirige
  // vers www, pour n'avoir qu'UNE seule adresse qui compte plutôt que deux qui
  // fonctionnent en parallèle. Placé avant toute autre route pour s'appliquer
  // aussi à /api et /socket.io.
  app.use((req, res, next) => {
    if (req.hostname === DOMAINE_A_REDIRIGER) {
      return res.redirect(301, `https://${DOMAINE_CANONIQUE}${req.originalUrl}`);
    }
    next();
  });

  app.use(cors({ origin: verifierOrigine, credentials: true }));
  // 5 Mo plutôt que le défaut 100 Ko : l'Assistant (3.19) stocke les captures
  // d'écran en base64 directement dans le corps JSON (pas d'upload fichier).
  app.use(express.json({ limit: "5mb" }));

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
  app.use("/api/rapports", rapportsRouter);
  app.use("/api/rapports-personnels", rapportsPersonnelsRouter);
  app.use("/api/parametres", parametresRouter);
  app.use("/api/approbations", approbationsRouter);
  app.use("/api/delegations", delegationsRouter);
  app.use("/api/etat-systeme", etatSystemeRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/assistant", assistantRouter);
  // Public par nécessité (section 3.7) : chaque route revérifie elle-même que
  // la base est encore vide, voir routes/premierLancement.ts.
  app.use("/api/premier-lancement", premierLancementRouter);

  // --- Frontend compilé (production / déploiement) --------------------------
  // En dev, le frontend est servi par Vite (avec proxy vers cette API). En
  // production, il n'y a plus de proxy : l'API sert elle-même le build statique
  // du frontend. Tout est alors sur la MÊME origine, donc les appels relatifs
  // (/api, /socket.io) fonctionnent sans configuration ni CORS, et l'app est
  // déployable comme un service unique. Chemin surchargable via WEB_DIST.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST ?? path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist));
    // Repli SPA : toute route hors /api renvoie index.html (React Router gère
    // ensuite côté client). Les requêtes /api inconnues tombent dans le 404 JSON.
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  // 404 JSON pour les routes /api non trouvées.
  app.use("/api", (_req, res) => {
    res.status(404).json({ erreur: "Ressource introuvable" });
  });

  // Gestion d'erreurs centralisée
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ erreur: "Erreur interne du serveur" });
  });

  return app;
}

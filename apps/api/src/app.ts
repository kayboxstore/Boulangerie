import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { verifierOrigine } from "./lib/origines.js";
import { gardeBarriereEcriture, marquerRequeteReinitialisation } from "./lib/barriereEcriture.js";
import { logger } from "./lib/logger.js";
import { authRouter } from "./routes/auth.js";
import { produitsRouter } from "./routes/produits.js";
import { rolesRouter } from "./routes/roles.js";
import { notificationsRouter } from "./routes/notifications.js";
import { clientsRouter, typeClientsRouter } from "./routes/clients.js";
import { zonesDepositaireRouter } from "./routes/zones-depositaires.js";
import { commandesRouter } from "./routes/commandes.js";
import {
  demandesCommandePubliquesPubliqueRouter,
  demandesCommandePubliquesRouter,
} from "./routes/demandesCommandePubliques.js";
import { commissionsRouter } from "./routes/commissions.js";
import { caisseRouter } from "./routes/caisse.js";
import { stocksRouter } from "./routes/stocks.js";
import { productionRouter } from "./routes/production.js";
import { cyclesLivraisonRouter } from "./routes/cycles-livraison.js";
import { fournisseursRouter } from "./routes/fournisseurs.js";
import { equipeRouter } from "./routes/equipe.js";
import { travailleursRouter } from "./routes/travailleurs.js";
import { departementsRouter, groupesRouter } from "./routes/departements.js";
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
import { aProposRouter } from "./routes/apropos.js";

export function createApp() {
  const app = express();

  // Render (et tout hébergeur derrière un reverse proxy) transmet la requête
  // en interne ; sans ceci, req.hostname/req.protocol refléteraient le proxy,
  // pas le domaine réellement visité par le navigateur.
  const hopsProxy = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === "production" ? "1" : "0"), 10);
  app.set("trust proxy", Number.isInteger(hopsProxy) && hopsProxy > 0 ? hopsProxy : false);

  // Identifiant de corrélation généré par le serveur. Il est renvoyé au client
  // et inclus dans les erreurs, afin de retrouver précisément la requête dans
  // les journaux sans exposer de détail technique.
  app.use((_req, res, next) => {
    const idRequete = randomUUID();
    res.locals.idRequete = idRequete;
    res.setHeader("X-Request-Id", idRequete);
    next();
  });

  // Pas de redirection de domaine ici : depuis la migration vers un site
  // vitrine public sur l'apex/www de boulangerie-lomoto.com, cette app ne
  // possède plus qu'un seul domaine (gestion.boulangerie-lomoto.com, voir
  // lib/origines.ts) — rien à rediriger vers autre chose. L'ancienne logique
  // apex→www (pertinente quand cette app possédait encore l'apex) a été
  // retirée avec ce changement.

  app.use(helmet());
  app.use(cors({ origin: verifierOrigine, credentials: true }));
  // 5 Mo plutôt que le défaut 100 Ko : l'Assistant (3.19) stocke les captures
  // d'écran en base64 directement dans le corps JSON (pas d'upload fichier).
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "Boulangerie Lomoto API" });
  });

  // Le marqueur utilise le VRAI routeur Express avant la barrière : les
  // variantes que la route accepte réellement (casse/barre finale selon la
  // configuration Express) sont reconnues de la même façon, sans comparaison
  // artisanale de req.path. La barrière reste prioritaire si elle est déjà
  // active ; le marqueur évite seulement que la requête initiatrice se compte
  // elle-même puis attende sa propre fin.
  app.post("/api/etat-systeme/reinitialiser", marquerRequeteReinitialisation);

  // Barrière d'écriture (P0, section 3.15) : bloque toute requête (sauf le
  // health check ci-dessus) pendant la fenêtre dump→effacement d'une
  // réinitialisation de base, pour que la sauvegarde de sûreté et l'état
  // effacé juste après représentent la même frontière logique. Voir
  // lib/barriereEcriture.ts pour le détail du mécanisme et sa limite
  // mono-instance.
  app.use(gardeBarriereEcriture);

  const reponseLimitee = (_req: express.Request, res: express.Response) =>
    res.status(429).json({
      erreur: "Trop de tentatives. Patientez quelques minutes avant de réessayer.",
      code: "TROP_DE_REQUETES",
      idRequete: res.locals.idRequete,
    });

  // Les limites sont ciblées sur les routes publiques qui déclenchent le plus
  // de travail ou qui pourraient servir à une attaque par force brute. Les
  // routes métier authentifiées gardent leurs propres permissions.
  app.use(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: reponseLimitee,
    }),
  );
  app.use(
    "/api/auth/mot-de-passe-oublie",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: reponseLimitee,
    }),
  );
  app.use(
    ["/api/auth/reinitialisation", "/api/auth/reinitialisation/verifier"],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: reponseLimitee,
    }),
  );
  app.use(
    ["/api/auth/etat-initial", "/api/auth/langue-defaut", "/api/premier-lancement"],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: reponseLimitee,
    }),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/produits", produitsRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/type-clients", typeClientsRouter);
  app.use("/api/zones-depositaires", zonesDepositaireRouter);
  // /api/public/* : CORS dédié, plus permissif que le reste de l'API — ces
  // routes sont FAITES pour être appelées depuis un autre domaine (le site
  // vitrine, pas encore sur un nom de domaine figé pendant son
  // développement). Jamais `credentials: true` ici (pas de cookie/session
  // sur ces routes, et un navigateur refuse de toute façon cette combinaison
  // avec une origine ouverte) — contrairement au CORS global juste au-dessus,
  // qui reste strict et sert l'app de gestion authentifiée.
  app.use("/api/public", cors());
  // Chemin dédié /api/public/* : sépare visuellement, dans ce fichier, les
  // routes PUBLIQUES (sans authentification) du reste — utile pour repérer
  // d'un coup d'œil toute nouvelle route accidentellement non protégée.
  app.use(
    "/api/public/demandes-commande",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: reponseLimitee,
    }),
    demandesCommandePubliquesPubliqueRouter,
  );
  app.use("/api/demandes-commande-publiques", demandesCommandePubliquesRouter);
  app.use("/api/commandes", commandesRouter);
  app.use("/api/commissions", commissionsRouter);
  app.use("/api/caisse", caisseRouter);
  app.use("/api/stocks", stocksRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/production", cyclesLivraisonRouter);
  app.use("/api/fournisseurs", fournisseursRouter);
  app.use("/api/equipe", equipeRouter);
  app.use("/api/travailleurs", travailleursRouter);
  app.use("/api/departements", departementsRouter);
  app.use("/api/groupes", groupesRouter);
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
  app.use("/api/apropos", aProposRouter);

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
    res.status(404).json({
      erreur: "Ressource introuvable",
      code: "RESSOURCE_INTROUVABLE",
      idRequete: res.locals.idRequete,
    });
  });

  // Gestion d'erreurs centralisée
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("Erreur non gérée", {
      erreur: err,
      methode: req.method,
      chemin: req.path,
      idRequete: res.locals.idRequete,
    });
    res.status(500).json({
      erreur: "Erreur interne du serveur",
      code: "ERREUR_INTERNE",
      idRequete: res.locals.idRequete,
    });
  });

  return app;
}

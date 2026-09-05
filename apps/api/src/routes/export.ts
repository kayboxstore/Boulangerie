import { Router } from "express";
import { aAcces, documentExportSchema, envoiEmailSchema, MODULE_LABELS, type Module } from "@lomoto/shared";
import { requireAuth } from "../middleware/auth.js";
import { construirePdf, nomFichierPdf } from "../services/pdf.js";
import { emailConfigure, ErreurEmail, envoyerRapport } from "../services/email.js";
import type { Request, Response } from "express";

export const exportRouter = Router();

exportRouter.use(requireAuth);

/**
 * Le document est composé par l'écran (mêmes sections que l'export CSV), mais
 * les modules dont il tire ses données sont déclarés et VÉRIFIÉS ici : un
 * utilisateur sans lecture sur Commissions ne peut pas en demander l'export,
 * même en forgeant la requête à la main.
 */
function moduleInterdit(req: Request, modules: Module[]): Module | null {
  const permissions = req.utilisateur?.role.permissions ?? [];
  return modules.find((m) => !aAcces(permissions, m, "LECTURE")) ?? null;
}

const refuser = (res: Response, module: Module) =>
  res.status(403).json({
    erreur: `Accès refusé : lecture requise sur le module ${MODULE_LABELS[module]} pour exporter ces données`,
  });

/** Indique au frontend si le bouton « Envoyer par email » peut être proposé. */
exportRouter.get("/capacites", (_req, res) => {
  res.json({ email: emailConfigure() });
});

// --- Téléchargement PDF -----------------------------------------------------

exportRouter.post("/pdf", async (req, res, next) => {
  try {
    const parsed = documentExportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const interdit = moduleInterdit(req, parsed.data.modules);
    if (interdit) return refuser(res, interdit);

    const pdf = await construirePdf(parsed.data, req.utilisateur!.nom);
    const nom = nomFichierPdf(parsed.data.titre);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nom}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } catch (e) {
    next(e);
  }
});

// --- Envoi par email (même génération PDF, pas de logique dupliquée) --------

exportRouter.post("/email", async (req, res, next) => {
  try {
    const parsed = envoiEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { destinataire, message, ...document } = parsed.data;

    const interdit = moduleInterdit(req, document.modules);
    if (interdit) return refuser(res, interdit);

    const pdf = await construirePdf(document, req.utilisateur!.nom);
    await envoyerRapport({
      destinataire,
      sujet: document.titre,
      message,
      nomFichier: nomFichierPdf(document.titre),
      pdf,
      auteurNom: req.utilisateur!.nom,
    });

    res.json({ envoye: true, destinataire });
  } catch (e) {
    if (e instanceof ErreurEmail) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});

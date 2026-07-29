import { MODULE_LABELS, ROLE_ADMINISTRATEUR, ROLE_DIRECTEUR_GENERAL, type Module } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { busEvenements } from "../lib/events.js";

/**
 * Périmètre d'origine de l'Administrateur (section 2). Activation, État système
 * et Approbations sont gardés par le module EQUIPE : écrire dans ces modules ne
 * constitue donc pas une intervention hors périmètre.
 */
const PERIMETRE_ADMIN: Module[] = ["PARAMETRES", "EQUIPE"];

export const estHorsPerimetreAdmin = (module: Module) => !PERIMETRE_ADMIN.includes(module);

/**
 * Garde-fou de la section 2 : quand l'Admin Principal — super utilisateur —
 * ÉCRIT dans un module métier qui n'est pas le sien à l'origine, le rôle
 * propriétaire de ce module et le DG en sont avertis en temps réel. Le pouvoir
 * total reste possible, mais jamais discret ; cela s'ajoute à la trace
 * automatique au Journal d'audit (3.17).
 *
 * Le rôle propriétaire est déduit de la matrice (rôles ayant l'ÉCRITURE sur ce
 * module, Administrateur exclu) plutôt que codé en dur : ajouter un rôle reste
 * sans effet sur ce code.
 */
export async function notifierInterventionAdmin(params: {
  module: Module;
  auteurId: string;
  auteurNom: string;
  methode: string;
  chemin: string;
}): Promise<void> {
  const { module, auteurId, auteurNom, methode, chemin } = params;

  const rolesProprietaires = await prisma.rolePermission.findMany({
    where: { module, niveauAcces: "ECRITURE", role: { nom: { not: ROLE_ADMINISTRATEUR } } },
    select: { roleId: true },
  });

  const destinataires = await prisma.utilisateur.findMany({
    where: {
      actif: true,
      id: { not: auteurId },
      OR: [
        { roleId: { in: rolesProprietaires.map((r) => r.roleId) } },
        { role: { nom: ROLE_DIRECTEUR_GENERAL } },
      ],
    },
    select: { id: true },
  });
  if (destinataires.length === 0) return;

  busEvenements.emettreEvenement({
    type: "INTERVENTION_ADMIN",
    module,
    emetteurId: auteurId,
    priorite: "HAUTE",
    destinataireIdsDirects: destinataires.map((d) => d.id),
    message: `⚠ Intervention de l'Administrateur principal ${auteurNom} sur ${MODULE_LABELS[module]} — écriture hors de son périmètre habituel (détail au Journal d'audit)`,
    donnees: { module, methode, chemin, auteurId },
  });
}

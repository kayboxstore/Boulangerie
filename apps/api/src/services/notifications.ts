import type { Module, NotificationDTO, TypeEvenement } from "@lomoto/shared";
import { MODULE_LABELS } from "@lomoto/shared";
import type { Notification, Utilisateur } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getIo, roomUtilisateur } from "../lib/realtime.js";
import { busEvenements, type EvenementMetier } from "../lib/events.js";
import { logger } from "../lib/logger.js";

/**
 * Détermine les rôles destinataires d'un événement (section 2 + 3.10) :
 *
 *  - tous les rôles ayant au moins LECTURE sur le module de l'événement — la
 *    matrice encode déjà la règle « un supérieur lit le périmètre de son
 *    subordonné », les exceptions explicites (Caissier(ère) → Production,
 *    Commissions) et le DG (lecture partout) ;
 *  - union avec le supérieur hiérarchique direct de l'émetteur (filet de
 *    sécurité si la matrice d'un futur rôle était incomplète) ;
 *  - l'Administrateur, hors hiérarchie opérationnelle, n'a aucune permission
 *    sur les modules métier et ne reçoit donc pas les notifications.
 *
 * L'émetteur est toujours exclu (il n'a pas besoin d'être notifié de sa
 * propre action).
 */
async function rolesDestinataires(module: Module, emetteurRoleId: string): Promise<Set<string>> {
  const roleIds = new Set<string>();

  const permissions = await prisma.rolePermission.findMany({
    where: { module, niveauAcces: { in: ["LECTURE", "ECRITURE"] } },
    select: { roleId: true },
  });
  for (const p of permissions) roleIds.add(p.roleId);

  const roleEmetteur = await prisma.role.findUnique({
    where: { id: emetteurRoleId },
    select: { roleParentId: true },
  });
  if (roleEmetteur?.roleParentId) roleIds.add(roleEmetteur.roleParentId);

  return roleIds;
}

/**
 * Destinataires d'un événement SYSTÈME : tous les rôles ayant au moins la
 * lecture sur le module (pas de hiérarchie à remonter, faute d'émetteur).
 */
async function rolesAvecLecture(module: Module): Promise<Set<string>> {
  const permissions = await prisma.rolePermission.findMany({
    where: { module, niveauAcces: { in: ["LECTURE", "ECRITURE"] } },
    select: { roleId: true },
  });
  return new Set(permissions.map((p) => p.roleId));
}

function versDTO(n: Notification, emetteur: (Utilisateur & { role: { nom: string } }) | null): NotificationDTO {
  return {
    id: n.id,
    type: n.type as TypeEvenement,
    module: n.module as Module,
    message: n.message,
    evenementRef: n.evenementRef,
    donnees: n.donnees,
    priorite: n.priorite,
    lu: n.lu,
    dateCreation: n.dateCreation.toISOString(),
    emetteur: emetteur ? { id: emetteur.id, nom: emetteur.nom, roleNom: emetteur.role.nom } : null,
  };
}

/**
 * Persiste une notification par destinataire puis la pousse en temps réel
 * dans la room user:{id} de chacun. Retourne les DTO créés.
 */
export async function publierEvenement(evenement: EvenementMetier): Promise<NotificationDTO[]> {
  // Événement SYSTÈME : aucun émetteur humain (ex. alerte de dette non payée).
  // Personne n'est alors exclu des destinataires.
  const emetteur = evenement.emetteurId
    ? await prisma.utilisateur.findUnique({
        where: { id: evenement.emetteurId },
        include: { role: { select: { id: true, nom: true } } },
      })
    : null;
  if (evenement.emetteurId && !emetteur) return [];

  // Ciblage direct (ex. approbation → Admin Principal) : court-circuite la
  // matrice. Sinon, destinataires déduits de la matrice + hiérarchie.
  const rolesCibles = emetteur
    ? await rolesDestinataires(evenement.module, emetteur.role.id)
    : await rolesAvecLecture(evenement.module);
  const destinataires = evenement.destinataireIdsDirects
    ? await prisma.utilisateur.findMany({
        where: {
          id: { in: evenement.destinataireIdsDirects, ...(emetteur ? { not: emetteur.id } : {}) },
          actif: true,
        },
        select: { id: true },
      })
    : await prisma.utilisateur.findMany({
        where: {
          roleId: { in: [...rolesCibles] },
          actif: true,
          ...(emetteur ? { id: { not: emetteur.id } } : {}),
          ...(evenement.restreindreAuxRoles
            ? { role: { nom: { in: evenement.restreindreAuxRoles } } }
            : {}),
        },
        select: { id: true },
      });
  if (destinataires.length === 0) return [];

  const message =
    evenement.message ??
    (emetteur
      ? `${emetteur.nom} (${emetteur.role.nom}) — événement ${evenement.type} sur ${MODULE_LABELS[evenement.module]}`
      : `Événement ${evenement.type} sur ${MODULE_LABELS[evenement.module]}`);

  const io = getIo();
  const dtos: NotificationDTO[] = [];
  for (const d of destinataires) {
    const notification = await prisma.notification.create({
      data: {
        destinataireId: d.id,
        emetteurId: emetteur?.id ?? null,
        type: evenement.type,
        module: evenement.module,
        evenementRef: evenement.evenementRef ?? null,
        message,
        donnees: evenement.donnees === undefined ? undefined : (evenement.donnees as object),
        priorite: evenement.priorite ?? "NORMALE",
      },
    });
    const dto = versDTO(notification, emetteur);
    dtos.push(dto);
    io.to(roomUtilisateur(d.id)).emit("notification", dto);
  }
  return dtos;
}

/** Branche le service sur le bus d'événements interne (appelé au démarrage). */
export function initNotificationService() {
  busEvenements.surEvenement((evenement) => {
    publierEvenement(evenement).catch((e) => logger.error("Échec de publication de notification", { erreur: e }));
  });
}

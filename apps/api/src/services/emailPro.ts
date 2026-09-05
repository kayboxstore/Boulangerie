import type { Travailleur } from "@prisma/client";
import type { StatutEmailPro } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { APEX } from "../lib/origines.js";
import { creerOuObtenirDestination, creerRegleRoutage, ErreurCloudflare, obtenirDestination } from "../lib/cloudflareEmail.js";

/**
 * Adresse email professionnelle (section 3.18) — logique partagée entre la
 * fiche Travailleur (routes/travailleurs.ts, authentifié) et l'Assistant de
 * premier lancement (routes/premierLancement.ts, public mais gardé par « base
 * encore vide ») : un seul mécanisme, deux points d'entrée.
 */

/** Retire les accents/diacritiques et ne garde que [a-z0-9]. */
function normaliserPourEmail(segment: string): string {
  return segment
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** prenom.nom — premier mot du nom complet = prénom, le reste = nom de famille. */
function baseAdresseDepuisNom(nomComplet: string): string {
  const mots = nomComplet.trim().split(/\s+/);
  const prenom = normaliserPourEmail(mots[0] ?? "");
  const nom = normaliserPourEmail(mots.slice(1).join(""));
  if (prenom && nom) return `${prenom}.${nom}`;
  return prenom || nom || "employe";
}

/** Ajoute un suffixe numérique (2, 3…) si l'adresse de base est déjà prise par un AUTRE travailleur — collision de prénom+nom. */
export async function genererAdresseProUnique(nomComplet: string, ignorerTravailleurId: string): Promise<string> {
  const base = baseAdresseDepuisNom(nomComplet);
  for (let suffixe = 1; ; suffixe++) {
    const local = suffixe === 1 ? base : `${base}${suffixe}`;
    const adresse = `${local}@${APEX}`;
    const existant = await prisma.travailleur.findUnique({ where: { emailProAdresse: adresse } });
    if (!existant || existant.id === ignorerTravailleurId) return adresse;
  }
}

const messageErreurCloudflare = (e: unknown): string =>
  e instanceof ErreurCloudflare ? e.message : e instanceof Error ? e.message : "Erreur inconnue";

/**
 * Déclenche la création : adresse de destination Cloudflare (envoie l'email
 * de vérification à l'employé) + adresse pro générée (avec suffixe en cas de
 * collision). La règle de routage n'est créée immédiatement que si la
 * destination est DÉJÀ vérifiée (rare à ce stade) — sinon `verifierEmailPro`
 * la complète une fois l'employé passé par le lien reçu.
 */
export async function declencherEmailPro(travailleur: Travailleur, emailDestination: string): Promise<Travailleur> {
  const emailProAdresse = travailleur.emailProAdresse ?? (await genererAdresseProUnique(travailleur.nom, travailleur.id));

  try {
    const destination = await creerOuObtenirDestination(emailDestination);
    let statut: StatutEmailPro = "EN_ATTENTE_VERIFICATION";
    let cloudflareRegleId = travailleur.cloudflareRegleId;
    let erreur: string | null = null;

    // Destination déjà vérifiée (ex. réutilisée d'une fiche précédente) :
    // la règle peut être posée tout de suite, pas besoin d'attendre.
    if (destination.verified) {
      try {
        const regle = await creerRegleRoutage(emailProAdresse, emailDestination);
        cloudflareRegleId = regle.id;
        statut = "ACTIF";
      } catch (e) {
        statut = "ECHEC";
        erreur = messageErreurCloudflare(e);
      }
    }

    return prisma.travailleur.update({
      where: { id: travailleur.id },
      data: {
        emailDestination,
        emailProAdresse,
        emailProStatut: statut,
        emailProErreur: erreur,
        cloudflareAdresseId: destination.id,
        cloudflareRegleId,
      },
    });
  } catch (e) {
    // Échec de l'appel Cloudflare lui-même (jeton invalide, compte/zone
    // incorrects, adresse refusée…) — jamais silencieux : le motif exact
    // remonte jusqu'à la fiche pour que l'Admin puisse agir.
    return prisma.travailleur.update({
      where: { id: travailleur.id },
      data: { emailDestination, emailProAdresse, emailProStatut: "ECHEC", emailProErreur: messageErreurCloudflare(e) },
    });
  }
}

export interface ResultatVerification {
  travailleur: Travailleur;
  erreur?: string;
  status?: number;
}

/**
 * Re-vérifie l'état côté Cloudflare (asynchrone : dépend du clic de l'employé
 * sur le lien reçu, hors du contrôle de l'app) et pose la règle de routage
 * dès que la destination est vérifiée.
 */
export async function verifierEmailPro(travailleur: Travailleur): Promise<ResultatVerification> {
  if (travailleur.emailProStatut === "AUCUNE") {
    return { travailleur, erreur: "Aucune adresse professionnelle n'a encore été demandée pour ce travailleur.", status: 400 };
  }
  if (travailleur.emailProStatut === "ACTIF") {
    return { travailleur };
  }
  if (!travailleur.cloudflareAdresseId || !travailleur.emailProAdresse || !travailleur.emailDestination) {
    return { travailleur, erreur: "État incomplet pour la vérification — relancez la création de l'adresse pro.", status: 409 };
  }

  try {
    const destination = await obtenirDestination(travailleur.cloudflareAdresseId);
    if (!destination.verified) {
      // Toujours en attente : rien à faire, l'employé n'a pas encore cliqué
      // le lien — l'appelant réessaiera plus tard (bouton ou actualisation automatique).
      return { travailleur };
    }

    const regle = await creerRegleRoutage(travailleur.emailProAdresse, travailleur.emailDestination);
    const maj = await prisma.travailleur.update({
      where: { id: travailleur.id },
      data: { emailProStatut: "ACTIF", cloudflareRegleId: regle.id, emailProErreur: null },
    });
    return { travailleur: maj };
  } catch (e) {
    const maj = await prisma.travailleur.update({
      where: { id: travailleur.id },
      data: { emailProStatut: "ECHEC", emailProErreur: messageErreurCloudflare(e) },
    });
    return { travailleur: maj };
  }
}

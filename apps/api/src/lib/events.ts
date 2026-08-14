import { EventEmitter } from "node:events";
import type { Module, PrioriteNotification, TypeEvenement } from "@lomoto/shared";
import type { TypeEvenementCycleLivraison } from "@lomoto/shared/cycles-livraison";

/**
 * Bus d'événements interne (note technique, section 7 de la spec) : les modules
 * métier émettent ici sans connaître Socket.io ; le NotificationService écoute
 * et se charge de la persistance + diffusion temps réel.
 */
export interface EvenementMetier {
  type: TypeEvenement | TypeEvenementCycleLivraison;
  module: Module;
  /**
   * Auteur humain de l'action. `null` = événement SYSTÈME (ex. alerte de dette
   * non payée, 3.4) : personne ne l'a déclenché, donc aucun destinataire n'est
   * exclu et les destinataires sont déduits de la seule matrice de permissions.
   */
  emetteurId: string | null;
  message?: string;
  evenementRef?: string;
  donnees?: unknown;
  /** HAUTE = alerte visuellement distincte (ex. transaction inhabituelle). */
  priorite?: PrioriteNotification;
  /**
   * Si présent, limite les destinataires aux titulaires de ces rôles (parmi
   * les destinataires calculés par la matrice). Ex. : alerte transaction
   * inhabituelle dédiée au DG (spec 3.10).
   */
  restreindreAuxRoles?: string[];
  /**
   * Si présent, IGNORE la matrice et cible directement ces utilisateurs. Ex. :
   * une demande d'approbation notifiée à l'Admin Principal (spec 3.16).
   */
  destinataireIdsDirects?: string[];
}

class BusEvenements extends EventEmitter {
  emettreEvenement(evenement: EvenementMetier) {
    this.emit("evenement", evenement);
  }
  surEvenement(handler: (evenement: EvenementMetier) => void) {
    this.on("evenement", handler);
  }
}

export const busEvenements = new BusEvenements();

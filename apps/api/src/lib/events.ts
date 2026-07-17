import { EventEmitter } from "node:events";
import type { Module, PrioriteNotification, TypeEvenement } from "@lomoto/shared";

/**
 * Bus d'événements interne (note technique, section 7 de la spec) : les modules
 * métier émettent ici sans connaître Socket.io ; le NotificationService écoute
 * et se charge de la persistance + diffusion temps réel.
 */
export interface EvenementMetier {
  type: TypeEvenement;
  module: Module;
  emetteurId: string;
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

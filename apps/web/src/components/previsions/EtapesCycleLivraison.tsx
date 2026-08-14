import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  cleDescriptionStatutCycle,
  cleLibelleStatutCycle,
  RESULTATS_CYCLE_LIVRAISON,
  STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON,
  STATUTS_FINAUX_CYCLE_LIVRAISON,
  varianteBadgeStatutCycle,
  type ResultatCycleLivraison,
  type StatutCycleLivraison,
  type VarianteBadgeStatutCycle,
} from "./cycleLivraisonLogique";

/**
 * Légende visuelle du cycle « prévision J → livraison J+1 » (F4 round 1,
 * corrigée round 2, restructurée round 3, complétée round 4, connectée à C4
 * en I4). Purement présentationnel : aucun appel réseau ici — c'est l'écran
 * appelant (ex. `BonsLivraison`) qui charge les cycles réels et peut passer
 * un `statutActif` réel via `CycleLivraisonDTO.statut`.
 *
 * Structure en QUATRE blocs, jamais mélangés :
 * 1. `chronologie` : liste ORDONNÉE des sept statuts C4 séquentiels, de
 *    `PREVISION` à `EN_ATTENTE_CONFIRMATION` (flèches entre étapes
 *    consécutives). S'arrête là : le dépôt chez le client est l'action qui
 *    fait passer `EN_TOURNEE` → `EN_ATTENTE_CONFIRMATION`, il n'existe aucun
 *    statut serveur « déposé ».
 * 2. `statuts finaux` (round 4) : groupe NON chronologique et mutuellement
 *    exclusif (`PARTIELLEMENT_ACCEPTEE`, `ACCEPTEE`, `RETOUR_TOTAL`,
 *    `ANNULEE`) — un cycle se termine dans un seul de ces statuts, jamais
 *    une suite des quatre ; aucune flèche entre eux ; jamais confondu avec
 *    le groupe de résultats (quantités) ci-dessous.
 * 3. `résultats` : groupe PARALLÈLE (accepté, retourné, manquant) — trois
 *    quantités DISTINCTES de la livraison, présentées en parallèle (pas
 *    indépendantes : bornées par des règles exactes, voir
 *    `cycleLivraisonLogique.ts`), JAMAIS reliées entre elles par une flèche.
 * 4. `conséquence` : la SEULE relation directionnelle du groupe final,
 *    accepté → facturable — présentée séparément du groupe de résultats.
 *
 * `statutActif`, optionnel, accepte l'un des ONZE statuts C4 (chronologie OU
 * final) et marque le badge correspondant avec `aria-current="step"` —
 * réservé à un écran qui connaît RÉELLEMENT le statut en cours pour un cycle
 * donné à partir d'une donnée serveur (`CycleLivraisonDTO.statut`). Ne
 * jamais le renseigner avec une valeur fixe/devinée : afficher un statut
 * actif sans donnée serveur laisserait croire à un suivi qui n'existe pas.
 * Cette légende reste volontairement générique (pas de `statutActif`) sur un
 * écran qui liste PLUSIEURS cycles à la fois, chacun dans un statut
 * potentiellement différent — le statut réel de chaque cycle s'affiche alors
 * à côté de sa propre ligne, pas dans cette légende partagée.
 */
export interface EtapesCycleLivraisonProps {
  statutActif?: StatutCycleLivraison;
  className?: string;
}

const VARIANTE_PAR_RESULTAT: Record<ResultatCycleLivraison, "secondary" | "destructive"> = {
  accepte: "secondary",
  retourne: "destructive",
  manquant: "destructive",
};

/** Badge + description accessible (aria-describedby, jamais title seul — round 2). Réutilisé hors de ce fichier (ex. BonsLivraison) pour tout badge de statut C4 réel. */
export function BadgeDecrit({
  id,
  variante,
  actif,
  texte,
  description,
}: {
  id: string;
  variante: VarianteBadgeStatutCycle;
  actif?: boolean;
  texte: string;
  description: string;
}) {
  return (
    <>
      <Badge
        variant={variante}
        aria-current={actif ? "step" : undefined}
        aria-describedby={id}
        title={description}
        className={cn(actif && "ring-2 ring-or ring-offset-1 ring-offset-background")}
      >
        {texte}
      </Badge>
      <span id={id} className="sr-only">
        {description}
      </span>
    </>
  );
}

export function EtapesCycleLivraison({ statutActif, className }: EtapesCycleLivraisonProps) {
  const { t } = useTranslation();
  const idBase = useId();

  return (
    <div className={cn("space-y-3", className)}>
      <ol aria-label={t("previsions.chronologieLegende")} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.map((statut, index) => (
          <li key={statut} className="flex items-center gap-1.5">
            <BadgeDecrit
              id={`${idBase}-chrono-${statut}`}
              variante={varianteBadgeStatutCycle(statut)}
              actif={statut === statutActif}
              texte={t(cleLibelleStatutCycle(statut))}
              description={t(cleDescriptionStatutCycle(statut))}
            />
            {index < STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.length - 1 && (
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      <div>
        <p id={`${idBase}-finaux-titre`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("previsions.statutsFinauxTitre")}
        </p>
        {/* Groupe NON chronologique et mutuellement exclusif (round 4) : un
            cycle se termine dans UN seul de ces statuts, jamais reliés entre
            eux par une flèche, jamais confondus avec les quantités ci-dessous. */}
        <ul aria-labelledby={`${idBase}-finaux-titre`} className="flex flex-wrap items-center gap-1.5">
          {STATUTS_FINAUX_CYCLE_LIVRAISON.map((statut) => (
            <li key={statut}>
              <BadgeDecrit
                id={`${idBase}-final-${statut}`}
                variante={varianteBadgeStatutCycle(statut)}
                actif={statut === statutActif}
                texte={t(cleLibelleStatutCycle(statut))}
                description={t(cleDescriptionStatutCycle(statut))}
              />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p id={`${idBase}-resultats-titre`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("previsions.resultatsTitre")}
        </p>
        {/* Groupe PARALLÈLE (round 3) : aucune flèche entre ces trois éléments —
            ce ne sont pas des étapes d'une même suite. */}
        <ul aria-labelledby={`${idBase}-resultats-titre`} className="flex flex-wrap items-center gap-1.5">
          {RESULTATS_CYCLE_LIVRAISON.map((resultat) => (
            <li key={resultat}>
              <BadgeDecrit
                id={`${idBase}-resultat-${resultat}`}
                variante={VARIANTE_PAR_RESULTAT[resultat]}
                texte={t(`previsions.resultats.${resultat}.label`)}
                description={t(`previsions.resultats.${resultat}.description`)}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Conséquence (round 3) : SEULE relation directionnelle du groupe final,
          présentée séparément du groupe de résultats — jamais « retourné » ni
          « manquant » ne mènent nulle part. */}
      <div aria-label={t("previsions.consequenceLegende")} className="flex items-center gap-1.5">
        <BadgeDecrit
          id={`${idBase}-consequence-accepte`}
          variante={VARIANTE_PAR_RESULTAT.accepte}
          texte={t("previsions.resultats.accepte.label")}
          description={t("previsions.resultats.accepte.description")}
        />
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <BadgeDecrit
          id={`${idBase}-consequence-facturable`}
          variante="gold"
          texte={t("previsions.facturable.label")}
          description={t("previsions.facturable.description")}
        />
      </div>
    </div>
  );
}

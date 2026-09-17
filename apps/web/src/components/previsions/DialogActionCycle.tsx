import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { api, ApiError } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  actionRequiertChauffeur,
  actionRequiertLignes,
  champPrereplissagePourAction,
  cleBoutonAction,
  cleDescriptionAction,
  cleLibelleAction,
  type ActionProductionCycleLivraison,
} from "./transitionsCycleLivraison";

const nombre = (v: string) => (v.trim() === "" ? 0 : Number(v));

interface ReponseTransition {
  cycle: CycleLivraisonDTO;
  commande: { id: string; numero: number; quantiteBacs: number; montantRecu: number } | null;
}

export interface DialogActionCycleProps {
  cycle: CycleLivraisonDTO;
  action: ActionProductionCycleLivraison;
  open: boolean;
  onOpenChange: (ouvert: boolean) => void;
}

/**
 * Dialogue d'exécution d'une action Production du cycle C4 (F5A, vague 3).
 * Le serveur reste seul juge : aucune transition n'est jamais simulée
 * localement, aucun succès n'est affiché avant sa réponse (contrat C4 §5-7).
 * `version` est toujours celle du cycle affiché à l'ouverture — un conflit
 * 409 (`VERSION_OBSOLETE`) recharge le cycle et l'explique clairement,
 * jamais n'écrase silencieusement une transition concurrente : le
 * formulaire reste figé et affiche le message, sans retenter.
 */
export function DialogActionCycle({ cycle, action, open, onOpenChange }: DialogActionCycleProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const requiertLignes = actionRequiertLignes(action);
  const requiertChauffeur = actionRequiertChauffeur(action);
  const champPreremplissage = champPrereplissagePourAction(action);

  const [lignes, setLignes] = useState<Record<string, string>>({});
  const [chauffeur, setChauffeur] = useState("");
  const [observations, setObservations] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [conflitVersion, setConflitVersion] = useState(false);

  // Réinitialise le formulaire à CHAQUE ouverture — jamais de valeurs
  // laissées d'une transition précédente. Le préremplissage ne reprend que
  // ce que le serveur a DÉJÀ confirmé à l'étape précédente (contrat C4 §7),
  // jamais une valeur devinée ou calculée localement.
  useEffect(() => {
    if (!open) return;
    const valeursInitiales: Record<string, string> = {};
    if (champPreremplissage) {
      for (const ligne of cycle.lignes) {
        const valeur = ligne[champPreremplissage];
        valeursInitiales[ligne.produitId] = valeur !== null ? String(valeur) : "";
      }
    }
    setLignes(valeursInitiales);
    setChauffeur("");
    setObservations("");
    setErreur(null);
    setConflitVersion(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle.id, action]);

  const transition = useMutation({
    mutationFn: () => {
      const corps: Record<string, unknown> = { action, version: cycle.version };
      if (requiertLignes) {
        corps.lignes = cycle.lignes.map((ligne) => ({
          produitId: ligne.produitId,
          quantite: nombre(lignes[ligne.produitId] ?? ""),
        }));
      }
      if (requiertChauffeur) corps.livrePar = chauffeur.trim();
      if (observations.trim()) corps.observations = observations.trim();
      return api<ReponseTransition>(`/api/production/cycles-livraison/${cycle.id}/transitions`, {
        method: "POST",
        body: JSON.stringify(corps),
      });
    },
    onSuccess: () => {
      onOpenChange(false);
      // Jamais de mise à jour optimiste locale : on redemande l'état réel au
      // serveur, seule autorité sur le statut/version/quantités du cycle.
      queryClient.invalidateQueries({ queryKey: ["cycles-livraison"] });
      toast({
        variante: "succes",
        // Persistant (audit UX-17) : un succès de transition C4 doit rester
        // lisible tant que l'utilisateur ne l'a pas fermé lui-même, jamais
        // disparaître avant d'avoir pu être lu (exigence vague 3 §6).
        persistant: true,
        message: t(`previsions.actionsDialog.succes.${action}`),
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        // Conflit de version : le cycle a changé entre-temps. On ne retente
        // jamais automatiquement et on n'écrase rien — on recharge la donnée
        // serveur en arrière-plan (la ligne du tableau se met à jour) et on
        // fige ce formulaire avec une explication claire.
        setConflitVersion(true);
        setErreur(t("previsions.actionsDialog.versionObsolete"));
        queryClient.invalidateQueries({ queryKey: ["cycles-livraison"] });
        return;
      }
      setErreur(e instanceof Error ? e.message : t("previsions.actionsDialog.erreurGenerique"));
    },
  });

  const soumissionValide = !requiertChauffeur || chauffeur.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(ouvert) => !transition.isPending && onOpenChange(ouvert)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!conflitVersion) transition.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t(cleLibelleAction(action))}</DialogTitle>
            <DialogDescription>{t(cleDescriptionAction(action))}</DialogDescription>
          </DialogHeader>

          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {t("previsions.actionsDialog.aucunEffetFinancier")}
          </p>

          {requiertLignes && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("previsions.actionsDialog.quantitesTitre")}</p>
              <div className="grid grid-cols-2 gap-3">
                {cycle.lignes.map((ligne) => (
                  <div key={ligne.produitId} className="space-y-1.5">
                    <Label htmlFor={`${idBase}-${ligne.produitId}`}>{ligne.produitNom}</Label>
                    <Input
                      id={`${idBase}-${ligne.produitId}`}
                      type="number"
                      min={0}
                      disabled={transition.isPending || conflitVersion}
                      value={lignes[ligne.produitId] ?? ""}
                      onChange={(e) => setLignes((prev) => ({ ...prev, [ligne.produitId]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {requiertChauffeur && (
            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-chauffeur`}>{t("previsions.actionsDialog.chauffeur")}</Label>
              <Input
                id={`${idBase}-chauffeur`}
                value={chauffeur}
                onChange={(e) => setChauffeur(e.target.value)}
                disabled={transition.isPending || conflitVersion}
                required
                aria-describedby={`${idBase}-chauffeur-aide`}
              />
              <p id={`${idBase}-chauffeur-aide`} className="text-xs text-muted-foreground">
                {t("previsions.actionsDialog.chauffeurAide")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${idBase}-obs`}>{t("previsions.actionsDialog.observations")}</Label>
            <Input
              id={`${idBase}-obs`}
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              disabled={transition.isPending || conflitVersion}
            />
          </div>

          {erreur && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {erreur}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={transition.isPending}>
              {t("common.cancel")}
            </Button>
            {!conflitVersion && (
              <Button type="submit" variant="cta" loading={transition.isPending} disabled={!soumissionValide}>
                {t(cleBoutonAction(action))}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { api, ApiError } from "@/lib/api";
import { resoudreCleIdempotence, type EtatIdempotence } from "@/lib/idempotence";
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
import { cleSuccesAcceptation, sommeAccepteRetourneDepasseDepose } from "./acceptationCycleLogique";

const nombre = (v: string) => (v.trim() === "" ? 0 : Number(v));

interface ReponseAcceptation {
  cycle: CycleLivraisonDTO;
  commande: { id: string; numero: number; quantiteBacs: number; montantRecu: number } | null;
}

interface CorpsAcceptation {
  action: "CONFIRMER_ACCEPTATION";
  version: number;
  lignes: { produitId: string; quantiteAcceptee: number; quantiteRetournee: number }[];
  bonRetourne: boolean;
  observations?: string;
}

export interface DialogAcceptationCycleProps {
  cycle: CycleLivraisonDTO;
  open: boolean;
  onOpenChange: (ouvert: boolean) => void;
}

/**
 * Dialogue de confirmation d'acceptation du cycle C4 (F5B, module Commandes,
 * permission COMMANDES:ECRITURE — jamais accessible à un rôle Production
 * seul, voir intégration dans AcceptationsLivraison.tsx). C'est la SEULE
 * action du cycle qui peut créer une commande facturable (contrat C4 §7) :
 * le dialogue le dit explicitement, et n'affiche ce résultat qu'après la
 * réponse serveur — jamais anticipé côté client.
 *
 * Idempotence obligatoire (Idempotency-Key) : une nouvelle clé par nouvelle
 * saisie, la même clé pour un rejeu strictement identique du même corps
 * (`resoudreCleIdempotence`) — jamais la même clé avec des valeurs
 * différentes. `version` toujours celle du cycle affiché à l'ouverture ; un
 * 409 VERSION_OBSOLETE recharge le cycle en arrière-plan et fige le
 * formulaire avec une explication, sans jamais retenter automatiquement ni
 * écraser silencieusement une acceptation concurrente.
 */
export function DialogAcceptationCycle({ cycle, open, onOpenChange }: DialogAcceptationCycleProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const queryClient = useQueryClient();
  const { toast } = useFeedback();

  const [saisies, setSaisies] = useState<Record<string, { accepte: string; retourne: string }>>({});
  const [bonRetourne, setBonRetourne] = useState(false);
  const [observations, setObservations] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [conflitVersion, setConflitVersion] = useState(false);
  const idempotenceRef = useRef<EtatIdempotence | null>(null);

  // Réinitialise tout à CHAQUE ouverture, y compris l'idempotence : rouvrir
  // le dialogue est toujours une NOUVELLE opération, jamais le rejeu d'une
  // tentative précédente (même si elle portait sur le même cycle).
  useEffect(() => {
    if (!open) return;
    setSaisies({});
    setBonRetourne(cycle.bonRetourne);
    setObservations("");
    setErreur(null);
    setConflitVersion(false);
    idempotenceRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle.id]);

  function construireCorps(): CorpsAcceptation {
    return {
      action: "CONFIRMER_ACCEPTATION",
      version: cycle.version,
      lignes: cycle.lignes.map((ligne) => ({
        produitId: ligne.produitId,
        quantiteAcceptee: nombre(saisies[ligne.produitId]?.accepte ?? ""),
        quantiteRetournee: nombre(saisies[ligne.produitId]?.retourne ?? ""),
      })),
      bonRetourne,
      ...(observations.trim() ? { observations: observations.trim() } : {}),
    };
  }

  // Une ligne qui dépasse le déposé bloque la soumission — vérifié avec les
  // quantités déjà connues du serveur (`quantiteDeposee`), jamais un
  // « manquant » recalculé ou plafonné par la prévision.
  const depassements = cycle.lignes.filter((ligne) =>
    sommeAccepteRetourneDepasseDepose(
      nombre(saisies[ligne.produitId]?.accepte ?? ""),
      nombre(saisies[ligne.produitId]?.retourne ?? ""),
      ligne.quantiteDeposee ?? 0,
    ),
  );

  const transition = useMutation({
    mutationFn: () => {
      const corps = construireCorps();
      const empreinte = JSON.stringify(corps);
      const { cle } = resoudreCleIdempotence(idempotenceRef.current, empreinte);
      idempotenceRef.current = { cle, empreinte };
      return api<ReponseAcceptation>(`/api/production/cycles-livraison/${cycle.id}/transitions`, {
        method: "POST",
        headers: { "Idempotency-Key": cle },
        body: JSON.stringify(corps),
      });
    },
    onSuccess: (reponse) => {
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["cycles-livraison"] });
      queryClient.invalidateQueries({ queryKey: ["commandes"] });
      queryClient.invalidateQueries({ queryKey: ["commandes-resume-jour"] });
      toast({
        variante: "succes",
        persistant: true,
        message: reponse.commande
          ? t(cleSuccesAcceptation(reponse.commande), { numero: reponse.commande.numero, bacs: reponse.commande.quantiteBacs })
          : t(cleSuccesAcceptation(reponse.commande)),
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && (e.corps as { code?: string } | undefined)?.code === "VERSION_OBSOLETE") {
        setConflitVersion(true);
        setErreur(t("acceptations.versionObsolete"));
        queryClient.invalidateQueries({ queryKey: ["cycles-livraison"] });
        return;
      }
      setErreur(e instanceof Error ? e.message : t("acceptations.errorGeneric"));
    },
  });

  const soumissionValide = depassements.length === 0;

  return (
    <Dialog open={open} onOpenChange={(ouvert) => !transition.isPending && onOpenChange(ouvert)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!conflitVersion && soumissionValide) transition.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t("acceptations.dialogTitle", { client: cycle.client.nom })}</DialogTitle>
            <DialogDescription>{t("acceptations.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <p className="rounded-md border border-or/40 bg-or/5 px-3 py-2 text-xs text-marine dark:text-creme">
            {t("acceptations.financialEffectWarning")}
          </p>

          <div className="space-y-3">
            {cycle.lignes.map((ligne) => {
              const depasse = sommeAccepteRetourneDepasseDepose(
                nombre(saisies[ligne.produitId]?.accepte ?? ""),
                nombre(saisies[ligne.produitId]?.retourne ?? ""),
                ligne.quantiteDeposee ?? 0,
              );
              return (
                <div key={ligne.produitId} className="rounded-md border p-3">
                  <p className="mb-2 flex items-center justify-between text-sm font-medium">
                    <span>{ligne.produitNom}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("acceptations.deposited", { n: ligne.quantiteDeposee ?? 0 })}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${idBase}-${ligne.produitId}-accepte`}>{t("acceptations.accepted")}</Label>
                      <Input
                        id={`${idBase}-${ligne.produitId}-accepte`}
                        type="number"
                        min={0}
                        disabled={transition.isPending || conflitVersion}
                        value={saisies[ligne.produitId]?.accepte ?? ""}
                        onChange={(e) =>
                          setSaisies((prev) => ({
                            ...prev,
                            [ligne.produitId]: { accepte: e.target.value, retourne: prev[ligne.produitId]?.retourne ?? "" },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${idBase}-${ligne.produitId}-retourne`}>{t("acceptations.returned")}</Label>
                      <Input
                        id={`${idBase}-${ligne.produitId}-retourne`}
                        type="number"
                        min={0}
                        disabled={transition.isPending || conflitVersion}
                        value={saisies[ligne.produitId]?.retourne ?? ""}
                        onChange={(e) =>
                          setSaisies((prev) => ({
                            ...prev,
                            [ligne.produitId]: { accepte: prev[ligne.produitId]?.accepte ?? "", retourne: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                  {depasse && (
                    <p role="alert" className="mt-1.5 text-xs font-medium text-terracotta">
                      {t("acceptations.sumExceedsDeposited", { deposited: ligne.quantiteDeposee ?? 0 })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2">
            <input
              id={`${idBase}-bon-retourne`}
              type="checkbox"
              checked={bonRetourne}
              disabled={transition.isPending || conflitVersion || cycle.bonRetourne}
              onChange={(e) => setBonRetourne(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <Label htmlFor={`${idBase}-bon-retourne`} className="font-normal">
              {cycle.bonRetourne ? t("acceptations.bonRetourneAlready") : t("acceptations.bonRetourne")}
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idBase}-obs`}>{t("acceptations.observations")}</Label>
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
                {t("acceptations.confirmButton")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

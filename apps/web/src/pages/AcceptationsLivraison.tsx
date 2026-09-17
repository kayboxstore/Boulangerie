import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateISOKinshasa } from "@/lib/dateKinshasa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { EtatChargement, EtatErreur, EtatVide } from "@/components/ui/etats";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BadgeDecrit } from "@/components/previsions/EtapesCycleLivraison";
import { cleDescriptionStatutCycle, cleLibelleStatutCycle, varianteBadgeStatutCycle } from "@/components/previsions/cycleLivraisonLogique";
import { DialogAcceptationCycle } from "@/components/previsions/DialogAcceptationCycle";

const jourISO = dateISOKinshasa;

/**
 * Sous-module de Commandes (F5B, vague 3) : confirme l'acceptation des
 * livraisons du cycle C4 en attente (`EN_ATTENTE_CONFIRMATION`). Réservé à
 * `COMMANDES:ECRITURE` — jamais accessible à un rôle Production seul, même
 * en lecture ce module n'affiche que ce qui concerne Commandes. Écran à part
 * pour ne pas encombrer /commandes, comme /production/bons-livraison pour
 * Production (F4/F5A).
 */
export function AcceptationsLivraisonPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const editable = peutEcrire("COMMANDES");

  const [date, setDate] = useState(jourISO(new Date()));
  const {
    data: cyclesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["cycles-livraison", date],
    queryFn: () =>
      api<{ date: string; cycles: CycleLivraisonDTO[]; totaux: Record<string, number> }>(
        `/api/production/cycles-livraison?date=${date}`,
      ),
  });

  // Seuls les cycles en attente de confirmation demandent une action ici —
  // les autres statuts sont hors périmètre de cet écran (lisibles dans
  // Bons de livraison, Production).
  const cyclesEnAttente = useMemo(
    () => (cyclesData?.cycles ?? []).filter((c) => c.statut === "EN_ATTENTE_CONFIRMATION"),
    [cyclesData],
  );

  const [dialogCycle, setDialogCycle] = useState<CycleLivraisonDTO | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to="/commandes"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-marine dark:hover:text-creme"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("acceptations.backToOrders")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-serif text-3xl font-bold text-marine dark:text-creme">
              <ClipboardCheck className="h-7 w-7 text-or" />
              {t("acceptations.title")}
            </h1>
            <p className="mt-1 text-muted-foreground">{t("acceptations.subtitle")}</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <Label htmlFor="date-acceptations">{t("common.date")}</Label>
            <Input id="date-acceptations" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <CardDescription className="max-w-sm">
            {editable ? t("acceptations.descWrite") : t("acceptations.descRead")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <EtatChargement message={t("acceptations.loading")} />
          ) : isError ? (
            <EtatErreur message={error instanceof Error ? error.message : undefined} onReessayer={() => refetch()} />
          ) : cyclesEnAttente.length === 0 ? (
            <EtatVide description={t("acceptations.empty")} />
          ) : (
            <>
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("acceptations.colClient")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead className="text-right">{t("acceptations.colDeposited")}</TableHead>
                    {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cyclesEnAttente.map((cycle) => (
                    <TableRow key={cycle.id}>
                      <TableCell className="font-medium">{cycle.client.nom}</TableCell>
                      <TableCell>
                        <BadgeDecrit
                          id={`statut-${cycle.id}`}
                          variante={varianteBadgeStatutCycle(cycle.statut)}
                          texte={t(cleLibelleStatutCycle(cycle.statut))}
                          description={t(cleDescriptionStatutCycle(cycle.statut))}
                        />
                      </TableCell>
                      <TableCell className="text-right">{cycle.totaux.depose ?? 0}</TableCell>
                      {editable && (
                        <TableCell className="text-right">
                          <Button variant="cta" size="sm" onClick={() => setDialogCycle(cycle)}>
                            {t("acceptations.confirmButton")}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="space-y-2 md:hidden">
                {cyclesEnAttente.map((cycle) => (
                  <CarteLigne key={cycle.id}>
                    <CarteLigneTitre>
                      <span>{cycle.client.nom}</span>
                      <Badge variant={varianteBadgeStatutCycle(cycle.statut)}>{t(cleLibelleStatutCycle(cycle.statut))}</Badge>
                    </CarteLigneTitre>
                    <CarteLigneChamp label={t("acceptations.colDeposited")} value={cycle.totaux.depose ?? 0} />
                    {editable && (
                      <CarteLigneActions>
                        <Button variant="cta" size="sm" onClick={() => setDialogCycle(cycle)}>
                          {t("acceptations.confirmButton")}
                        </Button>
                      </CarteLigneActions>
                    )}
                  </CarteLigne>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {dialogCycle && (
        <DialogAcceptationCycle
          cycle={dialogCycle}
          open
          onOpenChange={(ouvert) => !ouvert && setDialogCycle(null)}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ZoneDepositaireDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

/**
 * Zones de dépôt (section 3.3 d) : purement organisationnel, aucune
 * permission propre — gouverné par le module COMMANDES (rattachées à la
 * fiche Client). Card autonome (requête react-query partagée via la clé
 * "zones-depositaires"), montée sur l'écran Schéma de commande.
 */
export function ZonesDepositaireCard({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();

  const { data } = useQuery({
    queryKey: ["zones-depositaires"],
    queryFn: () => api<{ zones: ZoneDepositaireDTO[] }>("/api/zones-depositaires"),
  });
  const zones = data?.zones ?? [];

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["zones-depositaires"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["schema-commande"] });
  };

  const [dialogZone, setDialogZone] = useState(false);
  const [zoneEditee, setZoneEditee] = useState<ZoneDepositaireDTO | null>(null);
  const [nomZone, setNomZone] = useState("");
  const [ordreZone, setOrdreZone] = useState("0");
  const [erreurZone, setErreurZone] = useState<string | null>(null);

  function ouvrirZone(z: ZoneDepositaireDTO | null) {
    setZoneEditee(z);
    setNomZone(z?.nom ?? "");
    setOrdreZone(String(z?.ordre ?? zones.length));
    setErreurZone(null);
    setDialogZone(true);
  }

  const sauverZone = useMutation({
    mutationFn: () => {
      const corps = { nom: nomZone.trim(), ordre: Number(ordreZone) || 0 };
      return zoneEditee
        ? api(`/api/zones-depositaires/${zoneEditee.id}`, { method: "PUT", body: JSON.stringify(corps) })
        : api("/api/zones-depositaires", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogZone(false);
      rafraichir();
    },
    onError: (e) => setErreurZone(e instanceof Error ? e.message : t("zonesDepot.saveError")),
  });

  const supprimerZone = useMutation({
    mutationFn: (id: string) => api(`/api/zones-depositaires/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("zonesDepot.deleteError")),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-or" />
            {t("zonesDepot.title")}
          </CardTitle>
          <CardDescription>{t("zonesDepot.subtitle")}</CardDescription>
        </div>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => ouvrirZone(null)}>
            <Plus className="h-4 w-4" />
            {t("zonesDepot.newZone")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-1.5">
          {zones.map((z) => (
            <Badge key={z.id} variant="outline" className="gap-1 pr-1">
              <button
                type="button"
                disabled={!editable}
                onClick={() => editable && ouvrirZone(z)}
                className="disabled:cursor-default"
              >
                {z.nom}
              </button>
              {editable && (
                <button
                  type="button"
                  aria-label={t("zonesDepot.ariaDelete", { nom: z.nom })}
                  onClick={async () => {
                    if (await confirmer({ description: t("zonesDepot.confirmDelete", { nom: z.nom }), destructive: true }))
                      supprimerZone.mutate(z.id);
                  }}
                  className="rounded-full p-0.5 hover:bg-secondary"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {zones.length === 0 && <span className="text-sm text-muted-foreground">{t("zonesDepot.noZones")}</span>}
        </div>
      </CardContent>

      <Dialog open={dialogZone} onOpenChange={setDialogZone}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverZone.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{zoneEditee ? t("zonesDepot.editZone", { nom: zoneEditee.nom }) : t("zonesDepot.newZone")}</DialogTitle>
              <DialogDescription>{t("zonesDepot.dialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="zone-nom">{t("zonesDepot.nameLabel")}</Label>
                <Input
                  id="zone-nom"
                  value={nomZone}
                  onChange={(e) => setNomZone(e.target.value)}
                  placeholder={t("zonesDepot.namePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zone-ordre">{t("zonesDepot.orderLabel")}</Label>
                <Input
                  id="zone-ordre"
                  type="number"
                  min={0}
                  value={ordreZone}
                  onChange={(e) => setOrdreZone(e.target.value)}
                />
              </div>
            </div>
            {erreurZone && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurZone}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogZone(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverZone.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

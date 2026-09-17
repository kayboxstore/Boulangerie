import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ZoneDepositaireDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
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

/**
 * Dialogue de création rapide d'une zone de dépôt (3.3 d), réutilisable
 * partout où l'écriture COMMANDES ou PRODUCTION est déjà acquise (voir
 * `ecritureZones` côté API) — ici depuis la fiche client, pour que le Chargé
 * des commandes n'ait pas besoin de passer par l'écran Production. Création
 * uniquement ; la gestion complète (renommer, supprimer) reste sur la carte
 * Zones de dépôt de Production.
 */
export function DialogNouvelleZone({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (zone: ZoneDepositaireDTO) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["zones-depositaires"],
    queryFn: () => api<{ zones: ZoneDepositaireDTO[] }>("/api/zones-depositaires"),
  });
  const zones = data?.zones ?? [];

  const [nomZone, setNomZone] = useState("");
  const [erreurZone, setErreurZone] = useState<string | null>(null);

  const creerZone = useMutation({
    mutationFn: () =>
      api<{ zone: ZoneDepositaireDTO }>("/api/zones-depositaires", {
        method: "POST",
        body: JSON.stringify({ nom: nomZone.trim(), ordre: zones.length }),
      }),
    onSuccess: ({ zone }) => {
      queryClient.invalidateQueries({ queryKey: ["zones-depositaires"] });
      setNomZone("");
      onOpenChange(false);
      onCreated?.(zone);
    },
    onError: (e) => setErreurZone(e instanceof Error ? e.message : t("zonesDepot.saveError")),
  });

  function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreurZone(null);
    creerZone.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setNomZone("");
          setErreurZone(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form onSubmit={soumettre} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("zonesDepot.newZone")}</DialogTitle>
            <DialogDescription>{t("zonesDepot.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nouvelle-zone-nom">{t("zonesDepot.nameLabel")}</Label>
            <Input
              id="nouvelle-zone-nom"
              value={nomZone}
              onChange={(e) => setNomZone(e.target.value)}
              placeholder={t("zonesDepot.namePlaceholder")}
              required
              autoFocus
            />
          </div>
          {erreurZone && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {erreurZone}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="cta" disabled={creerZone.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

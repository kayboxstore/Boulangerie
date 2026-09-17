import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LicenceActiverReponseDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useInvaliderLicenceEtat } from "@/lib/licence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Écran plein remplaçant tout l'accès (maquette validée "États de licence —
 * Vue 2"), même mécanisme que PremierLancementPage : cette instance n'a pas
 * pu confirmer sa licence depuis plus de 5 jours, ou son essai de 30 jours
 * est terminé (voir GET /api/licence/etat, calculerEtatLicencePourFrontend
 * côté API). Saisir une clé de licence valide POST /api/licence/activer et
 * lève le blocage dès que l'état se rafraîchit.
 */
interface Props {
  /** LIEN_ACHAT_LICENCE (voir GET /api/licence/etat) — absent si non configuré côté serveur. */
  lienAchat?: string;
}

export function EcranLicenceBloquee({ lienAchat }: Props) {
  const { t } = useTranslation();
  const invaliderLicenceEtat = useInvaliderLicenceEtat();
  const [cleLicence, setCleLicence] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const activer = useMutation({
    mutationFn: () => api<LicenceActiverReponseDTO>("/api/licence/activer", {
      method: "POST",
      body: JSON.stringify({ cleLicence: cleLicence.trim() }),
    }),
    onSuccess: async (r) => {
      if (r.erreurActivation) {
        setErreur(r.erreurActivation);
        return;
      }
      setErreur(null);
      await invaliderLicenceEtat();
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("licence.activationErreurGenerique")),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-marine p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-serif text-2xl text-marine dark:text-creme">{t("licence.blocageTitre")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{t("licence.blocageDescription")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              activer.mutate();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="licence-cle-blocage">{t("licence.champCle")}</Label>
              <Input
                id="licence-cle-blocage"
                value={cleLicence}
                onChange={(e) => setCleLicence(e.target.value)}
                placeholder={t("licence.champClePlaceholder")}
                autoComplete="off"
                required
              />
            </div>
            {erreur && (
              <p role="alert" className="text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}
            <Button type="submit" variant="cta" className="w-full" disabled={activer.isPending}>
              {t("licence.activerBouton")}
            </Button>
          </form>
          {lienAchat ? (
            <a
              href={lienAchat}
              target="_blank"
              rel="noopener noreferrer"
              className="block border-t pt-4 text-center text-sm text-muted-foreground"
            >
              {t("licence.blocageSupport")}
            </a>
          ) : (
            <p className="border-t pt-4 text-center text-sm text-muted-foreground">{t("licence.blocageSupport")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

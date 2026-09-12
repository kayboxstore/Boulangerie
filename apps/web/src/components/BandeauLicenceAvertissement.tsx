import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useInvaliderLicenceEtat } from "@/lib/licence";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";

const JOURS_GRACE_COUPURE = 5;

/**
 * Bandeau non bloquant (maquette validée "États de licence — Vue 1") affiché
 * en tête de l'app authentifiée quand le dernier contact réussi avec le
 * service central de licences date de plus d'1 jour, mais reste dans la
 * période de grâce de 5 jours (voir GET /api/licence/etat, services/licenceLocale.ts
 * côté API). Purement informatif — l'app reste pleinement utilisable.
 */
export function BandeauLicenceAvertissement({ joursDepuisContact }: { joursDepuisContact?: number }) {
  const { t } = useTranslation();
  const { toast, toastErreur } = useFeedback();
  const invaliderLicenceEtat = useInvaliderLicenceEtat();
  const [enCours, setEnCours] = useState(false);

  const joursAvantBlocage = Math.max(0, JOURS_GRACE_COUPURE - (joursDepuisContact ?? 0));
  const motJourRestant = joursAvantBlocage <= 1 ? t("licence.jourSingulier") : t("licence.jourPluriel");
  const motJourEcoule = (joursDepuisContact ?? 0) <= 1 ? t("licence.jourSingulier") : t("licence.jourPluriel");

  async function verifierMaintenant() {
    setEnCours(true);
    try {
      await api("/api/licence/rafraichir", { method: "POST" });
      await invaliderLicenceEtat();
      toast({ variante: "succes", message: t("licence.bandeauVerificationReussie") });
    } catch (e) {
      toastErreur(e instanceof Error ? e.message : t("licence.bandeauVerificationEchouee"));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-avertissement bg-avertissement/10 px-6 py-2.5 text-sm text-avertissement">
      <span>
        {t("licence.bandeauTexte", { jours: joursDepuisContact ?? 0, motJourEcoule, joursAvantBlocage, motJourRestant })}
      </span>
      <Button variant="cta" size="sm" onClick={verifierMaintenant} disabled={enCours}>
        {t("licence.verifierMaintenant")}
      </Button>
    </div>
  );
}

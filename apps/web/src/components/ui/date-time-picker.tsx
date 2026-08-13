import * as React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formaterDateFr, formaterHeureFr } from "./dateHeureFr";

export { estDateValide, estHeureValide, formaterDateFr, formaterHeureFr, combinerDateHeureISO } from "./dateHeureFr";

export interface DateHeurePickerProps {
  id?: string;
  dateLabel?: string;
  heureLabel?: string;
  dateValue: string;
  heureValue: string;
  onDateChange: (valeur: string) => void;
  onHeureChange: (valeur: string) => void;
  dateMin?: string;
  dateMax?: string;
  requis?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Sélecteur date + heure en français, construit sur les `<input type="date">`
 * / `<input type="time">` natifs — aucune bibliothèque de calendrier
 * n'est installée dans apps/web, et en ajouter une sort du périmètre F1
 * (voir §4 du plan de coordination : toute nouvelle dépendance doit d'abord
 * être démontrée nécessaire puis transmise à Codex). Les widgets natifs
 * suivent la locale du système/navigateur, pas la langue choisie dans
 * l'application : un aperçu reformaté en français est affiché sous chaque
 * champ pour rester lisible quel que soit ce réglage.
 */
function DateHeurePicker({
  id,
  dateLabel,
  heureLabel,
  dateValue,
  heureValue,
  onDateChange,
  onHeureChange,
  dateMin,
  dateMax,
  requis = false,
  disabled = false,
  className,
}: DateHeurePickerProps) {
  const { t } = useTranslation();
  // Correction revue Codex : sans `id` fourni par l'appelant, `idDate`/
  // `idHeure` restaient `undefined` — `Label htmlFor` n'associait alors plus
  // le libellé à son champ (association label/champ perdue). `React.useId()`
  // garantit un identifiant stable et unique même quand l'appelant n'en
  // fournit pas.
  const idGenere = React.useId();
  const idBase = id ?? idGenere;
  const idDate = `${idBase}-date`;
  const idHeure = `${idBase}-heure`;

  const apercuDate = formaterDateFr(dateValue);
  const apercuHeure = formaterHeureFr(heureValue);

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      <div>
        <Label htmlFor={idDate}>{dateLabel ?? t("premium.dateHeurePicker.date")}</Label>
        <Input
          id={idDate}
          type="date"
          className="mt-1"
          value={dateValue}
          min={dateMin}
          max={dateMax}
          required={requis}
          disabled={disabled}
          onChange={(e) => onDateChange(e.target.value)}
        />
        {apercuDate && <p className="mt-1 text-xs text-muted-foreground">{apercuDate}</p>}
      </div>
      <div>
        <Label htmlFor={idHeure}>{heureLabel ?? t("premium.dateHeurePicker.heure")}</Label>
        <Input
          id={idHeure}
          type="time"
          className="mt-1"
          value={heureValue}
          required={requis}
          disabled={disabled}
          onChange={(e) => onHeureChange(e.target.value)}
        />
        {apercuHeure && <p className="mt-1 text-xs text-muted-foreground">{apercuHeure}</p>}
      </div>
    </div>
  );
}

export { DateHeurePicker };

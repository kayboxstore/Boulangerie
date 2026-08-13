import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { Pagination } from "@/components/ui/pagination";
import { EtatChargement, EtatVide } from "@/components/ui/etats";
import { cn } from "@/lib/utils";
import { filtrerParRecherche, trierPar, type SensTri } from "./rechercheEtTri";

export interface ColonnePremiumTable<T> {
  cle: string;
  titre: string;
  /** Rendu de la cellule — badges, montants formatés, etc. Aucune règle métier : uniquement de l'affichage. */
  rendu: (item: T) => React.ReactNode;
  /** Valeur comparable utilisée pour le tri ; sans cette fonction, la colonne n'est pas triable même si `triable` vaut true. */
  valeurTri?: (item: T) => string | number;
  triable?: boolean;
  className?: string;
  /** N'affiche pas cette colonne dans les cartes mobiles (ex. colonnes très secondaires). */
  masqueeSurMobile?: boolean;
}

export interface SelectionPremiumTable {
  selectionnes: Set<string>;
  onChange: (selectionnes: Set<string>) => void;
}

export interface PremiumTableProps<T> {
  donnees: T[];
  colonnes: ColonnePremiumTable<T>[];
  cleId: (item: T) => string;
  /** Titre de la carte sur mobile (équivalent de la première colonne). */
  titreMobile: (item: T) => React.ReactNode;
  chargement?: boolean;
  /** Active la barre de recherche ; renvoie les valeurs texte/nombre à comparer à la requête pour un élément donné. */
  champsRecherche?: (item: T) => Array<string | number | null | undefined>;
  actions?: (item: T) => React.ReactNode;
  taillePage?: number;
  videTitre?: string;
  videDescription?: string;
  className?: string;
  selection?: SelectionPremiumTable;
}

/**
 * Tableau/liste Premium générique (audit UX-18) : un seul composant pilote à
 * la fois le rendu tableau (ordinateur, `md:` et plus) et cartes (mobile),
 * en réutilisant les primitives déjà existantes plutôt que de les dupliquer
 * (`Table` et `CarteLigne`, tous deux inchangés). Recherche et tri sont
 * calculés côté client via des fonctions pures testables (rechercheEtTri.ts) ;
 * la pagination est gérée en interne pour l'instant (aucune prop de
 * pagination contrôlée par le serveur pour le moment — l'ajouter plus tard
 * est un changement non cassant sur ce composant). Aucune règle métier ni
 * appel réseau : tout est piloté par les props fournies par l'écran appelant.
 */
function PremiumTable<T>({
  donnees,
  colonnes,
  cleId,
  titreMobile,
  chargement = false,
  champsRecherche,
  actions,
  taillePage = 10,
  videTitre,
  videDescription,
  className,
  selection,
}: PremiumTableProps<T>) {
  const { t } = useTranslation();
  const [recherche, setRecherche] = React.useState("");
  const [triCle, setTriCle] = React.useState<string | null>(null);
  const [triSens, setTriSens] = React.useState<SensTri>("asc");
  const [page, setPage] = React.useState(1);

  const donneesFiltrees = React.useMemo(() => {
    if (!champsRecherche) return donnees;
    return filtrerParRecherche(donnees, champsRecherche, recherche);
  }, [donnees, champsRecherche, recherche]);

  const colonneTriee = colonnes.find((c) => c.cle === triCle && c.valeurTri);
  const donneesTriees = React.useMemo(() => {
    if (!colonneTriee?.valeurTri) return donneesFiltrees;
    const extraire = colonneTriee.valeurTri;
    const comparateur = (a: T, b: T) => {
      const va = extraire(a);
      const vb = extraire(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    };
    return trierPar(donneesFiltrees, comparateur, triSens);
  }, [donneesFiltrees, colonneTriee, triSens]);

  // Repart en page 1 dès que la recherche ou le tri change l'ensemble de
  // résultats — sans cela, une recherche pourrait laisser l'utilisateur sur
  // une page devenue vide ou hors bornes.
  React.useEffect(() => {
    setPage(1);
  }, [recherche, triCle, triSens]);

  const total = donneesTriees.length;
  const debut = (page - 1) * taillePage;
  const donneesPage = donneesTriees.slice(debut, debut + taillePage);

  const basculerTri = (colonne: ColonnePremiumTable<T>) => {
    if (!colonne.triable || !colonne.valeurTri) return;
    if (triCle !== colonne.cle) {
      setTriCle(colonne.cle);
      setTriSens("asc");
    } else {
      setTriSens((s) => (s === "asc" ? "desc" : "asc"));
    }
  };

  const estSelectionne = (item: T) => selection?.selectionnes.has(cleId(item)) ?? false;
  const basculerSelection = (item: T) => {
    if (!selection) return;
    const id = cleId(item);
    const suivant = new Set(selection.selectionnes);
    if (suivant.has(id)) suivant.delete(id);
    else suivant.add(id);
    selection.onChange(suivant);
  };

  if (chargement) return <EtatChargement />;

  return (
    <div className={cn("space-y-3", className)}>
      {champsRecherche && (
        <Input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={t("premium.table.rechercherPlaceholder")}
          aria-label={t("premium.table.rechercherPlaceholder")}
          className="max-w-sm"
        />
      )}

      {total === 0 ? (
        <EtatVide titre={videTitre ?? t("premium.etats.videTitre")} description={videDescription} />
      ) : (
        <>
          {/* Vue ordinateur — tableau classique, inchangé au-delà de md: (audit 3.8/UX-18). */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {selection && <TableHead className="w-10" aria-hidden />}
                  {colonnes.map((colonne) => (
                    <TableHead
                      key={colonne.cle}
                      className={colonne.className}
                      aria-sort={
                        triCle === colonne.cle ? (triSens === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      {colonne.triable && colonne.valeurTri ? (
                        <button
                          type="button"
                          onClick={() => basculerTri(colonne)}
                          className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {colonne.titre}
                          {triCle !== colonne.cle ? (
                            <ArrowUpDown aria-hidden className="h-3 w-3 opacity-50" />
                          ) : triSens === "asc" ? (
                            <ArrowUp aria-hidden className="h-3 w-3" />
                          ) : (
                            <ArrowDown aria-hidden className="h-3 w-3" />
                          )}
                        </button>
                      ) : (
                        colonne.titre
                      )}
                    </TableHead>
                  ))}
                  {actions && <TableHead className="text-right">{t("common.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {donneesPage.map((item) => (
                  <TableRow key={cleId(item)} data-state={estSelectionne(item) ? "selected" : undefined}>
                    {selection && (
                      <TableCell>
                        <span className="-m-2 inline-flex p-2">
                          <input
                            type="checkbox"
                            checked={estSelectionne(item)}
                            onChange={() => basculerSelection(item)}
                            aria-label={t("premium.table.selectionnerLigne")}
                            className="h-4 w-4"
                          />
                        </span>
                      </TableCell>
                    )}
                    {colonnes.map((colonne) => (
                      <TableCell key={colonne.cle} className={colonne.className}>
                        {colonne.rendu(item)}
                      </TableCell>
                    ))}
                    {actions && <TableCell className="text-right">{actions(item)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Vue mobile — cartes empilées, réutilise CarteLigne inchangé. */}
          <div className="space-y-2 md:hidden">
            {donneesPage.map((item) => (
              <CarteLigne key={cleId(item)}>
                <CarteLigneTitre>
                  <span className="flex items-center gap-2">
                    {selection && (
                      <span className="-m-2 inline-flex p-2">
                        <input
                          type="checkbox"
                          checked={estSelectionne(item)}
                          onChange={() => basculerSelection(item)}
                          aria-label={t("premium.table.selectionnerLigne")}
                          className="h-4 w-4"
                        />
                      </span>
                    )}
                    {titreMobile(item)}
                  </span>
                </CarteLigneTitre>
                {colonnes
                  .filter((c) => !c.masqueeSurMobile)
                  .map((colonne) => (
                    <CarteLigneChamp key={colonne.cle} label={colonne.titre} value={colonne.rendu(item)} />
                  ))}
                {actions && <CarteLigneActions>{actions(item)}</CarteLigneActions>}
              </CarteLigne>
            ))}
          </div>

          <Pagination page={page} pageSize={taillePage} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

export { PremiumTable };

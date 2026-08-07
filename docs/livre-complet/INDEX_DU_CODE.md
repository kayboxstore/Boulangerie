# Index du code — Le Livre Boulangerie Lomoto

> Table de correspondance entre un fichier ou un symbole (fonction, composant, route) et le(s) chapitre(s) du livre qui l'expliquent. Utilisez `Ctrl+F` / recherche de texte pour trouver un nom exact.
>
> Complète `MATRICE_DE_COUVERTURE.md` (qui suit l'avancement) avec une vue orientée « je cherche telle chose dans le code, où en parle le livre ? ».

## Par fichier (uniquement les fichiers déjà couverts par au moins un chapitre)

| Fichier | Chapitre(s) |
|---|---|
| `packages/shared/src/index.ts` — fonctions `calculerCommande`, `avanceAvantCommande`, `calculerDepenseFarine`, `aAcces` | `volumes/11a-noyau-financier-permissions.md` |
| `packages/shared/src/index.test.ts` | `volumes/11a-noyau-financier-permissions.md` |

*(Le reste des 155 fichiers du projet apparaîtra ici au fur et à mesure — voir `MATRICE_DE_COUVERTURE.md` pour la liste complète et leur état actuel.)*

## Par symbole (fonctions, composants, routes déjà expliqués)

| Symbole | Fichier | Chapitre |
|---|---|---|
| `calculerCommande` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `avanceAvantCommande` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `calculerDepenseFarine` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `aAcces` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `CalculCommande` (type de retour) | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |

## Par terme métier (section de la spécification ↔ chapitre du livre)

| Section de `docs/spec-boulangerie.md` | Sujet | Chapitre du livre |
|---|---|---|
| 3.1 (dépense farine) | Registre de Caisse | `volumes/11a-noyau-financier-permissions.md` (formule), `volumes/11j-caisse.md` (à venir, écran complet) |
| 3.4 (commandes, avance/dette) | Commandes clients | `volumes/11a-noyau-financier-permissions.md` (formule), `volumes/11h-commandes.md` (à venir, écran complet) |

---

*Index amorcé à la création du livre — se remplit à chaque chapitre rédigé. Un fichier ou symbole absent de cet index n'a simplement pas encore été traité ; consultez `ETAT_DE_PROGRESSION.md` pour savoir quand il sera couvert.*

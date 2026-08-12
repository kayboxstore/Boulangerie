# Volume 22h — Travailleurs et Paie

> Huitième sous-chapitre du Guide complet d'utilisation, et le plus dense — il couvre le plus gros module de l'application. Comportement déjà vérifié techniquement aux Volumes 11k-1, 11k-2 et 11k-3.

## 1. Une fiche Travailleur n'est pas un compte de connexion

Point à bien distinguer avant tout le reste : une **fiche Travailleur** (nom, téléphone, poste, date d'embauche) peut exister **sans** qu'aucun compte de connexion n'y soit associé — c'est le cas normal pour du personnel qui n'utilise jamais l'application (un livreur, un agent d'entretien). Un compte de connexion peut ensuite, optionnellement, être **lié** à une fiche existante — c'est précisément cette liaison qui permet à la personne, une fois connectée, de consulter ses propres bulletins de paie (§5) même si son rôle ne lui donne aucun accès au module Travailleurs.

**Un compte ne peut être lié qu'à une seule fiche** — tenter de lier un compte déjà associé à une autre fiche est refusé, avec le nom de la fiche déjà concernée affiché pour éviter toute confusion.

## 2. Créer et gérer une fiche

### 2.1 Département et groupe

Chaque fiche doit être rattachée à un **Département** — le **Groupe**, une subdivision plus fine, reste facultatif. Un point de cohérence à connaître : un groupe ne peut être choisi que s'il appartient réellement au département sélectionné — l'application refuse explicitement toute combinaison département/groupe incohérente, même en cas de modification partielle de la fiche (changer seulement le téléphone, par exemple, revérifie quand même que le couple département/groupe existant reste valide).

### 2.2 L'adresse e-mail professionnelle

Pour créer un compte de connexion lié à une fiche, celle-ci doit d'abord disposer d'une adresse e-mail professionnelle **active** (Volume 22a évoque déjà ce mécanisme pour le tout premier compte de l'application) — aucune saisie libre d'adresse n'est possible. Le statut de cette adresse (en attente de vérification, active, échec) s'affiche directement sur la fiche.

### 2.3 Supprimer une fiche : une règle asymétrique

Un point important à connaître avant de supprimer une fiche : **si au moins un bulletin de paie a été généré** pour cette personne, la suppression est refusée — les bulletins constituent un historique officiel qui ne doit jamais disparaître silencieusement avec la fiche. En revanche, les pointages, absences et sanctions liés à la fiche (des données purement opérationnelles, pas un historique officiel au même titre) sont supprimés automatiquement avec elle, sans blocage, si aucun bulletin n'existe.

## 3. Le pointage

Chaque pointage enregistre une heure d'entrée et, une fois connue, une heure de sortie — jamais seulement une date. Ce choix permet de gérer nativement les équipes de nuit (qui commencent un jour et terminent le lendemain) sans aucun traitement particulier à connaître ou à contourner.

**Un pointage peut être créé « ouvert »** (la personne est encore en poste, l'heure de sortie n'est pas encore connue) — un raccourci d'un clic permet de le « clôturer maintenant » avec l'heure actuelle, sans rouvrir tout le formulaire. À l'inverse, un pointage déjà clôturé peut être **rouvert** en retirant son heure de sortie, si une correction s'impose.

## 4. Absences et sanctions

### 4.1 Déclarer une absence, puis la trancher — deux actes distincts

Signaler une absence (avec sa date et son motif) et **décider** si elle est justifiée sont deux actions séparées, qui peuvent être posées par la même personne ou par des personnes différentes, à des moments différents. Toute absence nouvellement déclarée démarre systématiquement au statut **En attente** — il n'existe aucun raccourci pour la déclarer déjà tranchée.

**Qui peut trancher une absence** : uniquement un Admin (secondaire ou Principal) — jamais le chef de département, dont le rôle reste purement organisationnel et sans effet sur les permissions.

**Une décision « Non justifiée » déclenche une notification immédiate**, adressée à tous les autres Admins ainsi qu'à la personne concernée elle-même, si elle dispose d'un compte lié à sa fiche.

**Un rappel automatique** signale, une seule fois, toute absence encore en attente de décision depuis la veille ou avant — ce rappel est réservé aux Admins uniquement (contrairement à d'autres alertes de l'application, le Directeur Général, qui a pourtant un accès en lecture au module Travailleurs, n'est volontairement pas notifié ici).

### 4.2 Les sanctions : punition ou retenue

Une sanction est soit une **punition** (par exemple un avertissement écrit, sans effet financier), soit une **retenue** (avec un montant, qui sera automatiquement déduit du salaire, §5). Le formulaire garantit cette cohérence : une punition ne peut jamais recevoir de montant, une retenue en exige toujours un.

## 5. Le calcul de paie

### 5.1 La formule, sans arrondi intermédiaire

Pour un mois donné, le salaire net se calcule ainsi : **salaire de base − retenue pour absences non justifiées de ce mois − retenues disciplinaires de ce mois**. Seules les absences tranchées **Non justifiée** entrent dans le calcul — une absence encore en attente ou déjà justifiée n'a aucun impact, quel que soit leur nombre. De même, seules les sanctions de type **Retenue** sont déduites — une punition n'affecte jamais automatiquement le salaire.

**Un détail visible à l'écran, qui mérite une explication** : le taux journalier et le montant de la retenue pour absences peuvent afficher des décimales (par exemple 13 461,54 Fc), alors que la plupart des montants de l'application sont des nombres entiers. C'est volontaire : seul le résultat final (le salaire net) est arrondi au franc le plus proche, une seule fois, tout à la fin du calcul — pour que le détail affiché à l'écran corresponde exactement à la somme des lignes qui le composent.

### 5.2 Exemple concret

Jean, salaire mensuel 350 000 Fc, 26 jours travaillés par mois. En février, il a deux absences tranchées Non justifiée et une retenue disciplinaire de 10 000 Fc. Il a aussi une absence encore en attente et une punition sans montant — ni l'une ni l'autre n'affecte le calcul.

- Taux journalier : 350 000 ÷ 26 = 13 461,54 Fc (valeur exacte conservée en interne, sans arrondi)
- Retenue pour les 2 absences non justifiées : 2 × 13 461,54 = 26 923,08 Fc
- Retenue disciplinaire : 10 000 Fc
- **Salaire net : 350 000 − 26 923,08 − 10 000 = 313 077 Fc** (arrondi final)

### 5.3 Le salaire et les jours travaillés doivent être renseignés

Le calcul de paie (et la génération d'un bulletin) sont **bloqués** avec un message explicite tant que le salaire mensuel et le nombre de jours travaillés par mois n'ont pas été renseignés sur la fiche — c'est le cas notamment des fiches créées avant l'introduction de cette fonctionnalité, pour lesquelles ces deux champs peuvent encore être vides.

## 6. Le bulletin de paie : la seule exception au calcul recalculé

Contrairement à la Caisse (Volume 22f) ou aux Commissions (Volume 22g), qui sont entièrement recalculées à chaque consultation, un **bulletin de paie généré devient une archive figée**, définitivement indépendante des données qui l'ont nourri.

**Ce que cela signifie concrètement** : si une absence est reclassée après coup (par exemple, tranchée Justifiée après avoir été Non justifiée), ou si une sanction est supprimée, **aucun bulletin déjà généré n'est modifié rétroactivement** — il continue d'afficher exactement les chiffres calculés au moment de sa génération. Seule la consultation d'un **nouveau** calcul, ou la génération d'un **nouveau** bulletin, refléterait le changement.

**Régénérer un bulletin pour un mois déjà traité** est toujours possible — cela crée un second bulletin indépendant du premier, sans jamais écraser ni modifier celui déjà émis. Les deux restent consultables séparément, ce qui garde une trace fidèle si, par exemple, un premier bulletin avait été généré prématurément puis corrigé par un second après une décision d'absence tardive.

## 7. Consulter ses propres bulletins

Une règle d'accès particulière mérite d'être connue : **n'importe quel compte connecté peut consulter les bulletins de la fiche Travailleur liée à son propre compte**, même s'il n'a par ailleurs strictement aucun accès au module Travailleurs dans sa matrice de permissions (Volume 22b). Un Caissier(ère) ou un Chargé des commandes, par exemple, peut ainsi voir et télécharger ses propres bulletins depuis son écran Profil (Volume 22a), sans jamais pouvoir consulter ceux de qui que ce soit d'autre.

Les Admins (secondaire et Principal), eux, voient et génèrent les bulletins de tout le monde, cohérent avec leur accès en lecture ou écriture sur l'ensemble du module.

## 8. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Une fiche Travailleur nécessite-t-elle un compte de connexion ? | Non — un compte est optionnel, lié à la fiche seulement s'il existe |
| Puis-je supprimer une fiche avec des bulletins de paie déjà émis ? | Non, bloqué — les pointages/absences/sanctions seuls peuvent disparaître avec elle |
| Une absence en attente affecte-t-elle le salaire ? | Non, seule une absence tranchée Non justifiée compte |
| Une punition affecte-t-elle automatiquement le salaire ? | Non, seule une retenue avec montant est déduite |
| Un bulletin déjà généré change-t-il si une absence est reclassée après coup ? | Non, jamais — il reste figé tel qu'il a été calculé |
| Puis-je consulter mes propres bulletins sans accès au module Travailleurs ? | Oui, depuis l'écran Profil |

**Prochain sous-chapitre** : Volume 22i — Équipe et Approbations.

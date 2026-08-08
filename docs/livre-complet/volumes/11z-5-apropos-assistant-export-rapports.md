# Volume 11z-5 — À propos, Email professionnel, Assistant, Rapports et Export

**Niveau de risque : 2 — Fonctionnel standard.** Dernier sous-chapitre du Volume 11z : il referme le reste du back-end Niveau 2 en couvrant cinq modules qui, ensemble, dessinent la couche « communication et restitution » de l'application — vers l'extérieur (À propos, Email pro), vers l'équipe (Assistant), et vers celui qui consulte ses propres données ou celles de l'équipe (Rapports, Export).

## 1. Ce que couvre ce chapitre

- `apps/api/src/routes/apropos.ts`, `apps/web/src/pages/APropos.tsx`
- `apps/api/src/services/emailPro.ts`, `apps/api/src/lib/cloudflareEmail.ts`, `apps/web/src/components/PanneauEmailPro.tsx` (mécanisme déjà entrevu aux Volumes 11k-1 et 11z-4, couvert ici dans son intégralité)
- `apps/api/src/routes/assistant.ts`, `apps/api/src/lib/ia.ts`, `apps/web/src/pages/Assistant.tsx`
- `apps/api/src/routes/rapports.ts` (widgets du Tableau de bord), `apps/api/src/routes/rapports-personnels.ts`, `apps/web/src/pages/RapportsPersonnels.tsx`
- `apps/api/src/routes/export.ts`, `apps/api/src/services/email.ts`, `construirePdf` générique de `apps/api/src/services/pdf.ts` (fonction restante depuis le Volume 11z-2), `apps/web/src/components/BarreExport.tsx`

`apps/web/src/pages/Dashboard.tsx` (l'écran qui consomme `routes/rapports.ts` côté widgets KPI) n'est **pas** couvert ici — fichier volumineux (593 lignes) laissé à un futur chapitre dédié, la logique serveur qu'il consomme étant, elle, entièrement expliquée dans ce chapitre.

## 2. À propos (`apropos.ts` / `APropos.tsx`)

Route courte, jumelle de `routes/parametres.ts` (Volume 11z-4) : `chargerAPropos()` lit six clés génériques via `lireParametre`, dont trois sont **la même donnée** que Paramètres (nom, adresse, contact boutique) — modifiable depuis l'un ou l'autre écran, jamais une copie séparée, confirmé par l'invalidation croisée des deux clés de requête (`["apropos"]`/`["parametres"]`) après chaque enregistrement. Trois champs propres à cet écran : présentation libre, horaires, et une liste extensible de réseaux sociaux (`plateforme`/`lien`), stockée en JSON dans une seule clé `ParametreBoutique` — `lireReseauxSociaux` absorbe silencieusement un JSON corrompu (retourne un tableau vide plutôt qu'une exception qui casserait une page accessible à **tous** les rôles).

Deux points de sécurité déjà couverts en amont dans l'historique du projet, retrouvés ici tels quels dans le code : la lecture n'exige **aucune** permission de module (seule l'authentification), cohérent avec la spec (« page accessible à tous les rôles ») ; et côté client, `estLienHttpSur` filtre les liens de réseaux sociaux qui ne commencent pas par `http(s)://` avant de les rendre en `<a href>` — défense en profondeur pour un lien enregistré avant le durcissement du schéma Zod serveur (referme la faille XSS `javascript:` déjà mentionnée dans l'historique du projet, ici visible directement dans le commentaire du code). Le **crédit développeur** (`CREDIT_DEVELOPPEUR`, nom et téléphone) est affiché en dur côté client, non éditable, et **volontairement absent** des PDF exportés (§7) — la spec précise explicitement cette restriction (3.12 : « affiché uniquement ici — pas sur les rapports exportés »), confirmée par le commentaire de `services/pdf.ts` (« pas de crédit développeur ici, réservé à la page À propos »).

## 3. Email professionnel — le mécanisme complet (`emailPro.ts` + `cloudflareEmail.ts`)

Ce mécanisme, entrevu à deux reprises (fiche Travailleur, Volume 11k-1 ; Assistant de premier lancement, Volume 11z-4) sans être expliqué lui-même, est maintenant couvert intégralement — un seul mécanisme, deux points d'entrée, exactement comme documenté dans le code.

### 3.1 `lib/cloudflareEmail.ts` — deux portées Cloudflare distinctes

Point technique central, commenté explicitement en tête de fichier : Cloudflare Email Routing expose **deux familles d'endpoints, à des portées différentes** — les adresses de *destination* vivent au niveau **Compte** (`/accounts/{account_id}/...`, jeton avec la permission « Email Routing Addresses: Edit »), les règles de *routage* vivent au niveau **Zone** (`/zones/{zone_id}/...`, permission « Email Routing Rules: Edit »). Un jeton limité à l'une des deux ne suffit pas pour l'autre — nuance déjà posée au Volume 5 lors de la présentation des variables d'environnement (`CLOUDFLARE_ACCOUNT_ID` vs `CLOUDFLARE_ZONE_ID`), vérifiée ici dans le code qui les consomme réellement. `trouverDestinationExistante` recherche d'abord une adresse déjà enregistrée avant d'en créer une nouvelle — plus robuste qu'analyser le texte (non stable dans le temps) d'une erreur « duplicate » de l'API.

### 3.2 `services/emailPro.ts` — génération d'adresse et séquencement

`baseAdresseDepuisNom` construit une adresse `prenom.nom@` à partir du nom complet (premier mot = prénom, reste = nom), avec normalisation des accents/diacritiques (`normaliserPourEmail`) ; `genererAdresseProUnique` ajoute un suffixe numérique en cas de collision entre deux travailleurs de même prénom+nom. `declencherEmailPro` orchestre la séquence complète : créer/récupérer la destination Cloudflare (déclenche l'email de vérification chez l'employé), puis — **seulement si la destination est déjà vérifiée** (cas rare à cette étape, ex. réutilisation d'une adresse existante) — poser immédiatement la règle de routage. Sinon, `verifierEmailPro` complète la boucle plus tard : ré-interroge Cloudflare, et pose la règle dès que `destination.verified` devient vrai. Aucun échec Cloudflare n'est silencieux : le motif exact remonte jusqu'au champ `emailProErreur` de la fiche, visible par l'Admin.

### 3.3 `PanneauEmailPro` — un seul composant, deux `basePath`

Le composant frontend partagé accepte un `basePath` en prop (`/api/travailleurs` pour la fiche normale, `/api/premier-lancement/travailleur` pour l'assistant public) — un seul code, deux routeurs API différents selon le contexte d'appel. Il s'auto-actualise toutes les 20 secondes tant que le statut reste `EN_ATTENTE_VERIFICATION` (`setInterval` sur `verifierEmailPro`), en complément du bouton manuel — la vérification dépendant du clic de l'employé sur un lien reçu, hors du contrôle de l'application, l'actualisation automatique évite d'avoir à cliquer répétitivement « Vérifier le statut ».

## 4. Assistant — support humain avec premier niveau IA (`assistant.ts` + `lib/ia.ts`)

### 4.1 `lib/ia.ts` — appel Gemini, jamais d'exception qui remonte

`appelerGemini` est un appel bas niveau « sans filet », qui retourne toujours un résultat structuré distinguant précisément la cause d'échec (`CLE_ABSENTE`, `HTTP`, `REPONSE_VIDE`, `EXCEPTION`) — jamais un booléen ou une exception générique. Deux fonctions exposées consomment ce résultat différemment : `repondreAssistantIA` (utilisée par le chat) **masque toujours l'échec** derrière un repli `null`, en journalisant le détail précis côté serveur (jamais la clé API elle-même — `clientKeyMasquee` n'en affiche que les 4 premiers et 2 derniers caractères) ; `testerConnexionIA` (utilisée par le diagnostic Admin, Volume 11z-4) renvoie au contraire le détail brut, pour que l'Admin puisse s'auto-diagnostiquer sans accès aux logs serveur. Le `PROMPT_SYSTEME` encode un résumé du fonctionnement réel de l'application (sections 3.1 à 3.19) directement en dur dans le code plutôt que de repasser toute la spécification à chaque appel — maintenu manuellement, donc sujet à dérive si une fonctionnalité change sans que ce prompt soit mis à jour (**non vérifié dans ce chapitre** que ce texte soit parfaitement synchronisé avec l'état actuel de chaque module — hors du périmètre d'un contrôle automatisable).

### 4.2 `routes/assistant.ts` — conversations, escalade, notification Admin

`IA_ACTIVE = process.env.ASSISTANT_IA_ACTIF === "true"` (flag déjà documenté au Volume 5) gouverne tout le comportement : IA désactivée par défaut, cohérent avec la spec (« mode humain, IA désactivée temporairement... bloquée par la facturation Google Cloud à finaliser »load, reprise prévue en réactivant simplement le flag). `POST /messages` (vue utilisateur) enchaîne : créer/reprendre la conversation ouverte → créer le message → diffuser en temps réel → si non escaladée et IA active, appeler `repondreAssistantIA` avec les 20 derniers échanges ; sinon (ou en cas d'échec IA), **escalader automatiquement** vers un humain — jamais l'utilisateur n'est laissé sans réponse, quoi qu'il arrive côté IA. `notifierAdmins` utilise `destinataireIdsDirects` (Volume 11z-4, §2) pour cibler nommément tous les comptes Admin actifs, hors matrice de permissions classique — cohérent avec l'absence de permission métier des Admins sur les modules opérationnels. Le bouton « Parler à un Admin » (`POST /escalader`) court-circuite directement l'IA, sans attendre un échec. Côté Admin, `POST /conversations/:id/messages` escalade systématiquement la conversation dès qu'un humain répond — l'IA ne doit plus jamais intervenir une fois qu'un Admin a rejoint le fil.

### 4.3 Frontend — deux vues, un composeur partagé

`AssistantPage` aiguille entre `VueUtilisateur` (sa propre conversation, la plus récente ouverte ou fermée — pour ne pas faire disparaître l'historique d'une conversation qui vient d'être close) et `VueAdmin` (file de toutes les conversations, `refetchInterval: 20000` en complément du temps réel, mise en page « liste + fil » qui masque l'une ou l'autre sur mobile selon la sélection). `Composeur`, réutilisé par les deux vues, gère la saisie texte et une capture d'écran encodée en base64 côté client (`FileReader.readAsDataURL`), plafonnée à 3 Mo bruts — cohérent avec la limite `express.json({ limit: "5mb" })` posée dans `app.ts` (Volume 8) une fois l'encodage base64 pris en compte.

## 5. Rapports — les widgets du Tableau de bord (`routes/rapports.ts`)

Sept routes, une par widget (`caisse`, `commandes`, `commissions`, `stock`, `production`, `fournisseurs`, `travailleurs`), chacune gardée par la permission `LECTURE` de son module respectif — implémentation directe de la règle de composition par rôle de la spec 3.8 (« chaque widget n'apparaît que si le rôle connecté a au moins la lecture sur le module correspondant »). Le widget Caisse (`registreSur`) reproduit fidèlement la logique déjà expliquée au Volume 11j (entrées = `montantRecu` moins les règlements déjà mouvementés, pour ne jamais compter deux fois le même argent), avec une série de 30 jours calculée par une requête SQL brute (`$queryRaw`) combinant trois sources (commandes, règlements, dépenses) — choix motivé par la difficulté d'exprimer une agrégation par jour glissant proprement en Prisma pur.

**Observation de documentation interne (pas un écart spec/code)** : le commentaire au-dessus de `GET /cloture-quotidienne` affirme « Réservé au DG via la matrice : seul son rôle a la lecture sur RAPPORTS (les Admins n'ont aucune permission métier...) ». Vérification faite dans `prisma/seed.ts` (Volume 13) : `TOUS_LES_MODULES = Object.values(Module)` inclut `RAPPORTS`, et la matrice de base du rôle Administrateur (`TOUS_LES_MODULES.filter((m) => m !== PARAMETRES && m !== EQUIPE && m !== TRAVAILLEURS).map(lecture)`) n'exclut pas `RAPPORTS` — les deux niveaux d'Admin ont donc bien `lecture(RAPPORTS)`. Ce commentaire semble antérieur à la mise à jour « Portée étendue » de la spec 3.8 (« disponible pour le DG et les deux niveaux d'Admin »), qui a corrigé la portée réelle sans que le commentaire du code soit mis à jour en conséquence. Le comportement effectif (`requirePermission("RAPPORTS", "LECTURE")`) reste correct — seul le commentaire, qui explique une raison désormais partiellement inexacte, est resté figé. Incohérence documentaire interne au code, comparable au commentaire obsolète découvert sur `schema.prisma` au Volume 13 — sans conséquence fonctionnelle.

## 6. Rapports personnels — portée dédiée, hors matrice (`rapports-personnels.ts`)

Module technique **délibérément séparé** de la matrice de permissions standard — la spec (3.13) l'exige explicitement (« ne se réduit pas à une entrée standard dans `RolePermission`... mécanisme dédié »). `resoudrePortee` implémente exactement les trois niveaux de la spec : portée globale pour DG et Administrateur (`ROLES_PORTEE_GLOBALE`), exception nommée pour le Caissier(ère) qui voit aussi les rapports du Chargé des commandes (`EXCEPTIONS_PORTEE`, une simple table de correspondance rôle → rôles supplémentaires), et repli sur soi-même pour tous les autres rôles. `GET /` agrège l'activité depuis **huit sources différentes** (commandes clients, règlements, dépenses de caisse, productions, mouvements de stock, commandes fournisseur/réceptions, pointages, absences), chacune filtrée par son propre champ auteur (`creeParId`, `enregistreParId`, `auteurId`, `declareParId`/`decideParId`...) — les absences génèrent même **deux entrées distinctes** par enregistrement (déclaration et décision, potentiellement par deux personnes différentes), avec un suffixe d'ID (`:declaration`/`:decision`) qui évite toute collision. Le tri final se fait en mémoire sur toutes les sources combinées (`_tri`, champ interne retiré avant la réponse JSON), plafonné à 200 résultats au total.

## 7. Export — génération PDF partagée (`export.ts`, `services/email.ts`, `construirePdf`)

### 7.1 Vérification de permission a posteriori, pas seulement côté client

`moduleInterdit` revérifie côté serveur, pour chaque module dont le document exporté tire ses données, que l'appelant a bien la lecture — un utilisateur sans accès à Commissions ne peut donc pas obtenir cet export en forgeant directement la requête HTTP, même si l'écran qui construit normalement ce document ne le lui aurait jamais proposé. `GET /capacites` indique simplement au frontend si `emailConfigure()` (Volume 11z-4-adjacent, ici dans `services/email.ts`) est vrai, pour savoir si le bouton « Envoyer par email » doit apparaître.

### 7.2 `construirePdf` — un seul générateur, trois écrans

Fonction générique de `services/pdf.ts`, distincte de `construirePdfBonsLivraison` (Volume 11z-2, spécifique au Bon de livraison). Elle prend un `DocumentExportInput` générique (titre, sous-titre, sections avec en-têtes et lignes) et produit un PDF de marque complet : en-tête avec logo et tagline, sections tabulaires avec lignes zébrées, logo en filigrane à 6 % d'opacité sur chaque page (appliqué **après** le contenu, pdfkit ne permettant pas de repasser sous une page déjà remplie), pagination en pied de page. Le curseur vertical est suivi manuellement (`y`) car `doc.text()` déplace aussi son propre curseur interne — s'y fier ferait dériver la pagination, commentaire explicite dans le code. Une seule implémentation, partagée par le téléchargement (`POST /pdf`) et l'envoi par email (`POST /email`) — pas de logique dupliquée entre les deux chemins.

### 7.3 `services/email.ts` — Nodemailer via Gmail

`envoyerRapport` envoie le PDF en pièce jointe via un transporteur Nodemailer configuré pour Gmail/Google Workspace, authentifié par un **mot de passe d'application** (jamais le mot de passe principal du compte — terme déjà défini au Glossaire, Volume 5). Le transporteur est mémorisé après sa première création (`transporteur` en variable de module) plutôt que reconstruit à chaque envoi. Un échec SMTP (identifiants refusés, réseau...) est capturé et transformé en `ErreurEmail(502, ...)` avec le message d'origine — jamais un `500` opaque.

### 7.4 `BarreExport` — un composant, trois écrans

Composant partagé par Rapports personnels (ce chapitre), Tableau de bord (`Dashboard.tsx`, non couvert ici) et Commissions (Volume 11i) — confirmé par le commentaire du code. Trois actions : impression navigateur (`window.print()`, réutilisable pour « Enregistrer en PDF » localement, sans appel serveur), téléchargement du PDF serveur (`fetch` direct + `Authorization` manuel, motif désormais familier depuis les Volumes 11z-2 et 11z-4 pour toute réponse binaire), et envoi par email (bouton visible seulement si `capacites.email` est vrai). `RapportsPersonnelsPage` illustre le cas `modules: []` — la portée ayant déjà été résolue côté serveur par le mécanisme dédié de `rapports-personnels.ts`, aucun module n'a besoin d'être déclaré pour l'export : l'utilisateur n'exporte jamais que ce qu'il voit déjà.

## 8. Croisement avec `docs/spec-boulangerie.md`

- Section 3.12 (À propos, page publique, champs partagés avec Paramètres, crédit développeur réservé à cet écran) : confirmé intégralement. Aucun écart.
- Section 3.18 (email professionnel, Cloudflare Email Routing, deux portées de jeton distinctes) : confirmé. Aucun écart.
- Section 3.19 (Assistant, chat temps réel, IA codée mais désactivée par défaut) : confirmé, y compris le flag `ASSISTANT_IA_ACTIF`. Aucun écart.
- Section 3.13 (Rapports personnels, portée dédiée par personne + exceptions nommées, export PDF/email partagé avec 3.8/3.11) : confirmé exhaustivement. Aucun écart.
- Section 3.8 (composition des widgets par permission de module, « Portée étendue » du résumé de clôture) : confirmé — voir l'observation de commentaire obsolète, §5.

Aucun écart spec/code trouvé dans ce chapitre — une observation de documentation interne (commentaire de `rapports.ts` non mis à jour après l'extension de portée de la spec).

## 9. Erreurs fréquentes et cas limites

- **Réseau social avec un lien `javascript:` enregistré avant le durcissement du schéma** : filtré côté client avant rendu, jamais exécuté au clic.
- **Cloudflare : jeton avec la seule permission Zone** : échoue précisément à la création de la destination (portée Compte), avec un message qui identifie clairement quelle permission manque.
- **Échec de l'appel Gemini, quelle qu'en soit la cause** : jamais d'exception qui romprait l'envoi du message utilisateur — repli automatique vers l'escalade humaine.
- **Export demandé sur un module sans permission de lecture** : rejeté par `moduleInterdit`, même si la requête est forgée manuellement en contournant l'écran normal.
- **Échec SMTP à l'envoi d'un rapport par email** : message actionnable (`502`), jamais un `500` générique.

## 10. Résumé — clôture du Volume 11z

Ce chapitre referme le reste du back-end Niveau 2 amorcé au Volume 11z-1. Les cinq sous-chapitres (11z-1 à 11z-5) ont couvert 12 routeurs API, 12 services, et une vingtaine de composants/pages frontend, sans qu'aucun écart spec/code n'ait été trouvé sur l'ensemble — seulement des observations mineures de qualité de code ou de documentation interne (chemin serveur inatteignable par l'UI, retour visuel incohérent entre deux écrans utilisant le même mécanisme, deux commentaires devenus obsolètes après une évolution de la spec). Les mêmes techniques transversales identifiées dès le Niveau 1 — compare-and-set, transaction `Serializable`, remplacement intégral plutôt que diff, génération PDF de marque cohérente, ciblage de notification par matrice de permissions — se retrouvent sans variation dans chacun de ces modules, confirmant qu'il s'agit bien de conventions du projet et non de choix ponctuels.

---

**Suite →** Volume 12 — API et communications réseau : `lib/realtime.ts`, `lib/events.ts`, `lib/socket.tsx`, `ActivityFeed.tsx`, `IndicateurConnexion.tsx` — le **transport** temps réel sur lequel reposent tous les mécanismes de notification déjà expliqués dans les Volumes 11 et 11z.

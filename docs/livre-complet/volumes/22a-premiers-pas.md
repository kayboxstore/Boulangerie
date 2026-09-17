# Volume 22a — Premiers pas

> Premier sous-chapitre du Volume 22 (Guide complet d'utilisation). Contrairement aux Volumes 1-21, qui expliquaient le fonctionnement interne du code, cette partie du livre explique **comment utiliser l'application** — écran par écran, du point de vue d'un membre de l'équipe de la boulangerie. Chaque affirmation s'appuie sur le comportement déjà vérifié techniquement dans les chapitres précédents (référencés au fil du texte) et croisé avec `docs/spec-boulangerie.md`.

## 1. Installer et déployer l'application

Ce guide ne répète pas la procédure d'installation, déjà couverte en détail par deux chapitres :
- **Pour un développeur qui installe le projet sur sa machine** : Volume 4 (Installation de l'environnement), qui détaille les 5 étapes du `README.md` — Node.js, dépendances, base PostgreSQL, migrations, démarrage.
- **Pour mettre l'application en ligne, accessible depuis un téléphone** : Volume 21 (Construction et déploiement), qui détaille la procédure de déploiement sur Render à partir de `render.yaml`, ainsi que les points de vigilance opérationnels réels (notamment l'expiration d'une base PostgreSQL gratuite après 30 jours — le risque le plus grave identifié dans tout ce livre).

Ce sous-chapitre commence là où ces deux volumes s'arrêtent : l'application est installée et démarrée, son adresse est ouverte dans un navigateur pour la première fois.

## 2. Le tout premier démarrage : la base est vide

### 2.1 Ce qui s'affiche, et pourquoi

Tant qu'**aucun compte n'existe encore** dans la base de données, l'écran de connexion habituel n'apparaît pas — il est remplacé par un **Assistant de premier lancement**, un écran plein cadre distinct du reste de l'application (pas de menu, pas de barre de navigation). Ce comportement est vérifié techniquement au Volume 8 (cycle de démarrage, `App.tsx` interroge `GET /api/auth/etat-initial`, une route volontairement publique — Volume 11c, §4.3 — qui ne révèle qu'un booléen : « la base contient-elle au moins un compte ? ») et détaillé en profondeur au Volume 11z-4 (§6, `routes/premierLancement.ts`).

**Pourquoi cette façon de faire ?** La spec (section 3.7) prévoit ce cas précis : « quand la base ne contient aucun compte Utilisateur ». Il n'existe littéralement personne pour se connecter à ce stade — il faut donc un chemin qui ne dépende d'aucune authentification préalable, tout en restant sûr. C'est pour cette raison que **rien d'autre dans l'application n'est accessible tant que cet assistant n'est pas terminé** (vérifié au Volume 11z-4 : chaque route de l'assistant revérifie elle-même que la base est toujours vide, plutôt que de s'appuyer sur un jeton d'authentification qui ne peut pas exister à ce stade).

### 2.2 Les trois écrans de l'assistant

L'assistant crée, dans cet ordre strict, le tout premier compte de l'application — qui sera automatiquement l'**Admin Principal** (le super utilisateur décrit à la spec section 2).

**Écran 1 — Identité du futur Admin Principal.** Un formulaire simple : nom, poste, téléphone (facultatif), date d'embauche. Ce sont exactement les mêmes champs qu'une fiche Travailleur ordinaire (Volume 11k-1) — le futur Admin Principal est, comme tout le monde dans l'application, d'abord une fiche Travailleur avant d'être un compte utilisateur.

**Écran 2 — Adresse e-mail professionnelle.** Une fois la fiche créée, un panneau (le même composant que celui utilisé sur une fiche Travailleur classique, Volume 11k-1) propose de générer une adresse e-mail professionnelle (`prenom.nom@ledomaine`) via l'intégration Cloudflare déjà détaillée au Volume 11z-5. C'est une étape **obligatoire** : sans adresse professionnelle active, il n'existe aucun moyen de passer à l'écran suivant, cohérent avec la règle générale déjà rencontrée pour tout le reste de l'équipe (Volume 11d) — un compte utilisateur ne peut être créé que depuis une fiche Travailleur dont l'e-mail professionnel est actif, plus de saisie libre d'adresse.

**Écran 3 — Mot de passe.** Apparaît seulement une fois l'e-mail professionnel actif : le mot de passe du compte (8 caractères minimum, saisi deux fois pour confirmation). À la validation, le compte Administrateur (avec le statut Admin Principal) est créé, et l'application tente une **connexion automatique** avec l'adresse professionnelle qui vient d'être générée et le mot de passe qui vient d'être choisi — pour ne jamais avoir à ressaisir ces informations une seconde fois immédiatement après les avoir tapées.

### 2.3 Si la connexion automatique échoue

Un détail vérifié dans le code (`PremierLancementPage`) et qui mérite d'être connu : si cette connexion automatique finale échoue pour une raison ponctuelle (réseau, par exemple), **le compte a tout de même été créé avec succès** — seule la tentative de connexion automatique a échoué. Il suffit alors de se rendre sur l'écran de connexion normal (§3 ci-dessous) et de se connecter manuellement avec l'adresse professionnelle et le mot de passe qui viennent d'être définis.

## 3. Se connecter

### 3.1 L'écran de connexion normal

Une fois qu'au moins un compte existe, l'écran habituel apparaît : adresse e-mail, mot de passe, bouton de connexion. Comportement vérifié en détail au Volume 11c :

- **Un message d'erreur volontairement vague** (« E-mail ou mot de passe incorrect ») s'affiche aussi bien pour une adresse inexistante que pour un mot de passe incorrect — jamais l'un ou l'autre distinctement. Ce n'est pas un défaut d'ergonomie : c'est une protection délibérée contre l'énumération de comptes (un attaquant ne peut pas déduire, à partir du message reçu, si une adresse e-mail donnée correspond à un compte réel de l'application).
- **Un compte désactivé** affiche en revanche un message spécifique (« Compte désactivé — contactez un administrateur ») — mais seulement après que le mot de passe correct a été fourni, jamais avant (Volume 11c, §4.1, étape 5). Si votre compte a été désactivé par un Administrateur (par exemple lors d'un départ temporaire ou d'une réorganisation, Volume 11d), c'est le seul cas où le message vous informera précisément de la raison de l'échec.

### 3.2 La règle de session unique

Un point de comportement à connaître avant qu'il ne surprenne un jour : la spec (section 3.7) impose qu'**un seul appareil à la fois** puisse être connecté à un même compte. Se connecter depuis un deuxième appareil (par exemple, se connecter sur un ordinateur alors qu'on était déjà connecté sur son téléphone) déconnecte **immédiatement** l'appareil précédent — vérifié en détail au Volume 11b et au Volume 11c (§4.2, avec un diagramme de séquence complet) : si l'ancien appareil est encore ouvert au moment de la nouvelle connexion, un message explicite apparaît sur son écran expliquant qu'une nouvelle connexion a eu lieu ailleurs ; s'il était déjà fermé ou hors ligne, il découvrira ce fait à sa prochaine tentative d'action.

Ce n'est pas un bug ni une limite technique — c'est une règle de sécurité volontaire (un seul point de connexion actif par compte à la fois, pour qu'un jeton de session oublié ou compromis quelque part ne puisse jamais coexister silencieusement avec une session légitime).

### 3.3 Mot de passe oublié — une limite réelle à connaître

**Point vérifié pour ce chapitre, en réponse à une question restée ouverte au Volume 11c** : il n'existe **aucune** procédure de type « mot de passe oublié » nulle part dans l'application — ni côté écran de connexion (aucun lien « mot de passe oublié »), ni côté Administration (recherche exhaustive dans `routes/equipe.ts` : la seule route qui définit un mot de passe est celle de la **création** d'un compte, aucune route de réinitialisation par un tiers n'existe). La spec elle-même ne mentionne cette possibilité nulle part non plus — ce n'est donc pas un écart entre la spec et le code, simplement une fonctionnalité absente des deux.

**Conséquence pratique pour l'utilisation quotidienne** : si un membre de l'équipe oublie son mot de passe, la seule solution actuelle est que **lui-même**, une fois reconnecté, le change depuis son propre écran Profil (Volume 18c, §2.4 — qui exige de connaître l'ancien mot de passe) — ce qui suppose donc de connaître encore l'ancien. Il n'existe aujourd'hui aucun moyen, ni pour un Administrateur ni pour quiconque d'autre, de réinitialiser le mot de passe d'un compte qui l'a réellement perdu, sans intervention directe sur la base de données (hors du périmètre de l'application elle-même, et donc hors du périmètre de ce guide).

### 3.4 La langue de l'écran de connexion

L'écran de connexion s'affiche par défaut dans la **langue de la boutique** (réglable par un Administrateur depuis l'écran Paramètres, Volume 11z-4) — cohérent avec le fait que personne n'est encore connecté à ce stade, donc aucune préférence individuelle (Volume 18c, §2.3) ne peut encore s'appliquer. Une fois connecté, chaque utilisateur peut choisir sa propre langue d'affichage (français, anglais, lingala ou kiswahili — les deux dernières signalées comme premier jet non définitif, Volume 17) depuis son écran Profil, indépendamment de la langue par défaut de la boutique.

## 4. Se déconnecter

Un bouton de déconnexion est disponible en permanence dans l'ossature de l'application (`Layout`, Volume 9). Se déconnecter met fin à la session côté client (le jeton est effacé) — contrairement à une nouvelle connexion depuis un autre appareil, une déconnexion volontaire ne déclenche aucune notification particulière : elle ramène simplement à l'écran de connexion.

## 5. Résumé du sous-chapitre

| Étape | Ce qu'il faut savoir |
|---|---|
| Base vide | L'Assistant de premier lancement remplace l'écran de connexion, en 3 écrans : fiche → e-mail professionnel (obligatoire) → mot de passe |
| Connexion | Message d'erreur volontairement identique pour e-mail inconnu et mot de passe incorrect (anti-énumération) |
| Session unique | Une nouvelle connexion déconnecte immédiatement tout autre appareil déjà connecté au même compte |
| Mot de passe oublié | Aucune procédure de réinitialisation n'existe — connaître l'ancien mot de passe reste indispensable |
| Langue | Langue de la boutique avant connexion, langue individuelle possible après (écran Profil) |

**Prochain sous-chapitre** : Volume 22b — Rôles et permissions (ce que chacun peut faire dans l'application, sous forme de guide pratique plutôt que de matrice technique).

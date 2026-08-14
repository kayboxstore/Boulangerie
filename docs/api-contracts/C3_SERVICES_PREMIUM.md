# C3 — Services Premium : contrats API

Base de référence : `agent/integration-wave-1@f2c3d2399751e0c54c6f1afa5accd5dcff980783`.

Tous les chemins sont relatifs à la même origine que l'application. Les dates civiles sont des chaînes `AAAA-MM-JJ` et le jour opérationnel est calculé dans `Africa/Kinshasa`.

## Récupération du mot de passe

### `POST /api/auth/mot-de-passe-oublie`

Route publique.

Requête :

```json
{ "email": "agent@boulangerie-lomoto.com" }
```

Réponse `202`, identique si l'adresse est inconnue, inactive, en temporisation ou si l'envoi échoue :

```json
{ "message": "Si cette adresse correspond à un compte actif, un lien de réinitialisation a été envoyé." }
```

Une adresse syntaxiquement invalide reçoit `400`. Limites : 5 requêtes par adresse IP sur 15 minutes, et au plus un jeton actif créé par compte toutes les 2 minutes. Le jeton brut n'est envoyé que par e-mail ; seul son SHA-256 est stocké. Durée : 30 minutes.

### `POST /api/auth/reinitialisation/verifier`

Route publique, limitée à 10 requêtes par adresse IP sur 15 minutes.

Requête :

```json
{ "jeton": "<jeton reçu par e-mail>" }
```

Réponse `200` :

```json
{ "valide": true }
```

Un jeton absent, mal formé, inconnu, expiré ou utilisé renvoie toujours `{ "valide": false }`.

### `POST /api/auth/reinitialisation`

Route publique, limitée à 10 requêtes par adresse IP sur 15 minutes.

Requête :

```json
{
  "jeton": "<jeton reçu par e-mail>",
  "nouveauMotDePasse": "NouveauSecretSolide"
}
```

Succès : `204`, corps vide. La consommation du jeton et le changement du secret sont atomiques. Tous les autres jetons du compte et sa session active sont révoqués. Une seconde utilisation reçoit `400` :

```json
{
  "code": "JETON_INVALIDE_OU_EXPIRE",
  "erreur": "Ce lien de réinitialisation est invalide, expiré ou déjà utilisé."
}
```

## Session et mot de passe temporaire

Les objets `utilisateur` de la connexion et `compte` du module Équipe peuvent contenir :

```json
{ "motDePasseDoitChanger": true }
```

Quand cette valeur est vraie, le JWT reste utilisable uniquement pour :

- `GET /api/auth/me` ;
- `POST /api/auth/mot-de-passe`.

Toute route métier reçoit `403` avec le code `MOT_DE_PASSE_A_CHANGER`, et la connexion Socket.io est refusée. Après remplacement réussi, le drapeau revient à `false`.

### `POST /api/equipe/:id/mot-de-passe-temporaire`

Authentification Bearer et permission `EQUIPE:ECRITURE`. Un Admin secondaire ne peut pas cibler l'Admin principal ; personne ne peut se cibler soi-même par cette route.

Réponse `201` :

```json
{
  "motDePasseTemporaire": "Lm9!…",
  "doitChanger": true
}
```

Le mot de passe temporaire est retourné une seule fois dans cette réponse, jamais persisté en clair. La session précédente de la cible est immédiatement révoquée.

## Profil privé

### `GET /api/auth/profil`

Authentification Bearer. Renvoie seulement le profil du compte connecté :

```json
{
  "profil": {
    "id": "…",
    "nom": "Nom",
    "email": "agent@boulangerie-lomoto.com",
    "roleNom": "Production",
    "languePreferee": "FR",
    "travailleur": {
      "id": "…",
      "poste": "Boulanger",
      "departementNom": "Production",
      "dateNaissance": "1990-08-13"
    }
  }
}
```

`travailleur` et `dateNaissance` peuvent être `null`. Cette date privée n'est jamais incluse dans l'endpoint d'anniversaires.

### `PUT /api/auth/profil`

Authentification Bearer. Le compte connecté peut modifier uniquement sa propre date de naissance :

```json
{ "dateNaissance": "1990-08-13" }
```

Envoyer `null` efface la date. Réponse : même enveloppe que `GET /api/auth/profil`. Sans fiche Travailleur liée : `409`.

## Anniversaires

### `POST /api/auth/anniversaires/aujourdhui`

Authentification Bearer. Réserve atomiquement l'affichage pour le compte et le jour civil de Kinshasa.

Premier appel du jour avec plusieurs anniversaires :

```json
{
  "date": "2026-08-13",
  "noms": ["Alain", "Zoé"],
  "dejaAffiche": false
}
```

Appels suivants le même jour :

```json
{
  "date": "2026-08-13",
  "noms": [],
  "dejaAffiche": true
}
```

S'il n'y a aucun anniversaire : liste vide et `dejaAffiche: false`; aucune réservation n'est créée. La réponse expose uniquement les noms triés et groupés : ni identifiant, ni date de naissance, ni âge.

## Types partagés

Schémas exportés par `@lomoto/shared` :

- `demandeReinitialisationSchema` ;
- `verificationReinitialisationSchema` ;
- `reinitialisationMotDePasseSchema` ;
- `profilPriveUpdateSchema`.

DTO exportés : `ProfilPriveDTO`, `AnniversairesDuJourDTO`, `MotDePasseTemporaireDTO`.

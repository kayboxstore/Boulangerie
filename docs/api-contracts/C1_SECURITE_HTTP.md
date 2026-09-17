# Contrats C1 — sécurité HTTP et filet de tests

**Base :** `main-a7fm5x` au commit `f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35`  
**Branche :** `codex/backend-safety-c1`

## Identifiant de requête

Chaque réponse API porte l’en-tête `X-Request-Id`. La valeur est un UUID généré par le serveur ; un identifiant fourni par le client n’est jamais réutilisé.

Les erreurs communes reprennent la même valeur dans `idRequete` :

```json
{
  "erreur": "Message lisible par l’utilisateur",
  "code": "CODE_STABLE",
  "idRequete": "00000000-0000-0000-0000-000000000000"
}
```

Le champ historique `erreur` est conservé pour ne pas casser le frontend existant.

## Erreurs communes ajoutées

| HTTP | `code` | Usage |
|---:|---|---|
| 404 | `RESSOURCE_INTROUVABLE` | Route API inexistante |
| 429 | `TROP_DE_REQUETES` | Limitation d’une route publique sensible |
| 500 | `ERREUR_INTERNE` | Erreur non gérée, sans détail technique exposé |

## Limitation de fréquence

| Route | Limite | Fenêtre |
|---|---:|---:|
| `POST /api/auth/login` | 10 tentatives par adresse IP | 15 minutes |
| `/api/auth/etat-initial` | 60 requêtes par adresse IP | 15 minutes |
| `/api/auth/langue-defaut` | 60 requêtes par adresse IP | 15 minutes |
| `/api/premier-lancement/**` | 60 requêtes par adresse IP | 15 minutes |

Les réponses utilisent les en-têtes standard de `RateLimit`. Les anciens en-têtes `X-RateLimit-*` sont désactivés.

## Proxy de confiance

`TRUST_PROXY_HOPS` fixe le nombre exact de proxies devant Express. Valeur par défaut : `1` en production, `0` ailleurs. Cette valeur doit correspondre à l’hébergement réel pour que l’adresse IP utilisée par la limitation soit fiable.

## En-têtes de sécurité

Helmet applique les en-têtes de sécurité HTTP communs. Le CORS existant et sa liste d’origines sont conservés.

## Couverture automatisée C1

- en-têtes Helmet et `X-Request-Id` ;
- rejet d’un identifiant de requête contrôlé par le client ;
- format 404 corrélable ;
- limitation de la connexion ;
- rejet sans jeton ;
- rejet d’une session remplacée ;
- autorisation/refus selon permission serveur ;
- isolation de l’historique des notifications ;
- impossibilité de marquer la notification d’un autre compte ;
- marquage en masse limité au compte connecté.

Les tests utilisent des doubles Prisma et ne nécessitent ni base de production ni données Lomoto.

## Éléments volontairement reportés

C1 ne modifie pas les règles financières, le modèle des commandes, le registre de caisse, l’archivage des produits, l’idempotence métier ni le frontend. Ces sujets nécessitent des PR séparées après stabilisation du filet de tests.

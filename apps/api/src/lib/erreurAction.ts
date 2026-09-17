/**
 * Erreur métier d'une action critique, mappée en statut HTTP par l'appelant.
 *
 * Déplacée hors de `services/actionsCritiques.ts` (Round 2 du correctif P1,
 * contre-revue Codex du 24/08/2026) : `services/permissionsRoleAudit.ts` en
 * a désormais besoin lui aussi (404 « Rôle introuvable » levé DANS la
 * transaction d'approbation), et `actionsCritiques.ts` importe déjà
 * `permissionsRoleAudit.ts` — la garder dans `actionsCritiques.ts` aurait
 * créé un import circulaire entre les deux fichiers.
 */
export class ErreurAction extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

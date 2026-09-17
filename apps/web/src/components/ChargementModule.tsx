/**
 * Fallback de chargement aux couleurs Lomoto (logo qui pulse), affiché pendant
 * qu'un module chargé en lazy est récupéré. `plein` = plein écran (état d'auth
 * initial) ; sinon centré dans la zone de contenu, la navigation restant visible.
 */
export function ChargementModule({ plein = false }: { plein?: boolean }) {
  return (
    <div className={plein ? "flex min-h-screen items-center justify-center bg-creme" : "flex min-h-[60vh] items-center justify-center"}>
      <img
        src="/logo-lomoto.png"
        alt="Boulangerie Lomoto"
        className="h-20 w-20 animate-pulse rounded-full object-contain ring-2 ring-or/40"
      />
    </div>
  );
}

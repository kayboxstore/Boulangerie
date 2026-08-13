import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { calculerPagination, genererNumerosPages } from "./pagination-logique";

export { calculerPagination, genererNumerosPages } from "./pagination-logique";
export type { EtatPagination, ElementNumeroPage } from "./pagination-logique";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Tailles de page proposées ; omis = pas de sélecteur (page/taille pilotés entièrement par l'appelant). */
  taillesDisponibles?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}

/**
 * Pagination Premium générique (audit UX-18) : purement pilotée par props,
 * sans aucun accès réseau ni règle métier — utilisable aussi bien sur une
 * liste chargée entièrement côté client que sur une future réponse API déjà
 * paginée côté serveur (Codex, hors périmètre F1). Cibles tactiles ≥ 44 px.
 */
function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  taillesDisponibles,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const { t } = useTranslation();
  const etat = calculerPagination(page, pageSize, total);
  const numeros = genererNumerosPages(etat.page, etat.totalPages);

  if (total === 0) return null;

  return (
    <nav
      aria-label={t("premium.pagination.navigation")}
      className={cn("flex flex-col items-center justify-between gap-3 sm:flex-row", className)}
    >
      <p className="text-xs text-muted-foreground sm:text-sm">
        {t("premium.pagination.resume", {
          debut: etat.premierIndex,
          fin: etat.dernierIndex,
          total: etat.total,
        })}
      </p>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          disabled={!etat.aPrecedente}
          onClick={() => onPageChange(etat.page - 1)}
          aria-label={t("premium.pagination.precedente")}
        >
          <ChevronLeft aria-hidden />
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {numeros.map((numero, index) =>
            numero === "…" ? (
              <span key={`ellipse-${index}`} className="px-2 text-sm text-muted-foreground" aria-hidden>
                …
              </span>
            ) : (
              <Button
                key={numero}
                type="button"
                variant={numero === etat.page ? "gold" : "ghost"}
                size="icon-touch"
                aria-current={numero === etat.page ? "page" : undefined}
                aria-label={t("premium.pagination.aller", { page: numero })}
                onClick={() => onPageChange(numero)}
              >
                {numero}
              </Button>
            ),
          )}
        </div>

        <p className="text-sm text-muted-foreground sm:hidden" aria-hidden>
          {t("premium.pagination.pageSur", { page: etat.page, totalPages: etat.totalPages })}
        </p>

        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          disabled={!etat.aSuivante}
          onClick={() => onPageChange(etat.page + 1)}
          aria-label={t("premium.pagination.suivante")}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {taillesDisponibles && taillesDisponibles.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
          {t("premium.pagination.parPage")}
          <select
            className="h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={etat.pageSize}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          >
            {taillesDisponibles.map((taille) => (
              <option key={taille} value={taille}>
                {taille}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}

export { Pagination };

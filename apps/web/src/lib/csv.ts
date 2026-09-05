/**
 * Export CSV des données affichées (section 3.8) : un fichier à sections —
 * une ligne de titre par widget, puis ses en-têtes et ses lignes.
 */
export interface SectionCSV {
  titre: string;
  entetes: string[];
  lignes: (string | number)[][];
}

function echapper(valeur: string | number): string {
  const s = String(valeur);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function genererCSV(sections: SectionCSV[]): string {
  const blocs = sections.map((s) =>
    [
      echapper(s.titre),
      s.entetes.map(echapper).join(";"),
      ...s.lignes.map((l) => l.map(echapper).join(";")),
    ].join("\n"),
  );
  // BOM pour qu'Excel ouvre l'UTF-8 (accents) correctement.
  return `﻿${blocs.join("\n\n")}`;
}

export function telechargerCSV(nomFichier: string, sections: SectionCSV[]) {
  const blob = new Blob([genererCSV(sections)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier;
  a.click();
  URL.revokeObjectURL(url);
}

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { CREDIT_DEVELOPPEUR, TAGLINE, VERSION_APP, type DocumentExportInput } from "@lomoto/shared";

// Palette de marque (section 3.8)
const MARINE = "#0F1923";
const CREME = "#FAF8F3";
const OR = "#DA9F4E";
const TERRACOTTA = "#AD5416";
const GRIS = "#6B6254";
const ZEBRE = "#F3EEE4";

const MARGE = 42;
const H_LIGNE = 15;
const TAILLE_FILIGRANE = 300;

/**
 * Le logo sert de filigrane sur chaque page. Il vit dans le frontend ; on le
 * cherche d'abord dans le build servi en production, puis dans les sources.
 *
 * On privilégie la variante `-pdf` (320 px, 31 Ko) plutôt que le logo de
 * l'interface (480 px) : le filigrane est dessiné à 300 pt et à 6 % d'opacité,
 * il n'a pas besoin de plus, et chaque Ko compte sur une pièce jointe d'email.
 */
function cheminLogo(): string | null {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const dossiers = [
    process.env.WEB_DIST ?? null,
    path.resolve(ici, "../../../web/dist"),
    path.resolve(ici, "../../../web/public"),
  ].filter((d): d is string => d !== null);
  for (const dossier of dossiers) {
    for (const nom of ["logo-lomoto-pdf.png", "logo-lomoto.png"]) {
      const chemin = path.join(dossier, nom);
      if (fs.existsSync(chemin)) return chemin;
    }
  }
  return null;
}

const LOGO = cheminLogo();

/**
 * Génère le PDF d'un document (section 3.13). UNE seule implémentation, partagée
 * par le téléchargement et l'envoi par email — la logique n'est pas dupliquée.
 *
 * Le curseur vertical est suivi à la main (`y`) : `doc.text()` déplace lui aussi
 * son curseur interne, s'y fier ferait dériver la pagination.
 */
export function construirePdf(document: DocumentExportInput, auteurNom: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGE, bufferPages: true });
    const morceaux: Buffer[] = [];
    doc.on("data", (c: Buffer) => morceaux.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(morceaux)));

    // Le logo est ouvert UNE fois et réutilisé : passer le chemin à chaque page
    // ré-encoderait l'image dans le fichier (plusieurs Mo pour rien).
    let logo: unknown = null;
    if (LOGO) {
      try {
        logo = (doc as unknown as { openImage: (s: string) => unknown }).openImage(LOGO);
      } catch {
        logo = LOGO; // repli : pdfkit accepte aussi le chemin
      }
    }

    const largeurUtile = doc.page.width - 2 * MARGE;
    // Marge volontairement large : si l'on écrit trop près du bas, pdfkit ajoute
    // une page de lui-même et la pagination manuelle déraille.
    const basUtile = doc.page.height - MARGE - 46;
    let y = MARGE;

    const texte = (
      s: string,
      x: number,
      largeur: number,
      align: "left" | "right" = "left",
      decalageY = 0,
    ) => doc.text(s, x, y + decalageY, { width: largeur, align, lineBreak: false });

    // --- En-tête de marque (première page) ---
    if (logo) doc.image(logo as string, MARGE, y - 4, { width: 46, height: 46 });
    const xTitre = logo ? MARGE + 58 : MARGE;
    doc.font("Helvetica-Bold").fontSize(17).fillColor(MARINE);
    texte("Boulangerie Lomoto", xTitre, largeurUtile - 58);
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(TERRACOTTA);
    texte(`« ${TAGLINE} »`, xTitre, largeurUtile - 58, "left", 21);
    y += 52;

    doc.font("Helvetica-Bold").fontSize(14).fillColor(MARINE);
    texte(document.titre, MARGE, largeurUtile);
    y += 18;
    if (document.sousTitre) {
      doc.font("Helvetica").fontSize(9).fillColor(GRIS);
      texte(document.sousTitre, MARGE, largeurUtile);
      y += 13;
    }
    doc.font("Helvetica").fontSize(8).fillColor(GRIS);
    texte(
      `Édité par ${auteurNom} le ${new Date().toLocaleString("fr-FR")} · v${VERSION_APP}`,
      MARGE,
      largeurUtile,
    );
    y += 12;
    doc.moveTo(MARGE, y).lineTo(doc.page.width - MARGE, y).strokeColor(OR).lineWidth(1.2).stroke();
    y += 14;

    const nouvellePage = () => {
      doc.addPage();
      y = MARGE;
    };

    // --- Sections ---
    for (const section of document.sections) {
      if (y > basUtile - 70) nouvellePage();

      doc.font("Helvetica-Bold").fontSize(11).fillColor(TERRACOTTA);
      texte(section.titre, MARGE, largeurUtile);
      y += 17;

      const nbCol = Math.max(section.entetes.length, 1);
      const largeurCol = largeurUtile / nbCol;
      const alignement = (i: number): "left" | "right" => (i === 0 ? "left" : "right");

      const dessinerEntetes = () => {
        if (section.entetes.length === 0) return;
        doc.save().rect(MARGE, y, largeurUtile, H_LIGNE).fillColor(MARINE).fill().restore();
        doc.font("Helvetica-Bold").fontSize(8).fillColor(CREME);
        section.entetes.forEach((h, i) =>
          texte(h, MARGE + i * largeurCol + 4, largeurCol - 8, alignement(i), 4),
        );
        y += H_LIGNE;
      };

      dessinerEntetes();

      section.lignes.forEach((ligne, index) => {
        if (y > basUtile) {
          nouvellePage();
          dessinerEntetes();
        }
        if (index % 2 === 1) {
          doc.save().rect(MARGE, y, largeurUtile, H_LIGNE).fillColor(ZEBRE).fill().restore();
        }
        doc.font("Helvetica").fontSize(8.5).fillColor(MARINE);
        ligne.forEach((cellule, i) =>
          texte(String(cellule), MARGE + i * largeurCol + 4, largeurCol - 8, alignement(i), 4),
        );
        y += H_LIGNE;
      });

      y += 12;
    }

    // --- Filigrane + pied de page sur chaque page -------------------------
    // Appliqués une fois le contenu écrit (pdfkit ne permet pas de repasser
    // sous une page déjà remplie). À 6 % d'opacité, le logo se lit comme un
    // fond et ne masque rien.
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);

      if (logo) {
        const x = (doc.page.width - TAILLE_FILIGRANE) / 2;
        const yF = (doc.page.height - TAILLE_FILIGRANE) / 2;
        doc.save().opacity(0.06);
        doc.image(logo as string, x, yF, { width: TAILLE_FILIGRANE, height: TAILLE_FILIGRANE });
        doc.restore();
      }

      // Le pied de page doit rester À L'INTÉRIEUR de la zone imprimable : écrire
      // sur la marge basse fait ajouter une page à pdfkit, une par page traitée.
      const bas = doc.page.height - MARGE - 12;
      doc.save();
      doc.moveTo(MARGE, bas - 6).lineTo(doc.page.width - MARGE, bas - 6).strokeColor(OR).lineWidth(0.5).stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(GRIS);
      doc.text(`${CREDIT_DEVELOPPEUR.mention} · ${CREDIT_DEVELOPPEUR.telephone}`, MARGE, bas, {
        width: largeurUtile,
        align: "left",
        lineBreak: false,
      });
      doc.text(`Page ${i + 1} / ${pages.count}`, MARGE, bas, {
        width: largeurUtile,
        align: "right",
        lineBreak: false,
      });
      doc.restore();
    }

    doc.end();
  });
}

/** Nom de fichier sûr, dérivé du titre du document. */
export function nomFichierPdf(titre: string): string {
  const base = titre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "rapport"}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

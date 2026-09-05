/**
 * Preuves (P0, 30/08/2026) de l'écriture atomique des sauvegardes locales —
 * constat Codex/Claude : écrire directement sur le chemin final laisserait,
 * en cas de panne EN COURS d'écriture, un fichier tronqué portant déjà le
 * nom attendu. Utilise le VRAI système de fichiers (pas de mock) contre un
 * répertoire temporaire dédié à ce fichier de test — c'est la façon la plus
 * honnête de prouver un comportement d'E/S réel.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dossierTest: string;
const dirOriginal = process.env.BACKUP_LOCAL_DIR;

beforeEach(async () => {
  dossierTest = await fs.mkdtemp(path.join(os.tmpdir(), "lomoto-sauvegarde-locale-test-"));
  process.env.BACKUP_LOCAL_DIR = dossierTest;
});

afterEach(async () => {
  if (dirOriginal === undefined) delete process.env.BACKUP_LOCAL_DIR;
  else process.env.BACKUP_LOCAL_DIR = dirOriginal;
  await fs.rm(dossierTest, { recursive: true, force: true });
});

describe("ecrireSauvegardeLocale", () => {
  it("écrit le fichier au nom final avec le contenu exact, sans laisser de fichier temporaire", async () => {
    const { ecrireSauvegardeLocale } = await import("./sauvegardeLocale.js");
    const contenu = Buffer.from("contenu-de-sauvegarde-factice");
    const chemin = await ecrireSauvegardeLocale("lomoto-test-atomique.dump", contenu);

    const lu = await fs.readFile(chemin);
    expect(lu.equals(contenu)).toBe(true);

    const fichiers = await fs.readdir(dossierTest);
    expect(fichiers).toEqual(["lomoto-test-atomique.dump"]);
    expect(fichiers.some((f) => f.startsWith(".tmp-"))).toBe(false);
  });

  it("n'expose JAMAIS le chemin final si le renommage atomique échoue — le fichier temporaire est nettoyé, rien de partiel ne subsiste au nom final", async () => {
    const { ecrireSauvegardeLocale } = await import("./sauvegardeLocale.js");
    const nomFichier = "lomoto-test-echec-rename.dump";
    // Force fs.rename() à échouer réellement : le chemin final est déjà
    // occupé par un RÉPERTOIRE (une opération OS authentique, pas un mock).
    await fs.mkdir(path.join(dossierTest, nomFichier));

    await expect(ecrireSauvegardeLocale(nomFichier, Buffer.from("contenu"))).rejects.toThrow();

    const fichiers = await fs.readdir(dossierTest);
    // Le répertoire préexistant reste seul : aucun fichier temporaire orphelin.
    expect(fichiers).toEqual([nomFichier]);
    const stat = await fs.stat(path.join(dossierTest, nomFichier));
    expect(stat.isDirectory()).toBe(true); // jamais écrasé par un fichier partiel
  });

  it("purge les fichiers temporaires orphelins d'une écriture atomique interrompue au prochain passage", async () => {
    const { ecrireSauvegardeLocale } = await import("./sauvegardeLocale.js");
    // Simule un reliquat laissé par un process tué entre writeFile et rename.
    await fs.writeFile(path.join(dossierTest, ".tmp-orphelin-simulation"), "reliquat");

    await ecrireSauvegardeLocale("lomoto-test-purge-tmp.dump", Buffer.from("contenu"));

    const fichiers = await fs.readdir(dossierTest);
    expect(fichiers.some((f) => f.startsWith(".tmp-"))).toBe(false);
    expect(fichiers).toContain("lomoto-test-purge-tmp.dump");
  });
});

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Langue } from "@lomoto/shared";
import { LANGUE_DEFAUT_PAR_DEFAUT } from "@lomoto/shared";
import fr from "./fr.json";
import ln from "./ln.json";
import en from "./en.json";
import sw from "./sw.json";

// Français = langue source/référence. Le Lingala et le Kiswahili sont des
// premiers jets (voir la clé "_note" de ln.json/sw.json) à faire relire par
// un locuteur natif avant un usage réel par l'équipe. L'anglais ne porte pas
// cette réserve.
export const RESSOURCES = {
  FR: { translation: fr },
  LN: { translation: ln },
  EN: { translation: en },
  SW: { translation: sw },
} as const;

i18n.use(initReactI18next).init({
  resources: RESSOURCES,
  lng: LANGUE_DEFAUT_PAR_DEFAUT,
  fallbackLng: "FR", // tout libellé manquant en Lingala retombe sur le français
  interpolation: { escapeValue: false },
});

/** Applique la langue effective à i18next (idempotent). */
export function appliquerLangue(langue: Langue) {
  if (i18n.language !== langue) void i18n.changeLanguage(langue);
}

export default i18n;

import nodemailer, { type Transporter } from "nodemailer";
import { TAGLINE } from "@lomoto/shared";

/**
 * Envoi d'email (section 3.13) via Gmail / Google Workspace, avec un MOT DE PASSE
 * D'APPLICATION — jamais de secret en dur ici. Variables d'environnement :
 *
 *   GMAIL_USER          adresse expéditrice (ex. contact@lomoto.cd)
 *   GMAIL_APP_PASSWORD  mot de passe d'application Google (16 caractères)
 *
 * Surcharges facultatives, utiles pour tester sans passer par Gmail :
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE
 *
 * Ces valeurs doivent être renseignées SÉPARÉMENT en local (.env) et sur
 * l'hébergeur — elles ne se propagent pas d'un environnement à l'autre.
 */
export class ErreurEmail extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function emailConfigure(): boolean {
  return !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;
}

let transporteur: Transporter | null = null;

function obtenirTransporteur(): Transporter {
  if (transporteur) return transporteur;
  if (!emailConfigure()) {
    throw new ErreurEmail(
      503,
      "L'envoi d'email n'est pas configuré sur ce serveur (GMAIL_USER et GMAIL_APP_PASSWORD manquants).",
    );
  }
  transporteur = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    // Gmail en 465 = TLS implicite ; une surcharge peut demander autre chose.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : true,
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! },
  });
  return transporteur;
}

/** Envoie un rapport en pièce jointe PDF. */
export async function envoyerRapport(params: {
  destinataire: string;
  sujet: string;
  message?: string;
  nomFichier: string;
  pdf: Buffer;
  auteurNom: string;
}): Promise<void> {
  const { destinataire, sujet, message, nomFichier, pdf, auteurNom } = params;
  const transport = obtenirTransporteur();

  const corps = [
    message?.trim(),
    `Rapport « ${sujet} » envoyé par ${auteurNom} depuis l'application Boulangerie Lomoto.`,
    `Le document est en pièce jointe (${nomFichier}).`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await transport.sendMail({
      from: `"Boulangerie Lomoto" <${process.env.GMAIL_USER}>`,
      to: destinataire,
      subject: `Boulangerie Lomoto — ${sujet}`,
      text: `${corps}\n\n—\nBoulangerie Lomoto · ${TAGLINE}`,
      attachments: [{ filename: nomFichier, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    // Un échec SMTP (identifiants refusés, réseau…) ne doit pas remonter en 500
    // opaque : on renvoie un message actionnable.
    throw new ErreurEmail(
      502,
      `L'envoi a échoué : ${e instanceof Error ? e.message : "erreur SMTP inconnue"}`,
    );
  }
}

import jwt from "jsonwebtoken";

// En production, JWT_SECRET est généré par Render (render.yaml, generateValue:
// true) — s'il manque quand même, on refuse de démarrer plutôt que de signer
// silencieusement avec la valeur de secours ci-dessous, publique dans ce dépôt.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET manquant en production : arrêt du serveur (voir apps/api/src/lib/jwt.ts).");
}
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-lomoto-change-me-in-production";
const EXPIRATION = "12h";

export interface JwtPayload {
  sub: string; // id utilisateur
  roleId: string;
  sid: string; // identifiant de session (section 3.7) — voir Utilisateur.sessionActuelleId
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRATION });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

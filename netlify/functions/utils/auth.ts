import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "./env";

const SECRET = () => {
  const s = env("JWT_SECRET");
  if (!s) throw new Error("JWT_SECRET is not configured");
  return s;
};

export type TokenPayload = {
  sub: string;
  role: "admin" | "judge";
  name: string;
};

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET(), { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET()) as TokenPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function checkPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function parseBearer(auth?: string | null): string | null {
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

import { randomInt, randomUUID } from "node:crypto";

const CODE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type VerificationRequest = {
  requestId: string;
  phone: string;
  code: string;
  createdAt: number;
  expiresAt: number;
};

type SessionRecord = {
  token: string;
  phone: string;
  createdAt: number;
  expiresAt: number;
};

const verificationRequests = new Map<string, VerificationRequest>();
const sessions = new Map<string, SessionRecord>();

export const SESSION_COOKIE_NAME = "snap_tax_session";
export const FLUX_VERIFICATION_NUMBER = "+16286298650";

export function normalizePhone(input: string): string {
  return input.trim();
}

export function isValidPhone(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}

function generateVerificationCode(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let i = 0; i < length; i += 1) {
    result += alphabet[randomInt(0, alphabet.length)];
  }

  return result;
}

function cleanupExpiredRecords(): void {
  const now = Date.now();

  for (const [requestId, request] of verificationRequests) {
    if (request.expiresAt <= now) {
      verificationRequests.delete(requestId);
    }
  }

  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

export function createVerificationRequest(rawPhone: string) {
  cleanupExpiredRecords();

  const phone = normalizePhone(rawPhone);

  if (!isValidPhone(phone)) {
    throw new Error("Phone number must be in E.164 format (e.g. +15551234567).");
  }

  const now = Date.now();
  const requestId = randomUUID();
  const code = generateVerificationCode();
  const expiresAt = now + CODE_TTL_MS;

  verificationRequests.set(requestId, {
    requestId,
    phone,
    code,
    createdAt: now,
    expiresAt,
  });

  return {
    requestId,
    phone,
    code,
    expiresAt,
    fluxNumber: FLUX_VERIFICATION_NUMBER,
  };
}

export function verifyCodeAndCreateSession(rawRequestId: string, rawCode: string) {
  cleanupExpiredRecords();

  const requestId = rawRequestId.trim();
  const code = rawCode.trim().toLowerCase();
  const request = verificationRequests.get(requestId);

  if (!request) {
    throw new Error("Verification request not found or expired.");
  }

  if (request.expiresAt <= Date.now()) {
    verificationRequests.delete(requestId);
    throw new Error("Verification code expired.");
  }

  if (request.code !== code) {
    throw new Error("Invalid verification code.");
  }

  verificationRequests.delete(requestId);

  const now = Date.now();
  const token = randomUUID();
  const expiresAt = now + SESSION_TTL_MS;

  sessions.set(token, {
    token,
    phone: request.phone,
    createdAt: now,
    expiresAt,
  });

  return {
    token,
    phone: request.phone,
    expiresAt,
  };
}

export function getSessionByToken(token: string | undefined) {
  cleanupExpiredRecords();

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

export function revokeSession(token: string | undefined): void {
  if (!token) {
    return;
  }

  sessions.delete(token);
}

export function getSessionMaxAgeSeconds(): number {
  return Math.floor(SESSION_TTL_MS / 1000);
}

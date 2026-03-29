import crypto from 'crypto';

type VerificationRecord = {
  codeHash: string;        // hashed instead of plain text
  expiresAt: number;
  verified: boolean;
  usedAt?: number;         // tracks when code was used
  attempts: number;        // limits brute force
  lastSentAt: number;      // rate limits resend
};

export const verificationStore = new Map<string, VerificationRecord>();

export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}
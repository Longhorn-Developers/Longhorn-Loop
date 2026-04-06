// This is to have email verication code sent.

import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { hashCode, verificationStore } from "../store/authStore";
import { sendVerificationEmail } from "../utils/sendEmail";

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidUTEmail(email: string) {
  return email.toLowerCase().endsWith("@utexas.edu");
}

router.post("/send-code", async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "MISSING_EMAIL" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!isValidUTEmail(normalizedEmail)) {
    return res.status(400).json({ error: "INVALID_UT_EMAIL" });
  }

  const existingRecord = verificationStore.get(normalizedEmail);
  if (
    existingRecord &&
    Date.now() - existingRecord.lastSentAt < RESEND_COOLDOWN_MS
  ) {
    return res.status(429).json({ error: "RESEND TOO SOON" });
  }

  const code = generateCode();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  verificationStore.set(normalizedEmail, {
    codeHash: hashCode(code),
    expiresAt: Date.now() + CODE_EXPIRY_MS,
    verified: false,
    usedAt: undefined,
    attempts: 0,
    lastSentAt: Date.now(),
  });

  await sendVerificationEmail(normalizedEmail, code);

  return res.status(200).json({
    message: "VERIFICATION_CODE_SENT",
  });
});

router.post("/verify-code", (req: Request, res: Response) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const record = verificationStore.get(normalizedEmail);

  if (!record) {
    return res.status(400).json({ error: "CODE_NOT_FOUND" });
  }

  if (Date.now() > record.expiresAt) {
    verificationStore.delete(normalizedEmail);
    return res.status(400).json({ error: "CODE_EXPIRED" });
  }

  if (record.usedAt) {
    return res.status(400).json({ error: "CODE_ALREADY_USED" });
  }

  if (record.codeHash !== hashCode(code)) {
    return res.status(400).json({ error: "INVALID_CODE" });
  }

  if (Date.now() > record.expiresAt) {
    verificationStore.delete(normalizedEmail);
    return res.status(400).json({ error: "CODE_EXPIRED" });
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    verificationStore.delete(normalizedEmail);
    return res.status(400).json({ error: "TOO_MANY_ATTEMPTS" });
  }

  record.verified = true;
  record.usedAt = Date.now();
  verificationStore.set(normalizedEmail, record);

  const token = jwt.sign({ email: normalizedEmail }, JWT_SECRET, {
    expiresIn: "7d",
  });

  return res.status(200).json({
    message: "AUTHENTICATED",
    token,
    user: {
      email: normalizedEmail,
      isVerified: true,
    },
  });
});

//POST/auth/resend-code
router.post("/resend-code", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "MISSING_EMAIL" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidUTEmail(normalizedEmail)) {
    return res.status(400).json({ error: "INVALID_UT_EMAIL" });
  }

  const existingRecord = verificationStore.get(normalizedEmail);
  if (
    existingRecord &&
    Date.now() - existingRecord.lastSentAt < RESEND_COOLDOWN_MS
  ) {
    return res.status(429).json({ error: "RESEND TOO SOON" });
  }

  const code = generateCode();
  verificationStore.set(normalizedEmail, {
    codeHash: hashCode(code),
    expiresAt: Date.now() + CODE_EXPIRY_MS,
    verified: false,
    attempts: 0,
    lastSentAt: Date.now(),
  });
  await sendVerificationEmail(normalizedEmail, code);
  return res.status(200).json({
    message: "VERIFICATION_CODE_SENT",
  });
});

router.get("/me", requireAuth, (req: AuthRequest, res: Response) => {
  return res.status(200).json({
    user: req.user,
  });
});

export default router;

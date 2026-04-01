import { Response, Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { saveUser } from "../store/userStore";

const router = Router();

// POST /users/me/agreements
router.post("/me/agreements", requireAuth, (req: AuthRequest, res: Response) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const {
    agreed_responsible_use,
    agreed_visibility_acknowledgment,
    agreed_community_guidelines,
    notifications_enabled,
  } = req.body;

  // All 3 required agreement fields must be explicitly true
  if (
    agreed_responsible_use !== true ||
    agreed_visibility_acknowledgment !== true ||
    agreed_community_guidelines !== true
  ) {
    return res.status(400).json({ error: "TERMS_NOT_ACCEPTED" });
  }

  // Save to store with timestamp
  const user = saveUser(email, {
    agreed_responsible_use,
    agreed_visibility_acknowledgment,
    agreed_community_guidelines,
    notifications_enabled: notifications_enabled === true,
    terms_accepted_at: new Date().toISOString(),
    onboarding_completed: true,
  });

  return res.status(200).json({
    message: "AGREEMENTS_SAVED",
    user,
  });
});

// GET /users/me — get current user's agreement status
router.get("/me", requireAuth, (req: AuthRequest, res: Response) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const { getUser } = require("../store/userStore");
  const user = getUser(email);

  if (!user) {
    return res.status(404).json({ error: "USER_NOT_FOUND" });
  }

  return res.status(200).json({ user });
});

export default router;
// Cloudflare Worker entry point -- replaces Express index.ts for production
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./routes/auth.worker";
import { userRoutes } from "./routes/users.worker";

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/auth", authRoutes);
app.route("/users", userRoutes);

export default app;

import { Router } from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import { z } from "zod";
import { requireUser } from "../lib/auth";
import { requestAccountDeletion } from "../lib/accountDeletion";

const router = Router();

const deletionRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many deletion requests. Please try again in an hour." },
});

router.delete("/account", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (req.body?.confirmation !== "DELETE") {
    res.status(400).json({ error: "Explicit deletion confirmation is required." });
    return;
  }
  try {
    const completed = await requestAccountDeletion(userId);
    res.status(completed ? 200 : 202).json({ status: completed ? "deleted" : "pending" });
  } catch (err) {
    req.log.error({ err }, "Could not accept account deletion");
    res.status(503).json({ error: "Could not accept deletion. Please try again." });
  }
});

const schema = z.object({
  email: z.string().email().max(200),
});

const RECIPIENT = "alhassansulaiman1369@gmail.com";

function createTransport() {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error("GMAIL_APP_PASSWORD is not set");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: RECIPIENT, pass },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

router.post("/delete-account-request", deletionRequestLimiter, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid email address." });
    return;
  }

  const { email } = parsed.data;

  try {
    const transporter = createTransport();

    await transporter.sendMail({
      from: `"Dodolink NG" <${RECIPIENT}>`,
      to: RECIPIENT,
      subject: `Account Deletion Request — ${email}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
          <h2 style="margin: 0 0 16px; font-size: 20px; color: #991b1b;">⚠️ Account Deletion Request</h2>
          <p style="margin: 0 0 16px; color: #111;">A user has requested deletion of their account and all associated data.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; font-weight: 600; color: #555; width: 120px;">Email</td>
              <td style="padding: 10px 0; color: #111;">
                <a href="mailto:${escapeHtml(email)}" style="color: #dc2626;">${escapeHtml(email)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-weight: 600; color: #555;">Requested at</td>
              <td style="padding: 10px 0; color: #111;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #fecaca;" />
          <p style="margin: 0; font-size: 12px; color: #999;">
            Action required: delete this user's account and all associated data within 90 days, per your Privacy Policy.
            Find the account in your Clerk dashboard and database using the email above.
          </p>
        </div>
      `,
      text: `Account Deletion Request\n\nEmail: ${email}\nRequested at: ${new Date().toUTCString()}\n\nAction required: delete this user's account and associated data within 90 days.`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to send deletion request email:", err);
    res.status(500).json({ error: "Failed to submit request. Please try again later." });
  }
});

export default router;

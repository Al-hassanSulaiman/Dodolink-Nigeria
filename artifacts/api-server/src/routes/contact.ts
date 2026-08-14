import { Router } from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import { z } from "zod";

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many contact requests. Please try again in an hour." },
});

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  description: z.string().min(1).max(2000),
  budget: z.string().min(1).max(100),
});

const RECIPIENT = "alhassansulaiman1369@gmail.com";

function createTransport() {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) {
    throw new Error("GMAIL_APP_PASSWORD environment variable is not set");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: RECIPIENT,
      pass,
    },
  });
}

router.post("/contact", contactLimiter, async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const { name, email, description, budget } = parsed.data;

  try {
    const transporter = createTransport();

    await transporter.sendMail({
      from: `"Portfolio Contact Form" <${RECIPIENT}>`,
      to: RECIPIENT,
      replyTo: `"${name}" <${email}>`,
      subject: `New Project Inquiry from ${name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9f9f9; border-radius: 8px;">
          <h2 style="margin: 0 0 24px; font-size: 22px; color: #111;">New project inquiry</h2>

          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; font-weight: 600; color: #555; width: 130px; vertical-align: top;">Name</td>
              <td style="padding: 10px 0; color: #111;">${escapeHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-weight: 600; color: #555; vertical-align: top;">Email</td>
              <td style="padding: 10px 0; color: #111;">
                <a href="mailto:${escapeHtml(email)}" style="color: #6366f1;">${escapeHtml(email)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-weight: 600; color: #555; vertical-align: top;">Budget</td>
              <td style="padding: 10px 0; color: #111;">${escapeHtml(budget)}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-weight: 600; color: #555; vertical-align: top;">Project</td>
              <td style="padding: 10px 0; color: #111; white-space: pre-wrap;">${escapeHtml(description)}</td>
            </tr>
          </table>

          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e5e5;" />
          <p style="margin: 0; font-size: 12px; color: #999;">
            Sent from your portfolio contact form. Reply directly to this email to respond to ${escapeHtml(name)}.
          </p>
        </div>
      `,
      text: `New project inquiry\n\nName: ${name}\nEmail: ${email}\nBudget: ${budget}\n\nProject description:\n${description}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to send contact email:", err);
    res.status(500).json({ error: "Failed to send email. Please try again later." });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default router;

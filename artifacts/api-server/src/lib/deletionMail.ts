import nodemailer from "nodemailer";

export async function sendDeletionConfirmation(email: string) {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error("Deletion confirmation email is not configured");
  const from = "alhassansulaiman1369@gmail.com";
  const transporter = nodemailer.createTransport({
    service: "gmail", auth: { user: from, pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  await transporter.sendMail({
    from: `"DodoLink NG" <${from}>`, to: email,
    subject: "Your DodoLink account has been deleted",
    text: "Your DodoLink account and associated app data have been deleted. Future automatic DodoLink subscription charges have stopped. You can still browse stores and products without an account.",
  });
}

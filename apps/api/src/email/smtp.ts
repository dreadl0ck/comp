import nodemailer, { type Transporter } from 'nodemailer';

/**
 * AT-PATCH: direct SMTP delivery.
 *
 * Comp has no SMTP path of its own. Every message goes through triggerEmail(),
 * which enqueues a Trigger.dev task that ultimately calls Resend — so email
 * requires TWO third-party SaaS accounts, and without them auth breaks
 * entirely: magic link and email OTP are the only sign-in methods the API
 * enables (emailAndPassword is disabled in auth.server.ts).
 *
 * Amsterdam Technologies already runs its own mail server, so this sends
 * straight from it. That removes both Resend and Trigger.dev from the auth
 * path, and keeps login email inside infrastructure already covered by the
 * processing register.
 *
 * Enabled by SMTP_HOST. When unset, triggerEmail falls back to the upstream
 * Trigger.dev path unchanged, so this is additive rather than a replacement.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT ?? 587);
  // Implicit TLS on 465; STARTTLS (upgraded after EHLO) everywhere else.
  // nodemailer's `secure` means "TLS from the first byte", NOT "use TLS at
  // all" — setting it true on 587 makes the handshake hang rather than fail,
  // which is a slow and confusing way to discover the difference.
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;

  const user = process.env.SMTP_USER || undefined;

  return {
    host,
    port,
    secure,
    user,
    pass: process.env.SMTP_PASS || undefined,
    // Fall back to the authenticating mailbox. A From that is not a real
    // mailbox on the sending domain gets rejected or spam-filed, and the
    // authenticated identity is the one guaranteed to exist.
    from: process.env.SMTP_FROM || user || `noreply@${host}`,
  };
}

let cached: Transporter | null = null;

function getTransport(config: SmtpConfig): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    // Reuse one connection across messages instead of reconnecting per send.
    pool: true,
    maxConnections: 3,
  });
  return cached;
}

export async function sendViaSmtp(params: {
  to: string;
  subject: string;
  html: string;
  cc?: string | string[];
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}): Promise<{ id: string }> {
  const config = getSmtpConfig();
  if (!config) throw new Error('SMTP is not configured (SMTP_HOST unset)');

  const info = await getTransport(config).sendMail({
    from: config.from,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });

  return { id: info.messageId };
}

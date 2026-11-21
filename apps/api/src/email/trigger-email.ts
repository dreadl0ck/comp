import { render } from '@react-email/render';
import { tasks } from '@trigger.dev/sdk';
import type { ReactElement } from 'react';
import type { EmailChannel, sendEmailTask } from '../trigger/email/send-email';
import type { EmailAttachment } from './resend';
import { getSmtpConfig, sendViaSmtp } from './smtp';

type TriggerEmailFlags = {
  marketing?: boolean;
  system?: boolean;
  trustPortal?: boolean;
};

function resolveChannel(flags: TriggerEmailFlags): EmailChannel {
  if (flags.trustPortal) return 'trustPortal';
  if (flags.marketing) return 'marketing';
  if (flags.system) return 'system';
  return 'default';
}

export async function triggerEmail(params: {
  to: string;
  subject: string;
  react: ReactElement;
  marketing?: boolean;
  system?: boolean;
  trustPortal?: boolean;
  cc?: string | string[];
  scheduledAt?: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  try {
    const html = await render(params.react);

    // AT-PATCH: send straight over SMTP when SMTP_HOST is set.
    //
    // Upstream's only path is Trigger.dev -> Resend, which makes login depend
    // on two SaaS accounts: magic link and email OTP are the sole sign-in
    // methods this API enables (emailAndPassword is disabled below in
    // auth.server.ts), so with neither configured the instance has no way in
    // at all. Amsterdam Technologies runs its own mail server, so use it.
    //
    // Deliberately BEFORE the tasks.trigger call and deliberately not
    // swallowing errors: a failure here must surface, because a silently
    // dropped magic link is indistinguishable from a wrong address.
    //
    // scheduledAt is ignored on this path — SMTP has no scheduling. Nothing in
    // the auth flow uses it; it is a campaign feature. Fall through to Trigger
    // when it is requested so scheduled mail keeps its semantics.
    if (getSmtpConfig() && !params.scheduledAt) {
      const result = await sendViaSmtp({
        to: params.to,
        subject: params.subject,
        html,
        cc: params.cc,
        attachments: params.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        })),
      });
      console.log('[triggerEmail] sent via SMTP', {
        to: params.to,
        subject: params.subject,
        messageId: result.id,
      });
      return result;
    }

    const channel = resolveChannel(params);

    const handle = await tasks.trigger<typeof sendEmailTask>('send-email', {
      to: params.to,
      subject: params.subject,
      html,
      channel,
      cc: params.cc,
      scheduledAt: params.scheduledAt,
      attachments: params.attachments?.map((att) => ({
        filename: att.filename,
        content:
          typeof att.content === 'string'
            ? att.content
            : att.content.toString('base64'),
        contentType: att.contentType,
      })),
    });

    return { id: handle.id };
  } catch (error) {
    console.error('[triggerEmail] Failed to trigger email task', {
      to: params.to,
      subject: params.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

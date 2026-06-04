import { SesEmailProvider } from "@/lib/email/providers/ses";

export type EmailSendPayload = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string[];
};

export type EmailSendResult = {
  provider: string;
  messageId: string;
};

export interface EmailProvider {
  readonly name: string;
  send(payload: EmailSendPayload): Promise<EmailSendResult>;
}

function parseEmailList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getEmailFromAddress() {
  const value = process.env.EMAIL_FROM_ADDRESS?.trim() ?? "";
  if (!value) {
    throw new Error("EMAIL_FROM_ADDRESS_MISSING");
  }
  return value;
}

export function getEmailReplyToAddresses() {
  return parseEmailList(process.env.EMAIL_REPLY_TO_ADDRESS);
}

export function getEmailProvider(): EmailProvider {
  const providerName = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (providerName === "ses") {
    return new SesEmailProvider();
  }
  if (!providerName) {
    throw new Error("EMAIL_PROVIDER_MISSING");
  }
  throw new Error(`EMAIL_PROVIDER_UNSUPPORTED_${providerName}`);
}

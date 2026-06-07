import {
  SESClient,
  SendEmailCommand,
} from "@aws-sdk/client-ses";
import {
  type EmailProvider,
  type EmailSendPayload,
  getEmailSource,
} from "@/lib/email/provider";

let cachedClient: SESClient | null = null;

function getSesClient() {
  if (cachedClient) {
    return cachedClient;
  }
  const region = process.env.AWS_REGION?.trim() ?? "";
  if (!region) {
    throw new Error("AWS_REGION_MISSING");
  }
  cachedClient = new SESClient({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? "",
    },
  });
  return cachedClient;
}

export class SesEmailProvider implements EmailProvider {
  readonly name = "ses";

  async send(payload: EmailSendPayload) {
    const client = getSesClient();
    const command = new SendEmailCommand({
      Source: getEmailSource(),
      Destination: {
        ToAddresses: payload.to,
      },
      ReplyToAddresses: payload.replyTo && payload.replyTo.length > 0 ? payload.replyTo : undefined,
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: payload.subject,
        },
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: payload.html,
          },
          Text: {
            Charset: "UTF-8",
            Data: payload.text,
          },
        },
      },
    });
    const response = await client.send(command);
    if (!response.MessageId) {
      throw new Error("SES_MESSAGE_ID_MISSING");
    }
    return {
      provider: this.name,
      messageId: response.MessageId,
    };
  }
}

// Delivery to the Expo push service. Unlike web push there is no VAPID key
// pair to configure here: Expo signs for FCM/APNs using the credentials stored
// against the EAS project, so the server only needs the device token.
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// Expo accepts at most 100 messages per request.
const EXPO_PUSH_BATCH_SIZE = 100;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
};

type ExpoPushTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushSendResult = {
  // Tokens Expo rejected as permanently unusable (app uninstalled, token
  // revoked). Callers drop these registrations so a dead device stops costing
  // a request on every send.
  invalidTokens: string[];
};

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function sendExpoPushNotifications(
  messages: ExpoPushMessage[],
): Promise<ExpoPushSendResult> {
  const invalidTokens: string[] = [];
  if (messages.length === 0) {
    return { invalidTokens };
  }

  for (const batch of chunk(messages, EXPO_PUSH_BATCH_SIZE)) {
    let tickets: ExpoPushTicket[] = [];
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        console.error(
          "[PUSH_NOTIFICATION_SEND_ERROR]",
          JSON.stringify({ transport: "expo", status: response.status }),
        );
        continue;
      }
      const payload = (await response.json()) as { data?: ExpoPushTicket[] };
      tickets = Array.isArray(payload.data) ? payload.data : [];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        "[PUSH_NOTIFICATION_SEND_ERROR]",
        JSON.stringify({ transport: "expo", reason }),
      );
      continue;
    }

    tickets.forEach((ticket, index) => {
      if (ticket?.status !== "error") {
        return;
      }
      const token = batch[index]?.to ?? "";
      if (ticket.details?.error === "DeviceNotRegistered" && token) {
        invalidTokens.push(token);
        return;
      }
      console.error(
        "[PUSH_NOTIFICATION_SEND_ERROR]",
        JSON.stringify({ transport: "expo", reason: ticket.message ?? ticket.details?.error }),
      );
    });
  }

  return { invalidTokens };
}

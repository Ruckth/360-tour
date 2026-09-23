export type ReplyChannel = "web" | "line" | "facebook" | "whatsapp" | "instagram";

type ReplyDelivery = {
  channel: ReplyChannel;
  recipient: string | null;
  content: string;
  requestId: string;
};

function graphVersion(value?: string) {
  return value && /^v\d+\.\d+$/.test(value) ? value : "v25.0";
}

export async function deliverAdminReply(
  reply: ReplyDelivery,
  env: NodeJS.ProcessEnv = process.env,
  send: typeof fetch = fetch,
) {
  if (reply.channel === "web") return;
  if (!reply.recipient) throw new Error("This chat has no channel recipient");

  let url: string;
  let token: string | undefined;
  let body: object;
  const headers: Record<string, string> = { "content-type": "application/json" };

  switch (reply.channel) {
    case "line":
      url = "https://api.line.me/v2/bot/message/push";
      token = env.LINE_CHANNEL_ACCESS_TOKEN;
      headers["x-line-retry-key"] = reply.requestId;
      body = {
        to: reply.recipient,
        messages: [{ type: "text", text: reply.content }],
      };
      break;
    case "facebook":
      url = `https://graph.facebook.com/${graphVersion(env.FACEBOOK_GRAPH_API_VERSION)}/me/messages`;
      token = env.FACEBOOK_ACCESS_TOKEN;
      body = {
        messaging_type: "RESPONSE",
        recipient: { id: reply.recipient },
        message: { text: reply.content },
      };
      break;
    case "instagram":
      url = `https://graph.instagram.com/${graphVersion(env.INSTAGRAM_GRAPH_API_VERSION)}/me/messages`;
      token = env.INSTAGRAM_ACCESS_TOKEN;
      body = {
        recipient: { id: reply.recipient },
        message: { text: reply.content },
      };
      break;
    case "whatsapp": {
      token = env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
      if (!phoneNumberId) throw new Error("WhatsApp phone number is not configured");
      url = `https://graph.facebook.com/${graphVersion(env.WHATSAPP_GRAPH_API_VERSION)}/${phoneNumberId}/messages`;
      body = {
        messaging_product: "whatsapp",
        to: reply.recipient,
        type: "text",
        text: { preview_url: true, body: reply.content },
      };
      break;
    }
  }

  if (!token) throw new Error(`${reply.channel} replies are not configured`);
  headers.authorization = `Bearer ${token}`;
  const response = await send(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error("Admin channel reply rejected", {
      channel: reply.channel,
      status: response.status,
      body: (await response.text()).slice(0, 300),
    });
    throw new Error(`${reply.channel} rejected the reply (${response.status})`);
  }
}

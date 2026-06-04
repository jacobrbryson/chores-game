import { beforeEach, describe, expect, it, vi } from "vitest";
import { SesEmailProvider } from "@/lib/email/providers/ses";

const { mockSend, mockSendEmailCommand } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSendEmailCommand: vi.fn(
    class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  ),
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: vi.fn(
    class {
      send = mockSend;
    },
  ),
  SendEmailCommand: mockSendEmailCommand,
}));

describe("SesEmailProvider", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSendEmailCommand.mockClear();
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.EMAIL_FROM_ADDRESS = "hello@example.com";
  });

  it("sends the expected SES payload", async () => {
    mockSend.mockResolvedValue({ MessageId: "msg-1" });
    const provider = new SesEmailProvider();

    await provider.send({
      to: ["parent@example.com"],
      subject: "Weekly Highlights",
      html: "<p>Hello</p>",
      text: "Hello",
      replyTo: ["reply@example.com"],
    });

    expect(mockSendEmailCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Source: "hello@example.com",
        Destination: { ToAddresses: ["parent@example.com"] },
        ReplyToAddresses: ["reply@example.com"],
      }),
    );
  });

  it("returns the provider message id", async () => {
    mockSend.mockResolvedValue({ MessageId: "provider-message-123" });
    const provider = new SesEmailProvider();

    const result = await provider.send({
      to: ["parent@example.com"],
      subject: "Weekly Highlights",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result).toEqual({
      provider: "ses",
      messageId: "provider-message-123",
    });
  });

  it("surfaces provider failures", async () => {
    mockSend.mockRejectedValue(new Error("SES sandbox rejection"));
    const provider = new SesEmailProvider();

    await expect(
      provider.send({
        to: ["parent@example.com"],
        subject: "Weekly Highlights",
        html: "<p>Hello</p>",
        text: "Hello",
      }),
    ).rejects.toThrow("SES sandbox rejection");
  });
});

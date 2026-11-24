import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailer } from "../src/mail.js";

const mail = { to: ["a@example.com"], subject: "Hello", text: "Hi" };

afterEach(() => vi.unstubAllGlobals());

describe("the mailer", () => {
  it("sends nothing, and says so, when email is not set up (missing key, or the word none)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const key of [undefined, "", "none", "  NONE "]) {
      expect(await createMailer({ RESEND_API_KEY: key, MAIL_FROM: "x" }).send(mail)).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hands the message to Resend when a key is set, and reports a refusal as not sent", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad key" });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mailer = createMailer({ RESEND_API_KEY: "re_test_key", MAIL_FROM: "P5 <hours@example.com>" });
    expect(await mailer.send(mail)).toBe(true);
    expect(await mailer.send(mail)).toBe(false);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer re_test_key" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ from: "P5 <hours@example.com>", to: ["a@example.com"], subject: "Hello" });
  });
});

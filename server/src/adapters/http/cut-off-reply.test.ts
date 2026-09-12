// Gauntlet item 2, the adapter half: a reply the model could not finish is
// reported as cut off, not posted as a question.
//
// On the wave-6 and wave-7 live loops one task's reply hit the edge of the
// model's 4,096-token window three times in a row, mid-word, with no status
// line. The adapter read the half as the model waiting on the person, the task
// showed "waiting on you" with nothing to answer, and the loop stalled there.
// The endpoint had said so all along: `finish_reason: "length"`.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHAT_COMPLETIONS_CUT_OFF_NOTE, parseChatCompletionsFinishReason } from "./chat-completions.js";
import { execute } from "./execute.js";

let server: Server;
let baseUrl = "";
let nextFinishReason = "length";

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "**One-Page Concept**\n\nA platform that seats strangers together every Wednesday and Satur" },
              finish_reason: nextFinishReason,
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function runTurn() {
  return execute({
    config: { url: `${baseUrl}/v1/chat/completions`, method: "POST", model: "stand-in" },
    runId: "run-1",
    agent: { id: "agent-1", name: "Nova", role: "general", adapterType: "http" },
    context: { toderoTaskMarkdown: "Write the one-page concept." },
    onLog: async () => undefined,
  } as never);
}

describe("parseChatCompletionsFinishReason", () => {
  it("reads the first choice's finish reason, in any casing", () => {
    expect(parseChatCompletionsFinishReason({ choices: [{ finish_reason: "Length" }] })).toBe("length");
    expect(parseChatCompletionsFinishReason(JSON.stringify({ choices: [{ finish_reason: "stop" }] }))).toBe("stop");
    expect(parseChatCompletionsFinishReason({ choices: [{}] })).toBeNull();
    expect(parseChatCompletionsFinishReason("not json")).toBeNull();
  });
});

describe("a reply the model could not finish", () => {
  it("is posted with the cut-off note and hands the turn to the person", async () => {
    nextFinishReason = "length";
    const result = await runTurn();
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("Satur");
    expect(result.summary?.endsWith(CHAT_COMPLETIONS_CUT_OFF_NOTE)).toBe(true);
    expect(result.resultJson).toMatchObject({ toderoDisposition: "waiting", toderoCutOff: true });
  });

  it("leaves a finished reply alone", async () => {
    nextFinishReason = "stop";
    const result = await runTurn();
    expect(result.summary).not.toContain(CHAT_COMPLETIONS_CUT_OFF_NOTE);
    expect(result.resultJson).not.toHaveProperty("toderoCutOff");
  });
});

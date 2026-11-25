import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { askClaude, ClaudeAnswerError, ClaudeUnavailableError, jsonSchemaFor, type ClaudeRunner } from "@/ai/claude";
import { SynthesisSchema } from "@/ai/destination-synthesis";

const Hello = z.object({ msg: z.string() });
const envelope = (fields: object) => JSON.stringify({ type: "result", is_error: false, ...fields });
const runner = (...outputs: (string | Error)[]) => {
  const run = vi.fn<ClaudeRunner>(async () => {
    const next = outputs.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  return run;
};

describe("askClaude", () => {
  it("returns the structured output, checked against the schema", async () => {
    const run = runner(envelope({ structured_output: { msg: "hi" }, result: '{"msg":"hi"}' }));
    await expect(askClaude("say hi", Hello, { run })).resolves.toEqual({ msg: "hi" });
  });

  it("asks with no tools, the schema, and without keeping a session", async () => {
    const run = runner(envelope({ structured_output: { msg: "hi" } }));
    await askClaude("say hi", Hello, { run, model: "sonnet", timeoutMs: 5000 });

    const [args, options] = run.mock.calls[0];
    expect(args.slice(0, 2)).toEqual(["-p", "say hi"]);
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toMatchObject({ type: "object", required: ["msg"] });
    expect(options.timeoutMs).toBe(5000);
  });

  it("falls back to the text of the result when there is no structured output", async () => {
    const run = runner(envelope({ result: '{"msg":"from text"}' }));
    await expect(askClaude("q", Hello, { run })).resolves.toEqual({ msg: "from text" });
  });

  it("asks once more when the answer has the wrong shape, then gives up", async () => {
    const wrong = envelope({ structured_output: { nope: 1 } });
    const ok = envelope({ structured_output: { msg: "second time" } });

    const recovers = runner(wrong, ok);
    await expect(askClaude("q", Hello, { run: recovers })).resolves.toEqual({ msg: "second time" });
    expect(recovers).toHaveBeenCalledTimes(2);

    const stuck = runner(wrong, wrong, ok);
    await expect(askClaude("q", Hello, { run: stuck })).rejects.toBeInstanceOf(ClaudeAnswerError);
    expect(stuck).toHaveBeenCalledTimes(2);
  });

  it("treats an answer that is not JSON as a wrong answer", async () => {
    await expect(askClaude("q", Hello, { run: runner("not json", "still not") })).rejects.toThrow(/JSON envelope/);
    await expect(askClaude("q", Hello, { run: runner(envelope({ result: "plain words" }), envelope({ result: "plain words" })) })).rejects.toThrow(/not JSON/);
  });

  it("does not retry an unavailable CLI or a timeout", async () => {
    const missing = runner(new ClaudeUnavailableError("no claude"));
    await expect(askClaude("q", Hello, { run: missing })).rejects.toBeInstanceOf(ClaudeUnavailableError);
    expect(missing).toHaveBeenCalledTimes(1);

    const slow = runner(new Error("Claude did not answer within 1 s"));
    await expect(askClaude("q", Hello, { run: slow })).rejects.toThrow(/did not answer/);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("reports an error the CLI itself reports, and recognises a missing login as unavailable", async () => {
    await expect(askClaude("q", Hello, { run: runner(envelope({ is_error: true, result: "Rate limited" })) })).rejects.toThrow(/Rate limited/);
    await expect(askClaude("q", Hello, { run: runner(envelope({ is_error: true, result: "Not logged in · Please run /login" })) })).rejects.toBeInstanceOf(ClaudeUnavailableError);
  });
});

describe("jsonSchemaFor", () => {
  it("leaves out the $schema line, which the CLI cannot resolve", () => {
    const schema = jsonSchemaFor(Hello);
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ type: "object", required: ["msg"] });
  });

  it("describes the synthesis answer in full: nested lists, enums and bounds", () => {
    const schema = JSON.stringify(jsonSchemaFor(SynthesisSchema));
    expect(schema).not.toContain("$schema");
    expect(schema).toContain('"enum":["high","medium","low"]');
    expect(schema).toContain('"maximum":100');
    expect(schema).toContain("pickDestinationId");
  });
});

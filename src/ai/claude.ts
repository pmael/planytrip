// Asks Claude through the `claude` CLI: it uses the subscription, no API key (architecture.md, "Calling
// Claude"). The CLI is either the one installed and logged in on this machine, or one in a throwaway
// Docker container (config.claude). Server only, and only from the worker: never while rendering a page.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { z } from "zod";
import { claude as claudeConfig } from "@/config";

/** Claude cannot be reached at all (the CLI is missing, or not logged in): trying again will not help. */
export class ClaudeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeUnavailableError";
  }
}

/** Claude answered, but not with what was asked for. Worth one more try. */
export class ClaudeAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeAnswerError";
  }
}

/** Runs the CLI with these arguments and gives back what it printed. Swapped for a fake in tests. */
export type ClaudeRunner = (args: string[], options: { timeoutMs: number }) => Promise<string>;

export type AskOptions = {
  timeoutMs?: number;
  /** A model name or alias for `--model`; the CLI's own default when left out */
  model?: string;
  run?: ClaudeRunner;
};

/** What the CLI prints when it says it is not logged in or has no credentials. */
const NOT_SIGNED_IN = /not logged in|\/login|invalid api key|authentication|credential/i;

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Lines the CLI prints that are not the answer or the reason it failed. */
const NOISE = /^warning: no stdin data received/i;

/** What went wrong, from what the CLI printed: the last meaningful lines, without its warnings. */
const reasonFrom = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !NOISE.test(line))
    .slice(-3)
    .join(" ")
    .slice(0, 400);

export type ClaudeSettings = { mode: "local" | "docker"; image: string; tokenVariable: string; memory: string; pidsLimit: number };

/**
 * The `docker run` that runs the CLI with `args` in a throwaway container: removed when it ends, no root,
 * no capabilities, a read-only disk with a scratch folder for the CLI's own files, limited memory. The
 * token goes in by name only (`-e NAME`), so it never shows up in the command line.
 */
export function dockerRunArgs(args: string[], { name, settings = claudeConfig }: { name: string; settings?: ClaudeSettings }): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "-e",
    settings.tokenVariable,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/home/node:rw,uid=1000,gid=1000,mode=700",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    settings.memory,
    "--pids-limit",
    String(settings.pidsLimit),
    settings.image,
    ...args,
  ];
}

/** What Docker says when it cannot run the container, as a reason the person can act on; null when it is something else. */
export function dockerProblem(said: string, settings: Pick<ClaudeSettings, "image"> = claudeConfig): string | null {
  if (/cannot connect to the docker daemon|is the docker daemon running/i.test(said)) return "Docker is not running: start Docker Desktop";
  if (/unable to find image|pull access denied|no such image|repository does not exist/i.test(said)) {
    return `The Docker image ${settings.image} is not built: run \`npm run claude:image\``;
  }
  return null;
}

/** Why the container cannot be used before even trying: it has no token to sign in with. */
const missingToken = (settings: ClaudeSettings) =>
  process.env[settings.tokenVariable]
    ? null
    : `Claude in Docker has no token: run \`claude setup-token\` and put ${settings.tokenVariable}=… in .env.local`;

/** Runs the CLI as `command` with `args` and gives back what it printed. */
function execute(
  command: string,
  args: string[],
  { timeoutMs, onTimeout, unavailable }: { timeoutMs: number; onTimeout?: () => void; unavailable: { missing: string; signedOut: string; reason: (said: string) => string | null } },
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Run from the temp folder so the project's own instructions are not read into the prompt
    const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, cwd: tmpdir() }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(new ClaudeUnavailableError(unavailable.missing));
      if (error.killed) {
        onTimeout?.();
        return reject(new Error(`Claude did not answer within ${Math.round(timeoutMs / 1000)} s`));
      }
      const said = `${stdout}\n${stderr}`;
      const reason = unavailable.reason(said);
      if (reason) return reject(new ClaudeUnavailableError(reason));
      if (NOT_SIGNED_IN.test(said)) return reject(new ClaudeUnavailableError(unavailable.signedOut));
      reject(new Error(`claude exited with an error: ${reasonFrom(said) || error.message}`));
    });
    // Nothing is piped in: without this the CLI waits a few seconds for input that never comes
    child.stdin?.end();
  });
}

const runLocal: ClaudeRunner = (args, { timeoutMs }) =>
  execute("claude", args, {
    timeoutMs,
    unavailable: {
      missing: "The `claude` command was not found: install Claude Code and log in",
      signedOut: "Claude Code is not logged in: run `claude` once to log in",
      reason: () => null,
    },
  });

/** Each call in its own container. A call that times out leaves its container behind, so that one is removed. */
export const createDockerRunner = (settings: ClaudeSettings): ClaudeRunner => (args, { timeoutMs }) => {
  const noToken = missingToken(settings);
  if (noToken) return Promise.reject(new ClaudeUnavailableError(noToken));

  const name = `planytrip-claude-${randomBytes(4).toString("hex")}`;
  return execute("docker", dockerRunArgs(args, { name, settings }), {
    timeoutMs,
    onTimeout: () => execFile("docker", ["rm", "-f", name], () => undefined),
    unavailable: {
      missing: "The `docker` command was not found: install Docker Desktop",
      signedOut: `Claude in Docker is not signed in: check ${settings.tokenVariable} (\`claude setup-token\`)`,
      reason: (said) => dockerProblem(said, settings),
    },
  });
};

const runClaude: ClaudeRunner = (args, options) => (claudeConfig.mode === "docker" ? createDockerRunner(claudeConfig) : runLocal)(args, options);

const EnvelopeSchema = z.looseObject({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});

/** Reads what `claude -p --output-format json` printed: the structured answer, or else the text of the result. */
function answerOf<T>(stdout: string, schema: z.ZodType<T>): T {
  let envelope: z.infer<typeof EnvelopeSchema>;
  try {
    envelope = EnvelopeSchema.parse(JSON.parse(stdout));
  } catch {
    throw new ClaudeAnswerError("Claude's output was not the JSON envelope the CLI prints");
  }
  if (envelope.is_error) {
    if (NOT_SIGNED_IN.test(envelope.result ?? "")) throw new ClaudeUnavailableError("Claude Code is not logged in: run `claude` once to log in");
    throw new Error(`Claude reported an error: ${(envelope.result ?? "no detail").slice(0, 400)}`);
  }

  let payload = envelope.structured_output;
  if (payload === undefined) {
    try {
      payload = JSON.parse(envelope.result ?? "");
    } catch {
      throw new ClaudeAnswerError("Claude's answer was not JSON");
    }
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ClaudeAnswerError(`Claude's answer did not match the expected shape: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/**
 * The schema as the CLI wants it: draft-07, and without the `$schema` line, which names a draft the
 * CLI's validator does not know and so refuses the whole schema.
 */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema, { target: "draft-7" }) };
  delete jsonSchema.$schema;
  return jsonSchema;
}

/**
 * Asks Claude a question and gets back an object checked against `schema`. No tools are given, it
 * only writes text. An answer of the wrong shape is asked for once more; a timeout or an
 * unavailable CLI is not retried here (the job queue decides about those).
 */
export async function askClaude<T>(prompt: string, schema: z.ZodType<T>, { timeoutMs = 120_000, model, run = runClaude }: AskOptions = {}): Promise<T> {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(jsonSchemaFor(schema)),
    "--tools",
    "",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
  ];

  for (let attempt = 1; ; attempt++) {
    const stdout = await run(args, { timeoutMs });
    try {
      return answerOf(stdout, schema);
    } catch (error) {
      if (!(error instanceof ClaudeAnswerError) || attempt >= 2) throw error;
    }
  }
}

/** What the handlers call: swapped for a fake in tests. */
export type AskFn = typeof askClaude;

export type ClaudeStatus = {
  installed: boolean;
  version: string | null;
  /** null when it could not be told */
  loggedIn: boolean | null;
  /** How they are signed in, e.g. "claude.ai" (the subscription) */
  account: string | null;
};

/**
 * Whether Claude can be used from here: the CLI is installed and logged in. It asks the CLI for its
 * version and login status, neither of which calls the model, so it costs nothing.
 */
export async function checkClaude({ run = runClaude, timeoutMs = 8000 }: { run?: ClaudeRunner; timeoutMs?: number } = {}): Promise<ClaudeStatus> {
  let version: string | null = null;
  try {
    version = (await run(["--version"], { timeoutMs })).trim().split(/\s+/)[0] || null;
  } catch (error) {
    if (error instanceof ClaudeUnavailableError) return { installed: false, version: null, loggedIn: null, account: null };
  }

  try {
    const status = z.looseObject({ loggedIn: z.boolean(), authMethod: z.string().optional() }).parse(JSON.parse(await run(["auth", "status"], { timeoutMs })));
    return { installed: true, version, loggedIn: status.loggedIn, account: status.authMethod ?? null };
  } catch (error) {
    // The CLI may say so on its way out: "not logged in" is an answer, not a failure
    const loggedOut = error instanceof Error && /"loggedIn":\s*false/.test(error.message);
    return { installed: true, version, loggedIn: loggedOut ? false : null, account: null };
  }
}

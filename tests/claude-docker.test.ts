import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeUnavailableError, createDockerRunner, dockerProblem, dockerRunArgs, type ClaudeSettings } from "@/ai/claude";

const settings: ClaudeSettings = { mode: "docker", image: "planytrip-claude", tokenVariable: "CLAUDE_CODE_OAUTH_TOKEN", memory: "1g", pidsLimit: 256 };

describe("dockerRunArgs (T6.4: the CLI in a throwaway container)", () => {
  const args = dockerRunArgs(["-p", "say hi", "--tools", ""], { name: "planytrip-claude-ab12", settings });

  it("runs the image once and throws the container away, with the CLI's arguments after the image", () => {
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
    expect(args.slice(args.indexOf("planytrip-claude"))).toEqual(["planytrip-claude", "-p", "say hi", "--tools", ""]);
    expect(args[args.indexOf("--name") + 1]).toBe("planytrip-claude-ab12");
  });

  it("passes the token by name only, so it never shows in the command line", () => {
    expect(args[args.indexOf("-e") + 1]).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(args.join(" ")).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN=/);
  });

  it("gives the container no more than it needs: no root powers, a read-only disk, limited memory", () => {
    expect(args).toEqual(expect.arrayContaining(["--read-only", "--cap-drop", "ALL", "no-new-privileges"]));
    expect(args[args.indexOf("--memory") + 1]).toBe("1g");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("256");
    // The CLI still has somewhere to write its own files
    expect(args.filter((a) => a === "--tmpfs")).toHaveLength(2);
  });

  it("mounts nothing from this machine", () => {
    expect(args).not.toContain("-v");
    expect(args).not.toContain("--volume");
    expect(args).not.toContain("--mount");
  });
});

describe("dockerProblem", () => {
  it("says to start Docker when the daemon is not running", () => {
    expect(dockerProblem("docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?")).toMatch(/start Docker Desktop/);
  });

  it("says to build the image when it does not exist", () => {
    expect(dockerProblem("Unable to find image 'planytrip-claude:latest' locally\ndocker: Error response from daemon: pull access denied for planytrip-claude"))
      .toMatch(/npm run claude:image/);
  });

  it("knows nothing about the other things that go wrong", () => {
    expect(dockerProblem("claude: something else broke")).toBeNull();
  });
});

describe("createDockerRunner, with a stand-in for the `docker` command", () => {
  let folder: string;
  let originalPath: string | undefined;
  let originalToken: string | undefined;

  /** A `docker` that writes down how it was called, then runs `body` (a shell script). */
  const fakeDocker = (body: string) => {
    writeFileSync(join(folder, "docker"), `#!/bin/sh\necho "$@" >> "${join(folder, "calls.log")}"\n${body}\n`);
    chmodSync(join(folder, "docker"), 0o755);
  };
  const calls = () => {
    try {
      return readFileSync(join(folder, "calls.log"), "utf8").trim().split("\n");
    } catch {
      return [];
    }
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "fake-docker-"));
    originalPath = process.env.PATH;
    originalToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.PATH = `${folder}:${originalPath}`;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat-test";
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalToken;
    rmSync(folder, { recursive: true, force: true });
  });

  it("gives back what the container printed", async () => {
    fakeDocker(`echo '{"type":"result"}'`);
    await expect(createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 })).resolves.toContain('"type":"result"');
    expect(calls()[0]).toMatch(/^run --rm -i --name planytrip-claude-[0-9a-f]{8} /);
    expect(calls()[0]).toMatch(/planytrip-claude -p hi$/);
  });

  it("does not even start a container without a token, and says how to get one", async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    fakeDocker("echo never");
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 }).catch((error) => error);
    expect(failure).toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toMatch(/claude setup-token/);
    expect(calls()).toEqual([]);
  });

  it("is unavailable, not failed, when Docker is not running: the ratings fall back to the rules", async () => {
    fakeDocker(`echo "docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2\nexit 1`);
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 }).catch((error) => error);
    expect(failure).toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toMatch(/start Docker Desktop/);
  });

  it("is unavailable when the image was never built", async () => {
    fakeDocker(`echo "Unable to find image 'planytrip-claude:latest' locally" >&2\nexit 125`);
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 }).catch((error) => error);
    expect(failure).toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toMatch(/npm run claude:image/);
  });

  it("is unavailable when the token is refused", async () => {
    fakeDocker(`echo "Invalid API key · Please run /login" >&2\nexit 1`);
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 }).catch((error) => error);
    expect(failure).toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toMatch(/setup-token/);
  });

  it("is unavailable when the docker command does not exist", async () => {
    process.env.PATH = folder; // an empty folder: no docker in it
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 }).catch((error) => error);
    expect(failure).toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toMatch(/install Docker Desktop/);
  });

  it("is an ordinary failure for anything else the CLI says", async () => {
    fakeDocker(`echo "claude: the model is overloaded" >&2\nexit 1`);
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 5000 }).catch((error) => error);
    expect(failure).not.toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toContain("the model is overloaded");
  });

  it("removes the container when the call took too long, so it does not keep running", async () => {
    fakeDocker(`case "$1" in run) sleep 5;; esac`);
    // Long enough for the stand-in to have started and written down its call, even when the machine is busy
    const failure = await createDockerRunner(settings)(["-p", "hi"], { timeoutMs: 1500 }).catch((error) => error);
    expect(failure).not.toBeInstanceOf(ClaudeUnavailableError);
    expect(failure.message).toMatch(/did not answer within/);

    const name = /--name (planytrip-claude-[0-9a-f]{8})/.exec(calls()[0])![1];
    await expect.poll(() => calls()).toContain(`rm -f ${name}`);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { artifactsSessionId } from "./artifacts-session-id";
import { InvalidInput } from "./errors";
import { isSessionId } from "./session-id";

type Mapping = (session: string) => string;

const ALPHABET = ["a", "s", "x", "u", "0", "_", "-"];
const MAX_LENGTH = 6;
const ARTIFACTS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function* sessionsUpTo(length: number): Generator<string> {
  let layer = [""];
  for (let size = 1; size <= length; size += 1) {
    layer = layer.flatMap((prefix) => ALPHABET.map((char) => prefix + char));
    yield* layer;
  }
  yield "_".repeat(64);
  yield `-${"a".repeat(63)}`;
  yield "a".repeat(64);
}

function keptAsIs(session: string): boolean {
  return ARTIFACTS_NAME.test(session) && !session.includes("__") && !session.endsWith("_");
}

function longestIdFor(session: string): number {
  return 3 + session.length + session.split("_").length - 1;
}

function counterexample(mapping: Mapping): string | null {
  const owners = new Map<string, string>();
  for (const session of sessionsUpTo(MAX_LENGTH)) {
    const id = mapping(session);
    const owner = owners.get(id);
    if (owner !== undefined) return `isolated: ${owner} and ${session} both map to ${id}`;
    owners.set(id, session);
    if (id.endsWith("_") || id.includes("__")) return `prefix-free: ${session} maps to ${id}`;
    if (!ARTIFACTS_NAME.test(id) || id.includes("..") || id.length > longestIdFor(session)) {
      return `accepted: ${session} maps to ${id}`;
    }
    if (keptAsIs(session) && id !== session) return `stable: ${session} maps to ${id}`;
  }
  return null;
}

const escape = (session: string) => `s.x${session.replaceAll("_", ".u")}`;

const legacy: Mapping = (session) =>
  ARTIFACTS_NAME.test(session) && !session.includes("__")
    ? session
    : `s-${session.replace(/_+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-")}`;

const keepsTrailingUnderscore: Mapping = (session) =>
  ARTIFACTS_NAME.test(session) && !session.includes("__") ? session : escape(session);

const dashEscape: Mapping = (session) =>
  keptAsIs(session) ? session : `s-${session.replaceAll("_", "-")}`;

const dashPrefixEscape: Mapping = (session) =>
  keptAsIs(session) ? session : `s-x${session.replaceAll("_", "-u")}`;

const dotEscape: Mapping = (session) =>
  keptAsIs(session) ? session : `s.${session.replaceAll("_", ".")}`;

describe("artifactsSessionId", () => {
  it("gives every session its own prefix-free Artifacts id, keeping ids Artifacts accepts", () => {
    expect(counterexample(artifactsSessionId)).toBeNull();
  });

  it.each([
    ["the legacy mapping", legacy, "isolated:"],
    ["keeping a trailing _", keepsTrailingUnderscore, "prefix-free: a_ maps to a_"],
    ["escaping _ as -", dashEscape, "isolated:"],
    ["an escape that a kept id can spell", dashPrefixEscape, "isolated:"],
    ["escaping _ as .", dotEscape, "accepted: _ maps to s.."],
    ["escaping every session", escape, "stable: a maps to s.xa"],
  ])("finds the break in %s", (_name, mapping, found) => {
    expect(counterexample(mapping)).toContain(found);
  });

  it.each([
    ["demo", "demo"],
    ["s-a-b", "s-a-b"],
    ["_a", "s.x.ua"],
    ["a_", "s.xa.u"],
    ["-x", "s.x-x"],
    ["a__b", "s.xa.u.ub"],
  ])("maps %s to %s", (session, id) => {
    expect(artifactsSessionId(session)).toBe(id);
  });

  it.each(["", "a".repeat(65), "a.b", "a b"])("refuses %j, which is not a session id", (value) => {
    expect(isSessionId(value)).toBe(false);
    expect(() => artifactsSessionId(value)).toThrow(InvalidInput);
  });
});

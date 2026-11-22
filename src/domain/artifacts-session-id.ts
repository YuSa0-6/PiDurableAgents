import { InvalidInput } from "./errors";
import { isSessionId } from "./session-id";

const ACCEPTED_AS_IS = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function artifactsSessionId(session: string): string {
  if (!isSessionId(session)) throw new InvalidInput("session must match [A-Za-z0-9_-]{1,64}");
  if (ACCEPTED_AS_IS.test(session) && !session.includes("__") && !session.endsWith("_")) {
    return session;
  }
  return `s.x${session.replaceAll("_", ".u")}`;
}

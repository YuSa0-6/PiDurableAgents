const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type SessionId = string & { readonly __brand: "SessionId" };

export function isSessionId(value: string): value is SessionId {
  return SESSION_ID.test(value);
}

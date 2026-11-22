import type { Authenticator } from "../usecase/ports/authenticator";

const UNAUTHORIZED = "Send an active Account API token as Authorization: Bearer <token>";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type BearerPolicy = {
  readonly auth: Authenticator;
  readonly skipAuthOnLocalhost: boolean;
};

export async function requireBearer(
  request: Request,
  policy: BearerPolicy,
): Promise<Response | null> {
  if (policy.skipAuthOnLocalhost && LOCAL_HOSTNAMES.has(new URL(request.url).hostname)) {
    return null;
  }
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token && (await policy.auth.isAllowed(token))) return null;
  return Response.json(
    { error: UNAUTHORIZED },
    { status: 401, headers: { "www-authenticate": "Bearer" } },
  );
}

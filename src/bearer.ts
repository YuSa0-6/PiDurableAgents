import type { Authenticator } from "./usecase/ports/authenticator";

const UNAUTHORIZED = "Send an active Account API token as Authorization: Bearer <token>";

export async function requireBearer(
  request: Request,
  auth: Authenticator,
): Promise<Response | null> {
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token && (await auth.isAllowed(token))) return null;
  return Response.json(
    { error: UNAUTHORIZED },
    { status: 401, headers: { "www-authenticate": "Bearer" } },
  );
}

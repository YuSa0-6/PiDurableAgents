export function health(model: string) {
  return { ok: true as const, model };
}

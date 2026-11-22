import type { Clock } from "../usecase/ports/clock";
import type { Ids } from "../usecase/ports/ids";

export const systemClock: Clock = { now: () => new Date().toISOString() };

export const randomIds: Ids = { next: () => crypto.randomUUID() };

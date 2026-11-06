import { randomInt } from "node:crypto";

/** Returns a uniformly distributed integer in [0, max). */
export type RandomInt = (max: number) => number;

/** Cryptographically secure source backed by node:crypto. */
export const secureRandomInt: RandomInt = (max) => randomInt(max);

export function pick<T>(items: ArrayLike<T>, rand: RandomInt): T {
  if (items.length === 0) {
    throw new RangeError("Cannot pick from an empty collection");
  }

  return items[rand(items.length)];
}

/** Returns a new array shuffled with Fisher–Yates. */
export function shuffle<T>(items: readonly T[], rand: RandomInt): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/** Picks `count` distinct elements without replacement (partial Fisher–Yates). */
export function sample<T>(items: readonly T[], count: number, rand: RandomInt): T[] {
  if (count > items.length) {
    throw new RangeError(`Cannot sample ${count} items from a collection of ${items.length}`);
  }

  const pool = [...items];

  for (let i = 0; i < count; i++) {
    const j = i + rand(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
}

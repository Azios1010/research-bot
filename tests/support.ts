import { stable } from "../supabase/functions/_shared/domain/primitives.ts";
import type { Value } from "../supabase/functions/_shared/domain/model.ts";

export class TestAssertionError extends Error {}
export function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new TestAssertionError(message);
}
export function equals(actual: unknown, expected: unknown, label = "equal values") {
  if (actual === undefined || expected === undefined) {
    assert(actual === expected, label);
    return;
  }
  if (
    stable(JSON.parse(JSON.stringify(actual)) as Value) !==
      stable(JSON.parse(JSON.stringify(expected)) as Value)
  ) throw new Error(label);
}
export async function rejects(action: () => unknown | Promise<unknown>, code?: string) {
  try {
    await action();
  } catch (error) {
    if (code) {
      assert(error instanceof Error && "code" in error && error.code === code, `expected ${code}`);
    }
    return;
  }
  throw new Error("expected rejection");
}
export async function fixture(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(`./fixtures/fake/${name}`, import.meta.url));
}

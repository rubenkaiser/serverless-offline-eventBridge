export function setsToArrays<T = any>(data: T): T {
  const entries = Object.entries<T>(data as unknown as any).filter(
    ([, value]) => value != null
  );

  const clean = entries.map(([key, v]) => {
    const value = v instanceof Set ? [...v] : v;
    return [key, value];
  });

  return Object.fromEntries(clean);
}

/** https://reacthustle.com/blog/javascript-remove-null-or-undefined-from-an-object */
export function removeEmpty<T = any>(data: T): T {
  // transform properties into key-values pairs and filter all the empty-values
  const entries = Object.entries<T>(data as unknown as any).filter(
    ([, value]) => value != null
  );

  // map through all the remaining properties and check if the value is an object.
  // if value is object, use recursion to remove empty properties
  const clean = entries.map(([key, v]) => {
    const value = typeof v === "object" ? removeEmpty(v) : v;
    return [key, value];
  });

  // transform the key-value pairs back to an object.
  return Object.fromEntries(clean);
}

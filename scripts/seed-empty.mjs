/** The existing mutation checks every schema table atomically before any write.
 * Never reinterpret any other seed failure as success, and never reset or import.
 * @param {() => Promise<unknown>} seed
 */
export async function seedEmpty(seed) {
  try {
    await seed();
    return 'seeded';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Seed requires an empty database; [A-Za-z][A-Za-z0-9]* is not empty/.test(message)) return 'preserved';
    throw error;
  }
}

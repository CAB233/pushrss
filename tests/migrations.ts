export async function testMigrations(): Promise<
  { name: string; sql: string }[]
> {
  const directory = "packages/db/migrations/";
  const names: string[] = [];
  for await (const file of Deno.readDir(directory)) {
    if (file.isFile && file.name.endsWith(".sql")) names.push(file.name);
  }
  return await Promise.all(
    names.sort().map(async (name) => ({
      name,
      sql: await Deno.readTextFile(directory + name),
    })),
  );
}

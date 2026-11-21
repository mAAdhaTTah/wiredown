/** Load an optional dependency required by the Node entry. */
export async function nodeDependency<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (cause) {
    throw new Error(
      `@wiredown/excalidraw/node could not load ${name}; install ${name} to use this entry.`,
      { cause },
    );
  }
}

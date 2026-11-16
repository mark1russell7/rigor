/**
 * The load of an optional peer dependency. An entry of this package that needs a peer imports it with `importPeer`, not
 * with a static import. Thus a user without the peer gets an error that names the peer, the entry and the install
 * command.
 *
 * A static import that the module loader cannot find stops the module graph before any code of the entry starts. Thus
 * only a dynamic import can give this error.
 */

/**
 * This function gives the module that `load` imports. When the module loader cannot find the package `peer`, the
 * function throws an `Error` that names `peer`, `entry` and the install command. The error of the loader is its `cause`.
 * The function gives each other error of the load as it is: an error in the peer or a missing package of the peer.
 */
export async function importPeer<T>(load: () => Promise<T>, peer: string, entry: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!missingPackage(error, peer)) throw error;
    throw new Error(
      `${entry} needs the package ${peer}, an optional peer dependency of @mark1russell7/rigor-testkit. ` +
        `Install it next to @mark1russell7/rigor-testkit: npm install --save-dev ${peer}`,
      { cause: error },
    );
  }
}

/**
 * This function tells if `error` is the error of Node.js for a package that it cannot find, and if that package is
 * `peer`. The message of Node.js is `Cannot find package '<name>' imported from <file>`. A file that is missing in an
 * installed package gives a path in the message, not the name in quotes.
 */
export function missingPackage(error: unknown, peer: string): boolean {
  if (!(error instanceof Error)) return false;
  const { code } = error as { readonly code?: unknown };
  return code === "ERR_MODULE_NOT_FOUND" && error.message.includes(`'${peer}'`);
}

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build, BuildOptions } from 'esbuild';

const fsp = fs.promises;

const IS_RUNNING_ON_WINDOWS = process.platform === 'win32';
const BUILTIN_MODULES_SET = new Set(builtinModules);
const NODEJS_SUPPORTED_FILE_EXTENSIONS = [
  'js',
  'mjs',
  'cjs',
  'node',
  'json',
].map(ext => `.${ext}`);

interface ResolutionOptions
  extends Pick<
    BuildOptions,
    // pure resolution options
    | 'conditions'
    | 'alias'
    | 'loader'
    | 'resolveExtensions'
    | 'mainFields'
    | 'nodePaths'
    // debugging options
    | 'sourcemap'
  > {}

export const importSingleTs = async (
  requestedImportPath: string,
  resolutionOptions?: ResolutionOptions,
) => {
  const resolvedImportPath = path.isAbsolute(requestedImportPath)
    ? requestedImportPath
    : require.resolve(requestedImportPath, {
        paths: [getCallerDirPath()],
      });

  if (!resolvedImportPath) {
    throw new Error(`Could not resolve: "${resolvedImportPath}"`);
  }

  const notRunnableByNodeFilesSet = new Set<string>();
  notRunnableByNodeFilesSet.add(resolvedImportPath);
  const tempFilePathPerResolvedImportPath = new Map<string, string>();
  tempFilePathPerResolvedImportPath.set(
    resolvedImportPath,
    getTempFileName(resolvedImportPath),
  );
  const tempFilePathPerStringifiedImport = new Map<string, string>();

  const baseEsbuildOptions: BuildOptions = {
    target: [`node${process.versions.node}`],
    platform: 'node',
    bundle: true,
    format: 'esm',
    ...resolutionOptions,
  } as const;

  /**
   * `esbuild` cannot output 1 file per every import like `tsc`
   * @see https://github.com/evanw/esbuild/issues/708
   *
   * We need that to support any location-based code like `__dirname`, `__filename`,
   * require.resolve, etc.
   *
   * That's why we run esbuild once to find all imports we need to transpile
   * AND then once PER every import to ONLY transform the code of that single import
   * and create a temporary file.
   */

  await build({
    ...baseEsbuildOptions,
    write: false,
    absWorkingDir: path.dirname(resolvedImportPath),
    entryPoints: [resolvedImportPath],
    plugins: [
      {
        name: 'externalize-runnable-js',
        setup: function externalizeRunnableJs({ onResolve, resolve }) {
          onResolve({ filter: /.+/ }, async args => {
            if (args.pluginData === true) {
              return;
            }
            const requestedInnerImportPath = args.path;

            // opt out of externalizing known scenarios before even resolving them
            if (isNeverExternalImport(requestedInnerImportPath, args.kind)) {
              return null;
            }

            if (
              BUILTIN_MODULES_SET.has(requestedInnerImportPath) ||
              requestedInnerImportPath.startsWith('node:')
            ) {
              return { external: true };
            }

            const resolvedInnerImportPath = (
              await resolve(args.path, {
                importer: args.importer,
                namespace: args.namespace,
                resolveDir: args.resolveDir,
                kind: args.kind,
                pluginData: true,
              })
            ).path;

            const isRunnableByNode =
              resolvedInnerImportPath &&
              (await fsp.stat(resolvedInnerImportPath).catch(() => false)) &&
              NODEJS_SUPPORTED_FILE_EXTENSIONS.some(ext =>
                resolvedInnerImportPath.endsWith(ext),
              );

            if (!isRunnableByNode) {
              if (resolvedInnerImportPath) {
                notRunnableByNodeFilesSet.add(resolvedInnerImportPath);
                if (
                  !tempFilePathPerResolvedImportPath.has(
                    resolvedInnerImportPath,
                  )
                ) {
                  tempFilePathPerResolvedImportPath.set(
                    resolvedInnerImportPath,
                    getTempFileName(resolvedInnerImportPath),
                  );
                }
                tempFilePathPerStringifiedImport.set(
                  stringifyEsbuildImportInfo(args),
                  tempFilePathPerResolvedImportPath.get(
                    resolvedInnerImportPath,
                  )!,
                );
              }
              return null;
            } else {
              return { external: true, path: resolvedInnerImportPath };
            }
          });
        },
      },
    ],
  });

  await Promise.all(
    [...notRunnableByNodeFilesSet].map(async resolvedAbsPath => {
      const fileNameTemp =
        tempFilePathPerResolvedImportPath.get(resolvedAbsPath)!;
      return build({
        ...baseEsbuildOptions,
        entryPoints: [resolvedAbsPath],
        outfile: fileNameTemp,
        plugins: [
          {
            name: 'replace-generated-paths-imports',
            setup: function externalizeRunnableJs({ onResolve }) {
              onResolve({ filter: /.+/ }, args => {
                // opt out of externalizing known scenarios before even resolving them
                if (isNeverExternalImport(args.path, args.kind)) {
                  return null;
                }
                const generatedPath = tempFilePathPerStringifiedImport.get(
                  stringifyEsbuildImportInfo(args),
                );
                return {
                  external: true,
                  ...(generatedPath && {
                    path: IS_RUNNING_ON_WINDOWS
                      ? pathToFileURL(generatedPath).href
                      : generatedPath,
                  }),
                };
              });
            },
          },
        ],
      });
    }),
  );

  try {
    const fileNameTemp =
      tempFilePathPerResolvedImportPath.get(resolvedImportPath)!;
    return await import(
      IS_RUNNING_ON_WINDOWS ? pathToFileURL(fileNameTemp).href : fileNameTemp
    );
  } finally {
    tempFilePathPerResolvedImportPath.forEach(fileNameTemp => {
      fsp.unlink(fileNameTemp).catch(() => {
        // Ignore errors, only log them
        console.error(`import-single-ts: COULD NOT DELETE '${fileNameTemp}'`);
      });
    });
  }
};

const isNeverExternalImport = (importPath: string, kind: string) =>
  importPath.startsWith('data:') || kind === 'entry-point';

const getTempFileName = (absolutePath: string) =>
  `${absolutePath}.importSingleTs.timestamp-${Date.now()}-${crypto.randomBytes(16).toString('hex')}.mjs`;

const stringifyEsbuildImportInfo = (args: {
  kind: string;
  importer: string;
  path: string;
}) => `${args.kind}--${args.importer}--${args.path}`;

const getCallerDirPath = () => {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const { stack } = new Error() as unknown as { stack: Array<NodeJS.CallSite> };
  Error.prepareStackTrace = originalPrepareStackTrace;

  const currentFilePath = stack.shift()!.getFileName();

  while (stack.length) {
    const callFilePath = stack.shift()!.getFileName();
    if (callFilePath && callFilePath !== currentFilePath) {
      return callFilePath.startsWith('REPL')
        ? process.cwd()
        : path.dirname(
            callFilePath.startsWith('file://')
              ? fileURLToPath(callFilePath)
              : callFilePath,
          );
    }
  }

  throw new Error(
    'Could not identify the directory where importTs(...) was called from',
  );
};

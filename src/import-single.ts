import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import enhancedResolve, {
  type ResolveOptionsOptionalFS,
} from 'enhanced-resolve';
import { build, BuildOptions } from 'esbuild';

const { CachedInputFileSystem, create: createResolverFn } = enhancedResolve;
const fsp = fs.promises;

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
    | 'conditions'
    | 'alias'
    | 'loader'
    | 'resolveExtensions'
    | 'mainFields'
    | 'nodePaths'
  > {}

export const importSingleTs = async (
  requestedImportPath: string,
  resolutionOptions?: ResolutionOptions,
) => {
  const finalResolutionOptions = {
    fileSystem: new CachedInputFileSystem(fs, 4000),
    extensions: NODEJS_SUPPORTED_FILE_EXTENSIONS,
    ...(resolutionOptions?.mainFields && {
      mainFields: resolutionOptions.mainFields,
    }),
    ...(resolutionOptions?.alias && { alias: resolutionOptions.alias }),
    conditionNames: [
      ...(resolutionOptions?.conditions || []),
      'import',
      'node',
      'default',
    ],
  } satisfies ResolveOptionsOptionalFS;
  const resolveMain = createResolverFn(finalResolutionOptions);
  const resolveWithCJS = createResolverFn({
    ...finalResolutionOptions,
    conditionNames: [...finalResolutionOptions.conditionNames, 'require'],
  });

  const promisifiedResolveMain = promisify(resolveMain);
  const promisifiedResolveWithCJS = promisify(resolveWithCJS);
  const promisifiedResolve = async (
    requesterDir: string,
    requestedFilePath: string,
  ) => {
    try {
      return await promisifiedResolveMain(requesterDir, requestedFilePath);
    } catch (err) {
      return await promisifiedResolveWithCJS(requesterDir, requestedFilePath);
    }
  };

  const resolvedImportPath = path.isAbsolute(requestedImportPath)
    ? requestedImportPath
    : await promisifiedResolve(getCallerDirPath(), requestedImportPath);

  if (!resolvedImportPath) {
    throw new Error(`Could not resolve: "${resolvedImportPath}"`);
  }

  const fileNameTemp = `${resolvedImportPath}.timestamp-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}.mjs`;

  await build({
    absWorkingDir: path.dirname(resolvedImportPath),
    entryPoints: [resolvedImportPath],
    outfile: fileNameTemp,
    target: [`node${process.versions.node}`],
    platform: 'node',
    bundle: true,
    format: 'esm',
    ...resolutionOptions,
    plugins: [
      {
        name: 'externalize-runnable-js',
        setup: function externalizeRunnableJs({ onResolve }) {
          onResolve({ filter: /.+/ }, async args => {
            const requestedInnerImportPath = args.path;

            // opt out of externalizing known scenarios before even resolving them
            if (
              requestedInnerImportPath.startsWith('data:') ||
              args.kind === 'entry-point'
            ) {
              return null;
            }

            if (
              BUILTIN_MODULES_SET.has(requestedInnerImportPath) ||
              requestedInnerImportPath.startsWith('node:')
            ) {
              return { external: true };
            }

            try {
              const resolvedInnerImportPath = await promisifiedResolve(
                args.resolveDir,
                requestedInnerImportPath,
              );

              const isRunnableByNode =
                resolvedInnerImportPath &&
                (await fsp.stat(resolvedInnerImportPath).catch(() => false)) &&
                NODEJS_SUPPORTED_FILE_EXTENSIONS.some(ext =>
                  resolvedInnerImportPath.endsWith(ext),
                );
              return isRunnableByNode
                ? { external: true, path: resolvedInnerImportPath }
                : null;
            } catch (e) {
              return null;
            }
          });
        },
      },
    ],
  });

  try {
    return await import(pathToFileURL(fileNameTemp));
  } finally {
    fsp.unlink(fileNameTemp).catch(() => {
      // Ignore errors
    });
  }
};

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
        : path.dirname(fileURLToPath(callFilePath));
    }
  }

  throw new Error(
    'Could not identify the directory where importTs(...) was called from',
  );
};

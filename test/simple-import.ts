import { build, BuildOptions } from 'esbuild';
import { nonsense } from './simple-import2';

nonsense()

export const testExport = () => {
  console.log(require.resolve('esbuild'), build.version);
};

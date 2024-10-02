import { testExport } from './simple-import';

type X = 2;

export const config = {
  a: testExport(),
};

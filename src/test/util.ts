import * as path from 'path';
import fileURL = require('file-url');

const rel = (x: string) => path.resolve(__dirname, x);

interface ITest {
  name: string;
  file: string;
  options?: any;
  'notes to validate': string;
  includeURL?: string;
  includeFilename?: string;
}

function normalizeTests(tests: ITest[]) {
  return tests.map(test => {
    const normalized = { ...test };
    const filename = rel(`../../src/test/inputs/${test.file}`);

    if (normalized.options || normalized.includeFilename || normalized.includeURL) {
      normalized.options = { ...test.options };

      if (normalized.includeFilename) {
        normalized.options.filename = filename;
        delete normalized.includeFilename;
      }
      if (normalized.includeURL) {
        normalized.options.url = fileURL(filename);
        delete normalized.includeURL;
      }
    }

    normalized.file = filename;
    console.log('normalized:', normalized);
    return normalized;
  });
}

export {
  ITest,
  normalizeTests,
};

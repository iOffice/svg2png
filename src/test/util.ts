import * as path from 'path';
import * as fs from 'fs';
import { Stream } from 'stream';
import fileURL = require('file-url');
import { ReadStream } from 'fs';
import { PNG } from 'pngjs';

const rel = (x: string) => path.resolve(__dirname, x);
const streamifier = require('streamifier');

interface ITest {
  name: string;
  file: string;
  options?: any;
  'notes to validate': string;
  includeURL?: string;
  includeFilename?: string;
}

type StrBuffStream = string | Buffer | Stream;

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
    return normalized;
  });
}


function toStream(obj: StrBuffStream): Promise<ReadStream> {
  return new Promise((resolve, reject) => {
    let result;
    if (typeof obj === 'string') {
      result = fs.createReadStream(obj).once('error', reject);
    }
    if (obj instanceof Buffer) {
      result = streamifier.createReadStream(obj).once('error', reject);
    }
    if (obj instanceof Stream) {
      result = obj;
    }
    resolve(result);
  });
}

function parsePNG(obj: StrBuffStream): Promise<PNG> {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await toStream(obj);
      stream.pipe(new PNG())
        .once('error', reject)
        .on('parsed', function onParsed() {
          resolve(this);
        });
    } catch (err) {
      reject(err);
    }
  });
}

async function pngCompare(obj1: StrBuffStream, obj2: StrBuffStream) {
  const png1 = await parsePNG(obj1);
  const png2 = await parsePNG(obj2);
  const dim1 = [png1.width, png1.height];
  const dim2 = [png2.width, png2.height];
  if (png1.data.length !== png2.data.length) {
    return Promise.reject(new Error(`Dimension mismatch: [${dim1}] vs [${dim2}].`));
  }

  const writeStream = new PNG({ width: dim1[0], height: dim1[1] });
  const data = writeStream.data;
  let i = 0;
  let count = 0;
  while (png1.data[i] != null) {
    if (
      png1.data[i] !== png2.data[i] ||
      png1.data[i + 1] !== png2.data[i + 1] ||
      png1.data[i + 2] !== png2.data[i + 2] ||
      png1.data[i + 3] !== png2.data[i + 3]
    ) {
      count += 1;
      data[i] = png2.data[i];
      data[i + 1] = png2.data[i + 1];
      data[i + 2] = png2.data[i + 2];
      data[i + 3] = png2.data[i + 3];
    }
    i += 4;
  }

  return {
    diffPixels: count,
    totalPixels: dim1[0]*dim1[1],
    png: writeStream.pack(),
  };
}

/**
 * Utility function to simulate doing nothing for a set number of milliseconds. Use in an async
 * function as follows:
 *
 * ```
 * await pause(1000);
 * ```
 *
 * That would halt the execution for 1 second.
 *
 * @param time The number of milliseconds to wait.
 */
function pause(time: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(() => {
      r();
    }, time);
  });
}

export {
  ITest,
  normalizeTests,
  toStream,
  pngCompare,
  pause,
};

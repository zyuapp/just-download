import type fs from 'fs';
import { Writable } from 'stream';

import { describe, expect, it } from 'vitest';

import { finalizeWritableStream, waitForWritableDrain } from './stream-lifecycle';

function settlesWithin(promise: Promise<unknown>, timeoutMs = 80): Promise<boolean> {
  return Promise.race([
    promise.then(() => true).catch(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    })
  ]);
}

function createWritableStream(): fs.WriteStream {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  }) as unknown as fs.WriteStream;
}

describe('stream lifecycle helpers', () => {
  it('settles finalize when stream is already destroyed', async () => {
    const stream = createWritableStream();
    stream.destroy();

    const settled = await settlesWithin(finalizeWritableStream(stream));
    expect(settled).toBe(true);
  });

  it('settles drain wait when stream closes before drain', async () => {
    const stream = createWritableStream();

    const waiting = waitForWritableDrain(stream);
    setTimeout(() => {
      stream.destroy();
    }, 10);

    const settled = await settlesWithin(waiting);
    expect(settled).toBe(true);
  });
});

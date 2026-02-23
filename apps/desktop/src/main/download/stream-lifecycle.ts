import type fs from 'fs';

function isWritableClosed(writeStream: fs.WriteStream): boolean {
  return Boolean(writeStream.destroyed || writeStream.closed);
}

export async function waitForWritableDrain(
  writeStream: fs.WriteStream,
  shouldStop: () => boolean = () => false
): Promise<void> {
  if (isWritableClosed(writeStream) || shouldStop()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      writeStream.off('drain', onDrain);
      writeStream.off('close', onClose);
      writeStream.off('finish', onFinish);
      writeStream.off('error', onError);
    };

    const settleResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onDrain = () => {
      settleResolve();
    };

    const onClose = () => {
      settleResolve();
    };

    const onFinish = () => {
      settleResolve();
    };

    const onError = (error: unknown) => {
      if (isWritableClosed(writeStream) || shouldStop()) {
        settleResolve();
        return;
      }

      settleReject(error);
    };

    writeStream.on('drain', onDrain);
    writeStream.on('close', onClose);
    writeStream.on('finish', onFinish);
    writeStream.on('error', onError);

    if (isWritableClosed(writeStream) || shouldStop()) {
      settleResolve();
    }
  });
}

export async function finalizeWritableStream(writeStream: fs.WriteStream): Promise<void> {
  if (isWritableClosed(writeStream)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      writeStream.off('finish', onFinish);
      writeStream.off('close', onClose);
      writeStream.off('error', onError);
    };

    const settleResolve = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const onFinish = () => {
      settleResolve();
    };

    const onClose = () => {
      settleResolve();
    };

    const onError = (error: unknown) => {
      if (isWritableClosed(writeStream)) {
        settleResolve();
        return;
      }

      settleReject(error);
    };

    writeStream.on('finish', onFinish);
    writeStream.on('close', onClose);
    writeStream.on('error', onError);

    try {
      writeStream.end();
    } catch (error) {
      if (isWritableClosed(writeStream)) {
        settleResolve();
        return;
      }

      settleReject(error);
      return;
    }

    if (isWritableClosed(writeStream) || writeStream.writableEnded) {
      settleResolve();
    }
  });
}

export const MAX_EXPORT_BYTES = 128 * 1024 * 1024;

function payloadTooLarge() {
  const error = new Error('Export request exceeds the 128 MiB limit.');
  error.code = 'PAYLOAD_TOO_LARGE';
  return error;
}

export function readLimitedBody(req, maxBytes = MAX_EXPORT_BYTES) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const chunks = [];
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      if (error) {
        chunks.length = 0;
        req.resume();
        reject(error);
      } else resolve(body);
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finish(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks).toString('utf8'));
    req.on('error', (error) => finish(error));
    req.on('end', onEnd);

    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      finish(payloadTooLarge());
      return;
    }
    req.on('data', onData);
  });
}

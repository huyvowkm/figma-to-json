import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readLimitedBody } from '../bin/read-limited-body.mjs';

const request = (chunks, headers = {}) => Object.assign(Readable.from(chunks.map((chunk) => Buffer.from(chunk))), { headers });

assert.equal(await readLimitedBody(request(['1234', '5678']), 8), '12345678');
await assert.rejects(readLimitedBody(request(['1234', '56789']), 8), { code: 'PAYLOAD_TOO_LARGE' });
await assert.rejects(readLimitedBody(request([], { 'content-length': '9' }), 8), { code: 'PAYLOAD_TOO_LARGE' });
console.log('Declared and streamed export body limits passed.');

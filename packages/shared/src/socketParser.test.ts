import { encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import * as parser from './socketParser.js';

const { PacketType, Encoder, Decoder } = parser;

function roundTrip(packet: parser.Packet): parser.Packet {
  const [frame] = new Encoder().encode(packet);
  const decoder = new Decoder();
  let decoded: parser.Packet | undefined;
  decoder.on('decoded', (p) => (decoded = p));
  decoder.add(frame);
  if (!decoded) throw new Error('no packet decoded');
  return decoded;
}

describe('socketParser', () => {
  it('exposes the socket.io-parser interface', () => {
    expect(parser.protocol).toBe(5);
    expect(PacketType).toMatchObject({
      CONNECT: 0,
      DISCONNECT: 1,
      EVENT: 2,
      ACK: 3,
      CONNECT_ERROR: 4,
    });
  });

  it('round-trips CONNECT with and without data', () => {
    expect(roundTrip({ type: PacketType.CONNECT, nsp: '/ingest', data: { token: 'abc' } })).toEqual(
      {
        type: 0,
        nsp: '/ingest',
        data: { token: 'abc' },
      },
    );
    expect(roundTrip({ type: PacketType.CONNECT, nsp: '/' })).toEqual({ type: 0, nsp: '/' });
  });

  it('round-trips EVENT with nested objects, Uint8Array and ack id', () => {
    const packet: parser.Packet = {
      type: PacketType.EVENT,
      nsp: '/telemetry',
      id: 12,
      data: [
        'tm',
        {
          s: 25544,
          d: { a: 1.5, nested: { list: [1, null, 'x'] } },
          blob: new Uint8Array([1, 2, 3]),
        },
      ],
    };
    const out = roundTrip(packet);
    expect(out).toEqual(packet);
    expect(((out.data as unknown[])[1] as { blob: unknown }).blob).toBeInstanceOf(Uint8Array);
  });

  it('round-trips ACK and DISCONNECT and CONNECT_ERROR', () => {
    expect(roundTrip({ type: PacketType.ACK, nsp: '/', id: 0, data: [{ ok: true }] })).toEqual({
      type: 3,
      nsp: '/',
      id: 0,
      data: [{ ok: true }],
    });
    expect(roundTrip({ type: PacketType.DISCONNECT, nsp: '/alerts' })).toEqual({
      type: 1,
      nsp: '/alerts',
    });
    expect(
      roundTrip({ type: PacketType.CONNECT_ERROR, nsp: '/', data: { message: 'nope' } }),
    ).toEqual({
      type: 4,
      nsp: '/',
      data: { message: 'nope' },
    });
  });

  it('drops undefined fields on the wire', () => {
    const [frame] = new Encoder().encode({
      type: PacketType.EVENT,
      nsp: '/',
      data: ['x'],
      id: undefined,
    });
    expect(frame).toEqual(encode({ type: 2, nsp: '/', data: ['x'] }));
  });

  const decodeOf = (value: unknown) => () => new Decoder().add(encode(value));

  it.each([
    ['unknown type', { type: 9, nsp: '/' }],
    ['string type', { type: '2', nsp: '/', data: ['x'] }],
    ['missing nsp', { type: 2, data: ['x'] }],
    ['non-string nsp', { type: 2, nsp: 5, data: ['x'] }],
    ['negative id', { type: 2, nsp: '/', data: ['x'], id: -1 }],
    ['fractional id', { type: 3, nsp: '/', data: [], id: 1.5 }],
    ['EVENT without array data', { type: 2, nsp: '/', data: { a: 1 } }],
    ['EVENT with non-string name', { type: 2, nsp: '/', data: [1] }],
    ['ACK with object data', { type: 3, nsp: '/', data: {} }],
    ['DISCONNECT with data', { type: 1, nsp: '/', data: [] }],
    ['CONNECT with array data', { type: 0, nsp: '/', data: [] }],
    ['CONNECT_ERROR with string data', { type: 4, nsp: '/', data: 'bad' }],
    ['array instead of object', [2, '/', ['x']]],
    ['bare string', 'hello'],
    ['null', null],
  ])('rejects %s', (_name, value) => {
    expect(decodeOf(value)).toThrow();
  });

  it('rejects non-binary and undecodable input', () => {
    expect(() => new Decoder().add('42["x"]')).toThrow();
    expect(() => new Decoder().add(new Uint8Array([0xc1]))).toThrow(); // 0xc1 is reserved in msgpack
    expect(() => new Decoder().add(new Uint8Array([0x85, 0x01]))).toThrow(); // truncated map
  });

  it('accepts ArrayBuffer chunks too', () => {
    const [frame] = new Encoder().encode({ type: PacketType.EVENT, nsp: '/', data: ['x'] });
    const buffer = frame.buffer.slice(
      frame.byteOffset,
      frame.byteOffset + frame.byteLength,
    ) as ArrayBuffer;
    const decoder = new Decoder();
    const seen: parser.Packet[] = [];
    decoder.on('decoded', (p) => seen.push(p));
    decoder.add(buffer);
    expect(seen).toEqual([{ type: 2, nsp: '/', data: ['x'] }]);
  });
});

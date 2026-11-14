// Socket.IO parser that frames every packet as a single MessagePack value.
// Replaces the unmaintained `socket.io-msgpack-parser`. The server AND every client must pass it:
//   new Server(http, { parser })      /      io(url, { parser })       (import * as parser from this module)
// Implements the socket.io-parser interface (protocol, PacketType, Encoder, Decoder) without the
// BINARY_* packet types: msgpack carries binary (Uint8Array) natively inside the same frame.
import { decode, encode } from '@msgpack/msgpack';
import { Emitter } from '@socket.io/component-emitter';

export const protocol = 5;

export const PacketType = {
  CONNECT: 0,
  DISCONNECT: 1,
  EVENT: 2,
  ACK: 3,
  CONNECT_ERROR: 4,
} as const;
export type PacketType = (typeof PacketType)[keyof typeof PacketType];

export interface Packet {
  type: PacketType;
  nsp: string;
  data?: unknown;
  id?: number;
}

const PACKET_TYPES: readonly number[] = Object.values(PacketType);

type Chunk = ArrayBuffer | ArrayBufferView;

export class Encoder {
  /** Always one binary frame; the array shape is what socket.io's engine layer expects. */
  encode(packet: Packet): [Uint8Array] {
    const { type, nsp, data, id } = packet;
    return [encode({ type, nsp, data, id }, { ignoreUndefined: true })];
  }
}

export class Decoder extends Emitter<
  Record<never, never>,
  Record<never, never>,
  { decoded: (packet: Packet) => void }
> {
  /** Decodes one frame and emits 'decoded'. Throws on malformed input so the caller can drop the connection. */
  add(chunk: unknown): void {
    this.emitReserved('decoded', parsePacket(decodeChunk(chunk)));
  }

  destroy(): void {
    // Stateless: every frame is self-contained, nothing to release.
  }
}

function decodeChunk(chunk: unknown): unknown {
  if (!(chunk instanceof ArrayBuffer) && !ArrayBuffer.isView(chunk)) {
    throw new Error('invalid payload: expected binary frame');
  }
  return decode(chunk as Chunk);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict structural validation; the shape of `data` depends on the packet type. */
function parsePacket(raw: unknown): Packet {
  if (!isPlainObject(raw)) throw new Error('invalid packet: not an object');
  const { type, nsp, data, id } = raw;

  if (typeof type !== 'number' || !PACKET_TYPES.includes(type))
    throw new Error('invalid packet type');
  if (typeof nsp !== 'string') throw new Error('invalid namespace');
  if (id !== undefined && id !== null && !(Number.isInteger(id) && (id as number) >= 0)) {
    throw new Error('invalid packet id');
  }
  if (!isValidData(type as PacketType, data)) throw new Error('invalid packet data');

  const packet: Packet = { type: type as PacketType, nsp };
  if (data !== undefined && data !== null) packet.data = data;
  if (typeof id === 'number') packet.id = id;
  return packet;
}

function isValidData(type: PacketType, data: unknown): boolean {
  const absent = data === undefined || data === null;
  switch (type) {
    case PacketType.CONNECT:
      return absent || isPlainObject(data); // server sends {sid}, clients send their auth payload
    case PacketType.DISCONNECT:
      return absent;
    case PacketType.CONNECT_ERROR:
      return isPlainObject(data);
    case PacketType.EVENT:
      return Array.isArray(data) && typeof data[0] === 'string';
    case PacketType.ACK:
      return Array.isArray(data);
  }
}

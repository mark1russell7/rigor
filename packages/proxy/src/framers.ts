/**
 * A framer cuts the bytes of one direction into frames. A fault with a `frame` point counts these frames, and a fault
 * that changes a frame (`split`, `reorder`, `duplicate`) works on one whole frame.
 *
 * A framer does not change, add or remove a byte. When it cannot read the stream, it gives each chunk as one frame for
 * the rest of the stream. Thus a framer can make the frames coarse, but it cannot break the stream.
 */

/** A framer of one direction. */
export interface Framer {
  /** This method takes the bytes of one read, and gives each frame that is whole after this read. */
  push(bytes: Uint8Array): Uint8Array[];
  /** This method gives the bytes that the framer holds at the end of the stream, as one frame, or no frame. */
  end(): Uint8Array[];
}

/** The framers of the two directions of one connection. */
export interface FramerPair {
  readonly up: Framer;
  readonly down: Framer;
}

/** This framer gives each read as one frame. It is the framer of a TCP stream. */
export function chunkFramer(): Framer {
  return { push: (bytes) => (bytes.length === 0 ? [] : [bytes]), end: () => [] };
}

/** This function gives the frames of a TCP connection: each read is one frame. */
export function tcpFramers(): FramerPair {
  return { up: chunkFramer(), down: chunkFramer() };
}

/** The longest head of an HTTP message that a framer reads. A longer head is not HTTP for the framer. */
const MAX_HEAD = 65_536;

/** The longest size line of a chunk that a framer reads. */
const MAX_LINE = 1024;

/** A queue of bytes. It joins its chunks only for a frame that it gives, thus a large frame costs one copy. */
class ByteQueue {
  /** The chunks from the index `head` hold the bytes. No chunk from `head` is empty. */
  private chunks: Uint8Array[] = [];
  private head = 0;
  length = 0;

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** This method gives the first `count` bytes, or all the bytes when the queue has fewer. */
  peek(count: number): Uint8Array {
    const size = Math.min(count, this.length);
    const first = this.chunks[this.head];
    if (first === undefined) return new Uint8Array(0);
    if (first.length >= size) return first.subarray(0, size);
    const out = new Uint8Array(size);
    for (let at = 0, i = this.head; at < size; i += 1) {
      const part = (this.chunks[i] as Uint8Array).subarray(0, size - at);
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  /** This method removes the first `count` bytes, and gives them. */
  take(count: number): Uint8Array {
    const out = this.peek(count);
    let left = out.length;
    this.length -= left;
    while (left > 0) {
      const chunk = this.chunks[this.head] as Uint8Array;
      if (chunk.length <= left) {
        this.head += 1;
        left -= chunk.length;
      } else {
        this.chunks[this.head] = chunk.subarray(left);
        left = 0;
      }
    }
    // The index moves, and the array drops its used part only now and then. Thus a take costs no shift of the array.
    if (this.length === 0) {
      this.chunks = [];
      this.head = 0;
    } else if (this.head > 64 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
    return out;
  }

  takeAll(): Uint8Array {
    return this.take(this.length);
  }
}

/**
 * This function gives the length of the WebSocket frame (RFC 6455, section 5.2) at the start of the bytes. It gives
 * `undefined` when the bytes do not hold the whole header yet, and `null` for a length that is not a safe integer.
 */
export function webSocketFrameLength(bytes: Uint8Array): number | undefined | null {
  if (bytes.length < 2) return undefined;
  const second = bytes[1] as number;
  const masked = (second & 0x80) !== 0;
  const short = second & 0x7f;
  let header = 2;
  let payload = short;
  if (short === 126) {
    header = 4;
    if (bytes.length < header) return undefined;
    payload = ((bytes[2] as number) << 8) | (bytes[3] as number);
  } else if (short === 127) {
    header = 10;
    if (bytes.length < header) return undefined;
    const high = (((bytes[2] as number) << 24) >>> 0) + ((bytes[3] as number) << 16) + ((bytes[4] as number) << 8) + (bytes[5] as number);
    const low = (((bytes[6] as number) << 24) >>> 0) + ((bytes[7] as number) << 16) + ((bytes[8] as number) << 8) + (bytes[9] as number);
    if (high >= 0x200000) return null;
    payload = high * 2 ** 32 + low;
  }
  return header + (masked ? 4 : 0) + payload;
}

/** This framer gives each WebSocket frame as one frame. */
export function webSocketFramer(): Framer {
  const queue = new ByteQueue();
  let raw = false;
  return {
    push(bytes) {
      if (raw) return bytes.length === 0 ? [] : [bytes];
      queue.push(bytes);
      const out: Uint8Array[] = [];
      for (;;) {
        const length = webSocketFrameLength(queue.peek(14));
        if (length === null) {
          raw = true;
          if (queue.length > 0) out.push(queue.takeAll());
          return out;
        }
        if (length === undefined || queue.length < length) return out;
        out.push(queue.take(length));
      }
    },
    end() {
      return queue.length === 0 ? [] : [queue.takeAll()];
    },
  };
}

const CRLF2 = [13, 10, 13, 10] as const;

const indexOfHeadEnd = (bytes: Uint8Array): number => {
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === CRLF2[0] && bytes[i + 1] === CRLF2[1] && bytes[i + 2] === CRLF2[2] && bytes[i + 3] === CRLF2[3]) return i + 4;
  }
  return -1;
};

const indexOfLineEnd = (bytes: Uint8Array, from: number): number => {
  for (let i = from; i + 1 < bytes.length; i += 1) if (bytes[i] === 13 && bytes[i + 1] === 10) return i + 2;
  return -1;
};

/** The parts of an HTTP/1.1 head that the framer reads. */
export interface HttpHead {
  /** The method of a request, or `null` for a response. */
  readonly method: string | null;
  /** The status of a response, or `null` for a request. */
  readonly status: number | null;
  /** The fields, with lower-case names. Repeated fields are joined with a comma. */
  readonly fields: ReadonlyMap<string, string>;
}

/** This function reads the start line and the fields of an HTTP/1.1 head. It gives `undefined` for a head that it cannot read. */
export function readHttpHead(head: Uint8Array): HttpHead | undefined {
  const text = new TextDecoder("latin1").decode(head);
  const lines = text.split("\r\n");
  const start = lines[0] ?? "";
  const response = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(start);
  const request = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+) \S+ HTTP\/1\.[01]$/.exec(start);
  if (response === null && request === null) return undefined;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return undefined;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    fields.set(name, fields.has(name) ? `${fields.get(name) as string}, ${value}` : value);
  }
  return { method: request === null ? null : (request[1] as string), status: response === null ? null : Number(response[1]), fields };
}

const hasToken = (value: string | undefined, token: string): boolean => (value ?? "").split(",").some((part) => part.trim().toLowerCase() === token);

type Body = { readonly type: "none" } | { readonly type: "length"; left: number } | { readonly type: "chunked" } | { readonly type: "close" };

/** The state that the two HTTP framers of one connection share. */
interface Shared {
  /** The methods of the requests that have no response yet, in order. */
  readonly methods: string[];
  /** The protocol of an upgrade that a request asked for, in lower case, or `null`. */
  upgrade: string | null;
  /** The framer of each direction after a `101` response, or `null` before it. */
  switched: FramerPair | null;
}

/**
 * This function gives the frames of an HTTP/1.1 connection. A head is one frame. A body with a length gives each read
 * of the body as one frame. A chunked body gives each chunk as one frame, and the last chunk with its trailer as one
 * frame. After a `101` response to an upgrade to `websocket`, each WebSocket frame is one frame.
 */
export function httpFramers(): FramerPair {
  const shared: Shared = { methods: [], upgrade: null, switched: null };
  return { up: httpFramer("up", shared), down: httpFramer("down", shared) };
}

function httpFramer(direction: "up" | "down", shared: Shared): Framer {
  const queue = new ByteQueue();
  let body: Body = { type: "none" };
  let raw = false;

  const giveUp = (out: Uint8Array[]): Uint8Array[] => {
    raw = true;
    if (queue.length > 0) out.push(queue.takeAll());
    return out;
  };

  const startBody = (head: HttpHead): Body => {
    if (direction === "up") {
      shared.methods.push(head.method as string);
      if (hasToken(head.fields.get("connection"), "upgrade") && head.fields.has("upgrade")) shared.upgrade = (head.fields.get("upgrade") as string).toLowerCase();
    } else {
      const status = head.status as number;
      if (status === 101) {
        const protocol = shared.upgrade;
        shared.switched = protocol !== null && hasToken(protocol, "websocket") ? { up: webSocketFramer(), down: webSocketFramer() } : tcpFramers();
        return { type: "none" };
      }
      if (status >= 100 && status < 200) return { type: "none" };
      const method = shared.methods.shift();
      shared.upgrade = null;
      if (method === "HEAD" || status === 204 || status === 304) return { type: "none" };
    }
    if (hasToken(head.fields.get("transfer-encoding"), "chunked")) return { type: "chunked" };
    const length = head.fields.get("content-length");
    if (length !== undefined) {
      if (!/^\d+$/.test(length)) return { type: "close" };
      const left = Number(length);
      return left === 0 ? { type: "none" } : { type: "length", left };
    }
    return direction === "down" ? { type: "close" } : { type: "none" };
  };

  /**
   * This function gives the length of the chunk at the start of the queue, with its size line and its CRLF. The last
   * chunk includes its trailer. It gives `undefined` when the chunk is not whole yet, and `null` for bytes that are not a chunk.
   */
  const chunkOf = (): { readonly length: number; readonly last: boolean } | undefined | null => {
    const start = queue.peek(MAX_LINE + 2);
    const line = indexOfLineEnd(start, 0);
    if (line < 0) return queue.length > MAX_LINE ? null : undefined;
    const sizeText = new TextDecoder("latin1").decode(start.subarray(0, line - 2)).split(";")[0]?.trim() ?? "";
    if (!/^[0-9A-Fa-f]{1,13}$/.test(sizeText)) return null;
    const size = Number.parseInt(sizeText, 16);
    if (size > 0) return queue.length < line + size + 2 ? undefined : { length: line + size + 2, last: false };
    // The last chunk: the trailer fields end with an empty line.
    const all = queue.peek(line + MAX_HEAD);
    for (let at = line; ; ) {
      const next = indexOfLineEnd(all, at);
      if (next < 0) return queue.length - line > MAX_HEAD ? null : undefined;
      if (next - at === 2) return { length: next, last: true };
      at = next;
    }
  };

  return {
    push(bytes) {
      if (raw) return bytes.length === 0 ? [] : [bytes];
      queue.push(bytes);
      const out: Uint8Array[] = [];
      while (queue.length > 0) {
        if (shared.switched !== null && body.type === "none") {
          out.push(...shared.switched[direction].push(queue.takeAll()));
          return out;
        }
        if (body.type === "close") {
          out.push(queue.takeAll());
          return out;
        }
        if (body.type === "length") {
          const take = Math.min(body.left, queue.length);
          out.push(queue.take(take));
          body.left -= take;
          if (body.left === 0) body = { type: "none" };
          continue;
        }
        if (body.type === "chunked") {
          const chunk = chunkOf();
          if (chunk === undefined) return out;
          if (chunk === null) return giveUp(out);
          const frame = queue.take(chunk.length);
          out.push(frame);
          if (chunk.last) body = { type: "none" };
          else if (frame[frame.length - 2] !== 13 || frame[frame.length - 1] !== 10) return giveUp(out);
          continue;
        }
        const window = queue.peek(MAX_HEAD + 4);
        const end = indexOfHeadEnd(window);
        if (end < 0) return queue.length > MAX_HEAD ? giveUp(out) : out;
        const head = readHttpHead(window.subarray(0, end));
        if (head === undefined || (direction === "up" ? head.method === null : head.status === null)) return giveUp(out);
        out.push(queue.take(end));
        body = startBody(head);
      }
      return out;
    },
    end() {
      const rest = queue.length === 0 ? [] : [queue.takeAll()];
      return [...rest, ...(shared.switched?.[direction].end() ?? [])];
    },
  };
}

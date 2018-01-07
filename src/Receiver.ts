import { EventEmitter } from "events";

enum FrameParseState {
    GET_INFO,
    GET_PAYLOAD_LENGTH_16,
    GET_PAYLOAD_LENGTH_64,
    GET_MASK,
    GET_DATA,
    INFLATING
}

export enum BinaryType {
    NODEBUFFER = "nodebuffer",
    ARRAYBUFFER = "arraybuffer",
    FRAGMENTS = "fragments"
}

const EMPTY_BUFFER = Buffer.alloc(0);

const unmaskBuffer = (buffer: Buffer, mask: Buffer) => {
    const length = buffer.length;
    for (let i = 0; i < length; i++) {
        buffer[i] ^= mask[i & 3];
    }
};

export default class Receiver extends EventEmitter {
    private maxPayload: number;
    private binaryType: BinaryType = BinaryType.NODEBUFFER;

    private bufferedBytes: number = 0;
    private buffers: Buffer[] = [];
    private frameState: FrameParseState = FrameParseState.GET_INFO;
    private loop: boolean = false;
    private totalPayloadLength: number = 0;
    private messageLength: number = 0;

    // Frame pieces
    private fin: boolean;
    private opcode: number;
    private payloadLength: number;
    private masked: boolean;

    private mask: Buffer;

    // Frame fragmented
    private fragmented: number = 0;
    private fragments: Buffer[] = [];

    public constructor(maxPayload: number, binaryType: BinaryType) {
        super();
        this.maxPayload = maxPayload;
        this.binaryType = binaryType;
    }

    public add(data: Buffer) {
        this.bufferedBytes += data.length;
        this.buffers.push(data);
        this.parseFrame();
    }

    private readBuffer(length: number) {
        let offset = 0;
        let dst: Buffer;
        let l: number;

        this.bufferedBytes -= length;

        if (length === this.buffers[0].length) { return this.buffers.shift(); }

        if (length < this.buffers[0].length) {
            dst = this.buffers[0].slice(0, length);
            this.buffers[0] = this.buffers[0].slice(length);
            return dst;
        }

        dst = Buffer.allocUnsafe(length);

        while (length > 0) {
            l = this.buffers[0].length;

            if (length >= l) {
                this.buffers[0].copy(dst, offset);
                offset += l;
                this.buffers.shift();
            } else {
                this.buffers[0].copy(dst, offset, 0, length);
                this.buffers[0] = this.buffers[0].slice(length);
            }

            length -= l;
        }

        return dst;
    }

    private parseFrame() {
        this.loop = true;
        while (this.loop) {
            switch (this.frameState) {
                case FrameParseState.GET_INFO:
                    this.getInfo();
                    break;
                case FrameParseState.GET_PAYLOAD_LENGTH_16:
                    this.getPayloadLength16();
                    break;
                case FrameParseState.GET_PAYLOAD_LENGTH_64:
                    this.getPayloadLength64();
                    break;
                case FrameParseState.GET_MASK:
                    this.getMask();
                    break;
                case FrameParseState.GET_DATA:
                    this.getData();
                    break;
                default:
                    this.loop = false;
            }
        }
    }

    private getInfo() {
        if (!this.hasBufferedBytes(2)) {
            return;
        }

        const buf = this.readBuffer(2);

        if ((buf![0] & 0x30) !== 0x00) {
            // TODO error
            // Invalid WebSocket frame: RSV2 and RSV3 must be clear
            return;
        }

        this.fin = (buf![0] & 0x80) === 0x80;
        this.opcode = buf![0] & 0x0f;
        this.payloadLength = buf![1] & 0x7f;

        if (this.opcode === 0x00) {
            if (!this.fragmented) {
                // TODO error
                // Invalid WebSocket frame: invalid opcode 0
                return;
            } else {
                this.opcode = this.fragmented;
            }
        } else if (this.opcode === 0x01 || this.opcode === 0x02) {
            if (this.fragmented) {
                // TODO error
                // Invalid WebSocket frame: invalid opcode
                return;
            }
        } else if (this.opcode > 0x07 && this.opcode < 0x0b) {
            if (!this.fin) {
                // TODO error
                // Invalid WebSocket frame: FIN must be set
                return;
            }

            if (this.payloadLength > 0x7d) {
                // TODO error
                // Invalid WebSocket frame: invalid payload length
                return;
            }
        } else {
            // TODO error
            // Invalid WebSocket frame: invalid opcode
            return;
        }

        if (!this.fin && !this.fragmented) { this.fragmented = this.opcode; }

        this.masked = (buf![1] & 0x80) === 0x80;

        if (this.payloadLength === 126) { this.frameState = FrameParseState.GET_PAYLOAD_LENGTH_16; } else if (this.payloadLength === 127) {
            this.frameState = FrameParseState.GET_PAYLOAD_LENGTH_64;
             } else { this.haveLength(); }
    }

    private getPayloadLength16() {
        if (!this.hasBufferedBytes(2)) { return; }

        this.payloadLength = this.readBuffer(2)!.readUInt16BE(0, true);
        this.haveLength();
    }

    private getPayloadLength64() {
        if (!this.hasBufferedBytes(8)) { return; }

        const buf = this.readBuffer(8)!;
        const num = buf.readUInt32BE(0, true);

        if (num > Math.pow(2, 53 - 32) - 1) {
            // TODO error
            // Unsupported WebSocket frame: payload length > 2^53 - 1
            return;
        }

        this.payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4, true);
        this.haveLength();
    }

    private getMask() {
        if (!this.hasBufferedBytes(4)) { return; }

        this.mask = this.readBuffer(4)!;
        this.frameState = FrameParseState.GET_DATA;
    }

    private getData() {
        let data = EMPTY_BUFFER;

        if (this.payloadLength) {
            if (!this.hasBufferedBytes(this.payloadLength)) { return; }

            data = this.readBuffer(this.payloadLength)!;
            if (this.masked) { unmaskBuffer(data, this.mask); }
        }

        if (this.opcode > 0x07) {
            this.controlMessage(data);
        } else if (this.pushFragment(data)) {
            this.dataMessage();
        }
    }

    private hasBufferedBytes(length: number) {
        if (this.bufferedBytes >= length) {
            return true;
        }
        this.loop = false;
        return false;
    }

    private haveLength() {
        if (this.opcode < 0x08 && this.maxPayloadExceeded(this.payloadLength)) {
            return;
        }

        if (this.masked) { this.frameState = FrameParseState.GET_MASK; } else { this.frameState = FrameParseState.GET_DATA; }
    }

    private maxPayloadExceeded(length) {
        if (length === 0 || this.maxPayload < 1) { return false; }

        const fullLength = this.totalPayloadLength + length;

        if (fullLength <= this.maxPayload) {
            this.totalPayloadLength = fullLength;
            return false;
        }

        // TODO error
        // Max payload size exceeded
        return true;
    }

    // 处理控制消息
    private controlMessage(data: Buffer) {
        if (this.opcode === 0x08) {
            if (data.length === 0) {
                this.loop = false;
                // TODO close
            } else if (data.length === 1) {
                // TODO error
                // Invalid WebSocket frame: invalid payload length 1
            } else {
                // const code = data.readUInt16BE(0, true);

                // TODO validate code
                // if not valid, report error Invalid WebSocket frame: invalid status code

                const buf = data.slice(2);

                // check utf8
                // if not, report error Invalid WebSocket frame: invalid UTF-8 sequence

                this.emit("close", buf.toString());
                this.loop = false;
            }

            return;
        }

        if (this.opcode === 0x09) {
            this.emit("ping", data);
        } else {
            this.emit("pong", data);
        }

        this.frameState = FrameParseState.GET_INFO;
    }

    private pushFragment(fragment: Buffer) {
        if (fragment.length === 0) { return true; }

        const totalLength = this.messageLength + fragment.length;

        if (this.maxPayload < 1 || totalLength <= this.maxPayload) {
            this.messageLength = totalLength;
            this.fragments.push(fragment);
            return true;
        }

        // TODO error
        // Max payload size exceeded
        return false;
    }

    private dataMessage() {
        if (this.fin) {
            const messageLength = this.messageLength;
            const fragments = this.fragments;

            this.totalPayloadLength = 0;
            this.messageLength = 0;
            this.fragmented = 0;
            this.fragments = [];

            if (this.opcode === 2) {
                let data;

                if (this.binaryType === BinaryType.NODEBUFFER) {
                    data = toBuffer(fragments, messageLength);
                } else if (this.binaryType === BinaryType.ARRAYBUFFER) {
                    data = toArrayBuffer(toBuffer(fragments, messageLength));
                } else {
                    data = fragments;
                }

                this.emit("message", data); // Mark
            } else {
                const buf = toBuffer(fragments, messageLength);

                // TODO validate utf8
                // if not valid, report error Invalid WebSocket frame: invalid UTF-8 sequence
                // return

                this.emit("message", buf.toString());
            }
        }

        this.frameState = FrameParseState.GET_INFO;
    }
}

/**
 * Makes a buffer from a list of fragments.
 *
 * @param {Buffer[]} fragments The list of fragments composing the message
 * @param {Number} messageLength The length of the message
 * @return {Buffer}
 * @private
 */
function toBuffer(fragments, messageLength) {
    if (fragments.length === 1) { return fragments[0]; }
    if (fragments.length > 1) {
        const target = Buffer.allocUnsafe(messageLength);
        let offset = 0;

        for (let i = 0; i < fragments.length; i++) {
            const buf = fragments[i];
            buf.copy(target, offset);
            offset += buf.length;
        }

        return target;
    }
    return EMPTY_BUFFER;
}

/**
 * Converts a buffer to an `ArrayBuffer`.
 *
 * @param {Buffer} The buffer to convert
 * @return {ArrayBuffer} Converted buffer
 */
function toArrayBuffer(buf) {
    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
        return buf.buffer;
    }

    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

import { EventEmitter } from "events";
import * as crypto from "crypto";
import { Socket } from "net";

export default class Sender extends EventEmitter {
    private firstFragment: boolean = true;
    private socket: Socket;

    public constructor(socket: Socket) {
        super();
        this.socket = socket;
    }

    public send(data, binary: boolean, fin: boolean, mask: boolean, cb) {
        let opcode = binary ? 2 : 1;
        let rsv1 = false;
        let readOnly = true;

        if (!Buffer.isBuffer(data)) {
            if (data instanceof ArrayBuffer) {
                data = Buffer.from(data);
            } else if (ArrayBuffer.isView(data)) {
                const buf = Buffer.from(data.buffer);
                if (data.byteLength !== data.buffer.byteLength) {
                    data = buf.slice(data.byteOffset, data.byteOffset + data.byteLength);
                } else {
                    data = buf;
                }
            } else {
                data = Buffer.from(data);
                readOnly = false;
            }
        }

        if (this.firstFragment) {
            this.firstFragment = false;
        } else {
            rsv1 = false;
            opcode = 0;
        }

        if (fin) {
            this.firstFragment = true;
        }

        this.sendFrame(Sender.frame(data, opcode, readOnly, fin, mask, false), cb);
    }

    private sendFrame(list, cb) {
        if (list.length === 2) {
            this.socket.write(list[0]);
            this.socket.write(list[1], cb);
        } else {
            this.socket.write(list[0], cb);
        }
    }

    static frame(
        data,
        opcode: number,
        readOnly: boolean,
        fin: boolean,
        mask: boolean,
        rsv1: boolean
    ) {
        const merge = data.length < 1024 || (mask && readOnly);
        let offset = mask ? 6 : 2;
        let payloadLength = data.length;

        if (data.length >= 65536) {
            offset += 8;
            payloadLength = 127;
        } else if (data.length > 125) {
            offset += 2;
            payloadLength = 126;
        }

        const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);

        target[0] = fin ? opcode | 0x80 : opcode;
        if (rsv1) { target[0] |= 0x40; }

        if (payloadLength === 126) {
            target.writeUInt16BE(data.length, 2, true);
        } else if (payloadLength === 127) {
            target.writeUInt32BE(0, 2, true);
            target.writeUInt32BE(data.length, 6, true);
        }

        if (!mask) {
            target[1] = payloadLength;
            if (merge) {
                data.copy(target, offset);
                return [target];
            }

            return [target, data];
        }

        const maskBuf = crypto.randomBytes(4);

        target[1] = payloadLength | 0x80;
        target[offset - 4] = maskBuf[0];
        target[offset - 3] = maskBuf[1];
        target[offset - 2] = maskBuf[2];
        target[offset - 1] = maskBuf[3];

        if (merge) {
            for (let i = 0; i < data.length; i++) {
                target[offset + i] = target[i] ^ maskBuf[i & 3];
            }
            return [target];
        }

        for (let i = 0; i < data.length; i++) {
            data[i] = data[i] ^ maskBuf[i & 3];
        }
        return [target, data];
    }
}

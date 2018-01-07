"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var events_1 = require("events");
var crypto = require("crypto");
var Sender = /** @class */ (function (_super) {
    __extends(Sender, _super);
    function Sender(socket) {
        var _this = _super.call(this) || this;
        _this.firstFragment = true;
        _this.socket = socket;
        return _this;
    }
    Sender.prototype.send = function (data, binary, fin, mask, cb) {
        var opcode = binary ? 2 : 1;
        var rsv1 = false;
        var readOnly = true;
        if (!Buffer.isBuffer(data)) {
            if (data instanceof ArrayBuffer) {
                data = Buffer.from(data);
            }
            else if (ArrayBuffer.isView(data)) {
                var buf = Buffer.from(data.buffer);
                if (data.byteLength !== data.buffer.byteLength) {
                    data = buf.slice(data.byteOffset, data.byteOffset + data.byteLength);
                }
                else {
                    data = buf;
                }
            }
            else {
                data = Buffer.from(data);
                readOnly = false;
            }
        }
        if (this.firstFragment) {
            this.firstFragment = false;
        }
        else {
            rsv1 = false;
            opcode = 0;
        }
        if (fin) {
            this.firstFragment = true;
        }
        this.sendFrame(Sender.frame(data, opcode, readOnly, fin, mask, false), cb);
    };
    Sender.prototype.sendFrame = function (list, cb) {
        if (list.length === 2) {
            this.socket.write(list[0]);
            this.socket.write(list[1], cb);
        }
        else {
            this.socket.write(list[0], cb);
        }
    };
    Sender.frame = function (data, opcode, readOnly, fin, mask, rsv1) {
        var merge = data.length < 1024 || (mask && readOnly);
        var offset = mask ? 6 : 2;
        var payloadLength = data.length;
        if (data.length >= 65536) {
            offset += 8;
            payloadLength = 127;
        }
        else if (data.length > 125) {
            offset += 2;
            payloadLength = 126;
        }
        var target = Buffer.allocUnsafe(merge ? data.length + offset : offset);
        target[0] = fin ? opcode | 0x80 : opcode;
        if (rsv1)
            target[0] |= 0x40;
        if (payloadLength === 126) {
            target.writeUInt16BE(data.length, 2, true);
        }
        else if (payloadLength === 127) {
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
        var maskBuf = crypto.randomBytes(4);
        target[1] = payloadLength | 0x80;
        target[offset - 4] = maskBuf[0];
        target[offset - 3] = maskBuf[1];
        target[offset - 2] = maskBuf[2];
        target[offset - 1] = maskBuf[3];
        if (merge) {
            for (var i = 0; i < data.length; i++) {
                target[offset + i] = target[i] ^ maskBuf[i & 3];
            }
            return [target];
        }
        for (var i = 0; i < data.length; i++) {
            data[i] = data[i] ^ maskBuf[i & 3];
        }
        return [target, data];
    };
    return Sender;
}(events_1.EventEmitter));
exports.default = Sender;

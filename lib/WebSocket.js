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
var Receiver_1 = require("./Receiver");
var Sender_1 = require("./Sender");
var ReadyStates;
(function (ReadyStates) {
    ReadyStates["CONNECTING"] = "CONNECTING";
    ReadyStates["OPEN"] = "OPEN";
    ReadyStates["CLOSING"] = "CLOSING";
    ReadyStates["CLOSED"] = "CLOSED";
})(ReadyStates || (ReadyStates = {}));
var WebSocket = /** @class */ (function (_super) {
    __extends(WebSocket, _super);
    function WebSocket(options) {
        var _this = _super.call(this) || this;
        _this.binaryType = Receiver_1.BinaryType.NODEBUFFER;
        _this._readyState = ReadyStates.CONNECTING;
        if (options.binaryType) {
            _this.binaryType = options.binaryType;
        }
        return _this;
        // TODO
    }
    Object.defineProperty(WebSocket.prototype, "readyState", {
        get: function () {
            return this._readyState;
        },
        enumerable: true,
        configurable: true
    });
    WebSocket.prototype.setSocket = function (socket, headers, maxPayload) {
        var _this = this;
        socket.setTimeout(0);
        socket.setNoDelay(true); //ignore Nagle
        if (headers.length) {
            socket.unshift(headers.join("\r\n"));
        }
        var receiver = new Receiver_1.default(maxPayload, this.binaryType);
        socket.on("data", receiver.add.bind(receiver));
        receiver.on("message", function (data) {
            _this.emit("message", data);
        });
        receiver.on("ping", function (data) {
            // this.pong(data, !this._isServer, constants.NOOP);
            _this.emit("ping", data);
        });
        receiver.on("pong", function (data) {
            _this.emit("pong", data);
        });
        // TODO events
        // receiver close
        // receiver error
        this.socket = socket;
        this.receiver = receiver;
        this.sender = new Sender_1.default(socket);
        // this._receiver.onclose = (code, reason) => {
        //     this._closeFrameReceived = true;
        //     this._closeMessage = reason;
        //     this._closeCode = code;
        //     if (this._finalized) return;
        //     if (code === 1005) this.close();
        //     else this.close(code, reason);
        // };
        // this._receiver.onerror = (error, code) => {
        //     this._closeMessage = "";
        //     this._closeCode = code;
        //     //
        //     // Ensure that the error is emitted even if `WebSocket#finalize()` has
        //     // already been called.
        //     //
        //     this._readyState = ReadyStates.CLOSING;
        //     this.emit("error", error);
        //     this.finalize(true);
        // };
        this._readyState = ReadyStates.OPEN;
        this.emit("open");
    };
    WebSocket.prototype.send = function (data) {
        if (this._readyState !== ReadyStates.OPEN) {
            // TODO error
            return;
        }
        if (typeof data === "number") {
            data = data.toString();
        }
        var opts = {
            binary: typeof data !== "string",
            mask: false,
            compress: false,
            fin: true
        };
        this.sender.send(data || Buffer.alloc(0), opts.binary, opts.fin, opts.mask, function () { });
    };
    return WebSocket;
}(events_1.EventEmitter));
exports.default = WebSocket;

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
var http = require("http");
var url = require("url");
var crypto = require("crypto");
var buffer_1 = require("buffer");
var WebSocket_1 = require("./WebSocket");
var WebSocketServer = /** @class */ (function (_super) {
    __extends(WebSocketServer, _super);
    function WebSocketServer(options, callback) {
        var _this = _super.call(this) || this;
        var port = options.port, server = options.server;
        if (!port && !server) {
            throw new TypeError("port, server options must have one be specified");
        }
        var host = options.host || "127.0.0.1";
        if (!server) {
            _this.server = http.createServer(function (_req, res) {
                var body = http.STATUS_CODES[426];
                res.writeHead(426, {
                    "Content-Length": body.length,
                    "Content-Type": "text/plain"
                });
                res.end(body);
            });
            _this.server.listen(port, host, callback);
        }
        else {
            _this.server = server;
        }
        _this.server.on("upgrade", function (req, socket) {
            _this.handleUpgrade(req, socket, function (client) {
                _this.emit("connection", client, req);
            });
        });
        _this.options = options;
        return _this;
    }
    WebSocketServer.prototype.validateRequest = function (req) {
        var path = this.options.path || "/";
        return url.parse(req.url || "").pathname === path;
    };
    WebSocketServer.prototype.cancelConnection = function (socket, code, message) {
        if (socket.writable) {
            message = message || http.STATUS_CODES[code];
            socket.write([
                "HTTP/1.1 " + code + " " + http.STATUS_CODES[code],
                "Connection: close",
                "Content-Type: text/html",
                "Content-Length: " + buffer_1.Buffer.byteLength(message),
                message
            ].join("\r\n"));
        }
        socket.removeListener("error", socketError);
        socket.destroy();
    };
    WebSocketServer.prototype.handleUpgrade = function (req, socket, callback) {
        var _this = this;
        socket.on("error", socketError);
        var version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET" ||
            req.headers.upgrade.toLocaleLowerCase() !== "websocket" ||
            !req.headers["sec-websocket-key"] ||
            version !== 13 ||
            !this.validateRequest(req)) {
            return this.cancelConnection(socket, 400);
        }
        // req header
        // Upgrade: websocket
        // Connection: Upgrade
        // Sec-WebSocket-Key: ************==
        // Sec-WebSocket-Version: **
        // res header
        // Upgrade：websocket
        // Connnection: Upgrade
        // Sec-WebSocket-Accept: ******************
        var secKey = crypto
            .createHash("sha1")
            .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
        var resHeaders = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: " + secKey
        ]
            .concat("", "")
            .join("\r\n");
        socket.on("data", function (data) {
            _this.emit("message", data);
        });
        socket.write(resHeaders);
        socket.removeListener("error", socketError);
        var ws = new WebSocket_1.default({
            binaryType: this.options.binaryType
        });
        ws.setSocket(socket, req.rawHeaders, this.options.maxPayload || 1 << 10);
        callback(ws);
    };
    return WebSocketServer;
}(events_1.EventEmitter));
exports.default = WebSocketServer;
function socketError() {
    this.destroy();
}

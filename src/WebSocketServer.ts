import { EventEmitter } from "events";
import { Server, Socket } from "net";
import * as http from "http";
import { IncomingMessage } from "http";
import * as url from "url";
import * as crypto from "crypto";
import { Buffer } from "buffer";

interface IWebSocketServerOptions {
    host?: string;
    port?: number;
    path?: string;
    server?: Server;
}

export default class WebSocketServer extends EventEmitter {
    private options: IWebSocketServerOptions;
    private server: Server;

    public constructor(options: IWebSocketServerOptions, callback?: () => void) {
        super();
        const { port, server } = options;
        if (!port && !server) {
            throw new TypeError("port, server options must have one be specified");
        }

        const host = options.host || "127.0.0.1";

        if (!server) {
            this.server = http.createServer((_req, res) => {
                const body = http.STATUS_CODES[426];

                res.writeHead(426, {
                    "Content-Length": body!.length,
                    "Content-Type": "text/plain"
                });
                res.end(body);
            });
            this.server.listen(port, host, callback);
        } else {
            this.server = server;
        }

        this.server.on("upgrade", this.handleUpgrade.bind(this));

        this.options = options;
    }

    private validateRequest(req: IncomingMessage) {
        const path = this.options.path || "/";
        return url.parse(req.url || "").pathname === path;
    }

    private cancelConnection(socket: Socket, code: number, message?: string) {
        if (socket.writable) {
            message = message || http.STATUS_CODES[code];
            socket.write(
                [
                    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}`,
                    "Connection: close",
                    "Content-Type: text/html",
                    `Content-Length: ${Buffer.byteLength(message!)}`,
                    message
                ].join("\r\n")
            );
        }
        socket.removeListener("error", socketError);
        socket.destroy();
    }

    private handleUpgrade(req: IncomingMessage, socket: Socket) {
        socket.on("error", socketError);

        const version = +req.headers["sec-websocket-version"]!;
        if (
            req.method !== "GET" ||
            req.headers.upgrade!.toLocaleLowerCase() !== "websocket" ||
            !req.headers["sec-websocket-key"] ||
            version !== 13 ||
            !this.validateRequest(req)
        ) {
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
        const secKey = crypto
            .createHash("sha1")
            .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");

        const resHeaders = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: " + secKey
        ]
            .concat("", "")
            .join("\r\n");

        socket.on("data", data => {
            this.emit("message", data);
        });
        socket.write(resHeaders);
        socket.removeListener("error", socketError);
    }
}

function socketError() {
    this.destroy();
}

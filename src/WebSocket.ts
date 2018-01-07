import { EventEmitter } from "events";
import { Socket } from "net";
import Receiver, { BinaryType } from "./Receiver";
import Sender from "./Sender";

enum ReadyStates {
    CONNECTING = "CONNECTING",
    OPEN = "OPEN",
    CLOSING = "CLOSING",
    CLOSED = "CLOSED"
}

interface IWebSocketOptions {
    binaryType: BinaryType;
}

export default class WebSocket extends EventEmitter {
    private receiver: Receiver;
    private sender: Sender;
    private socket: Socket;
    private binaryType: BinaryType = BinaryType.NODEBUFFER;

    private _readyState: string = ReadyStates.CONNECTING;
    public get readyState() {
        return this._readyState;
    }

    public constructor(options: IWebSocketOptions) {
        super();
        if (options.binaryType) {
            this.binaryType = options.binaryType;
        }

        // TODO
    }

    public setSocket(socket: Socket, headers: string[], maxPayload: number) {
        socket.setTimeout(0);
        socket.setNoDelay(true); //ignore Nagle
        // （1）如果包长度达到MSS，则允许发送；
        // （2）如果该包含有FIN，则允许发送；
        // （3）设置了TCP_NODELAY选项，则允许发送；
        // （4）未设置TCP_CORK选项时，若所有发出去的小数据包（包长度小于MSS）均被确认，则允许发送；
        // （5）上述条件都未满足，但发生了超时（一般为200ms），则立即发送。
        if (headers.length) {
            socket.unshift(headers.join("\r\n"));
        }

        const receiver = new Receiver(maxPayload, this.binaryType);
        socket.on("data", receiver.add.bind(receiver));

        receiver.on("message", data => {
            this.emit("message", data);
        });

        receiver.on("ping", data => {
            // this.pong(data, !this._isServer, constants.NOOP);
            this.emit("ping", data);
        });

        receiver.on("pong", data => {
            this.emit("pong", data);
        });

        // TODO events
        // receiver close
        // receiver error

        this.socket = socket;
        this.receiver = receiver;
        this.sender = new Sender(socket);

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
    }

    public send(data) {
        if (this._readyState !== ReadyStates.OPEN) {
            // TODO error
            return;
        }

        if (typeof data === "number") {
            data = data.toString();
        }

        const opts = {
            binary: typeof data !== "string",
            mask: false, // Server not use mask
            compress: false,
            fin: true
        };

        this.sender.send(data || Buffer.alloc(0), opts.binary, opts.fin, opts.mask, () => {});
    }
}

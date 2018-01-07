var Server = require("../lib/WebSocketServer").default;

_utf2buffer = function(utfstr) {
    var buf = new ArrayBuffer(utfstr.length * 2);
    var bufView = new Uint8Array(buf);
    for (var i = 0, strlen = utfstr.length; i < strlen; i++) {
        bufView[i] = utfstr.charCodeAt(i);
    }
    return buf;
};

readBlob = function(blob, cb) {
    const reader = new FileReader();

    // This fires after the blob has been read/loaded.
    reader.addEventListener("loadend", e => {
        const text = e.srcElement.result;
        console.log(text);
        cb(null, text);
    });

    // Start reading the blob as text.
    reader.readAsText(blb);
};

const wss = new Server(
    {
        port: 9000
    },
    function() {
        console.log("server started");
    }
);

wss.on("connection", function(ws) {
    // console.log(ws);
    ws.on("message", function(msg) {
        console.log("received: %s", msg);
        ws.send(_utf2buffer(`received: ${msg}`));
    });
});

// const ws = new WebSocket("ws://127.0.0.1:9000");
// ws.onmessage = message => {
//     console.log(message);
//     setTimeout(() => {
//         ws.send("1");
//     }, 2000);
// };
// ws.onopen = () => {
//     ws.send("open");
// };

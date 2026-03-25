import EventEmitter from "events";
import { createServer, Server } from "http";
import { Server as HTTPSServer } from "https";
import { WebSocketServer } from "ws";

export class SocketHandler {
  server;
  ws;

  sessionParser;

  /** @type {Map<string, Socket>} */
  sockets = new Map();
  /**
   * @param {Server|HTTPSServer} server
   * @param {RequestHandler} sessionParser
   */
  constructor(server, sessionParser) {
    this.server = server;
    this.ws = new WebSocketServer({ noServer: true });
    this.sessionParser = sessionParser;

    this.setupEvents();
  }

  setupEvents() {
    const onSocketError = (e) => {
      console.error(e);
    }
    this.server.on("upgrade", (request, socket, head) => {
      socket.on("error", onSocketError);

      this.sessionParser(request, {}, () => {
        if (!request.session.userId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        socket.removeListener('error', onSocketError);

        this.ws.handleUpgrade(request, socket, head, function (ws) {
          this.ws.emit('connection', ws, request);
        });
      });
    });
    this.ws.on("connection", handleConnection.bind(this));
  }
  /**
   * @param {WebSocket} s
   */
  handleConnection(s, request) {
    const id = request.session.userId;
    const socket = new Socket(s, id);

    this.sockets.set(id, socket);
    socket.on("close", () => {
      this.sockets.delete(id);
    });
  }
}

export class Socket extends EventEmitter {
  /**
   * @param {WebSocket} socket
   * @param {string} userId
   */
  constructor(socket, userId) {
    super();

    this.socket = socket;
    this.userId = userId;

    this.setupEvents();
  }

  setupEvents() {
    this.socket.on("close", () => {
      this.emit("close");
    });
  }
}

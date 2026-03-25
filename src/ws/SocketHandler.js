import EventEmitter from "events";
import { createServer, Server } from "http";
import { Server as HTTPSServer } from "https";
import { WebSocketServer } from "ws";
import { RedisManager } from "../remix/RedisHandler";

export class SocketHandler {
  server;
  ws;

  sessionParser;

  /** @type {Map<string, Socket>} */
  sockets = new Map();
  /**
   * @param {Server|HTTPSServer} server
   * @param {RequestHandler} sessionParser
   * @param {RedisManager} redis;
   */
  constructor(server, sessionParser, redis) {
    this.server = server;
    this.ws = new WebSocketServer({ noServer: true });
    this.sessionParser = sessionParser;
    this.redis = redis;

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
   * @param {Request} request
   */
  handleConnection(s, request) {
    const path = request.url.split("/")[request.url.length - 1];

    var handler;
    switch (path) {
      case "stoat":
        handler = this.redis.stoat;
        break;
      default:
        s.close(3003, "invalid path");
        return;
    }
    const id = request.session.userId;
    const socket = new Socket(s, id, handler);

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
   * @param {RedisHandler} redis
   */
  constructor(socket, userId, redis) {
    super();

    this.socket = socket;
    this.userId = userId;
    this.redis = redis;

    this.setupEvents();
  }

  setupEvents() {
    this.socket.on("close", () => {
      this.emit("close");
    });
  }
}

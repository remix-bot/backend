import EventEmitter from "events";
import { createServer, Server } from "http";
import { Server as HTTPSServer } from "https";
import { WebSocketServer } from "ws";
import { RedisManager } from "../remix/RedisHandler";
import { DatabaseManager } from "../db/DatabaseManager";

export class SocketHandler {
  server;
  ws;

  /** @type {Map<string, Socket>} */
  sockets = new Map();
  /**
   * @param {Server|HTTPSServer} server
   * @param {RedisManager} redis;
   * @param {DatabaseManager} db
   */
  constructor(server, redis, db) {
    this.server = server;
    this.ws = new WebSocketServer({ server });
    this.redis = redis;
    this.db = db;

    this.setupEvents();
  }

  setupEvents() {
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
    const socket = new Socket(s, handler, this.db);
    socket.once("authenticated", (id) => {
      this.sockets.set(id, socket);
      socket.once("close", () => {
        this.sockets.delete(id);
      });
    });
  }
}

export const OP = ["AUTH", "MSG", "PING"];

export class Socket extends EventEmitter {
  authenticated = false;
  /** @type {string|null} */
  user = null;
  /**
   * @param {WebSocket} socket
   * @param {RedisManager} redis
   * @param {DatabaseManager} db
   */
  constructor(socket, redis, db) {
    super();

    this.socket = socket;
    this.redis = redis;
    this.db = db;

    this.closeTimeout = setTimeout(this.forceClose.bind(this), 30 * 1000); // 30 seconds to authenticate

    this.setupEvents();
  }

  forceClose() {
    this.socket.close(3000, "Unauthorized");
    this.authenticated = false;
    this.closeTimeout = null;
  }

  setupEvents() {
    this.socket.on("close", () => {
      this.emit("close");
    });
    this.socket.on("message", this.processMessage.bind(this));

    this.on("authenticated", this.onInit.bind(this));
  }
  onInit() {
    this.redis.handler.subscribe(this.id, (m) => {
      console.log("Message for user: ", m);
    });
  }
  delayClose() {
    clearTimeout(this.closeTimeout);
    this.closeTimeout = setTimeout(() => {
      this.socket.close(3008, "No message received recently");
    }, 30 * 1000);
  }
  /**
   * @param {string} m
   */
  async processMessage(m) {
    /** @type {{op: string, data: [Object]}} */
    var payload;
    try {
      payload = JSON.parse(m);
    } catch (e) {
      console.log("[Socket] Malformed message received: ", e);
    }
    const op = payload.op;
    const data = payload.data;
    if (!op || !data) return;

    switch (op) {
      case "AUTH":
        if (this.authenticated) return;
        if (!data) return;
        const token = data.token;
        const id = data.id;
        if (!token || !id) return;

        const res = await this.db.verifyAPIToken(token, id);
        if (!res.valid) {
          if (!this.closeTimeout) clearTimeout(this.closeTimeout);
          this.socket.cose(3000, "Invalid authentication.");
          return;
        }

        this.delayClose();

        this.user = res.user;
        this.emit("authenticated", res.user)
        break;
      case "MSG":
        if (!this.authenticated) return;
        this.delayClose();
        this.emit("message", data);
        break;
      default: // ping to keep the connection open
        if (!this.authenticated) return;
        this.delayClose();
        break;
    }
  }
}

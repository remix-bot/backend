import EventEmitter from "events";
import { createServer, Server } from "http";
import { Server as HTTPSServer } from "https";
import { WebSocketServer } from "ws";
import { RedisManager } from "../remix/RedisHandler.js";
import { DatabaseManager } from "../db/DatabaseManager.js";
import { Player } from "../remix/PlayerManager.js";

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
    this.ws.on("connection", this.handleConnection.bind(this));
  }
  /**
   * @param {WebSocket} s
   * @param {Request} request
   */
  handleConnection(s, request) {
    const path = request.url.split("/")[request.url.split("/").length - 1];

    var handler;
    switch (path) {
      case "stoat":
        handler = this.redis.stoat;
        break;
      default:
        s.close(3003, "invalid path");
        return;
    }
    const socket = new Socket(s, this.redis, this.db);
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
      if (this.onClose) this.onClose();
      this.emit("close");
    });
    this.socket.on("message", (m) => {
      this.processMessage(m.toString());
    });

    this.on("authenticated", this.onInit.bind(this));
  }
  async onInit() {
    /*this.redis.handler.subscribe(this.user, (m) => {
      console.log("Message for user: ", m);
    });*/
    const user = await this.redis.stoat.users.getOrFetchUser(this.user);
    const joinListener = (channel) => {
      console.log("joining");
      const player = this.redis.stoat.players.get(channel);
      this.subscribePlayer(player);
      if (!player) return console.warn("User " + this.user + " joined channel " + channel + " with unknown player");
      this.socket.send(JSON.stringify({
        op: OP[1],
        data: {
          type: "join",
          data: player.serialise()
        }
      }));
    };
    const leaveListener = (channel) => {
      this.socket.send(JSON.stringify({
        op: OP[1],
        data: {
          type: "leave",
          data: channel
        }
      }));
    };
    user.on("join", joinListener);
    user.on("leave", leaveListener);

    const playerListeners = user.connectedTo.map((cid) => {
      const player = this.redis.stoat.players.get(cid);
      if (!player) return console.warn("unknown player " + cid + " requested by " + user.id);
      return { player, listener: this.subscribePlayer(player)};
    });

    this.onClose = () => {
      user.off("join", joinListener);
      user.off("leave", leaveListener);
      playerListeners.forEach((p) => {
        p.player.off("update", p.listener);
      })
    }

    //this.handler.socket
    this.socket.send(JSON.stringify({
      op: OP[0],
      data: {
        type: "auth",
        data: user.serialise()
      }
    }));
  }
  /**
   * @param {Player} p
   */
  subscribePlayer(p) { // TODO: switch to more granular updates
    const listener = (player) => {
      this.socket.send(JSON.stringify({
        op: OP[1],
        data: {
          type: "player",
          data: p.serialise()
        }
      }));
    }
    p.on("update", listener);
    return listener;
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
    if (!op || !data) return console.log("[Socket] Malformed message: ", op, data);

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
          this.socket.close(3000, "Invalid authentication.");
          return;
        }

        this.delayClose();

        this.user = res.user;
        this.authenticated = true;
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

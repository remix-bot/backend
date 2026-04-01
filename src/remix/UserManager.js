import EventEmitter from "node:events";
import { Stoat } from "./RedisHandler.js";
import { Player } from "./PlayerManager.js";

export class User extends EventEmitter {
  /**
   * @param {string} id
   * @param {UserManager} manager
   */
  constructor(id, manager) {
    super();

    this.id = id;
    this.manager = manager;
    /** @type {string[]} */
    this.connectedTo = [];

    this.subscribe();
  }

  subscribe() {
    const handler = (m) => {
      this.handleUpdate(JSON.parse(m));
    }
    this.manager.subscribeUser(this.id, handler);
  }
  /**
   * @param {Object} m
   */
  handleUpdate(m) {
    const event = m.type;

    switch (event) {
      case "join":
        this.connectedTo.push(m.data);
        this.emit("join", m.data);
        break;
      case "leave":
        const idx = this.connectedTo.findIndex(e => e === m.data);
        if (idx === -1) break;
        this.connectedTo.splice(idx, 1);
        this.emit("leave", m.data);
        break;
      default:
        console.log(m);
    }
  }
}

export class UserManager {

  /**
   * @param {Stoat} platform
   */
  constructor(platform) {
    this.platform = platform;
    /** @type {Map<string, User>} */
    this.cache = new Map();
  }
  /**
   *
   * @param {Object[]} users
   * @param {Player} p
   */
  onPlayerInit(users, p) {
    users.forEach(u => {
      const user = this.cache.get(u.id);
      if (!user) return;
      user.handleUpdate({
        type: "join",
        data: p.channel.id
      });
    });
  }
  /**
   * @param {string} id
   * @returns {User}
   */
  getUser(id) {
    if (this.cache.has(id)) return this.cache.get(id);

    const user = new User(id, this);
    this.cache.set(id, user);
    return user;
  }
  /**
   * @param {string} id user id
   * @param {(m: Object) => void} callback
   * @returns {Promise<void>}
   */
  subscribeUser(id, callback) {
    return this.platform.subscribe(this.platform.channelPrefix + "user_" + id, callback);
  }
  /**
   * @param {string} id user id
   * @param {(m: Object) => void} callback
   * @returns {Promise<void>}
   */
  unsubscribeUser(id, callback) {
    return this.platform.unsubscribe(this.platform.channelPrefix + "user_" + id, callback);
  }
}

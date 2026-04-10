import EventEmitter from "node:events";
import { Stoat } from "./RedisHandler.js";
import { Player } from "./PlayerManager.js";

export class User extends EventEmitter {
  /** @type {string} */
  id;
  /** @type {string} */
  discriminator;
  /** @type {string} */
  username;
  /** @type {string} */
  displayName;
  /** @type {{url: string}} */
  avatar;

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
    console.log(event);

    switch (event) {
      case "join":
        if (this.connectedTo.includes(m.data)) break;
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

  serialise() {
    return {
      id: this.id,
      discriminator: this.discriminator,
      username: this.username,
      displayName: this.displayName,
      avatar: this.avatar,
      connectedTo: this.connectedTo
    }
  }
  /**
   * @typedef APIUser
   * @property {string} id
   * @property {string} discriminator
   * @property {string} username
   * @property {string} displayName
   * @property {Object} avatar
   * @property {string} avatar.url
   */
  /**
   * @param {APIUser} data
   */
  deserialise(data) {
    this.id = data.id;
    this.discriminator = data.discriminator;
    this.username = data.username;
    this.displayName = data.displayName;
    this.avatar = data.avatar;
  }
  /**
   * @override
   */
  toString() {
    return this.serialise();
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
   * @param {string[]} users
   * @param {Player} p
   */
  onPlayerInit(users, p) {
    console.log("playerInit");
    console.log(users);
    users.forEach(u => {
      const user = this.getUser(u);
      if (!user) return;
      user.handleUpdate({
        type: "join",
        data: p.channel.id
      });
    });
  }
  onPlayerClose(users, p) {
    users.forEach(u => {
      const user = this.cache.get(u.id);
      if (!user) return;
      user.handleUpdate({
        type: "leave",
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
  async getOrFetchUser(id) {
    const user = this.cache.get(id) || new User(id, this);
    const data = await this.platform.get("user", id);
    user.deserialise(data);
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

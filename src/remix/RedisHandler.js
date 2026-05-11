import EventEmitter from "events";
import { createClient } from "redis";
import { PlayerManager } from "./PlayerManager.js";
import { UserManager } from "./UserManager.js";
import { AuthenticationManager } from "../auth/AuthenticationManager.js";

/**
 * Interface to the Stoat and Fluxer servers.
 */
export class RedisManager {
  /**
   * @param {Object} config
   * @param {RedisClientOptions} config.redis
   * @param {AuthenticationManager} auth
   */
  constructor(config, auth) {
    this.handler = new RedisHandler(config);
    this.auth = auth;

    this.stoat = new Stoat(this.handler, auth);
    this.fluxer = new Fluxer(this.handler, auth);
  }
}

/**
 * @template T
 * @callback Getter
 * @param {ValueDescriptor} data
 * @returns {Promise<T>}
 */
/**
 * @typedef ValueDescriptor
 * @property {PlatformString} platform
 * @property {string} key
 * @property {string} type
 * @property {string} [accessor] An additional identifier used for authentication
 * @property {any} additional Further information to the called function
 * @property {boolean} [noCache]
 */
export class RedisHandler extends EventEmitter {
  clientReady = false;
  subReady = false;
  connected = false;
  connectionReady = false; // wether the bot is online and can respond

  currId = 0;
  /**
   *
   * @param {Object} opts
   * @param {RedisClientOptions} opts.redis
   */
  constructor(opts) {
    super();

    this.client = createClient({
      RESP: 3,
      clientSideCache: {
        ttl: 60 * 60 * 1000, // 1 hour
        maxEntries: 0, // unlimited, for now
        evictPolicy: "LRU"
      },
      ...opts.redis
    });
    this.client.on("error", (err) => {
      console.log("[Redis/Main] Error: ", err);
    });
    this.client.connect().then(() => {
      console.log("[RedisMain] Connected");
      this.clientReady = true;
      if (this.subReady && !this.connected) {
        this.emit("redisReady");
        this.connected = true;
      }
    });

    this.subscriber = this.client.duplicate();
    this.subscriber.on("error", (err) => {
      console.log("[Redis/Subscriber] Error: ", err);
    })
    this.subscriber.connect().then(async () => {
      console.log("[Redis/Subscriber] Connected");

      this.subscribe("info", (m) => {
        const data = JSON.parse(m);
        if (data.platform !== "stoat") return; // for now
        if (data.type !== "connected") return;
        this.emit("ready");
      });

      this.subReady = true;
      if (this.clientReady && !this.connected) {
        this.emit("redisReady");
        this.connected = true;
      }
    });

    this.once("redisReady", () => {
      this.client.publish("info", JSON.stringify({
        platform: "backend",
        type: "requestConnected"
      }));
    });
  }
  /**
   * Fulfills once all connections are ready or instantly if already connected
   * @returns {Promise<undefined>}
   */
  ready() {
    if (this.clientReady && this.subReady) return;
    return new Promise((res) => {
      this.once("ready", res);
    });
  }

  /**
   * @param {string} channel
   * @param {string} message
   * @returns {Promise<number>}
   */
  send(channel, message) {
    return this.client.publish(channel, message);
  }
  /**
   *
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  subscribe(channel, listener) {
    return this.subscriber.subscribe(channel, listener);
  }
  /**
   *
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  unsubscribe(channel, listener) {
    return this.subscriber.unsubscribe(channel, listener);
  }

  /**
   * @template T
   * @param {T} data
   * @param {string} platform Identifier of the client that should reply
   * @returns {Promise<T | { error: string }>}
   */
  async request(data, platform) {
    const content = data;
    return new Promise(async res => {
      const id = this.currId++;
      const payload = {
        id,
        content,
        platform,
      }
      const subscriber = async (m) => {
        const d = JSON.parse(m);
        if (d.id != id) return;
        await this.subscriber.unsubscribe("response", subscriber);
        res(d.content);
      }
      await this.subscriber.subscribe("response", subscriber.bind(this));

      await this.client.publish("request", JSON.stringify(payload));
    });
  }
  /**
   *
   * @param {Object} data
   * @param {PlatformString} data.platform
   * @param {string} data.key
   * @param {string} data.type
   * @param {string} [data.accessor] An additional identifier used for authentication
   * @param {boolean} [data.noCache]
   * @returns {Promise<Object>}
   */
  async get(data) {
    // TODO: revisit this, possibly remove accessor from redis store key
    const key = data.platform + ":" + data.type + ":" + data.key + ((data.accessor) ? ":" + data.accessor : "");
    try {
      const data = JSON.parse(await this.client.get(key));
      if (data) return data;
    } catch (e) { }
    const d = await this.request({ type: data.type, key: data.key, accessor: data.accessor }, data.platform);
    if (d && !data.noCache) {
      if (d.error) return d; // don't cache in case of any errors
      await this.client.set(key, JSON.stringify(d), {
        expiration: {
          type: "EX",
          value: 5 * 60, // 5 minutes
        },
      });
    }
    return d;
  }
  /**
   * @template T
   * @param {ValueDescriptor} data
   * @param {Getter<T>} getter The getter function for this value. Will only be called if the cache entry is non existent (or already expired)
   * @returns {Promise<T>}
   */
  async cacheExtraneous(data, getter) {
    const key = data.platform + ":" + data.type + ":" + data.key + ((data.accessor) ? ":" + data.accessor : "");
    try {
      const data = JSON.parse(await this.client.get(key));
      if (data) return data;
    } catch (e) { }
    const d = await getter(data);
    if (d && !data.noCache) {
      if (d.error) return d; // don't cache in case of any errors
      await this.client.set(key, JSON.stringify(d), {
        expiration: {
          type: "EX",
          value: 5 * 60, // 5 minutes
        },
      });
    }
    return d;
  }
  /**
   * utility wrapper for this.request
   * @param {string} func
   * @param {any} data
   * @param {string} platform
   * @returns
   */
  async call(func, data, platform) {
    return await this.request({ type: "function", params: { func, data } }, platform);
  }
}

/**
 * @typedef {("stoat"|"fluxer")} PlatformString
 * @typedef {import("redis").PubSubListener} PubSubListener
 */
 /**
  * @typedef PlatformValueDescriptor
  * @property {string} key
  * @property {string} type
  * @property {string} [accessor] An additional identifier used for authentication
  * @property {any} additional Further information to the called function
  * @property {boolean} [noCache]
  */
 /**
  * Abstract platform base class. May be expanded in the future.
  * @abstract
  */
export class Platform {
  /** @type {PlayerManager} */
  players;
  /** @type {UserManager} */
  users;
  // TODO: define command typings
  /** @type {Object[]} */
  commands;

  /**
   *
   * @param {RedisHandler} _handler
   * @param {AuthenticationManager} _auth
   */
  constructor(_handler, _auth) {

  }

  /**
   * @returns {AuthenticationManager}
   */
  getAuthManager() {
    this.#fail();
  }

  #fail() {
    throw "Property accessed/function called on abstract class.";
  }
  get channelPrefix() {
    return this.#fail();
  }
  /** @type {PlatformString} */
  get identifier() {
    return this.#fail();
  }
  /**
   * @param {string} type
   * @param {string} key
   * @param {string} [accessor] Used on some requests to verify access to that resource
   * @param {boolean} [noCache=false]
   * @returns {Promise<Object>}
   */
  get(type, key, accessor, noCache = false) { this.#fail(); }
  /**
   * @template T
   * @param {PlatformValueDescriptor} data
   * @param {Getter<T>} getter The getter function for this value. Will only be called if the cache entry is non existent (or already expired)
   * @returns {Promise<T>}
   */
  cacheExtraneous(data, getter) { this.#fail();  }
  /**
     *
     * @param {string} func
     * @param {any} data
     * @returns {any}
     */
  call(func, data) { this.#fail(); }
  /**
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  subscribe(channel, listener) { this.#fail(); }
  /**
   *
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  unsubscribe(channel, listener) { this.#fail(); }
}

export class Fluxer extends Platform {
  /**
   *
   * @param {RedisHandler} redis
   * @param {AuthenticationManager} auth
   */
  constructor(redis, auth) {
    super();

    this.redis = redis;
    this.auth = auth;
    this.redis.on("ready", async () => {
      this.commands = await this.get("commands", "*"); // TODO: verify on fluxer
    });
    this.players = new PlayerManager(this.redis, this);
    this.users = new UserManager(this);
  }

  get identifier() {
    return "fluxer";
  }
  get channelPrefix() {
    return "fluxer:";
  }

  getAuthenticationManager() {
    return this.auth;
  }
  /**
   * @param {string} type
   * @param {string} key
   * @param {string} [accessor] Used on some requests to verify access to that resource
   * @param {boolean} [noCache=false]
   * @returns {Promise<Object>}
   */
  get(type, key, accessor, noCache = false) {
    if (type === "user") {
      // TODO: get user object via auth manager and cache
    }
    return this.redis.get({ platform: "fluxer", key: key, type: type, accessor, noCache });
  }
  /**
   * @template T
   * @param {PlatformValueDescriptor} data
   * @param {Getter<T>} getter The getter function for this value. Will only be called if the cache entry is non existent (or already expired)
   * @returns {Promise<T>}
   */
  cacheExtraneous(data, getter) {
    return this.redis.cacheExtraneous({
      platform: this.identifier,
      ...data
    }, getter);
  }
  /**
   *
   * @param {string} func
   * @param {any} data
   * @returns
   */
  call(func, data) {
    return this.redis.call(func, data, "fluxer");
  }
  /**
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  subscribe(channel, listener) {
    return this.redis.subscribe(channel, listener);
  }
  /**
   *
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  unsubscribe(channel, listener) {
    return this.redis.unsubscribe(channel, listener);
  }
}

export class Stoat extends Platform {
  /** @type {Object[]} */
  commands;

  /**
   * @param {RedisHandler} redis
   */
  constructor(redis) {
    super();

    this.redis = redis;
    this.redis.on("ready", async () => {
      this.commands = await this.get("commands", "*");
    });
    this.players = new PlayerManager(redis, this);
    this.users = new UserManager(this);
  }
  get channelPrefix() {
    return "stoat:";
  }
  get identifier() {
    return "stoat";
  }
  /**
   * @param {string} type
   * @param {string} key
   * @param {string} [accessor] Used on some requests to verify access to that resource
   * @param {boolean} [noCache=false]
   * @returns {Promise<Object>}
   */
  get(type, key, accessor, noCache=false) {
    return this.redis.get({ platform: "stoat", key: key, type: type, accessor, noCache });
  }
  /**
   *
   * @param {string} func
   * @param {any} data
   * @returns
   */
  call(func, data) {
    return this.redis.call(func, data, "stoat");
  }
  /**
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  subscribe(channel, listener) {
    return this.redis.subscribe(channel, listener);
  }
  /**
   *
   * @param {string} channel
   * @param {PubSubListener<false>} listener
   * @returns {Promise<void>}
   */
  unsubscribe(channel, listener) {
    return this.redis.unsubscribe(channel, listener);
  }
}

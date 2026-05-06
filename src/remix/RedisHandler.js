import EventEmitter from "events";
import { createClient } from "redis";
import { PlayerManager } from "./PlayerManager.js";
import { UserManager } from "./UserManager.js";

/**
 * Interface to the Stoat and Fluxer servers.
 */
export class RedisManager {
  /**
   * @param {Object} config
   * @param {RedisClientOptions} config.redis
   */
  constructor(config) {
    this.handler = new RedisHandler(config);

    this.stoat = new Stoat(this.handler);
  }
}

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
 */

export class Fluxer {
  /**
   *
   * @param {RedisHandler} redis
   */
  constructor(redis) {
    this.redis = redis;
    this.redis.on("ready", () => {
      // TODO:
    });
  }
}

export class Stoat {
  /** @type {Object[]} */
  commands;

  /**
   * @param {RedisHandler} redis
   */
  constructor(redis) {
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

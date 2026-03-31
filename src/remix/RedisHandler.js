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
        this.emit("ready");
        this.connected = true;
      }
    });

    this.subscriber = this.client.duplicate();
    this.subscriber.on("error", (err) => {
      console.log("[Redis/Subscriber] Error: ", err);
    })
    this.subscriber.connect().then(async () => {
      console.log("[Redis/Subscriber] Connected");

      this.subReady = true;
      if (this.clientReady && !this.connected) {
        this.emit("ready");
        this.connected = true;
      }
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
   * @returns {Promise<T>}
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
   * @param {("fluxer"|"stoat")} data.platform
   * @param {string} data.key
   * @param {string} data.type
   * @returns {Promise<Object>}
   */
  async get(data) {
    const key = data.platform + "_" + data.type + "_" + data.key;
    try {
      const data = JSON.parse(await this.client.get(key));
      if (data) return data;
    } catch (e) { }
    const d = await this.request({ type: data.type, key: data.key }, data.platform);
    if (d) {
      await this.client.set(key, JSON.stringify(d), {
        expiration: {
          type: "EX",
          value: 5 * 60, // 5 minutes
        },
      });
    }
    return d;
  }
}

export class Stoat {
  /**
   * @param {RedisHandler} redis
   */
  constructor(redis) {
    this.redis = redis;
    this.players = new PlayerManager(redis, "stoat");
    this.users = new UserManager(this);
  }
  get channelPrefix() {
    return "stoat_";
  }
  /**
   * @param {string} type
   * @param {string} key
   * @returns {Promise<Object>}
   */
  get(type, key) {
    return this.redis.get({ platform: "stoat", key: key, type: type });
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

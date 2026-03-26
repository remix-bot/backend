import EventEmitter from "events";
import { createClient } from "redis";
import { PlayerManager } from "./PlayerManager";

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

    this.client = createClient(opts.redis);
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
   * @param {string|Object} data
   * @returns {Promise<string>}
   */
  async request(data) {
    const content = (typeof data === "string") ? data : JSON.stringify(data);
    return new Promise(async res => {
      const id = this.id++;
      const payload = {
        id,
        content
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
}

export class Stoat {
  /**
   * @param {RedisHandler} redis
   */
  constructor(redis) {
    this.redis = redis;
    this.players = new PlayerManager(redis);
  }


}

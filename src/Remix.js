import { createClient } from "redis";

/**
 * Interface to the Stoat and Fluxer servers.
 */
export class Remix {
  constructor() {
    this.stoat = new Stoat();
  }
}

export class RedisHandler {
  /**
   *
   * @param {Object} opts
   * @param {RedisClientOptions} opts.redis
   */
  constructor(opts) {
    this.client = createClient(opts.redis);
    this.client.on("error", (err) => {
      console.log("[Redis/Main] Error: ", err);
    });
    this.client.connect().then(() => {
      console.log("[RedisMain] Connected");
    });

    this.subscriber = this.client.duplicate();
    this.subscriber.on("error", (err) => {
      console.log("[Redis/Subscriber] Error: ", err);
    })
    this.subscriber.connect().then(() => {
      console.log("[Redis/Subscriber] Connected");
    });
  }
}

export class Stoat {
  /**
   * @param {RedisHandler} redis
   */
  constructor(redis) {
    this.redis = redis;
  }
}

import { RedisHandler, RedisManager } from "./RedisHandler.js";

export class PlayerManager {
  /**
   * @param {RedisHandler} redis
   */
  constructor(redis) {
    this.redis = redis;

    this.redis.on("ready", this.initChannels.bind(this));
  }

  async initChannels() {
    const data = JSON.parse(await this.redis.request({
      type: "fetchPlayers"
    }));

  }
}

export class Player {
  constructor(channel, subscriber) {

  }
}

import { RedisHandler, RedisManager } from "./RedisHandler.js";

export class PlayerManager {
  /**
   * @param {RedisHandler} redis
   * @param {string} platform
   */
  constructor(redis, platform) {
    this.redis = redis;
    this.platform = platform;

    this.redis.on("ready", this.initChannels.bind(this));
  }

  async initChannels() {
    const data = await this.redis.request({
      type: "fetchPlayers"
    }, this.platform);

  }
}

export class Player {
  constructor(channel, subscriber) {

  }
}

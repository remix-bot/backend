import { RedisHandler, RedisManager } from "./RedisHandler.js";

export class PlayerManager {
  /** @type {Map<string, Player>} */
  playerMap = new Map();
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
    /** @type {SerialisedPlayer[]} */
    const data = await this.redis.request({
      type: "fetchPlayers"
    }, this.platform);
    data.forEach((p) => {
      console.log(p);
      const player = new Player(this.platform + "_player_" + p.channel.id, this.redis);
      player.deserialise(p);
      console.log(player.queueLoop, player.songLoop);
      this.playerMap.set(p.channel.id, player);
    });
    //console.log(this.playerMap);
  }
}

/**
 * @typedef SerialisedPlayer
 * @property {number} loop First bit queue loop, second bit song loop
 * @property {boolean} paused
 * @property {number} volume
 * @property {Object} queue
 * @property {Object} queue.current
 * @property {Object[]} queue.data
 * @property {Object} channel
 * @property {string} channel.id
 * @property {Object} server
 */
export class Player {
  /** @type {number} */
  loop;
  /** @type {boolean} */
  paused;
  /** @type {number} */
  volume;
  /** @type {Object} */
  channel;
  /** @type {Object} */
  queue;
  /**
   *
   * @param {string} channel
   * @param {RedisHandler} subscriber
   */
  constructor(channel, subscriber) {
    this.redisChannel = channel;
    this.redis = subscriber;

    this.setupEvents();
  }
  setupEvents() {
    const listener = (m) => {
      console.log(m);
    }
    this.redis.subscribe(this.redisChannel, listener);
  }

  /**
   * @param {SerialisedPlayer} redisData
   */
  deserialise(redisData) {
    if (!redisData) return;
    this.loop = redisData.loop;
    this.paused = redisData.paused;
    this.volume = redisData.volume;
    this.channel = {
      ...redisData.channel,
      server: redisData.server
    };
    this.queue = redisData.queue;
  }

  get queueLoop() {
    return (this.loop & 1) === 1;
  }
  get songLoop() {
    return (this.loop & 2) === 2; // the songLoop bit is shifted to the left
  }
}

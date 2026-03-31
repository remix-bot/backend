import { RedisHandler, RedisManager } from "./RedisHandler.js";
import EventEmitter from "node:events";

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
      const player = this.deserialisePlayer(p);
      this.playerMap.set(p.channel.id, player);
    });
    console.log(this.playerMap);

    const managerEvent = (m) => {
      const data = JSON.parse(m);
      const type = data.type;
      /** @type {SerialisedPlayer} */
      const player = data.player;

      if (type === "init") {
        const p = this.deserialisePlayer(player);
        this.playerMap.set(p.channel.id, p);
        return;
      } else if (type === "close") {
        const id = player.channel.id;
        this.get(id).close();
        this.playerMap.delete(id);
      }
    }
    await this.redis.subscribe(this.platform + "_players", managerEvent);
  }
  /**
   * @param {string} id Channel id of the player
   * @returns {Player|undefined}
   */
  get(id) {
    return this.playerMap.get(id);
  }
  /**
   *
   * @param {SerialisedPlayer} p
   * @returns {Player}
   */
  deserialisePlayer(p) {
    console.log("deserialisation", p.channel.id);
    const player = new Player(this.platform + "_player_" + p.channel.id, this.redis);
    player.deserialise(p);
    return player;
  }
}

/**
 * @typedef SerialisedVideo
 * @property {string} title
 * @property {string} url
 * @property {string} videoId
 * @property {string} type
 * @property {string} duration (timestamp)
 * @property {string} description
 * @property {Object} artist
 * @property {string} artist.name
 * @property {string} artist.url
 * @property {string} thumbnail
 */
export class Queue {
  /** @type {SerialisedVideo} */
  current;
  /** @type {SerialisedVideo[]} */
  data;
  constructor() {

  }
  /**
   * @typedef SerialisedQueue
   * @property {SerialisedVideo} current
   * @property {SerialisedVideo[]} data
   */
  /**
   * @param {SerialisedQueue} data
   */
  deserialise(data) {
    this.current = data.current;
    this.data = data.data;
  }
  /**
   * Invoked by startPlay
   * @param {SerialisedVideo} vid
   */
  playNext(vid) {
    this.current = vid;
  }

  update(event) {
    const type = event.type;
    switch (type) {
      case "add":
        const vid = event.data;
        if (event.append) {
          this.data.push(vid);
        } else {
          this.data.unshift(vid);
        }
        break;
      case "remove":
        const idx = event.data.index;
        this.data.splice(idx, 1);
        break;
      case "update": // new song playing
        this.data.shift();
        if (event.data.loop) {
          this.data.push(event.data.old);
        }
        break;
      case "shuffle":
        const newArr = event.data;
        // reordering is not necessary at this point in time
        /*queueData.forEach((item) => {
          const idx = newArr.findIndex(e => e.videoId === item.videoId && !e.consumed);
          item.queueIndex = idx;
          newArr[idx].consumed = true;
        });
        queueData = queueData.sort((a, b) => b.queueIndex - a.queueIndex);*/
        this.data = newArr;
        break;
    }
  }
}
/**
 * @typedef SerialisedPlayer
 * @property {number} loop First bit queue loop, second bit song loop
 * @property {boolean} paused
 * @property {number} volume
 * @property {SerialisedQueue} queue
 * @property {Object} channel
 * @property {string} channel.id
 * @property {Object} server
 */
export class Player extends EventEmitter {
  loop = 0;
  paused = false;
  playing = false;
  volume = 1;
  startPlaying = 0;
  timeDiff = 0; // time since last pause/resume and this since startPlaying

  /** @type {Object} */
  channel;
  /** @type {Queue} */
  queue;
  /** @type {Object[]} */
  users;
  /**
   * @param {string} channel
   * @param {RedisHandler} subscriber
   */
  constructor(channel, subscriber) {
    super();

    this.redisChannel = channel;
    this.redis = subscriber;

    this.setupEvents();
  }
  setupEvents() {
    const listener = (m) => {
      const { type, data } = JSON.parse(m);
      console.log(type, data);
      switch (type) {
        case "startplay":
          this.queue.playNext(data);
          this.startPlaying = 0;
          this.timeDiff = 0;
          this.playing = false;
          break;
        case "streamStartPlay":
          this.startPlaying = data;
          this.playing = true;
          break;
        case "pause":
          this.paused = true;
          break;
        case "resume":
          this.paused = false;
          this.startPlaying = Date.now()
          this.timeDiff = data.elapsedTime;
          break;
        case "stopplay":
          this.paused = false;
          this.playing = false;
          this.timeDiff = 0;
          this.startPlaying = 0;
          break;
        case "volume":
          this.volume = data;
          break;
        case "queue":
          this.queue.update(data);
          break;
        case "join":
          this.users.push(data);
          break;
        case "leave":
          const idx = this.users.findIndex(u => u.id === data.id);
          if (idx === -1) break;
          this.users.splice(idx, 1);
          break;
      }
    }
    this.redis.subscribe(this.redisChannel, listener);
  }

  get elapsed() {
    return Date.now() - this.startPlaying + this.timeDiff;
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
    this.queue = new Queue();
    this.queue.deserialise(redisData.queue);
    this.users = this.channel.voiceParticipants;
  }

  close() {
    // TODO: IMPORTANT!
  }

  get queueLoop() {
    return (this.loop & 1) === 1;
  }
  get songLoop() {
    return (this.loop & 2) === 2; // the songLoop bit is shifted to the left
  }
}

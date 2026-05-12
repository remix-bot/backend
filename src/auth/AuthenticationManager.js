import { DatabaseManager } from "../db/DatabaseManager.js";
import { RedisManager } from "../remix/RedisHandler.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 */

 /**
  * @typedef {AuthenticatedRequest}
  * @augments {Request}
  * @property {Object} data
  */

  /**
   * @typedef FluxerUser
   * @property {string} id
   * @property {string} username
   * @property {string} discriminator
   * @property {string} global_name
   * @property {string} avatar
   * @property {number} avatar_color
   * @property {number} flags
   * @property {boolean} bot
   * @property {boolean} system
   * @property {string} email
   * @property {boolean} verified
   */

export class AuthenticationManager {
  /**
   * @typedef UserCredentials
   * Fluxer OAuth2 credentials
   * @property {string} token
   * @property {string} type
   */
  /** @type {Map<string, UserCredentials>} */
  userCredentials = new Map();

  fluxerEndpoint = "https://api.fluxer.app/v1";
  /**
   *
   * @param {RedisManager} redis
   * @param {DatabaseManager} db
   */
  constructor(redis, db) {
    this.redis = redis;
    this.db = db;
  }

  /**
   *
   * @param {Request} req
   * @returns {Promise<boolean>}
   */
  async verifySession(req) {
    if (req.session.fluxerVerified) return true;
    if (req.session.verified) return true;
    if (!req.session.code || !req.session.user) {
      const token = req.headers.token;
      const id = req.headers.tokenid;
      if (!token || !id) return false;
      const data = await this.db.verifyAPIToken(token, id);
      if (!data.valid) return false;
      req.session.user = data.user;
      req.session.verified = true;
      req.session.type = "stoat";
      return true;
    }
    if (!(await this.db.verifyLoginCode(req.session.user, req.session.code))) return false;
    req.session.verified = true;
    req.session.type = "stoat";
    return true;
  }

  /**
   *
   * @param {string} user Fluxer user id
   * @returns {Promise<string | null>} The fluxer access token stored for that user account or null if not found or if an error occured.
   */
  async getFluxerAuthToken(user) {
    return this.redis.handler.cacheExtraneous({
      platform: "fluxer",
      type: "access_token",
      key: user
    }, async (data) => this.db.getFluxerAccessToken(data.key));
  }

  /**
   * @param {string} user Fluxer user id
   * @returns {Promise<FluxerUser>}
   */
  async getFluxerUser(user) {
    const res = await (await this.get(this.fluxerEndpoint + "/oauth2/@me", await this.getFluxerAuthToken(user))).json();
    if (!!res.errors) {
      console.error("Fluxer user fetch error: ", res);
      return null;
    }
    return res.user;
  }
  /**
   *
   * @param {string} token
   * @returns {Promise<FluxerUser}
   */
  async getFluxerUserByToken(token) {
    const res = await (await this.get(this.fluxerEndpoint + "/oauth2/@me", token)).json();
    if (!!res.errors) {
      console.error("Fluxer user fetch error: ", res);
      return null;
    }
    return res.user;
  }

  /**
   *
   * @param {string} url
   * @param {string} bearer Bearer Auth Token
   */
  get(url, bearer) { // TODO: extend capabilities
    const params = new URLSearchParams();
    params.append("Authorization", "Bearer " + bearer);
    return fetch(url, {
      method: "get",
      headers: params
    });
  }

  /**
   *
   * @param {string} userStoat userId
   * @param {Request} req
   * @returns {Promise<string>}
   */
  async initiateLogin(user, req) {
    const token = await this.db.generateLoginCode(user);

    req.session.user = user;
    req.session.code = token;
    req.session.verified = false;

    return token;
  }

  /**
   *
   * @returns {RequestHandler}
   */
  middleware() {
    return async (req, res, next) => {
      if (!(await this.verifySession(req))) return res.status(403).send({ error: "Unauthorized" });
      console.log("auth ", req.session);
        // TODO: stoat for now, fluxer needs handling as well
      /*const stoatUser = await this.redis.stoat.users.getOrFetchUser(req.session.user);
      const fluxerUser = await this.redis.fluxer.users.getOrFetchUser(req.session.user);*/
      req.data = {
        /*users: { // TODO: concurrent logged in accounts
          stoat: stoatUser
          },*/
        user: (req.session.type === "stoat") ? await this.redis.stoat.users.getOrFetchUser(req.session.user) : await this.redis.fluxer.users.getOrFetchUser(req.session.user) // TODO: switch based on current preferred platform
      };
      console.log("done", req.data);
      next();
    }
  }
}

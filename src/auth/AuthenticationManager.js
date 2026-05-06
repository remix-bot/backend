import { DatabaseManager } from "../db/DatabaseManager";
import { RedisManager } from "../remix/RedisHandler";

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

export class AuthenticationManager {
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

        // TODO: stoat for now, fluxer needs handling as well
      const stoatUser = await this.redis.stoat.users.getOrFetchUser(req.session.user);
      req.data = {
        users: {
          stoat: stoatUser
        },
        user: stoatUser // TODO: switch based on current preferred platform
      };
      next();
    }
  }
}

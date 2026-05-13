import { compare, genSalt, hash } from "bcryptjs";
import { createPool } from "mysql2/promise";
import mysql2 from "mysql2/promise";
const { FieldPacket, PoolOptions, QueryResult } = mysql2;
import { Utils } from "../Utils.js";

/** @typedef {import("../remix/RedisHandler.js").PlatformString} PlatformString */

export class DatabaseManager {
  /**
   * @param {PoolOptions} config Based on https://sidorares.github.io/node-mysql2/docs#using-connection-pools
   */
  constructor(config) {
    this.db = createPool({
      connectionLimit: 15,
      ...config
    });

    this.init();
  }

  async init() {
    /*
    // TODO: complete
    this.execute(`CREATE TABLE 'api_tokens' (
      'user' varchar(26) COLLATE utf8mb4_general_ci NOT NULL,
      'id' varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
      'platform' varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'stoat',
      'token' varchar(70) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL,
      'createdAt' datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) IF NOT EXISTS ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`, []);

    this.execute(`CREATE TABLE 'fluxer_auth' (
      'user' varchar(26) COLLATE utf8mb4_general_ci NOT NULL,
      'token' varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
      'expires' int NOT NULL,
      'refresh' varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
      'scope' varchar(255) COLLATE utf8mb4_general_ci NOT NULL
    ) IF NOT EXISTS ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`, []);

    this.execute(`CREATE TABLE 'login_codes' (
      'user' varchar(26) COLLATE utf8mb4_general_ci NOT NULL,
      'id' varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
      'token' varchar(70) COLLATE utf8mb4_general_ci NOT NULL,
      'verified' tinyint(1) NOT NULL DEFAULT '0',
      'createdAt' datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`, []);*/
  }
  /**
   * @param {string} query
   * @returns {Promise<[QueryResult, FieldPacket[]]>}
   */
  async query(query) {
    return this.db.query(query);
  }
  /**
   * @param {string} query
   * @param {string[]} [data]
   * @returns {Promise<QueryResult>}
   */
  async execute(query, data) {
    const [res, _fields] = await this.db.execute(query, data);
    return res;
  }
  /**
   * @param {string} plain
   * @returns {Promise<string>}
   */
  async hash(plain) {
    const salt = await genSalt(10);
    return hash(plain, salt);
  }
  /**
   * @param {string} plain
   * @param {string} hash
   * @returns {Promise<string>}
   */
  async compareHash(plain, hash) {
    return await compare(plain, hash);
  }
  /**
   *
   * @param {string} user
   * @param {PlatformString} [platform]
   * @returns {Promise<{token: string, id: string}>} API Token and ID, both have to be provided for websocket calls and reauthentication.
   */
  async generateAPIToken(user, platform="stoat") {
    const id = Utils.uid();
    const token = await Utils.randomToken();
    try {
      await this.execute(`INSERT INTO api_tokens (user, id, platform, token, createdAt) VALUES (?, ?, ?, ?, NOW())`, [user, id, platform, await this.hash(token)])
    } catch (e) {
      console.log("api token generation error:", e);
      return null;
    }
    return { token, id };
  }
  /**
   * @param {string} user userId
   * @returns {Promise<string>}
   */
  async generateLoginCode(user) {
    const uid = Utils.uid();
    const token = await Utils.randomToken();
    this.query(`DELETE FROM api_tokens WHERE DATE_ADD(createdAt, INTERVAL 63 DAY) < NOW()`);
    this.execute("DELETE FROM login_codes WHERE createdAt<?", [new Date(Date.now() - this.expiryTime)]).catch(e => {
      console.log("mysql cleanup error:", e);
    });
    try {
      const res = await this.execute(`INSERT INTO login_codes (user, id, token, verified, createdAt) VALUES (?, ?, ?, false, NOW())`,
        [user, uid, await this.hash(token)]);
    } catch (e) {
      console.log("Login code creation error: ", e);
      return null;
    }

    return token;
  }
  /**
   * @param {string} token
   * @param {string} id
   * @returns {Promise<{ valid: boolean, user: string, platform: PlatformString }>}
   */
  async verifyAPIToken(token, id) {
    try {
      const res = await this.execute("SELECT * FROM api_tokens WHERE id=?", [id]);
      if (res.length === 0) return {
        valid: false
      };
      if (!(await this.compareHash(token, res[0].token))) return {
        vaid: false
      };

      return {
        valid: true,
        platform: res[0].platform,
        user: res[0].user
      };
    } catch (e) {
      console.error("SELECT api_tokens:", e);
      return {
        valid: false
      };
    }
  }
  /**
   * @param {string} id
   */
  async deleteAPIToken(id) {
    try {
      const res = await this.execute("DELETE FROM api_tokens WHERE id=?", [
        id
      ]);
      return true;
    } catch (e) {
      console.error("DELETE FROM api_tokens:", e);
      return false;
    }
  }
  /**
   * @param {string} userId
   * @param {string} code
   * @returns {Promise<boolean>}
   */
  async verifyLoginCode(userId, code) {
    try {
      const res = await this.execute("SELECT * FROM login_codes WHERE user=?", [userId]);
      //if (res.length === 0) return false;
      for (let i = 0; i < res.length; i++) {
        if (!res[i].verified) continue;
        if (!this.compareHash(code, res[i].token)) continue;
        return true;
      }
      return false;
    } catch (e) {
      console.log("SELECT login:codes:", e);
      return false;
    }
  }

  /**
   * @param {string} user
   * @returns {Promise<{ token: string, refresh: string, expiry: number } | null>}
   */
  async getFluxerAccessToken(user) {
    try {
      const res = await this.execute("SELECT * FROM fluxer_auth WHERE user=? ORDER BY expires DESC LIMIT 1", [user]);
      if (res.length == 0) return null;
      // TODO: possibly refresh the token if adequate
      return {
        token: res[0].token,
        refresh: res[0].refresh,
        expiry: res[0].expires * 1000
      };
    } catch (e) {
      console.error("SELECT fluxer_auth: ", user, e);
    }
    return null;
  }
  async storeFluxerAccessToken(user, data) {
    try {
      await this.execute("DELETE FROM fluxer_auth WHERE user=?", [user]);
      const res = await this.execute("INSERT INTO fluxer_auth (user, token, expires, refresh, scope) VALUES (?, ?, ?, ?, ?)", [
        user, data.token, data.expires, data.refreshToken, data.scope
      ]);
    } catch (e) {
      console.error("INSERT INTO fluxer_auth: ", user, e);
    }
  }

  /**
   * Gracefully closes any database connections
   * @returns {Promise<void>}
   */
  close() {
    return this.db.end();
  }
}

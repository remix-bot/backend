import { compare, genSalt, hash } from "bcryptjs";
import { createPool } from "mysql2/promise";
import mysql2 from "mysql2/promise";
const { FieldPacket, PoolOptions, QueryResult } = mysql2;
import { Utils } from "../Utils.js";

export class DatabaseManager {
  /**
   * @param {PoolOptions} config Based on https://sidorares.github.io/node-mysql2/docs#using-connection-pools
   */
  constructor(config) {
    this.db = createPool({
      connectionLimit: 15,
      ...config
    });
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
   * @returns {Promise<{token: string, id: string}>} API Token and ID, both have to be provided for websocket calls and reauthentication.
   */
  async generateAPIToken(user) {
    const id = Utils.uid();
    const token = await Utils.randomToken();
    try {
      await this.execute(`INSERT INTO api_tokens (user, id, token, createdAt) VALUES (?, ?, ?, NOW())`, [user, id, await this.hash(token)])
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
   * @returns {Promise<{ valid: boolean, user: string }>}
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
      console.llg("SELECT login:codes:", e);
      return false;
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

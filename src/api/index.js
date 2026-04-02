import session from "express-session";
import express, { json, Router } from "express";
import cors from "cors";
import { createServer } from "http";
import { createServer as createServerHttps } from "https";
import * as fs from "node:fs";
import { SocketHandler } from "../ws/SocketHandler.js";
import { RedisManager } from "../remix/RedisHandler.js";
import { DatabaseManager } from "../db/DatabaseManager.js";
import { RedisStore } from "connect-redis";

export class APIServer {
  /**
   * @param {Object} config
   * @param {string} config.sessionSecret
   * @param {number} config.port Port the http server will listen on
   *
   * @param {Object} config.ssl
   * @param {boolean} [config.ssl.useSSL] Defaults to `false`
   * @param {string} [config.ssl.private] Path to the private key file
   * @param {string} [config.ssl.cert] Path to the cert file
   * @param {number} [config.ssl.httpPort] Port the http port will listen on to redirect to https
   *
   * @param {PoolOptions} config.mysql
   */
  constructor(config) {
    this.app = express();
    this.server;
    if (config.ssl.useSSL) {
      this.server = createServerHttps({
        key: fs.readFileSync(config.ssl.private),
        cert: fs.readFileSync(config.ssl.cert)
      }, this.app);

      const httpServer = express();
      httpServer.get(/(.*)/, function (req, res) {
        res.redirect("https://" + req.headers.host + req.url);
      });
      httpServer.listen(config.ssl.httpPort);
    } else {
      this.server = createServer(this.app);
    }

    this.port = config.port || 80;
    this.server.listen(this.port, () => {
      console.log("Listening on port " + this.port);
    });

    this.redis = new RedisManager(config);
    const redisStore = new RedisStore({
      client: this.redis.handler.client,
      prefix: "backend-session:"
    });
    this.ses = session({
      store: redisStore,
      saveUninitialized: false,
      secret: config.sessionSecret || "testsecret",
      resave: "false",
      cookie: {
        secure: "auto"
      }
    });
    this.app.use(this.ses);
    this.app.use(json());
    /*const dynamicCors = (req, callback) => {
      console.log(req.headers.origin === config.frontendOrigin, config.frontendOrigin, req.headers.origin);
      if (req.headers.origin === config.frontendOrigin) {
        return callback(null, {
          origin: config.frontendOrigin,
          preflightContinue: true,
          credenials: true
        });
      }
      return callback(null, { origin: "*" });
    }
    this.app.use(cors(dynamicCors));*/
    this.app.use(cors({
      origin: config.frontendOrigin,
      credentials: true
    }));
    //this.app.use(cors());

    this.db = new DatabaseManager(config.mysql);

    this.sockets = new SocketHandler(this.server, this.redis, this.db);

    this.setupPublic();
    this.setupSecure();
  }

  /**
   * @param {string} d
   * @returns {Promise<string>}
   */
  async getUserId(d) {
    if (!d) return;
    if (d.length !== 26) return null; // too short
    if (!d.match(/[0-9A-Z]{26}/g)) return null;
    // TODO: fetch users from remix and cache them
    return d;
  }

  setupPublic() {
    this.app.post("/login", async (req, res) => {
      if (!req.body) {
        return res.status(400).send({ message: "Invalid body" });
      }
      const user = await this.getUserId(req.body.user);
      if (req.session.code && user === req.session.user) return res.status(200).send({ code: req.session.code, user });
      if (!user) {
        return res.status(400).send({ message: "Invalid user data" });
      }
      const token = await this.db.generateLoginCode(user);
      req.session.user = user;
      req.session.code = token;
      req.session.verified = false;
      res.status(200).send({ code: token, user });
    });
    this.app.get("/login/code", (req, res) => {
      return res.status(200).send({ code: req.session?.code });
    })
    this.app.post("/login/verify", async (req, res) => {
      const v = await this.verifySession(req);
      if (!v) return res.send({ verified: false });
      const apiToken = await this.db.generateAPIToken(req.session.user);
      res.send({ verified: true, token: apiToken });
    });
    this.app.get("/commands", (req, res) => {
      res.send(this.redis.stoat.commands);
    });
  }
  /**
   * @param {Request} req
   * @returns {Promise<boolean>}
   */
  async verifySession(req) {
    if (req.session.verified) return true;
    if (!req.session.code || !req.session.user) {
      const token = req.headers.token;
      const id = req.headers.tokenid;
      if (!token || !id) return false;
      const data = await this.db.verifyAPIToken(token, id);
      if (!data.valid) return false;
      req.session.user = data.user;
      req.session.verified = true;
      return true;
    }
    if (!(await this.db.verifyLoginCode(req.session.user, req.session.code))) return false;
    req.session.verified = true;
    return true;
  }
  setupSecure() {
    this.secured = new Router();
    this.secured.use(/** @param {Request} req @param {Response} res */async (req, res, next) => {
      if (!(await this.verifySession(req))) return res.status(403).send({ error: "Unauthorized." });
      req.data = {
        user: await this.redis.stoat.users.getOrFetchUser(req.session.user)
      };

      next();
    });
    this.app.use(this.secured);

    this.secured.get("/info", async (req, res) => {
      res.status(200).send({
        user: req.data.user.serialise()
      });
    });
  }
}

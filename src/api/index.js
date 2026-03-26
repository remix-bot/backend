import session from "express-session";
import express, { Router } from "express";
import { createServer } from "http";
import { createServerHttps } from "https";
import * as fs from "node:fs";
import { SocketHandler } from "../ws/SocketHandler";
import { RedisManager } from "../remix/RedisHandler";
import { DatabaseManager } from "../db/DatabaseManager";

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
      httpServer.get("*", function (req, res) {
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

    this.ses = session({
      saveUninitialized: false,
      secret: config.sessionSecret || "testsecret",
      resave: "false",
      cookie: {
        secure: "auto"
      }
    });
    this.app.use(this.ses);

    this.redis = new RedisManager(config);
    this.db = new DatabaseManager(config.mysql);

    this.sockets = new SocketHandler(this.server, this.redis, this.db);

    this.setupSecure();
    this.setupPublic();
  }

  setupPublic() {
    this.app.post("/login", async (req, res) => {
      const user = await this.getUserId(req.body.user);
      if (!user) {
        return res.status(400).send({ message: "Invalid user data" });
      }
      const token = await this.db.generateLoginCode(user);
      req.session.user = user;
      req.session.code = token;
      req.session.verified = false;
      res.status(200).send(JSON.stringify({ code: token }));
    });
    this.app.post("/login/verify", async (req, res) => {
      const v = await this.verifySession(req);
      if (!v) res.send({ verified: false });
      const apiToken = await this.db.generateAPIToken(req.session.user);
      res.send({ verified: true, token: apiToken });
    });
  }
  /**
   * @param {Request} req
   * @returns {Promise<boolean>}
   */
  async verifySession(req) {
    if (req.session.verified) return true;
    if (!req.session.code || !req.session.user) {
      const token = req.headers.get("token");
      const id = req.headers.get("tokenId");
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
      if (!(await this.verifySession(req))) return res.status(403).send("Unauthorized.");
      req.data = {
        id: req.session.user
      };

      next();
    });
    this.app.use(this.secured);
  }
}

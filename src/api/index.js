import session from "express-session";
import express, { json, Router } from "express";
import cors from "cors";
import { createServer } from "http";
import { createServer as createServerHttps } from "https";
import * as fs from "node:fs";
import { SocketHandler } from "../ws/SocketHandler.js";
import { Platform, RedisManager, Stoat } from "../remix/RedisHandler.js";
import { DatabaseManager } from "../db/DatabaseManager.js";
import { RedisStore } from "connect-redis";
import { FluxerAuth } from "../auth/FluxerAuth.js";
import { AuthenticationManager } from "../auth/AuthenticationManager.js";

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
   * @param {Object} config.fluxer
   * @param {string} config.fluxer.id
   * @param {string} config.fluxer.secret
   * @param {string} config.fluxer.redirectUri
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
    this.frontendOrigin = config.frontendOrigin;
    this.config = config;

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
    this.app.use((req, res, next) => {
      try {
        decodeURIComponent(req.path);
      } catch (e) {
        console.log(new Date().toLocaleString(), req.url, e);
        return res.redirect('/404');
      }
      next();
    });

    this.db = new DatabaseManager(config.mysql);

    this.sockets = new SocketHandler(this.server, this.redis, this.db);
    this.auth = new AuthenticationManager(this.redis, this.db);
    this.redis.setAuthManager(this.auth);

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
      const token = await this.auth.initiateLogin(user);
      res.status(200).send({ code: token, user });
    });
    this.app.get("/login/code", (req, res) => {
      return res.status(200).send({ code: req.session?.code });
    })
    this.app.post("/login/verify", async (req, res) => {
      const v = await this.auth.verifySession(req);
      if (!v) return res.send({ verified: false });
      const apiToken = await this.db.generateAPIToken(req.session.user, req.session.authPlatform);
      res.send({ verified: true, token: apiToken });
    });
    this.app.get("/commands", (req, res) => {
      res.send(this.redis.stoat.commands);
    });
    this.app.get("/connectioncheck", async (req, res) => {
      res.status(200).send(await this.redis.stoat.call("testConnection"));
    });

    const auth = new Router();
    const fluxer = new FluxerAuth(auth, this, this.redis.handler, this.config.fluxer);

    this.app.use("/auth", auth);
  }
  /**
   * @param {Request} req
   * @returns {Promise<boolean>}
   */
   /*async verifySession(req) {
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
  }*/
  setupSecure() {
    this.secured = new Router();
    this.secured.use(this.auth.middleware());
    this.app.use(this.secured);

    this.secured.get("/info", async (req, res) => {
      res.status(200).send({
        user: req.data.user.serialise()
      });
    });
    this.secured.get("/player/:channel", async (req, res) => {
      const player = this.redis.stoat.players.get(req.params.channel);
      if (!player) return res.status(404).send({ error: "Player not found" });
      if (!player.users.find(u => u === req.data.user.id)) return res.status(401).send({ error: "Unauthorized" });
      res.status(200).send(player.serialise());
    });
    this.secured.get("/servers", async (req, res) => {
      const servers = await this.redis.stoat.get("sharedServers", req.data.user.id);
      res.status(200).send(servers);
    });
    this.secured.get("/server/:id/channels", async (req, res) => {
      const server = await this.redis.stoat.get("server", req.params.id, req.data.user.id);
      res.status(200).send(server?.channels || server);
    });

    this.secured.post("/voice/:id/join", async (req, res) => {
      if (!req.params?.id || !req.body.text) return res.status(400).send({ error: "invalid voice or text channel id" });
      const response = await this.redis.stoat.call("join", {
        channel: req.params.id,
        text: req.body.text,
        user: req.data.user.id
      });
      res.status(200).send(response);
    });
    this.secured.post("/voice/:id/leave", async (req, res) => {
      if (!req.params?.id || !req.body.channel) return res.status(400).send({ error: "invalid voice or text channel id" });

    });
    this.secured.post("/dashboard/control", async (req, res) => {
      if (req.data.user.connectedTo.length === 0) return res.status(422).send({ message: "Not in a voice channel" });
      if (!["pausePlayback", "skip", "resumePlayback", "volume"].includes(req.body.action)) return res.status(400).send({ message: "Invalid action" });
      const r = await this.redis.stoat.call(req.body.action, {
        user: req.data.user.id,
        player: req.data.user.connectedTo[0],
        volume: req.body.volume
      });
      return res.status(200).send(r);
    });
    this.secured.post("/dashboard/queue", async (req, res) => {
      if (req.data.user.connectedTo.length === 0) return res.status(422).send({ message: "Not in a voice channel" });
      const type = (req.body.query.startsWith("remix://radio/")) ? "radio" : "video";
      const query = (type === "radio") ? req.body.query.slice("remix://radio/".length) : req.body.query;
      const r = await this.redis.stoat.call("addToQueue", {
        user: req.data.user.id,
        player: req.data.user.connectedTo[0],
        type: type,
        query
      });
      return res.status(200).send(r);
    });
  }
}

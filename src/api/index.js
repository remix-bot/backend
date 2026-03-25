import session from "express-session";
import express from "express";
import { createServer } from "http";
import { createServerHttps } from "https";
import * as fs from "node:fs";
import { SocketHandler } from "../ws/SocketHandler";

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

    this.sockets = new SocketHandler(this.server, this.ses);
  }
}

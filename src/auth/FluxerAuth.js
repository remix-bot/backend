import { Router } from "express";
import path from "node:path";
import { APIServer } from "../api/index.js";
import url from "node:url";
import { format } from "node:url";

export class FluxerAuth {
  /**
   *
   * @param {Router} router
   * @param {APIServer} server
   * @param {Object} clientConfig
   * @param {string} clientConfig.id
   * @param {string} clientConfig.secret
   * @param {string} clientConfig.redirectUri
   */
  constructor(router, server, clientConfig) {
    this.app = router;
    this.server = server;
    this.config = clientConfig;
    this.frontendUrl = new url.URL(this.server.frontendOrigin);

    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get("/fluxer", async (req, res) => {
      const code = req.query.code;
      const error = req.query.error;

      if (!!error) return res.redirect(this.constructUrl("/error", { m: error }));
      if (!code) return res.status(400).send({ message: "Auth code missing." });
      const success = await this.fetchAccessToken(code);
      if (!success) return res.redirect(this.constructUrl("/error", {
        m: "An error occurred while verifying your Fluxer login."
      }));
      req.session.fluxerVerified = true;
      req.session.type = "fluxer";
      res.redirect(this.constructUrl("/login", {
        a: "complete_fluxer"
      }));
    });
  }

  /**
   *
   * @param {string} path
   * @param {Object} query
   */
  constructUrl(path, query) {
    return url.format({
      protocol: this.frontendUrl.protocol,
      hostname: this.frontendUrl.hostname,
      port: this.frontendUrl.port,
      host: this.frontendUrl.host,
      pathname: path,
      query
    });
  }

  /**
   * @param {string} code Access code from the authorize endpoint
   */
  async fetchAccessToken(code) {
    try {
      const body = new URLSearchParams({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": this.config.redirectUri,
        "client_id": this.config.id,
        "client_secret": this.config.secret,
      })
      const res = await (await fetch("https://api.fluxer.app/v1/oauth2/token", {
        method: "POST",
        body
      })).json();
      console.log(res);
      if (!res.access_token) return false;
    } catch (e) {
      console.warn("Fluxer auth error: ", e);
      return false;
    }
    return true;
  }
}

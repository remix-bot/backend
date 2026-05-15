import { Router } from "express";
import path from "node:path";
import { APIServer } from "../api/index.js";
import url from "node:url";
import { format } from "node:url";
import { RedisHandler } from "../remix/RedisHandler.js";

export class FluxerAuth {
  /**
   *
   * @param {Router} router
   * @param {APIServer} server
   * @param {RedisHandler} redis
   * @param {Object} clientConfig
   * @param {string} clientConfig.id
   * @param {string} clientConfig.secret
   * @param {string} clientConfig.redirectUri
   * @param {string} clientConfig.authorisationUrl
   */
  constructor(router, server, redis, clientConfig) {
    this.app = router;
    this.server = server;
    this.config = clientConfig;
    this.frontendUrl = new url.URL(this.server.frontendOrigin);
    this.redis = redis;

    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get("/fluxer/authorize", (_req, res) => {
      res.redirect(this.config.authorisationUrl);
    });

    this.app.get("/fluxer", async (req, res) => {
      const code = req.query.code;
      const error = req.query.error;

      if (!!error) return res.redirect(this.constructUrl("/error", { m: error }));
      if (!code) return res.status(400).send({ message: "Auth code missing." });
      const token = await this.fetchAccessToken(code);
      if (!token) return res.redirect(this.constructUrl("/error", {
        m: "An error occurred while verifying your Fluxer login."
      }));
      // TODO: fetch user initially
      const user = await this.server.auth.getFluxerUserByToken(token.token);
      console.log(token);
      await this.server.db.storeFluxerAccessToken(user.id, token)
      req.session.token = token;
      req.session.user = user.id;
      //req.session.refreshToken;
      req.session.fluxerVerified = true;
      req.session.authPlatform = "fluxer";
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
   * token.expires specifies the date after which the token will expire.
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
      if (!res.access_token) return null;
      return {
        token: res.access_token,
        refreshToken: res.refresh_token,
        tokenType: res.token_type,
        expires: (Date.now() / 1000) + res.expires_in,
        scope: res.scope
      };
    } catch (e) {
      console.warn("Fluxer auth error: ", e);
      return null;
    }
  }


}

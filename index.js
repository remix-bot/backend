import { APIServer } from "./src/api/index.js";
import * as fs from "node:fs";

class Dashboard {
  constructor() {
    const configPath = new URL("./config.json", import.meta.url);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    this.server = new APIServer(config);
  }
}

const dashboard = new Dashboard();

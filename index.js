import { APIServer } from "./src/api/index.js";
import * as fs from "node:fs";

class Dashboard {
  constructor() {
    const config = JSON.parse(fs.readFileSync("./config.json"));
    this.server = new APIServer(config);
  }
}

const dashboard = new Dashboard();

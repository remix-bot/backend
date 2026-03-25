import { APIServer } from "./src/api";
import * as fs from "node:fs";

class Dashboard {
  constructor() {
    const config = JSON.parse(fs.readFileSync("./config.json"));
    this.server = new APIServer();
  }
}

const dashboard = new Dashboard();

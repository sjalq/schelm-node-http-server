"use strict";

const { EventEmitter } = require("node:events");
const { WebSocketServer } = require("../vendor/ws-8.21.1/package");

/** Package-private migration bridge. Raw req/socket/head never cross Elm. */
class PinnedWsAdapter extends EventEmitter {
  constructor(registry) {
    super();
    this.registry = registry;
    this.server = new WebSocketServer({ noServer: true });
  }
  accept(upgradeId) {
    const offer = this.registry.transferUpgrade(upgradeId);
    if (!offer) return false;
    let transferred = false;
    try {
      this.server.handleUpgrade(offer.req, offer.socket, offer.head, socket => {
        transferred = true;
        socket.once("close", () => this.registry.releaseTransferredUpgrade(offer));
        this.emit("connection", socket, offer.req);
      });
      return true;
    } catch (error) {
      this.registry.releaseTransferredUpgrade(offer);
      if (!transferred) offer.socket.destroy();
      this.emit("error", error);
      return false;
    }
  }
  close(callback) { this.server.close(callback); }
}

module.exports = { PinnedWsAdapter };

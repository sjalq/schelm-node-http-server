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
    let adopted = false;
    try {
      this.server.handleUpgrade(offer.req, offer.socket, offer.head, socket => {
        adopted = this.registry.adoptTransferredUpgrade(offer);
        if (!adopted) {
          socket.terminate();
          return;
        }
        this.emit("connection", socket, offer.req);
      });
    } catch (error) {
      this.registry.failTransferredUpgrade(offer);
      this.emit("error", error);
      return false;
    }
    if (!adopted) this.registry.failTransferredUpgrade(offer);
    return adopted;
  }
  close(callback) { this.server.close(callback); }
}

module.exports = { PinnedWsAdapter };

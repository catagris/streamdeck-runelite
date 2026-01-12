import streamDeck from "@elgato/streamdeck";

import { TabButton } from "./actions/tab-button";
import { HealthMeter } from "./actions/health-meter";

console.log("[Plugin] Starting RuneLite Stream Deck Plugin");

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

console.log("[Plugin] Registering actions");
// Register actions
try {
	streamDeck.actions.registerAction(new TabButton());
	console.log("[Plugin] TabButton registered");
	streamDeck.actions.registerAction(new HealthMeter());
	console.log("[Plugin] HealthMeter registered");
} catch (error) {
	console.error("[Plugin] Error registering actions:", error);
}

// Finally, connect to the Stream Deck.
console.log("[Plugin] Connecting to Stream Deck");
streamDeck.connect();
console.log("[Plugin] Connected to Stream Deck");

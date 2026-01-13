import streamDeck from "@elgato/streamdeck";

import { TabButton } from "./actions/tab-button";
import { HealthMeter } from "./actions/health-meter";
import { RunMeter } from "./actions/run-meter";
import { PrayerMeter } from "./actions/prayer-meter";
import { SpecialAttackMeter } from "./actions/special-attack-meter";
import { MapButton } from "./actions/map-button";
import { PrayerButton } from "./actions/prayer-button";
import { startServer } from "./state-server";

console.log("[Plugin] Starting RuneLite Stream Deck Plugin");

// Start the HTTP server to receive state from RuneLite
startServer(8085);
console.log("[Plugin] State server started on port 8085");

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

console.log("[Plugin] Registering actions");
// Register actions
try {
	streamDeck.actions.registerAction(new TabButton());
	console.log("[Plugin] TabButton registered");
	streamDeck.actions.registerAction(new HealthMeter());
	console.log("[Plugin] HealthMeter registered");
	streamDeck.actions.registerAction(new RunMeter());
	console.log("[Plugin] RunMeter registered");
	streamDeck.actions.registerAction(new PrayerMeter());
	console.log("[Plugin] PrayerMeter registered");
	streamDeck.actions.registerAction(new SpecialAttackMeter());
	console.log("[Plugin] SpecialAttackMeter registered");
	streamDeck.actions.registerAction(new MapButton());
	console.log("[Plugin] MapButton registered");
	streamDeck.actions.registerAction(new PrayerButton());
	console.log("[Plugin] PrayerButton registered");
} catch (error) {
	console.error("[Plugin] Error registering actions:", error);
}

// Finally, connect to the Stream Deck.
console.log("[Plugin] Connecting to Stream Deck");
streamDeck.connect();
console.log("[Plugin] Connected to Stream Deck");

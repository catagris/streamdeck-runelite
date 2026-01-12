import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent } from "@elgato/streamdeck";
import { Hardware } from "keysender";

/**
 * Tracks the number of tab buttons currently visible
 */
let activeButtonCount = 0;

/**
 * Polling interval ID
 */
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Map to store tab button instances by context
 */
const activeButtons = new Map<string, { action: any; tabName: string }>();

/**
 * Cached server URL to avoid repeated getSettings() calls
 */
let cachedServerUrl = "http://localhost:8085/state";

/**
 * Configurable Tab Button action
 */
@action({ UUID: "com.catagris.runelite.tab" })
export class TabButton extends SingletonAction<TabSettings> {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<TabSettings>): Promise<void> {
		// log(`[TabButton] onWillAppear called, BEFORE increment activeButtonCount=${activeButtonCount}`);
		// Set default settings if not present
		const settings = ev.payload.settings;
		if (!settings.serverUrl) {
			settings.serverUrl = "http://localhost:8085/state";
		}
		if (!settings.pollInterval) {
			settings.pollInterval = 200;
		}
		if (!settings.tabName) {
			settings.tabName = "inventory";
		}
		if (!settings.keyToPress) {
			// Set default key based on OSRS defaults
			const osrsDefaults: { [key: string]: string } = {
				combat: "f1",
				skills: "f2",
				quests: "f3",
				inventory: "escape",
				equipment: "f4",
				prayer: "f5",
				magic: "f6",
				grouping: "f7",
				friends: "f9",
				settings: "f10",
				emotes: "f11",
				music: "f12",
				account: "f8" // Adding account with F8 as a reasonable default
			};
			settings.keyToPress = osrsDefaults[(settings.tabName || "inventory").toLowerCase()] || "f1";
		}
		await ev.action.setSettings(settings);

		// Update cached server URL
		cachedServerUrl = settings.serverUrl;

		// Check if this is the first button BEFORE incrementing
		const isFirstButton = activeButtonCount === 0;

		// Store the action instance with its configured tab name
		activeButtons.set(ev.action.id, {
			action: ev.action,
			tabName: settings.tabName.toLowerCase()
		});

		// Increment button count
		activeButtonCount++;
		// log(`[TabButton] Button added. Total buttons: ${activeButtonCount}, tab: ${settings.tabName}, isFirstButton: ${isFirstButton}`);

		// Set initial state to inactive (state 0)
		await ev.action.setState(0);

		// Set button title to the tab name (capitalized)
		const tabTitle = settings.tabName.charAt(0).toUpperCase() + settings.tabName.slice(1);
		await ev.action.setTitle(tabTitle);

		// Apply images if configured
		if (settings.inactiveImage) {
			await ev.action.setImage(settings.inactiveImage, { state: 0 });
		}
		if (settings.activeImage) {
			await ev.action.setImage(settings.activeImage, { state: 1 });
		}

		// Start polling if this is the first button
		// log(`[TabButton] Check: isFirstButton=${isFirstButton}, pollingInterval=${pollingInterval}`);
		if (isFirstButton) {
			// log("[TabButton] First button - calling startPolling");
			startPolling(settings.pollInterval);
		} else {
			// If polling is already running, immediately update this button
			// log("[TabButton] Not first button - calling updateTabButtons");
			updateTabButtons();
		}
	}

	/**
	 * Called when the action is removed from the Stream Deck
	 */
	override async onWillDisappear(ev: WillDisappearEvent<TabSettings>): Promise<void> {
		// Remove the action instance
		activeButtons.delete(ev.action.id);

		// Decrement button count
		activeButtonCount--;

		// Stop polling if no buttons are active
		if (activeButtonCount === 0) {
			stopPolling();
		}
	}

	/**
	 * Called when settings are updated via property inspector
	 */
	override async onDidReceiveSettings(ev: any): Promise<void> {
		const settings = ev.payload.settings;

		// Update cached server URL if changed
		if (settings.serverUrl) {
			cachedServerUrl = settings.serverUrl;
		}

		// Update the stored tab name for this button
		const buttonData = activeButtons.get(ev.action.id);
		if (buttonData) {
			buttonData.tabName = (settings.tabName || "inventory").toLowerCase();
		}

		// Update button title to the tab name (capitalized)
		const tabTitle = (settings.tabName || "inventory").charAt(0).toUpperCase() + (settings.tabName || "inventory").slice(1);
		await ev.action.setTitle(tabTitle);

		// Apply updated images
		if (settings.inactiveImage) {
			await ev.action.setImage(settings.inactiveImage, { state: 0 });
		}
		if (settings.activeImage) {
			await ev.action.setImage(settings.activeImage, { state: 1 });
		}

		// Immediately update to reflect new settings
		updateTabButtons();

		// Update poll interval if changed
		if (settings.pollInterval && pollingInterval) {
			stopPolling();
			startPolling(settings.pollInterval);
		}
	}

	/**
	 * Called when the button is pressed
	 */
	override async onKeyDown(ev: KeyDownEvent<TabSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const keyToPress = (settings.keyToPress || "f1") as "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "escape";

		try {
			// Create hardware instance (null handle targets the foreground window)
			const hardware = new Hardware(null);

			// Send the key press - button state will be updated by polling
			await hardware.keyboard.sendKey(keyToPress);
		} catch (error) {
			// Silently fail - button state is managed by polling
		}
	}
}

/**
 * Starts the polling interval
 */
function startPolling(interval: number): void {
	if (pollingInterval) {
		// log("[TabButton] Polling already running");
		return; // Already polling
	}

	// log(`[TabButton] Starting polling with ${interval}ms interval, ${activeButtons.size} buttons`);
	pollingInterval = setInterval(() => {
		// log("[TabButton] Polling interval triggered");
		updateTabButtons();
	}, interval);
	// log(`[TabButton] Interval ID: ${pollingInterval}`);

	// Immediately update on start
	updateTabButtons();
}

/**
 * Stops the polling interval
 */
function stopPolling(): void {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
	}
}

/**
 * Updates all tab buttons by fetching the current state from RuneLite
 */
async function updateTabButtons(): Promise<void> {
	if (activeButtons.size === 0) {
		// log("[TabButton] No buttons to update");
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

	try {
		// log(`[TabButton] Fetching state from ${cachedServerUrl}`);
		const response = await fetch(cachedServerUrl, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json() as RuneLiteState;
		// log(`[TabButton] Received data:`, data);

		// Check if logged in (player field exists when logged in)
		if (!data.player) {
			// log("[TabButton] Not logged in - setting all to inactive");
			// Not logged in - set all buttons to inactive state in parallel
			await Promise.all(
				Array.from(activeButtons.values()).map(buttonData =>
					buttonData.action.setState(0).catch(() => {})
				)
			);
			return;
		}

		// Get the active tab
		const activeTab = data.activeTab?.toLowerCase();
		// log(`[TabButton] Active tab: ${activeTab}, updating ${activeButtons.size} buttons`);

		// Update all buttons based on whether they match the active tab - in parallel
		await Promise.all(
			Array.from(activeButtons.values()).map(buttonData => {
				const isActive = buttonData.tabName === activeTab;
				// log(`[TabButton] Setting ${buttonData.tabName} to ${isActive ? 'active' : 'inactive'}`);
				return buttonData.action.setState(isActive ? 1 : 0).catch(() => {});
			})
		);

	} catch (error) {
		clearTimeout(timeoutId);
		// log(`[TabButton] Error updating buttons:`, error);
		// Connection error, timeout, or RuneLite is closed - set all to inactive in parallel
		await Promise.all(
			Array.from(activeButtons.values()).map(buttonData =>
				buttonData.action.setState(0).catch(() => {})
			)
		);
	}
}

/**
 * Settings for tab buttons
 */
type TabSettings = {
	serverUrl?: string;
	pollInterval?: number;
	tabName?: string;
	keyToPress?: string;
	activeImage?: string;
	inactiveImage?: string;
};

/**
 * RuneLite state response from the HTTP endpoint
 */
type RuneLiteState = {
	player?: {
		name: string;
		world: number;
	};
	activeTab?: string;
};

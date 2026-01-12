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
 * Tracks consecutive errors to implement exponential backoff
 */
let consecutiveErrors = 0;

/**
 * Flag to prevent multiple simultaneous update requests
 */
let isUpdating = false;

/**
 * Map to store tab button instances by context
 */
const activeButtons = new Map<string, { action: any; tabName: string }>();

/**
 * Configurable Tab Button action
 */
@action({ UUID: "com.catagris.runelite.tab" })
export class TabButton extends SingletonAction<TabSettings> {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<TabSettings>): Promise<void> {
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

		// Store the action instance with its configured tab name
		activeButtons.set(ev.action.id, {
			action: ev.action,
			tabName: settings.tabName.toLowerCase()
		});

		// Increment button count
		activeButtonCount++;

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
		if (activeButtonCount === 1) {
			startPolling(settings.pollInterval);
		} else {
			// If polling is already running, immediately update this button
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
		console.log("[TabButton] Polling already running");
		return; // Already polling
	}

	console.log(`[TabButton] Starting polling with ${interval}ms interval`);
	pollingInterval = setInterval(() => {
		updateTabButtons();
	}, interval);

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
	// Prevent multiple simultaneous updates
	if (isUpdating) {
		return;
	}

	// Get the server URL from the first button's settings (all should have the same URL)
	const firstButton = activeButtons.values().next().value;
	if (!firstButton) {
		return;
	}

	isUpdating = true;

	try {
		const settings = await firstButton.action.getSettings();
		const serverUrl = settings.serverUrl || "http://localhost:8085/state";

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 1000); // 1 second timeout

		try {
			const response = await fetch(serverUrl, { signal: controller.signal });
			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json() as RuneLiteState;

			// Success - reset error counter
			consecutiveErrors = 0;

			// Check if logged in (player field exists when logged in)
			if (!data.player) {
				console.log("[TabButton] Not logged in - setting all to inactive");
				// Not logged in - set all buttons to inactive state
				for (const buttonData of activeButtons.values()) {
					await buttonData.action.setState(0).catch(() => {});
				}
				return;
			}

			// Get the active tab
			const activeTab = data.activeTab?.toLowerCase();
			console.log(`[TabButton] Active tab: ${activeTab}`);

			// Update all buttons based on whether they match the active tab
			for (const buttonData of activeButtons.values()) {
				const isActive = buttonData.tabName === activeTab;
				console.log(`[TabButton] Setting ${buttonData.tabName} to ${isActive ? 'active' : 'inactive'}`);
				await buttonData.action.setState(isActive ? 1 : 0).catch(() => {});
			}

		} catch (error) {
			clearTimeout(timeoutId);
			consecutiveErrors++;
			console.log(`[TabButton] Error fetching state (${consecutiveErrors} consecutive): ${error}`);

			// Connection error, timeout, or RuneLite is closed - set all to inactive
			for (const buttonData of activeButtons.values()) {
				await buttonData.action.setState(0).catch(() => {});
			}

			// If we have too many consecutive errors, slow down polling to reduce load
			if (consecutiveErrors > 5 && pollingInterval) {
				console.log("[TabButton] Too many errors, slowing down polling to 1000ms");
				stopPolling();
				// Restart with slower polling (1 second instead of 200ms)
				startPolling(1000);
			}
		}
	} catch (error) {
		// Failsafe: handle any unexpected errors
		consecutiveErrors++;
	} finally {
		isUpdating = false;
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

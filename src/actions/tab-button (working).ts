import { action, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

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
}

/**
 * Starts the polling interval
 */
function startPolling(interval: number): void {
	if (pollingInterval) {
		return; // Already polling
	}

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
	// Get the server URL from the first button's settings (all should have the same URL)
	const firstButton = activeButtons.values().next().value;
	if (!firstButton) {
		return;
	}

	try {
		const settings = await firstButton.action.getSettings();
		const serverUrl = settings.serverUrl || "http://localhost:8085/state";

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

		try {
			const response = await fetch(serverUrl, { signal: controller.signal });
			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json() as RuneLiteState;

			// Check if logged in (player field exists when logged in)
			if (!data.player) {
				// Not logged in - set all buttons to inactive state
				for (const buttonData of activeButtons.values()) {
					await buttonData.action.setState(0);
				}
				return;
			}

			// Get the active tab
			const activeTab = data.activeTab?.toLowerCase();

			// Update all buttons based on whether they match the active tab
			for (const buttonData of activeButtons.values()) {
				const isActive = buttonData.tabName === activeTab;
				await buttonData.action.setState(isActive ? 1 : 0);
			}

		} catch (error) {
			clearTimeout(timeoutId);
			// Connection error, timeout, or RuneLite is closed - set all to inactive
			for (const buttonData of activeButtons.values()) {
				await buttonData.action.setState(0).catch(() => {});
			}
		}
	} catch (error) {
		// Failsafe: handle any unexpected errors
		// Silently fail to avoid spamming logs
	}
}

/**
 * Settings for tab buttons
 */
type TabSettings = {
	serverUrl?: string;
	pollInterval?: number;
	tabName?: string;
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

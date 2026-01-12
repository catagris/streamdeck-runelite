import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";

/**
 * Tracks the number of health meter buttons currently visible
 */
let activeButtonCount = 0;

/**
 * Polling interval ID
 */
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Map to store health meter button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached server URL to avoid repeated getSettings() calls
 */
let cachedServerUrl = "http://localhost:8085/state";

/**
 * Health Meter Button action
 */
@action({ UUID: "com.catagris.runelite.healthmeter" })
export class HealthMeter extends SingletonAction<HealthMeterSettings> {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<HealthMeterSettings>): Promise<void> {
		console.log("[HealthMeter] onWillAppear called");
		// Set default settings if not present
		const settings = ev.payload.settings;
		if (!settings.serverUrl) {
			settings.serverUrl = "http://localhost:8085/state";
		}
		if (!settings.pollInterval) {
			settings.pollInterval = 200;
		}
		if (!settings.maskImage) {
			settings.maskImage = ""; // User can optionally provide a mask image
		}
		await ev.action.setSettings(settings);

		// Update cached server URL
		cachedServerUrl = settings.serverUrl;

		// Check if this is the first button BEFORE incrementing
		const isFirstButton = activeButtonCount === 0;

		// Store the action instance
		activeButtons.set(ev.action.id, ev.action);

		// Cache settings
		cachedSettings.set(ev.action.id, settings);

		// Increment button count
		activeButtonCount++;
		console.log(`[HealthMeter] Button added. Total buttons: ${activeButtonCount}`);

		// Start polling if this is the first button
		if (isFirstButton) {
			startPolling(settings.pollInterval);
		} else {
			// If polling is already running, immediately update this button
			updateHealthMeters();
		}
	}

	/**
	 * Called when the action is removed from the Stream Deck
	 */
	override async onWillDisappear(ev: WillDisappearEvent<HealthMeterSettings>): Promise<void> {
		// Remove the action instance
		activeButtons.delete(ev.action.id);

		// Remove cached settings
		cachedSettings.delete(ev.action.id);

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
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<HealthMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;

		// Update cached server URL if changed
		if (settings.serverUrl) {
			cachedServerUrl = settings.serverUrl;
		}

		// Update cached settings
		cachedSettings.set(ev.action.id, settings);

		// Immediately update to reflect new settings
		updateHealthMeters();

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
		console.log("[HealthMeter] Polling already running");
		return; // Already polling
	}

	console.log(`[HealthMeter] Starting polling with ${interval}ms interval`);
	pollingInterval = setInterval(() => {
		updateHealthMeters();
	}, interval);

	// Immediately update on start
	updateHealthMeters();
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
 * Cached settings to avoid repeated getSettings() calls
 */
const cachedSettings = new Map<string, HealthMeterSettings>();

/**
 * Updates all health meter buttons by fetching the current state from RuneLite
 */
async function updateHealthMeters(): Promise<void> {
	if (activeButtons.size === 0) {
		console.log("[HealthMeter] No buttons to update");
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 1000); // 1 second timeout

	try {
		console.log(`[HealthMeter] Fetching state from ${cachedServerUrl}`);
		const response = await fetch(cachedServerUrl, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json() as RuneLiteState;
		console.log(`[HealthMeter] Received data:`, data);

		// Update all health meter buttons in parallel
		await Promise.all(
			Array.from(activeButtons.entries()).map(async ([id, action]) => {
				try {
					// Use cached settings if available
					let settings = cachedSettings.get(id);
					if (!settings) {
						settings = await action.getSettings();
						cachedSettings.set(id, settings);
					}
					const svgImage = createHealthMeterSVG(data, settings);
					await action.setImage(svgImage);
					console.log(`[HealthMeter] Updated button ${id}`);
				} catch (error) {
					console.log(`[HealthMeter] Error updating button ${id}:`, error);
				}
			})
		);

	} catch (error) {
		clearTimeout(timeoutId);
		console.log(`[HealthMeter] Error fetching state:`, error);
	}
}

/**
 * Creates an SVG with the health meter visualization
 */
function createHealthMeterSVG(data: RuneLiteState, settings: HealthMeterSettings): string {
	// Get health data from stats.hp
	const currentHealth = data.stats?.hp?.current || 0;
	const maxHealth = data.stats?.hp?.max || 100;
	const healthPercent = maxHealth > 0 ? currentHealth / maxHealth : 0;

	// Calculate fill height (from bottom)
	const fillHeight = 144 * healthPercent;
	const fillY = 144 - fillHeight;

	// Create SVG
	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	// Background (black)
	svg += `<rect width="144" height="144" fill="#000000"/>`;

	// Health bar fill (red, from bottom to current health)
	svg += `<rect x="0" y="${fillY}" width="144" height="${fillHeight}" fill="#FF0000"/>`;

	// Mask image overlay if provided
	if (settings.maskImage) {
		svg += `<image href="${settings.maskImage}" width="144" height="144"/>`;
	}

	// Health text (white with black stroke)
	svg += `<text x="72" y="72" font-family="Arial" font-size="48" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="4" fill="none">${currentHealth}</text>`;
	svg += `<text x="72" y="72" font-family="Arial" font-size="48" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF">${currentHealth}</text>`;

	svg += `</svg>`;

	// Convert SVG to data URI
	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Settings for health meter buttons
 */
type HealthMeterSettings = {
	serverUrl?: string;
	pollInterval?: number;
	maskImage?: string;
};

/**
 * RuneLite state response from the HTTP endpoint
 */
type RuneLiteState = {
	player?: {
		name: string;
		world: number;
	};
	stats?: {
		hp?: {
			current: number;
			max: number;
		};
		prayer?: {
			current: number;
			max: number;
		};
		runEnergy?: number;
		specialAttack?: number;
	};
};

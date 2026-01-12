import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Tracks the number of run meter buttons currently visible
 */
let activeButtonCount = 0;

/**
 * Polling interval ID
 */
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Map to store run meter button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached server URL to avoid repeated getSettings() calls
 */
let cachedServerUrl = "http://localhost:8085/state";

/**
 * Run Meter Button action
 */
@action({ UUID: "com.catagris.runelite.runmeter" })
export class RunMeter extends SingletonAction<RunMeterSettings> {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<RunMeterSettings>): Promise<void> {
		console.log("[RunMeter] onWillAppear called");
		// Set default settings if not present
		const settings = ev.payload.settings;
		if (!settings.serverUrl) {
			settings.serverUrl = "http://localhost:8085/state";
		}
		if (!settings.pollInterval) {
			settings.pollInterval = 200;
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
		console.log(`[RunMeter] Button added. Total buttons: ${activeButtonCount}`);

		// Start polling if this is the first button
		if (isFirstButton) {
			startPolling(settings.pollInterval);
		} else {
			// If polling is already running, immediately update this button
			updateRunMeters();
		}
	}

	/**
	 * Called when the action is removed from the Stream Deck
	 */
	override async onWillDisappear(ev: WillDisappearEvent<RunMeterSettings>): Promise<void> {
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
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<RunMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;

		// Update cached server URL if changed
		if (settings.serverUrl) {
			cachedServerUrl = settings.serverUrl;
		}

		// Update cached settings
		cachedSettings.set(ev.action.id, settings);

		// Immediately update to reflect new settings
		updateRunMeters();

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
		console.log("[RunMeter] Polling already running");
		return; // Already polling
	}

	console.log(`[RunMeter] Starting polling with ${interval}ms interval`);
	pollingInterval = setInterval(() => {
		updateRunMeters();
	}, interval);

	// Immediately update on start
	updateRunMeters();
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
const cachedSettings = new Map<string, RunMeterSettings>();

/**
 * Updates all run meter buttons by fetching the current state from RuneLite
 */
async function updateRunMeters(): Promise<void> {
	if (activeButtons.size === 0) {
		console.log("[RunMeter] No buttons to update");
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 1000); // 1 second timeout

	try {
		console.log(`[RunMeter] Fetching state from ${cachedServerUrl}`);
		const response = await fetch(cachedServerUrl, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json() as RuneLiteState;
		console.log(`[RunMeter] Received data:`, data);

		// Update all run meter buttons in parallel
		await Promise.all(
			Array.from(activeButtons.entries()).map(async ([id, action]) => {
				try {
					const image = createRunMeterImage(data);
					await action.setImage(image);
					console.log(`[RunMeter] Updated button ${id}`);
				} catch (error) {
					console.log(`[RunMeter] Error updating button ${id}:`, error);
				}
			})
		);

	} catch (error) {
		clearTimeout(timeoutId);
		console.log(`[RunMeter] Error fetching state:`, error);
	}
}

/**
 * Cached overlay images as base64 data URI
 */
let cachedEnabledOverlay: string | null = null;
let cachedDisabledOverlay: string | null = null;

/**
 * Loads the overlay PNG image and caches it as base64
 */
function loadOverlayImage(enabled: boolean): string {
	const cached = enabled ? cachedEnabledOverlay : cachedDisabledOverlay;
	if (cached) {
		return cached;
	}

	try {
		const filename = enabled ? 'Run_energy_orb_enabled.png' : 'Run_energy_orb_disabled.png';
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'run', filename);
		console.log('[RunMeter] Loading overlay image from:', imgPath);
		const imageBuffer = fs.readFileSync(imgPath);
		const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;
		console.log('[RunMeter] Overlay image loaded, size:', imageBuffer.length);

		if (enabled) {
			cachedEnabledOverlay = dataUri;
		} else {
			cachedDisabledOverlay = dataUri;
		}

		return dataUri;
	} catch (error) {
		console.log('[RunMeter] Error loading overlay image:', error);
		return '';
	}
}

/**
 * Run energy fill colors
 */
const RUN_COLORS = {
	enabled: '#CEA801',   // Golden Rod when run is enabled
	disabled: '#ACADA3',  // Dark gray when run is disabled
};

/**
 * Creates an image with the run meter visualization
 * Layers: background -> colored fill -> orbital gradient -> PNG overlay -> text
 */
function createRunMeterImage(data: RuneLiteState): string {
	// Get run energy data (0-10000)
	const runEnergy = data.stats?.runEnergy || 0;
	const runEnabled = data.stats?.runEnabled || false;

	// Calculate percentage (runEnergy is 0-10000)
	const energyPercent = runEnergy / 10000;

	// Display value (0-100)
	const displayValue = Math.floor(runEnergy / 100);

	// Calculate fill height (from bottom)
	const fillHeight = Math.round(144 * energyPercent);
	const fillY = 144 - fillHeight;

	// Get fill color based on run enabled state
	const fillColor = runEnabled ? RUN_COLORS.enabled : RUN_COLORS.disabled;

	// Load appropriate overlay PNG based on run state
	const overlayImageData = loadOverlayImage(runEnabled);

	// Create SVG - layering to match OSRS orb appearance
	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	// Define radial gradient for orbital darkening effect (highlight in upper-left like light hitting a sphere)
	svg += `<defs>`;
	svg += `<radialGradient id="orbGradient" cx="50%" cy="50%" r="50%" fx="30%" fy="25%">`;
	svg += `<stop offset="0%" stop-color="#000000" stop-opacity="0"/>`;
	svg += `<stop offset="40%" stop-color="#000000" stop-opacity="0.3"/>`;
	svg += `<stop offset="70%" stop-color="#000000" stop-opacity="0.6"/>`;
	svg += `<stop offset="90%" stop-color="#000000" stop-opacity="0.85"/>`;
	svg += `<stop offset="100%" stop-color="#000000" stop-opacity="0.95"/>`;
	svg += `</radialGradient>`;
	svg += `</defs>`;

	// Layer 1: Black background + colored energy fill (from bottom up based on energy %)
	svg += `<rect width="144" height="144" fill="#000000"/>`;
	svg += `<rect x="0" y="${fillY}" width="144" height="${fillHeight}" fill="${fillColor}"/>`;

	// Layer 2: Orbital gradient overlay for 3D spherical effect
	svg += `<circle cx="72" cy="72" r="72" fill="url(#orbGradient)"/>`;

	// Layer 3: PNG overlay on top (the orb frame/border with foot icon)
	if (overlayImageData) {
		svg += `<image href="${overlayImageData}" x="0" y="0" width="144" height="144"/>`;
	}

	// Layer 4: Run energy text (white with black stroke for readability)
	svg += `<text x="72" y="80" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="3" fill="none">${displayValue}</text>`;
	svg += `<text x="72" y="80" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF">${displayValue}</text>`;

	svg += `</svg>`;

	// Convert SVG to data URI
	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Settings for run meter buttons
 */
type RunMeterSettings = {
	serverUrl?: string;
	pollInterval?: number;
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
			status?: 'poisoned' | 'venomed' | 'diseased' | 'poisoned_diseased' | 'venomed_diseased';
		};
		prayer?: {
			current: number;
			max: number;
		};
		runEnergy?: number;
		runEnabled?: boolean;
		specialAttack?: number;
	};
};

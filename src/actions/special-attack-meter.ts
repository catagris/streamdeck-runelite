import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Tracks the number of special attack meter buttons currently visible
 */
let activeButtonCount = 0;

/**
 * Polling interval ID
 */
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Map to store special attack meter button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached server URL to avoid repeated getSettings() calls
 */
let cachedServerUrl = "http://localhost:8085/state";

/**
 * Special Attack Meter Button action
 */
@action({ UUID: "com.catagris.runelite.specialattackmeter" })
export class SpecialAttackMeter extends SingletonAction<SpecialAttackMeterSettings> {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<SpecialAttackMeterSettings>): Promise<void> {
		console.log("[SpecialAttackMeter] onWillAppear called");
		// Set default settings if not present
		const settings = ev.payload.settings;

		let needsUpdate = false;
		if (!settings.serverUrl) {
			settings.serverUrl = "http://localhost:8085/state";
			needsUpdate = true;
		}
		if (!settings.pollInterval) {
			settings.pollInterval = 200;
			needsUpdate = true;
		}
		if (settings.coloredNumbers === undefined) {
			settings.coloredNumbers = false;
			needsUpdate = true;
		}

		// Only save settings if we added defaults
		if (needsUpdate) {
			await ev.action.setSettings(settings);
		}

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
		console.log(`[SpecialAttackMeter] Button added. Total buttons: ${activeButtonCount}`);

		// Start polling if this is the first button
		if (isFirstButton) {
			startPolling(settings.pollInterval);
		} else {
			// If polling is already running, immediately update this button
			updateSpecialAttackMeters();
		}
	}

	/**
	 * Called when the action is removed from the Stream Deck
	 */
	override async onWillDisappear(ev: WillDisappearEvent<SpecialAttackMeterSettings>): Promise<void> {
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
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SpecialAttackMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;

		// Update cached server URL if changed
		if (settings.serverUrl) {
			cachedServerUrl = settings.serverUrl;
		}

		// Update cached settings
		cachedSettings.set(ev.action.id, settings);

		// Immediately update to reflect new settings
		updateSpecialAttackMeters();

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

	console.log(`[SpecialAttackMeter] Starting polling with ${interval}ms interval`);
	pollingInterval = setInterval(() => {
		updateSpecialAttackMeters();
	}, interval);

	// Immediately update on start
	updateSpecialAttackMeters();
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
const cachedSettings = new Map<string, SpecialAttackMeterSettings>();

/**
 * Updates all special attack meter buttons by fetching the current state from RuneLite
 */
async function updateSpecialAttackMeters(): Promise<void> {
	if (activeButtons.size === 0) {
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 1000); // 1 second timeout

	try {
		const response = await fetch(cachedServerUrl, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json() as RuneLiteState;

		// Update all special attack meter buttons in parallel
		await Promise.all(
			Array.from(activeButtons.entries()).map(async ([id, action]) => {
				try {
					const settings = cachedSettings.get(id) || {};
					const image = createSpecialAttackMeterImage(data, settings);
					await action.setImage(image);
				} catch (error) {
					console.log(`[SpecialAttackMeter] Error updating button ${id}:`, error);
				}
			})
		);

	} catch (error) {
		clearTimeout(timeoutId);
		console.log(`[SpecialAttackMeter] Error fetching state:`, error);
	}
}

/**
 * Cached images as base64 data URI
 */
let cachedOrbOverlay: string | null = null;
let cachedEnabledFill: string | null = null;
let cachedAvailableFill: string | null = null;
let cachedUnavailableFill: string | null = null;

/**
 * Loads and caches an image as base64
 */
function loadImage(filename: string): string {
	try {
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'special-attack-meter', filename);
		const imageBuffer = fs.readFileSync(imgPath);
		return `data:image/png;base64,${imageBuffer.toString('base64')}`;
	} catch (error) {
		console.log('[SpecialAttackMeter] Error loading image:', filename, error);
		return '';
	}
}

/**
 * Gets the orb overlay image (top layer with frame and sword icon)
 */
function getOrbOverlay(): string {
	if (!cachedOrbOverlay) {
		cachedOrbOverlay = loadImage('special_attack_orb.png');
	}
	return cachedOrbOverlay;
}

/**
 * Gets the appropriate fill image based on state
 */
function getFillImage(enabled: boolean, available: boolean): string {
	if (enabled) {
		if (!cachedEnabledFill) {
			cachedEnabledFill = loadImage('special_attack_orb_enable_fill.png');
		}
		return cachedEnabledFill;
	} else if (available) {
		if (!cachedAvailableFill) {
			cachedAvailableFill = loadImage('special_attack_orb_available_fill.png');
		}
		return cachedAvailableFill;
	} else {
		if (!cachedUnavailableFill) {
			cachedUnavailableFill = loadImage('special_attack_orb_unavailable_fill.png');
		}
		return cachedUnavailableFill;
	}
}

/**
 * Gets text color based on percentage (0-1)
 * Smooth gradient: Green (100%) -> Yellow (50%) -> Red (0%)
 */
function getPercentColor(percent: number): string {
	const pct = Math.max(0, Math.min(1, percent));

	let r: number, g: number;

	if (pct > 0.5) {
		// 100% to 50%: Green to Yellow (increase red from 0 to 255, green stays 255)
		const t = (pct - 0.5) / 0.5; // 1 at 100%, 0 at 50%
		r = Math.round(255 * (1 - t));
		g = 255;
	} else {
		// 50% to 0%: Yellow to Red (red stays 255, decrease green from 255 to 0)
		const t = pct / 0.5; // 1 at 50%, 0 at 0%
		r = 255;
		g = Math.round(255 * t);
	}

	return `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}00`;
}

/**
 * Creates an image with the special attack meter visualization
 * Layers: black background -> fill PNG -> black mask (from top) -> orb overlay -> text
 */
function createSpecialAttackMeterImage(data: RuneLiteState, settings: SpecialAttackMeterSettings): string {
	// Get special attack data
	const specialAttack = data.stats?.specialAttack || 0; // 0-100
	const specialAttackEnabled = data.stats?.specialAttackEnabled || false;
	const specialAttackAvailable = data.stats?.specialAttackAvailable || false;

	// Calculate percentage (0-1)
	const specPercent = specialAttack / 100;

	// Determine text color based on settings
	const textColor = settings.coloredNumbers === true ? getPercentColor(specPercent) : '#FFFFFF';

	// Calculate mask height (from top - covers the drained portion)
	const maskHeight = Math.round(144 * (1 - specPercent));

	// Get appropriate fill image based on state
	const fillImageData = getFillImage(specialAttackEnabled, specialAttackAvailable);
	const orbOverlayData = getOrbOverlay();

	// Create SVG with layered approach
	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	// Layer 1: Black background
	svg += `<rect width="144" height="144" fill="#000000"/>`;

	// Layer 2: Fill image (shows the full colored fill)
	if (fillImageData) {
		svg += `<image href="${fillImageData}" x="0" y="0" width="144" height="144"/>`;
	}

	// Layer 3: Black mask from top (covers drained portion)
	if (maskHeight > 0) {
		svg += `<rect x="0" y="0" width="144" height="${maskHeight}" fill="#000000"/>`;
	}

	// Layer 4: Orb overlay (frame with sword icon)
	if (orbOverlayData) {
		svg += `<image href="${orbOverlayData}" x="0" y="0" width="144" height="144"/>`;
	}

	// Layer 5: Special attack text (with black stroke for readability)
	if (settings.showNumbers !== false) {
		const textPos = getTextPosition(settings.textPosition);
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="3" fill="none">${specialAttack}</text>`;
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${specialAttack}</text>`;
	}

	svg += `</svg>`;

	// Convert SVG to data URI
	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Text position options
 */
type TextPosition = 'top-left' | 'top' | 'top-right' | 'left' | 'middle' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

/**
 * Gets the x,y coordinates for text based on position setting
 */
function getTextPosition(position: TextPosition | undefined): { x: number; y: number } {
	switch (position) {
		case 'top-left':     return { x: 40, y: 40 };
		case 'top':          return { x: 72, y: 40 };
		case 'top-right':    return { x: 104, y: 40 };
		case 'left':         return { x: 40, y: 80 };
		case 'right':        return { x: 104, y: 80 };
		case 'bottom-left':  return { x: 40, y: 120 };
		case 'bottom':       return { x: 72, y: 120 };
		case 'bottom-right': return { x: 104, y: 120 };
		case 'middle':
		default:             return { x: 72, y: 80 };
	}
}

/**
 * Settings for special attack meter buttons
 */
type SpecialAttackMeterSettings = {
	serverUrl?: string;
	pollInterval?: number;
	coloredNumbers?: boolean;
	textPosition?: TextPosition;
	showNumbers?: boolean;
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
			status?: string;
		};
		prayer?: {
			current: number;
			max: number;
		};
		runEnergy?: number;
		runEnabled?: boolean;
		specialAttack?: number;
		specialAttackEnabled?: boolean;
		specialAttackAvailable?: boolean;
	};
};

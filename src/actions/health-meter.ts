import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';

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
		if (settings.coloredNumbers === undefined) {
			settings.coloredNumbers = false;
		}
		console.log("[HealthMeter] onWillAppear settings:", JSON.stringify(settings));
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
		console.log(`[HealthMeter] onDidReceiveSettings called with:`, JSON.stringify(settings));
		console.log(`[HealthMeter] coloredNumbers value:`, settings.coloredNumbers, typeof settings.coloredNumbers);

		// Update cached server URL if changed
		if (settings.serverUrl) {
			cachedServerUrl = settings.serverUrl;
		}

		// Update cached settings
		cachedSettings.set(ev.action.id, settings);
		console.log(`[HealthMeter] Cached settings updated for ${ev.action.id}`);

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
					const settings = cachedSettings.get(id) || {};
					const image = createHealthMeterImage(data, settings);
					await action.setImage(image);
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
 * Cached overlay image as base64 data URI
 */
let cachedOverlayImage: string | null = null;

/**
 * Loads the overlay PNG image and caches it as base64
 */
function loadOverlayImage(): string {
	if (cachedOverlayImage) {
		return cachedOverlayImage;
	}

	try {
		// process.cwd() gives the plugin directory when running
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'health-meter', 'Hitpoints_orb.png');
		console.log('[HealthMeter] Loading overlay image from:', imgPath);
		const imageBuffer = fs.readFileSync(imgPath);
		cachedOverlayImage = `data:image/png;base64,${imageBuffer.toString('base64')}`;
		console.log('[HealthMeter] Overlay image loaded, size:', imageBuffer.length);
		return cachedOverlayImage;
	} catch (error) {
		console.log('[HealthMeter] Error loading overlay image:', error);
		return '';
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
 * Status color constants
 */
const STATUS_COLORS = {
	normal: '#B00905',    // Red for normal health
	poisoned: '#19DA00',  // Bright green for poison
	venomed: '#24573D',   // Dark green-blue for venom
	diseased: '#C5BA73',  // Dark Khaki/yellow for disease
};

/**
 * Determines the fill color(s) based on status effects
 * Returns either a single color string or an object with left/right colors for split display
 */
function getHealthFillColor(data: RuneLiteState): string | { left: string; right: string } {
	const status = data.stats?.hp?.status;

	// Handle combined statuses (split colors)
	if (status === 'poisoned_diseased') {
		return { left: STATUS_COLORS.poisoned, right: STATUS_COLORS.diseased };
	}
	if (status === 'venomed_diseased') {
		return { left: STATUS_COLORS.venomed, right: STATUS_COLORS.diseased };
	}

	// Single status colors
	switch (status) {
		case 'poisoned':
			return STATUS_COLORS.poisoned;
		case 'venomed':
			return STATUS_COLORS.venomed;
		case 'diseased':
			return STATUS_COLORS.diseased;
		default:
			return STATUS_COLORS.normal;
	}
}

/**
 * Creates an image with the health meter visualization
 * Layers: background -> colored fill -> PNG overlay (transparent areas show fill) -> text
 */
function createHealthMeterImage(data: RuneLiteState, settings: HealthMeterSettings): string {
	// Get health data from stats.hp
	const currentHealth = data.stats?.hp?.current || 0;
	const maxHealth = data.stats?.hp?.max || 100;
	const healthPercent = maxHealth > 0 ? currentHealth / maxHealth : 0;

	// Determine text color based on settings
	console.log(`[HealthMeter] createImage settings.coloredNumbers:`, settings.coloredNumbers);
	const textColor = settings.coloredNumbers === true ? getPercentColor(healthPercent) : '#FFFFFF';
	console.log(`[HealthMeter] Using textColor:`, textColor);

	// Calculate fill height (from bottom)
	const fillHeight = Math.round(144 * healthPercent);
	const fillY = 144 - fillHeight;

	// Get fill color based on status effect
	const fillColor = getHealthFillColor(data);

	// Load overlay PNG
	const overlayImageData = loadOverlayImage();

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

	// Layer 1: Colored health fill (from bottom up based on health %)
	svg += `<rect width="144" height="144" fill="#000000"/>`;

	// Handle split colors for combined statuses (left/right split)
	if (typeof fillColor === 'object') {
		// Left half
		svg += `<rect x="0" y="${fillY}" width="72" height="${fillHeight}" fill="${fillColor.left}"/>`;
		// Right half
		svg += `<rect x="72" y="${fillY}" width="72" height="${fillHeight}" fill="${fillColor.right}"/>`;
	} else {
		svg += `<rect x="0" y="${fillY}" width="144" height="${fillHeight}" fill="${fillColor}"/>`;
	}

	// Layer 2: Orbital gradient overlay for 3D spherical effect
	svg += `<circle cx="72" cy="72" r="72" fill="url(#orbGradient)"/>`;

	// Layer 3: PNG overlay on top (the orb frame/border with heart cutout)
	if (overlayImageData) {
		svg += `<image href="${overlayImageData}" x="0" y="0" width="144" height="144"/>`;
	}

	// Layer 4: Health text (colored or white based on settings, with black stroke for readability)
	if (settings.showNumbers !== false) {
		const textPos = getTextPosition(settings.textPosition);
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="3" fill="none">${currentHealth}</text>`;
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${currentHealth}</text>`;
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
 * Settings for health meter buttons
 */
type HealthMeterSettings = {
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

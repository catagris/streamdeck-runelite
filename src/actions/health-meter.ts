import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';
import { getState, addStateListener, removeStateListener, RuneLiteState } from '../state-server';

/**
 * Map to store health meter button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached settings per button
 */
const cachedSettings = new Map<string, HealthMeterSettings>();

/**
 * State listener function
 */
function onStateUpdate(state: RuneLiteState): void {
	updateHealthMeters(state);
}

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
		const settings = ev.payload.settings;

		// Set defaults
		if (settings.coloredNumbers === undefined) {
			settings.coloredNumbers = false;
		}
		if (settings.showNumbers === undefined) {
			settings.showNumbers = true;
		}

		await ev.action.setSettings(settings);

		// Register listener if first button
		if (activeButtons.size === 0) {
			addStateListener(onStateUpdate);
			console.log("[HealthMeter] Registered state listener");
		}

		// Store the action instance
		activeButtons.set(ev.action.id, ev.action);
		cachedSettings.set(ev.action.id, settings);

		// Immediately render with current state
		updateHealthMeters(getState());
	}

	/**
	 * Called when the action is removed from the Stream Deck
	 */
	override async onWillDisappear(ev: WillDisappearEvent<HealthMeterSettings>): Promise<void> {
		activeButtons.delete(ev.action.id);
		cachedSettings.delete(ev.action.id);

		// Remove listener if no buttons left
		if (activeButtons.size === 0) {
			removeStateListener(onStateUpdate);
			console.log("[HealthMeter] Removed state listener");
		}
	}

	/**
	 * Called when settings are updated via property inspector
	 */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<HealthMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;
		cachedSettings.set(ev.action.id, settings);
		updateHealthMeters(getState());
	}
}

/**
 * Updates all health meter buttons with current state
 */
async function updateHealthMeters(state: RuneLiteState): Promise<void> {
	if (activeButtons.size === 0) return;

	await Promise.all(
		Array.from(activeButtons.entries()).map(async ([id, action]) => {
			try {
				const settings = cachedSettings.get(id) || {};
				const image = createHealthMeterImage(state, settings);
				await action.setImage(image);
			} catch (error) {
				console.log(`[HealthMeter] Error updating button ${id}:`, error);
			}
		})
	);
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
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'health-meter', 'Hitpoints_orb.png');
		const imageBuffer = fs.readFileSync(imgPath);
		cachedOverlayImage = `data:image/png;base64,${imageBuffer.toString('base64')}`;
		return cachedOverlayImage;
	} catch (error) {
		console.log('[HealthMeter] Error loading overlay image:', error);
		return '';
	}
}

/**
 * Gets text color based on percentage (0-1)
 */
function getPercentColor(percent: number): string {
	const pct = Math.max(0, Math.min(1, percent));

	let r: number, g: number;

	if (pct > 0.5) {
		const t = (pct - 0.5) / 0.5;
		r = Math.round(255 * (1 - t));
		g = 255;
	} else {
		const t = pct / 0.5;
		r = 255;
		g = Math.round(255 * t);
	}

	return `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}00`;
}

/**
 * Status color constants
 */
const STATUS_COLORS = {
	normal: '#B00905',
	poisoned: '#19DA00',
	venomed: '#24573D',
	diseased: '#C5BA73',
};

/**
 * Determines the fill color(s) based on status effects
 */
function getHealthFillColor(data: RuneLiteState): string | { left: string; right: string } {
	const status = data.stats?.hp?.status;

	if (status === 'poisoned_diseased') {
		return { left: STATUS_COLORS.poisoned, right: STATUS_COLORS.diseased };
	}
	if (status === 'venomed_diseased') {
		return { left: STATUS_COLORS.venomed, right: STATUS_COLORS.diseased };
	}

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
 */
function createHealthMeterImage(data: RuneLiteState, settings: HealthMeterSettings): string {
	const currentHealth = data.stats?.hp?.current || 0;
	const maxHealth = data.stats?.hp?.max || 100;
	const healthPercent = maxHealth > 0 ? currentHealth / maxHealth : 0;

	const textColor = settings.coloredNumbers === true ? getPercentColor(healthPercent) : '#FFFFFF';

	const fillHeight = Math.round(144 * healthPercent);
	const fillY = 144 - fillHeight;

	const fillColor = getHealthFillColor(data);
	const overlayImageData = loadOverlayImage();

	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	svg += `<defs>`;
	svg += `<radialGradient id="orbGradient" cx="50%" cy="50%" r="50%" fx="30%" fy="25%">`;
	svg += `<stop offset="0%" stop-color="#000000" stop-opacity="0"/>`;
	svg += `<stop offset="40%" stop-color="#000000" stop-opacity="0.3"/>`;
	svg += `<stop offset="70%" stop-color="#000000" stop-opacity="0.6"/>`;
	svg += `<stop offset="90%" stop-color="#000000" stop-opacity="0.85"/>`;
	svg += `<stop offset="100%" stop-color="#000000" stop-opacity="0.95"/>`;
	svg += `</radialGradient>`;
	svg += `</defs>`;

	svg += `<rect width="144" height="144" fill="#000000"/>`;

	if (typeof fillColor === 'object') {
		svg += `<rect x="0" y="${fillY}" width="72" height="${fillHeight}" fill="${fillColor.left}"/>`;
		svg += `<rect x="72" y="${fillY}" width="72" height="${fillHeight}" fill="${fillColor.right}"/>`;
	} else {
		svg += `<rect x="0" y="${fillY}" width="144" height="${fillHeight}" fill="${fillColor}"/>`;
	}

	svg += `<circle cx="72" cy="72" r="72" fill="url(#orbGradient)"/>`;

	if (overlayImageData) {
		svg += `<image href="${overlayImageData}" x="0" y="0" width="144" height="144"/>`;
	}

	if (settings.showNumbers !== false) {
		const textPos = getTextPosition(settings.textPosition);
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="3" fill="none">${currentHealth}</text>`;
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${currentHealth}</text>`;
	}

	svg += `</svg>`;

	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

type TextPosition = 'top-left' | 'top' | 'top-right' | 'left' | 'middle' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

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

type HealthMeterSettings = {
	coloredNumbers?: boolean;
	textPosition?: TextPosition;
	showNumbers?: boolean;
};

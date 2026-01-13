import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';
import { getState, addStateListener, removeStateListener, RuneLiteState } from '../state-server';

/**
 * Map to store prayer meter button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached settings per button
 */
const cachedSettings = new Map<string, PrayerMeterSettings>();

/**
 * Cached images as base64 data URI
 */
let cachedEnabledBackground: string | null = null;
let cachedDisabledBackground: string | null = null;
let cachedEnabledOverlay: string | null = null;
let cachedDisabledOverlay: string | null = null;

/**
 * Loads and caches an image as base64
 */
function loadImage(filename: string): string {
	try {
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'prayer-meter', filename);
		const imageBuffer = fs.readFileSync(imgPath);
		return `data:image/png;base64,${imageBuffer.toString('base64')}`;
	} catch (error) {
		console.log('[PrayerMeter] Error loading image:', filename, error);
		return '';
	}
}

/**
 * Gets the background fill image based on quick prayer state
 */
function getBackgroundImage(enabled: boolean): string {
	if (enabled) {
		if (!cachedEnabledBackground) {
			cachedEnabledBackground = loadImage('Prayer_orb_enabled_backgroud.png');
		}
		return cachedEnabledBackground;
	} else {
		if (!cachedDisabledBackground) {
			cachedDisabledBackground = loadImage('Prayer_orb_disabled_backgroud.png');
		}
		return cachedDisabledBackground;
	}
}

/**
 * Gets the overlay image based on quick prayer state
 */
function getOverlayImage(enabled: boolean): string {
	if (enabled) {
		if (!cachedEnabledOverlay) {
			cachedEnabledOverlay = loadImage('Prayer_orb_enabled.png');
		}
		return cachedEnabledOverlay;
	} else {
		if (!cachedDisabledOverlay) {
			cachedDisabledOverlay = loadImage('Prayer_orb_disabled.png');
		}
		return cachedDisabledOverlay;
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
 * State listener function
 */
function onStateUpdate(state: RuneLiteState): void {
	updatePrayerMeters(state);
}

/**
 * Prayer Meter Button action
 */
@action({ UUID: "com.catagris.runelite.prayermeter" })
export class PrayerMeter extends SingletonAction<PrayerMeterSettings> {
	override async onWillAppear(ev: WillAppearEvent<PrayerMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;

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
		}

		activeButtons.set(ev.action.id, ev.action);
		cachedSettings.set(ev.action.id, settings);

		// Immediately render with current state
		updatePrayerMeters(getState());
	}

	override async onWillDisappear(ev: WillDisappearEvent<PrayerMeterSettings>): Promise<void> {
		activeButtons.delete(ev.action.id);
		cachedSettings.delete(ev.action.id);

		if (activeButtons.size === 0) {
			removeStateListener(onStateUpdate);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PrayerMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;
		cachedSettings.set(ev.action.id, settings);
		updatePrayerMeters(getState());
	}
}

/**
 * Updates all prayer meter buttons with current state
 */
async function updatePrayerMeters(state: RuneLiteState): Promise<void> {
	if (activeButtons.size === 0) return;

	await Promise.all(
		Array.from(activeButtons.entries()).map(async ([id, action]) => {
			try {
				const settings = cachedSettings.get(id) || {};
				const image = createPrayerMeterImage(state, settings);
				await action.setImage(image);
			} catch (error) {
				console.log(`[PrayerMeter] Error updating button ${id}:`, error);
			}
		})
	);
}

/**
 * Creates an image with the prayer meter visualization
 */
function createPrayerMeterImage(data: RuneLiteState, settings: PrayerMeterSettings): string {
	const currentPrayer = data.stats?.prayer?.current || 0;
	const maxPrayer = data.stats?.prayer?.max || 1;
	const quickPrayerActive = (data.activePrayers && data.activePrayers.length > 0) || false;

	const prayerPercent = maxPrayer > 0 ? currentPrayer / maxPrayer : 0;
	const textColor = settings.coloredNumbers === true ? getPercentColor(prayerPercent) : '#FFFFFF';
	const maskHeight = Math.round(144 * (1 - prayerPercent));

	const backgroundData = getBackgroundImage(quickPrayerActive);
	const overlayData = getOverlayImage(quickPrayerActive);

	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	svg += `<rect width="144" height="144" fill="#000000"/>`;

	if (backgroundData) {
		svg += `<image href="${backgroundData}" x="0" y="0" width="144" height="144"/>`;
	}

	if (maskHeight > 0) {
		svg += `<rect x="0" y="0" width="144" height="${maskHeight}" fill="#000000"/>`;
	}

	if (overlayData) {
		svg += `<image href="${overlayData}" x="0" y="0" width="144" height="144"/>`;
	}

	if (settings.showNumbers !== false) {
		const textPos = getTextPosition(settings.textPosition);
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="3" fill="none">${currentPrayer}</text>`;
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${currentPrayer}</text>`;
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

type PrayerMeterSettings = {
	coloredNumbers?: boolean;
	textPosition?: TextPosition;
	showNumbers?: boolean;
};

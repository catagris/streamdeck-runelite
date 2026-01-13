import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';
import { getState, addStateListener, removeStateListener, RuneLiteState } from '../state-server';

/**
 * Map to store special attack meter button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached settings per button
 */
const cachedSettings = new Map<string, SpecialAttackMeterSettings>();

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
 * Gets the orb overlay image
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
	updateSpecialAttackMeters(state);
}

/**
 * Special Attack Meter Button action
 */
@action({ UUID: "com.catagris.runelite.specialattackmeter" })
export class SpecialAttackMeter extends SingletonAction<SpecialAttackMeterSettings> {
	override async onWillAppear(ev: WillAppearEvent<SpecialAttackMeterSettings>): Promise<void> {
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
		updateSpecialAttackMeters(getState());
	}

	override async onWillDisappear(ev: WillDisappearEvent<SpecialAttackMeterSettings>): Promise<void> {
		activeButtons.delete(ev.action.id);
		cachedSettings.delete(ev.action.id);

		if (activeButtons.size === 0) {
			removeStateListener(onStateUpdate);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SpecialAttackMeterSettings>): Promise<void> {
		const settings = ev.payload.settings;
		cachedSettings.set(ev.action.id, settings);
		updateSpecialAttackMeters(getState());
	}
}

/**
 * Updates all special attack meter buttons with current state
 */
async function updateSpecialAttackMeters(state: RuneLiteState): Promise<void> {
	if (activeButtons.size === 0) return;

	await Promise.all(
		Array.from(activeButtons.entries()).map(async ([id, action]) => {
			try {
				const settings = cachedSettings.get(id) || {};
				const image = createSpecialAttackMeterImage(state, settings);
				await action.setImage(image);
			} catch (error) {
				console.log(`[SpecialAttackMeter] Error updating button ${id}:`, error);
			}
		})
	);
}

/**
 * Creates an image with the special attack meter visualization
 */
function createSpecialAttackMeterImage(data: RuneLiteState, settings: SpecialAttackMeterSettings): string {
	const specialAttack = data.stats?.specialAttack || 0;
	const specialAttackEnabled = data.stats?.specialAttackEnabled || false;
	const specialAttackAvailable = data.stats?.specialAttackAvailable || false;

	const specPercent = specialAttack / 100;
	const textColor = settings.coloredNumbers === true ? getPercentColor(specPercent) : '#FFFFFF';
	const maskHeight = Math.round(144 * (1 - specPercent));

	const fillImageData = getFillImage(specialAttackEnabled, specialAttackAvailable);
	const orbOverlayData = getOrbOverlay();

	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	svg += `<rect width="144" height="144" fill="#000000"/>`;

	if (fillImageData) {
		svg += `<image href="${fillImageData}" x="0" y="0" width="144" height="144"/>`;
	}

	if (maskHeight > 0) {
		svg += `<rect x="0" y="0" width="144" height="${maskHeight}" fill="#000000"/>`;
	}

	if (orbOverlayData) {
		svg += `<image href="${orbOverlayData}" x="0" y="0" width="144" height="144"/>`;
	}

	if (settings.showNumbers !== false) {
		const textPos = getTextPosition(settings.textPosition);
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" stroke="#000000" stroke-width="3" fill="none">${specialAttack}</text>`;
		svg += `<text x="${textPos.x}" y="${textPos.y}" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${specialAttack}</text>`;
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

type SpecialAttackMeterSettings = {
	coloredNumbers?: boolean;
	textPosition?: TextPosition;
	showNumbers?: boolean;
};

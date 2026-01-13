import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Tracks the number of prayer buttons currently visible
 */
let activeButtonCount = 0;

/**
 * Polling interval ID
 */
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Map to store prayer button instances by context
 */
const activeButtons = new Map<string, { action: any; settings: PrayerButtonSettings }>();

/**
 * Cached server URL to avoid repeated getSettings() calls
 */
let cachedServerUrl = "http://localhost:8085/state";

/**
 * Cached images as base64 data URI
 */
const cachedImages = new Map<string, string>();

/**
 * Loads and caches an image as base64
 */
function loadImage(filename: string): string {
	const cached = cachedImages.get(filename);
	if (cached) return cached;

	try {
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'prayer-button', filename);
		const imageBuffer = fs.readFileSync(imgPath);
		const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;
		cachedImages.set(filename, dataUri);
		return dataUri;
	} catch (error) {
		console.log('[PrayerButton] Error loading image:', filename, error);
		return '';
	}
}

/**
 * Maps prayer JSON keys to their icon filenames
 */
const PRAYER_ICONS: { [key: string]: string } = {
	thick_skin: 'Thick_Skin.png',
	burst_of_strength: 'Burst_of_Strength.png',
	clarity_of_thought: 'Clarity_of_Thought.png',
	sharp_eye: 'Sharp_Eye.png',
	mystic_will: 'Mystic_Will.png',
	rock_skin: 'Rock_Skin.png',
	superhuman_strength: 'Superhuman_Strength.png',
	improved_reflexes: 'Improved_Reflexes.png',
	rapid_restore: 'Rapid_Restore.png',
	rapid_heal: 'Rapid_Heal.png',
	protect_item: 'Protect_Item.png',
	hawk_eye: 'Hawk_Eye.png',
	mystic_lore: 'Mystic_Lore.png',
	steel_skin: 'Steel_Skin.png',
	ultimate_strength: 'Ultimate_Strength.png',
	incredible_reflexes: 'Incredible_Reflexes.png',
	protect_from_magic: 'Protect_from_Magic.png',
	protect_from_missiles: 'Protect_from_Missiles.png',
	protect_from_melee: 'Protect_from_Melee.png',
	eagle_eye: 'Eagle_Eye.png',
	mystic_might: 'Mystic_Might.png',
	retribution: 'Retribution.png',
	redemption: 'Redemption.png',
	smite: 'Smite.png',
	preserve: 'Preserve.png',
	chivalry: 'Chivalry.png',
	deadeye: 'Deadeye.png',
	mystic_vigour: 'Mystic_Vigour.png',
	piety: 'Piety.png',
	rigour: 'Rigour.png',
	augury: 'Augury.png',
};

/**
 * Creates a prayer button image with layered background and icon
 * Layers: black bg -> deactivated bg -> activated glow (if active) -> prayer icon
 */
function createPrayerImage(prayerName: string, isActive: boolean): string {
	const iconFile = PRAYER_ICONS[prayerName.toLowerCase()] || 'Protect_from_Melee.png';

	const deactivatedData = loadImage('Deactivated_prayer.png');
	const activatedData = loadImage('Activated_prayer.png');
	const iconData = loadImage(iconFile);

	// Create SVG with layered images
	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	// Layer 0: Black background
	svg += `<rect width="144" height="144" fill="#000000"/>`;

	// Layer 1: Deactivated background (always shown)
	if (deactivatedData) {
		svg += `<image href="${deactivatedData}" x="0" y="0" width="144" height="144" image-rendering="pixelated"/>`;
	}

	// Layer 2: Activated glow (only when prayer is active)
	if (isActive && activatedData) {
		svg += `<image href="${activatedData}" x="0" y="0" width="144" height="144" image-rendering="pixelated"/>`;
	}

	// Layer 3: Prayer icon overlay - 30x30 scaled to 120x120 and centered
	if (iconData) {
		svg += `<image href="${iconData}" x="12" y="12" width="120" height="120" image-rendering="pixelated"/>`;
	}

	svg += `</svg>`;

	// Convert SVG to data URI
	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Prayer Button action
 */
@action({ UUID: "com.catagris.runelite.prayerbutton" })
export class PrayerButton extends SingletonAction<PrayerButtonSettings> {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<PrayerButtonSettings>): Promise<void> {
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
		if (!settings.prayerName) {
			settings.prayerName = "protect_from_melee";
			needsUpdate = true;
		}

		if (needsUpdate) {
			await ev.action.setSettings(settings);
		}

		// Update cached server URL
		cachedServerUrl = settings.serverUrl;

		// Check if this is the first button BEFORE incrementing
		const isFirstButton = activeButtonCount === 0;

		// Store the action instance with its settings
		activeButtons.set(ev.action.id, {
			action: ev.action,
			settings: settings
		});

		// Increment button count
		activeButtonCount++;

		// Set initial image (inactive state)
		const image = createPrayerImage(settings.prayerName, false);
		await ev.action.setImage(image);

		// Start polling if this is the first button
		if (isFirstButton) {
			startPolling(settings.pollInterval);
		} else {
			// If polling is already running, immediately update this button
			updatePrayerButtons();
		}
	}

	/**
	 * Called when the action is removed from the Stream Deck
	 */
	override async onWillDisappear(ev: WillDisappearEvent<PrayerButtonSettings>): Promise<void> {
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
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PrayerButtonSettings>): Promise<void> {
		const settings = ev.payload.settings;

		// Update cached server URL if changed
		if (settings.serverUrl) {
			cachedServerUrl = settings.serverUrl;
		}

		// Update the stored settings for this button
		const buttonData = activeButtons.get(ev.action.id);
		if (buttonData) {
			buttonData.settings = settings;
		}

		// Immediately update to reflect new settings
		updatePrayerButtons();

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
		return;
	}

	pollingInterval = setInterval(() => {
		updatePrayerButtons();
	}, interval);

	// Immediately update on start
	updatePrayerButtons();
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
 * Last known states for each button to avoid unnecessary image updates
 */
const lastButtonStates = new Map<string, { isActive: boolean; prayerName: string }>();

/**
 * Updates all prayer buttons by fetching the current state from RuneLite
 */
async function updatePrayerButtons(): Promise<void> {
	if (activeButtons.size === 0) {
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 1000);

	try {
		const response = await fetch(cachedServerUrl, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json() as RuneLiteState;

		// Check if logged in (player field exists when logged in)
		if (!data.player) {
			// Not logged in - set all buttons to inactive state
			await Promise.all(
				Array.from(activeButtons.entries()).map(async ([id, buttonData]) => {
					const prayerName = (buttonData.settings.prayerName || 'protect_from_melee').toLowerCase();
					const lastState = lastButtonStates.get(id);
					if (lastState?.isActive !== false || lastState?.prayerName !== prayerName) {
						const image = createPrayerImage(prayerName, false);
						await buttonData.action.setImage(image);
						lastButtonStates.set(id, { isActive: false, prayerName });
					}
				})
			);
			return;
		}

		// Update all buttons based on whether their prayer is active
		await Promise.all(
			Array.from(activeButtons.entries()).map(async ([id, buttonData]) => {
				const prayerName = (buttonData.settings.prayerName || 'protect_from_melee').toLowerCase();
				const isActive = data.prayers?.[prayerName] === true;
				const lastState = lastButtonStates.get(id);

				// Only update image if state or prayer name changed
				if (lastState?.isActive !== isActive || lastState?.prayerName !== prayerName) {
					const image = createPrayerImage(prayerName, isActive);
					await buttonData.action.setImage(image);
					lastButtonStates.set(id, { isActive, prayerName });
				}
			})
		);

	} catch (error) {
		clearTimeout(timeoutId);
		// Connection error, timeout, or RuneLite is closed - set all to inactive
		await Promise.all(
			Array.from(activeButtons.entries()).map(async ([id, buttonData]) => {
				const prayerName = (buttonData.settings.prayerName || 'protect_from_melee').toLowerCase();
				const lastState = lastButtonStates.get(id);
				if (lastState?.isActive !== false || lastState?.prayerName !== prayerName) {
					const image = createPrayerImage(prayerName, false);
					await buttonData.action.setImage(image);
					lastButtonStates.set(id, { isActive: false, prayerName });
				}
			})
		);
	}
}

/**
 * Settings for prayer buttons
 */
type PrayerButtonSettings = {
	serverUrl?: string;
	pollInterval?: number;
	prayerName?: string;
};

/**
 * RuneLite state response from the HTTP endpoint
 */
type RuneLiteState = {
	player?: {
		name: string;
		world: number;
	};
	prayers?: {
		[key: string]: boolean;
	};
};

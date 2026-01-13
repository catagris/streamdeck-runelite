import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import * as fs from 'fs';
import * as path from 'path';
import { getState, addStateListener, removeStateListener, RuneLiteState } from '../state-server';

/**
 * Map to store prayer button instances by context
 */
const activeButtons = new Map<string, { action: any; settings: PrayerButtonSettings }>();

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
 */
function createPrayerImage(prayerName: string, isActive: boolean): string {
	const iconFile = PRAYER_ICONS[prayerName.toLowerCase()] || 'Protect_from_Melee.png';

	const deactivatedData = loadImage('Deactivated_prayer.png');
	const activatedData = loadImage('Activated_prayer.png');
	const iconData = loadImage(iconFile);

	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	svg += `<rect width="144" height="144" fill="#000000"/>`;

	if (deactivatedData) {
		svg += `<image href="${deactivatedData}" x="0" y="0" width="144" height="144" image-rendering="pixelated"/>`;
	}

	if (isActive && activatedData) {
		svg += `<image href="${activatedData}" x="0" y="0" width="144" height="144" image-rendering="pixelated"/>`;
	}

	if (iconData) {
		svg += `<image href="${iconData}" x="12" y="12" width="120" height="120" image-rendering="pixelated"/>`;
	}

	svg += `</svg>`;

	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Last known states for each button to avoid unnecessary image updates
 */
const lastButtonStates = new Map<string, { isActive: boolean; prayerName: string }>();

/**
 * State listener function
 */
function onStateUpdate(state: RuneLiteState): void {
	updatePrayerButtons(state);
}

/**
 * Prayer Button action
 */
@action({ UUID: "com.catagris.runelite.prayerbutton" })
export class PrayerButton extends SingletonAction<PrayerButtonSettings> {
	override async onWillAppear(ev: WillAppearEvent<PrayerButtonSettings>): Promise<void> {
		const settings = ev.payload.settings;

		if (!settings.prayerName) {
			settings.prayerName = "protect_from_melee";
			await ev.action.setSettings(settings);
		}

		// Register listener if first button
		if (activeButtons.size === 0) {
			addStateListener(onStateUpdate);
		}

		activeButtons.set(ev.action.id, {
			action: ev.action,
			settings: settings
		});

		// Set initial image (inactive state)
		const image = createPrayerImage(settings.prayerName, false);
		await ev.action.setImage(image);

		// Immediately render with current state
		updatePrayerButtons(getState());
	}

	override async onWillDisappear(ev: WillDisappearEvent<PrayerButtonSettings>): Promise<void> {
		activeButtons.delete(ev.action.id);
		lastButtonStates.delete(ev.action.id);

		if (activeButtons.size === 0) {
			removeStateListener(onStateUpdate);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PrayerButtonSettings>): Promise<void> {
		const settings = ev.payload.settings;

		const buttonData = activeButtons.get(ev.action.id);
		if (buttonData) {
			buttonData.settings = settings;
		}

		// Clear last state to force update with new prayer name
		lastButtonStates.delete(ev.action.id);
		updatePrayerButtons(getState());
	}
}

/**
 * Updates all prayer buttons with current state
 */
async function updatePrayerButtons(state: RuneLiteState): Promise<void> {
	if (activeButtons.size === 0) return;

	// Check if we have any active prayers data
	const activePrayers = state.activePrayers || [];

	await Promise.all(
		Array.from(activeButtons.entries()).map(async ([id, buttonData]) => {
			const prayerName = (buttonData.settings.prayerName || 'protect_from_melee').toLowerCase();
			const isActive = activePrayers.includes(prayerName);
			const lastState = lastButtonStates.get(id);

			// Only update image if state or prayer name changed
			if (lastState?.isActive !== isActive || lastState?.prayerName !== prayerName) {
				const image = createPrayerImage(prayerName, isActive);
				await buttonData.action.setImage(image);
				lastButtonStates.set(id, { isActive, prayerName });
			}
		})
	);
}

type PrayerButtonSettings = {
	prayerName?: string;
};

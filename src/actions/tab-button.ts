import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { Hardware } from "keysender";
import * as fs from 'fs';
import * as path from 'path';
import { getState, addStateListener, removeStateListener, RuneLiteState } from '../state-server';

/**
 * Map to store tab button instances by context
 */
const activeButtons = new Map<string, { action: any; settings: TabSettings }>();

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
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'tab-button', filename);
		const imageBuffer = fs.readFileSync(imgPath);
		const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;
		cachedImages.set(filename, dataUri);
		return dataUri;
	} catch (error) {
		console.log('[TabButton] Error loading image:', filename, error);
		return '';
	}
}

/**
 * Maps tab names to their icon filenames
 */
const TAB_ICONS: { [key: string]: string } = {
	combat: 'combat.png',
	skills: 'skills.png',
	quests: 'quest.png',
	inventory: 'inventory.png',
	equipment: 'equipment.png',
	prayer: 'prayer.png',
	magic: 'magic.png',
	grouping: 'grouping_chat.png',
	account: 'account.png',
	friends: 'friends.png',
	settings: 'settings.png',
	emotes: 'emotes.png',
	music: 'music.png',
};

/**
 * Default OSRS keybindings for each tab
 */
const DEFAULT_KEYS: { [key: string]: string } = {
	combat: 'f1',
	skills: 'f2',
	quests: 'f3',
	inventory: 'escape',
	equipment: 'f4',
	prayer: 'f5',
	magic: 'f6',
	grouping: 'f7',
	account: 'f8',
	friends: 'f9',
	settings: 'f10',
	emotes: 'f11',
	music: 'f12',
};

/**
 * Creates a tab button image with layered background and icon
 */
function createTabImage(tabName: string, isActive: boolean): string {
	const backgroundFile = isActive ? 'backgroud_active.png' : 'backgroud_unactive.png';
	const iconFile = TAB_ICONS[tabName.toLowerCase()] || 'inventory.png';

	const backgroundData = loadImage(backgroundFile);
	const iconData = loadImage(iconFile);

	let svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">`;

	if (backgroundData) {
		svg += `<image href="${backgroundData}" x="0" y="0" width="144" height="144"/>`;
	}

	if (iconData) {
		svg += `<image href="${iconData}" x="0" y="0" width="144" height="144"/>`;
	}

	svg += `</svg>`;

	const svgBase64 = Buffer.from(svg).toString('base64');
	return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Last known states for each button to avoid unnecessary image updates
 */
const lastButtonStates = new Map<string, { isActive: boolean; tabName: string }>();

/**
 * State listener function
 */
function onStateUpdate(state: RuneLiteState): void {
	updateTabButtons(state);
}

/**
 * Configurable Tab Button action
 */
@action({ UUID: "com.catagris.runelite.tab" })
export class TabButton extends SingletonAction<TabSettings> {
	override async onWillAppear(ev: WillAppearEvent<TabSettings>): Promise<void> {
		const settings = ev.payload.settings;
		let needsUpdate = false;

		if (!settings.tabName) {
			settings.tabName = "inventory";
			needsUpdate = true;
		}
		if (!settings.keyToPress) {
			settings.keyToPress = DEFAULT_KEYS[settings.tabName.toLowerCase()] || "escape";
			needsUpdate = true;
		}

		if (needsUpdate) {
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
		const image = createTabImage(settings.tabName, false);
		await ev.action.setImage(image);

		// Immediately render with current state
		updateTabButtons(getState());
	}

	override async onWillDisappear(ev: WillDisappearEvent<TabSettings>): Promise<void> {
		activeButtons.delete(ev.action.id);
		lastButtonStates.delete(ev.action.id);

		if (activeButtons.size === 0) {
			removeStateListener(onStateUpdate);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TabSettings>): Promise<void> {
		const settings = ev.payload.settings;

		const buttonData = activeButtons.get(ev.action.id);
		if (buttonData) {
			buttonData.settings = settings;
		}

		// Clear last state to force update with new tab name
		lastButtonStates.delete(ev.action.id);
		updateTabButtons(getState());
	}

	override async onKeyDown(ev: KeyDownEvent<TabSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const keyToPress = (settings.keyToPress || "escape") as "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "escape";

		try {
			const hardware = new Hardware(null);
			await hardware.keyboard.sendKey(keyToPress);
		} catch (error) {
			console.log('[TabButton] Error sending key:', error);
		}
	}
}

/**
 * Updates all tab buttons with current state
 */
async function updateTabButtons(state: RuneLiteState): Promise<void> {
	if (activeButtons.size === 0) return;

	const activeTab = state.activeTab?.toLowerCase();

	await Promise.all(
		Array.from(activeButtons.entries()).map(async ([id, buttonData]) => {
			const tabName = (buttonData.settings.tabName || 'inventory').toLowerCase();
			const isActive = tabName === activeTab;
			const lastState = lastButtonStates.get(id);

			// Only update image if state or tab name changed
			if (lastState?.isActive !== isActive || lastState?.tabName !== tabName) {
				const image = createTabImage(tabName, isActive);
				await buttonData.action.setImage(image);
				lastButtonStates.set(id, { isActive, tabName });
			}
		})
	);
}

type TabSettings = {
	tabName?: string;
	keyToPress?: string;
};

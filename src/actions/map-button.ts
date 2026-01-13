import { action, SingletonAction, WillAppearEvent, KeyDownEvent, KeyUpEvent } from "@elgato/streamdeck";
import { Hardware } from "keysender";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Map to store map button instances by context
 */
const activeButtons = new Map<string, any>();

/**
 * Cached images as base64 data URI
 */
let cachedNormalImage: string | null = null;
let cachedHighlightImage: string | null = null;

/**
 * Loads and caches an image as base64
 */
function loadImage(filename: string): string {
	try {
		const imgPath = path.join(process.cwd(), 'imgs', 'actions', 'map-button', filename);
		const imageBuffer = fs.readFileSync(imgPath);
		return `data:image/png;base64,${imageBuffer.toString('base64')}`;
	} catch (error) {
		console.log('[MapButton] Error loading image:', filename, error);
		return '';
	}
}

/**
 * Gets the normal map orb image
 */
function getNormalImage(): string {
	if (!cachedNormalImage) {
		cachedNormalImage = loadImage('map_orb.png');
	}
	return cachedNormalImage;
}

/**
 * Gets the highlight map orb image
 */
function getHighlightImage(): string {
	if (!cachedHighlightImage) {
		cachedHighlightImage = loadImage('map_orb_highlight.png');
	}
	return cachedHighlightImage;
}

/**
 * Map Button action - sends Ctrl+M to toggle the world map
 */
@action({ UUID: "com.catagris.runelite.mapbutton" })
export class MapButton extends SingletonAction {
	/**
	 * Called when the action becomes visible on the Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		console.log("[MapButton] onWillAppear called");

		// Store the action instance
		activeButtons.set(ev.action.id, ev.action);

		// Set the normal image
		const normalImage = getNormalImage();
		if (normalImage) {
			await ev.action.setImage(normalImage);
		}
	}

	/**
	 * Called when the key is pressed down
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		console.log("[MapButton] Key pressed - showing highlight");

		// Show highlight image while pressed
		const highlightImage = getHighlightImage();
		if (highlightImage) {
			await ev.action.setImage(highlightImage);
		}
	}

	/**
	 * Called when the key is released
	 */
	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		console.log("[MapButton] Key released - sending Ctrl+M and restoring normal image");

		// Restore normal image
		const normalImage = getNormalImage();
		if (normalImage) {
			await ev.action.setImage(normalImage);
		}

		// Send Ctrl+M keystroke using keysender
		try {
			const hardware = new Hardware(null);
			await hardware.keyboard.sendKey(["ctrl", "m"]);
			console.log('[MapButton] Ctrl+M sent successfully');
		} catch (error) {
			console.log('[MapButton] Error sending keystroke:', error);
		}
	}
}

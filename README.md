<p align="center">
  <img src="Icon.png" alt="Streamdeck-Runelite Logo" width="200">
</p>

# RuneLite Stream Deck Plugin

A Stream Deck plugin that integrates with Old School RuneScape through RuneLite, providing real-time game status displays and limited buttons.

## Requirements

- **Windows 10 or later** (macOS not supported due to `keysender` dependency for keyboard input)
- [Stream Deck](https://www.elgato.com/stream-deck) software 6.9+
- [RuneLite](https://runelite.net/) client
- [RuneLite Stream Deck Plugin](https://github.com/catagris/runelite-streamdeck) - Required for communication between RuneLite and Stream Deck

## Installation

1. Install the RuneLite Stream Deck plugin from the [RuneLite Plugin Hub](https://github.com/catagris/runelite-streamdeck)
2. Install this Stream Deck plugin
3. Launch RuneLite and ensure the Stream Deck plugin is enabled
4. Add buttons to your Stream Deck

## Actions

### Tab Button
Displays a game interface tab (Inventory, Prayer, Magic, etc.) and highlights when that tab is active. Press to send the corresponding keyboard shortcut to switch tabs.

### Health Meter
Shows current hitpoints as a filling orb with optional number display. Changes color based on status effects (poison, venom, disease).

### Prayer Meter
Shows current prayer points as a filling orb. Appearance changes when quick prayers are active.

### Run Meter
Shows current run energy (0-100) as a filling orb. Appearance changes when run is toggled on/off.

### Special Attack Meter
Shows special attack energy (0-100) as a filling orb. Appearance changes based on weapon availability and activation state.

### Map Button
Press to toggle the world map (sends Ctrl+M).

### Prayer Button
Displays a specific prayer icon and shows whether that prayer is currently active or inactive.

## Configuration

Most actions support the following settings:

- **Server URL** - The RuneLite plugin endpoint (default: `http://localhost:8085/state`)
- **Poll Interval** - How often to update the display in milliseconds (default: 200ms)
- **Show Numbers** - Toggle number display on meter buttons
- **Colored Numbers** - Numbers change color based on percentage (green to red)
- **Text Position** - Where to display numbers on the button

## Building from Source

```bash
npm install
npm run build
```

## License

MIT

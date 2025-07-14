# Game Localization Helper

A VSCode extension for efficient game localization file editing. Simplify your translation workflow with an intuitive interface and powerful features.
Currently only Korean is supported. AI vibe code deep shit hehe

## Features

- 📝 **Intuitive Editing Interface**: View original and translated text side by side
- 🔍 **Smart Navigation**: Navigate through translation entries with keyboard shortcuts
- 📊 **Progress Tracking**: Real-time progress tracking with completion status
- 🎯 **Filtering**: View only incomplete translations or search specific text
- 💾 **Auto-save**: Automatic saving of progress and settings
- 🤖 **AI Translation Suggestions**: Generate translation prompts for AI assistants (Cursor, ChatGPT, etc.)
- ⌨️ **Keyboard Shortcuts**: Speed up your workflow with hotkeys
- 🎨 **Customizable**: Adjust fonts, sizes, and text alignment to your preference

## Supported File Format

The extension works with localization files in the following format:

```
"Original text" -> "Translated text"
'Original text' -> 'Translated text'
```

## Usage

### Opening the Editor
1. Right-click on a `.txt` file → Select "게임 로컬라이제이션 에디터 열기"
2. Or use the keyboard shortcut `Ctrl+Alt+L`

### Navigation
- **Enter**: Move to next entry
- **Shift+Enter**: Move to previous entry
- **Ctrl+D**: Copy original text to translation field
- **Ctrl+T**: Generate AI translation prompt
- **Click original text**: Auto-focus on translation input

### Translation Workflow
1. Navigate through entries using arrow buttons or keyboard shortcuts
2. Enter your translation in the input field
3. Press **Enter** to mark as completed and move to next entry
4. Use "Go to Incomplete" button to jump to untranslated entries
5. Save your work with the "Save Translation File" button

### AI Translation Assistance
1. Click the **🤖 Translation Suggestion** button
2. A translation prompt is automatically copied to your clipboard
3. Paste it into any AI assistant (Cursor, ChatGPT, Claude, etc.)
4. Copy the AI's response back to the translation field

### Settings
Access the settings panel to customize:
- **Font selection** for original and translated text
- **Font size** adjustment (10px - 24px)
- **Text alignment** (left, center, right, justified)

All settings are automatically saved and restored between sessions.

## Installation

### From VSIX File
1. Download the `.vsix` file
2. Open VSCode
3. Press `Ctrl+Shift+P` → Type "Extensions: Install from VSIX..."
4. Select the downloaded `.vsix` file

### From Command Line
```bash
code --install-extension game-localization-helper-0.0.1.vsix
```

## Development

### Prerequisites
- Node.js
- VSCode

### Setup
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to compile TypeScript
4. Press `F5` to launch the extension in a new VSCode window

### Building
```bash
npm run compile
vsce package
```

## File Structure

The extension creates several helper files:
- `filename_translated.txt` - Your translated file
- `filename_progress.json` - Progress tracking data

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+L` | Open localization editor |
| `Enter` | Next entry |
| `Shift+Enter` | Previous entry |
| `Ctrl+D` | Copy original text |
| `Ctrl+T` | AI translation suggestion |

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - see LICENSE file for details.

## Changelog

### 0.0.1
- Initial release
- Basic translation interface
- Progress tracking
- AI translation suggestions
- Customizable settings
- Keyboard shortcuts
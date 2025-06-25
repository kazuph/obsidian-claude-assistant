# Claude Assistant Plugin for Obsidian

An Obsidian plugin that integrates Claude Code CLI to provide AI assistance directly within your note-taking workflow.

## Features

- **Ask Claude about your notes**: Send your current note content along with a question to Claude
- **Cursor position insertion**: Claude's response is automatically inserted at your cursor position
- **Comprehensive logging**: Detailed logging for debugging and monitoring
- **Progress tracking**: Verbose mode shows Claude's thinking process
- **Debug tools**: Built-in testing and debugging capabilities

## Usage

1. **Install the plugin** in your Obsidian vault
2. **Configure Claude CLI path** in plugin settings (auto-detection available)
3. **Use the command**: 
   - Press `Cmd/Ctrl + P` and search for "Ask Claude about current note"
   - Or use the ribbon icon
4. **Enter your question** in the modal
5. **Claude's response** will be inserted at your cursor position

## Requirements

- [Claude Code CLI](https://claude.ai/code) installed and configured
- Node.js (for Claude CLI execution)
- Obsidian desktop app

## Configuration

The plugin automatically detects common Claude CLI installation paths:
- `/usr/local/bin/claude`
- `/opt/homebrew/bin/claude`
- `~/.claude/local/claude`
- And more...

You can also manually specify the Claude CLI path in the plugin settings.

## Development

### Building

```bash
npm install
npm run build
```

### Architecture

- **main.ts**: Core plugin implementation
- **executeClaudeCommand()**: Handles Claude CLI execution via Node.js spawn
- **Comprehensive logging**: All operations are logged to debug.log
- **Error handling**: Robust error handling with detailed diagnostics

### Debugging

The plugin includes extensive logging capabilities:
- All input/output is logged
- Process status monitoring
- Verbose Claude CLI output
- Debug test commands in settings

## License

MIT

## Author

kazuph

---

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
import { Plugin, MarkdownView, Modal, Setting, Notice, App, PluginSettingTab } from 'obsidian';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { access, writeFile, appendFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const execAsync = promisify(exec);

interface ClaudeAssistantSettings {
    claudePath: string;
}

const DEFAULT_SETTINGS: ClaudeAssistantSettings = {
    claudePath: 'claude'
}

export default class ClaudeAssistantPlugin extends Plugin {
    private claudePath: string | null = null;
    settings: ClaudeAssistantSettings;
    private logFilePath: string;

    async onload() {
        await this.loadSettings();
        
        // ログファイルパスを設定
        this.logFilePath = '/Users/kazuph/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Vault/.obsidian/plugins/claude-assistant/debug.log';
        await this.log('=== Claude Assistant Plugin Started ===');
        
        // 設定からパスを使用、なければ自動検出
        if (this.settings.claudePath && this.settings.claudePath !== 'claude') {
            this.claudePath = this.settings.claudePath;
            console.log('Claude Assistant: Using configured path:', this.claudePath);
        } else {
            // Claude CLIのパスを初期化時に解決
            this.claudePath = await this.findClaudePath();
            
            // デバッグ: パス情報をコンソールに出力
            if (this.claudePath) {
                console.log('Claude Assistant: Found Claude CLI at:', this.claudePath);
            } else {
                console.warn('Claude Assistant: Claude CLI not found');
            }
        }
        // コマンドパレットにコマンドを追加
        this.addCommand({
            id: 'ask-claude',
            name: 'Ask Claude about current note',
            callback: () => this.openQuestionModal(),
        });

        // リボンアイコンを追加
        this.addRibbonIcon('message-circle', 'Ask Claude', () => {
            this.openQuestionModal();
        });

        // 設定タブを追加
        this.addSettingTab(new ClaudeAssistantSettingTab(this.app, this));
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async log(message: string): Promise<void> {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        
        try {
            await appendFile(this.logFilePath, logEntry, 'utf8');
            console.log(`Claude Assistant: ${message}`);
        } catch (error) {
            console.error('Failed to write to log file:', error);
            console.log(`Claude Assistant: ${message}`);
        }
    }

    openQuestionModal() {
        new QuestionModal(this.app, async (question: string) => {
            await this.processClaudeRequest(question);
        }).open();
    }

    async processClaudeRequest(question: string) {
        await this.log(`processClaudeRequest started with question: ${question.substring(0, 100)}...`);
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            await this.log('ERROR: No active markdown view found');
            new Notice('No active markdown view found');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            await this.log('ERROR: No active file found');
            new Notice('No active file found');
            return;
        }

        try {
            // Loading通知を表示
            const loadingNotice = new Notice('Asking Claude...', 0);
            await this.log('Loading notice displayed');
            
            // デバッグ情報
            await this.log(`Using Claude path: ${this.claudePath}`);
            
            // ノート内容を取得
            const noteContent = await this.app.vault.read(activeFile);
            await this.log(`Note content length: ${noteContent.length} characters`);
            await this.log(`Note content preview: ${noteContent.substring(0, 200)}...`);
            await this.log(`User question: "${question}"`);
            
            // Claudeコマンドを実行
            await this.log('Starting Claude command execution...');
            const result = await this.executeClaudeCommand(noteContent, question);
            await this.log(`Claude command completed. Result length: ${result.length} characters`);
            await this.log(`Claude response preview: ${result.substring(0, 300)}...`);
            
            // Loading通知を削除
            loadingNotice.hide();
            await this.log('Loading notice hidden');
            
            // カーソル位置に結果を挿入
            const editor = activeView.editor;
            const cursor = editor.getCursor();
            editor.replaceRange('\n\n' + result + '\n\n', cursor);
            await this.log('Result inserted at cursor position');
            
            new Notice(`Claude response inserted (${result.length} chars): ${result.substring(0, 50)}${result.length > 50 ? '...' : ''}`, 5000);
            await this.log('processClaudeRequest completed successfully');
        } catch (error) {
            await this.log(`ERROR in processClaudeRequest: ${error.message}`);
            await this.log(`ERROR stack: ${error.stack}`);
            new Notice(`Error: ${error.message}`);
            console.error('Claude Assistant Error:', error);
            console.error('Claude Assistant: Current path was:', this.claudePath);
        }
    }

    async findClaudePath(): Promise<string | null> {
        const homeDir = homedir();
        const possiblePaths = [
            // よくあるClaude CLIのパス（権限問題を回避するため簡素化）
            'claude', // PATH上のclaude（最も権限問題が少ない）
            '/usr/local/bin/claude',
            '/opt/homebrew/bin/claude',
            `${homeDir}/.claude/local/claude`,
            `${homeDir}/.claude/local/node_modules/.bin/claude`,
            `${homeDir}/.config/claude/claude`,
            `${homeDir}/.local/bin/claude`
        ];

        console.log('Claude Assistant: Searching for Claude CLI...');

        for (const path of possiblePaths) {
            try {
                console.log(`Claude Assistant: Checking path: ${path}`);
                
                if (path === 'claude') {
                    // PATH上のコマンドを確認
                    try {
                        const { stdout } = await execAsync('which claude');
                        const resolvedPath = stdout.trim();
                        if (resolvedPath) {
                            console.log(`Claude Assistant: Found via which: ${resolvedPath}`);
                            // 実際の実行テスト
                            await this.testClaudePath(resolvedPath);
                            return resolvedPath;
                        }
                    } catch (error) {
                        console.log(`Claude Assistant: which claude failed: ${error.message}`);
                    }
                } else {
                    // ファイルの存在確認
                    await access(path);
                    console.log(`Claude Assistant: File exists: ${path}`);
                    // 実際の実行テスト
                    await this.testClaudePath(path);
                    return path;
                }
            } catch (error) {
                console.log(`Claude Assistant: Path ${path} failed: ${error.message}`);
                continue;
            }
        }

        console.warn('Claude Assistant: No valid Claude CLI path found');
        return null;
    }

    async testClaudePath(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(path, ['--version'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000
            });

            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`Claude Assistant: Successfully tested path: ${path}`);
                    resolve();
                } else {
                    reject(new Error(`Test failed with exit code ${code}`));
                }
            });

            child.on('error', (error) => {
                reject(error);
            });

            setTimeout(() => {
                child.kill();
                reject(new Error('Test timeout'));
            }, 5000);
        });
    }

    async executeClaudeCommand(noteContent: string, question: string): Promise<string> {
        await this.log('executeClaudeCommand: Starting execution');
        
        // プロンプトを構築
        const prompt = `${noteContent}\n\n---------\n\n${question}`;
        await this.log(`executeClaudeCommand: Prompt length: ${prompt.length} characters`);
        await this.log(`executeClaudeCommand: Prompt preview: ${prompt.substring(0, 200)}...`);
        
        // 環境変数を適切に設定（Shell commands プラグインの方式）
        const processEnv = {
            ...process.env,
            // Node.jsのPATHを明示的に追加
            PATH: [
                '/opt/homebrew/bin',
                '/usr/local/bin', 
                '/Users/kazuph/.local/share/mise/installs/node/20.18.2/bin',
                process.env.PATH
            ].filter(Boolean).join(':')
        };
        await this.log(`executeClaudeCommand: Environment PATH: ${processEnv.PATH}`);
        
        // Claude CLIの実行
        const claudeCliPath = '/Users/kazuph/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js';
        const nodeCommand = '/opt/homebrew/bin/node';
        const args = [claudeCliPath, '--verbose', '--print'];
        
        await this.log(`executeClaudeCommand: Command: ${nodeCommand}`);
        await this.log(`executeClaudeCommand: Args: [${args[0]}, ${args[1]}, ${args[2] ? 'prompt(' + args[2].length + 'chars)' : 'MISSING_PROMPT'}]`);
        await this.log(`executeClaudeCommand: Working directory: ${homedir()}`);
        
        return new Promise(async (resolve, reject) => {
            await this.log('executeClaudeCommand: Creating spawn process...');
            
            // Shell commands プラグインと同じ方式でspawn
            const child = spawn(nodeCommand, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: processEnv,
                cwd: homedir() // working directory を明示的に設定
            });

            await this.log(`executeClaudeCommand: Spawn created, PID: ${child.pid}`);

            let stdout = '';
            let stderr = '';

            // utf8エンコーディングを設定（Shell commands プラグインと同じ）
            child.stdout?.setEncoding('utf8');
            child.stderr?.setEncoding('utf8');

            // イベントハンドラーを先に全て設定
            child.on('spawn', async () => {
                await this.log('executeClaudeCommand: Process spawned successfully');
            });

            child.on('error', async (error) => {
                await this.log(`executeClaudeCommand: Process error: ${error.message}`);
                await this.log(`executeClaudeCommand: Error stack: ${error.stack}`);
                reject(new Error(`Claude CLI execution error: ${error.message}`));
            });

            child.stdout?.on('data', async (data) => {
                const dataStr = data.toString();
                stdout += dataStr;
                await this.log(`executeClaudeCommand: stdout data received: ${dataStr.length} chars`);
                await this.log(`executeClaudeCommand: stdout preview: ${dataStr.substring(0, 200)}...`);
            });

            child.stderr?.on('data', async (data) => {
                const dataStr = data.toString();
                stderr += dataStr;
                await this.log(`executeClaudeCommand: stderr data received: ${dataStr.length} chars`);
                await this.log(`executeClaudeCommand: stderr content: ${dataStr}`);
            });

            child.on('close', async (code) => {
                await this.log(`executeClaudeCommand: Process closed with code: ${code}`);
                await this.log(`executeClaudeCommand: Final stdout length: ${stdout.length}`);
                await this.log(`executeClaudeCommand: Final stderr length: ${stderr.length}`);
                
                if (code === 0) {
                    await this.log('executeClaudeCommand: Success, resolving with stdout');
                    resolve(stdout.trim());
                } else {
                    await this.log(`executeClaudeCommand: Failed with exit code ${code}`);
                    reject(new Error(`Claude CLI failed with exit code ${code}: ${stderr}`));
                }
            });

            // デバッグ用：定期的な状態チェック
            const statusInterval = setInterval(async () => {
                await this.log(`executeClaudeCommand: Status check - Process exists: ${child.pid}, killed: ${child.killed}, connected: ${child.connected}`);
            }, 5000);

            child.on('close', () => {
                clearInterval(statusInterval);
            });

            child.on('error', () => {
                clearInterval(statusInterval);
            });

            // プロンプトを標準入力に送信
            if (child.stdin) {
                await this.log('executeClaudeCommand: Writing prompt to stdin...');
                child.stdin.write(prompt);
                child.stdin.end();
                await this.log('executeClaudeCommand: Prompt written to stdin');
            } else {
                await this.log('executeClaudeCommand: ERROR - stdin not available');
                reject(new Error('stdin not available'));
                return;
            }

            // タイムアウトを無効化（デバッグ用）
            // setTimeout(() => {
            //     child.kill('SIGTERM');
            //     setTimeout(() => child.kill('SIGKILL'), 1000);
            //     reject(new Error('Claude CLI execution timed out'));
            // }, 30000);
            
            await this.log('executeClaudeCommand: Promise setup complete, waiting for process...');
        });
    }

}

class QuestionModal extends Modal {
    private question: string = '';
    private onSubmit: (question: string) => void;

    constructor(app: App, onSubmit: (question: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Ask Claude' });

        new Setting(contentEl)
            .setName('Question')
            .setDesc('Enter your question about the current note')
            .addTextArea(text => {
                text.setPlaceholder('What would you like to ask Claude about this note?')
                    .setValue(this.question)
                    .onChange(value => this.question = value);
                text.inputEl.rows = 4;
                text.inputEl.cols = 50;
                // フォーカスを設定
                setTimeout(() => text.inputEl.focus(), 100);
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => {
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Ask Claude')
                .setCta()
                .onClick(() => {
                    if (this.question.trim()) {
                        this.close();
                        this.onSubmit(this.question);
                    } else {
                        new Notice('Please enter a question');
                    }
                }));

        // Enterキーでの送信をサポート
        this.scope.register(['Mod'], 'Enter', (evt: KeyboardEvent) => {
            if (this.question.trim()) {
                this.close();
                this.onSubmit(this.question);
            }
            return false;
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ClaudeAssistantSettingTab extends PluginSettingTab {
    plugin: ClaudeAssistantPlugin;

    constructor(app: App, plugin: ClaudeAssistantPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Claude Assistant Settings' });

        new Setting(containerEl)
            .setName('Claude CLI Path')
            .setDesc('Path to Claude CLI executable. Leave as "claude" to use PATH, or specify full path like "/Users/username/.claude/local/claude"')
            .addText(text => text
                .setPlaceholder('/Users/username/.claude/local/claude')
                .setValue(this.plugin.settings.claudePath)
                .onChange(async (value) => {
                    this.plugin.settings.claudePath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Test Claude CLI')
            .setDesc('Test if Claude CLI is accessible using the same method as actual execution')
            .addButton(button => button
                .setButtonText('Test Connection')
                .onClick(async () => {
                    button.setButtonText('Testing...');
                    try {
                        // 実際の実行と同じロジックでテスト
                        const testResult = await this.testClaudeExecution();
                        new Notice(`✅ Claude CLI test success! Response: ${testResult.substring(0, 100)}${testResult.length > 100 ? '...' : ''}`, 8000);
                        console.log('Claude CLI test result:', testResult);
                        button.setButtonText('Test Connection');
                    } catch (error) {
                        new Notice(`❌ Claude CLI test failed: ${error.message}`, 5000);
                        console.error('Claude CLI test error:', error);
                        button.setButtonText('Test Connection');
                    }
                }));

        // デバッグ用テスト機能（必要最小限）
        containerEl.createEl('h3', { text: 'Debug Commands' });
        
        const debugCommands = [
            { name: 'Test Node.js access', command: '/opt/homebrew/bin/node', args: ['--version'] },
            { name: 'Test Claude CLI direct', command: '/opt/homebrew/bin/node', args: ['/Users/kazuph/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js', '--version'] }
        ];

        debugCommands.forEach(cmd => {
            new Setting(containerEl)
                .setName(cmd.name)
                .addButton(button => button
                    .setButtonText('Test')
                    .onClick(async () => {
                        button.setButtonText('Testing...');
                        try {
                            const result = await this.testCommand(cmd.command, cmd.args);
                            new Notice(`✅ ${cmd.name} success`);
                            console.log(`${cmd.name} result:`, result);
                            button.setButtonText('Test');
                        } catch (error) {
                            new Notice(`❌ ${cmd.name} failed: ${error.message}`);
                            console.error(`${cmd.name} error:`, error);
                            button.setButtonText('Test');
                        }
                    }))
        });

        // macOS権限についての説明
        containerEl.createEl('h3', { text: 'macOS Permissions' });
        containerEl.createEl('p', { 
            text: 'If Claude CLI is not found, you may need to grant Obsidian additional permissions:'
        });
        
        const permissionsList = containerEl.createEl('ul');
        permissionsList.createEl('li', { text: 'System Preferences > Privacy & Security > Full Disk Access > Add Obsidian' });
        permissionsList.createEl('li', { text: 'System Preferences > Privacy & Security > Files and Folders > Grant Home folder access to Obsidian' });
        
        containerEl.createEl('p', { 
            text: 'After changing permissions, restart Obsidian and try again.'
        });
    }

    async testClaudeExecution(): Promise<string> {
        await this.plugin.log('testClaudeExecution: Starting test with actual prompt');
        
        const testPrompt = 'こんにちは';
        await this.plugin.log(`testClaudeExecution: Test input: "${testPrompt}"`);
        
        try {
            // 実際のexecuteClaudeCommandを使用してテスト
            const result = await this.plugin.executeClaudeCommand('', testPrompt);
            await this.plugin.log(`testClaudeExecution: Test output: "${result}"`);
            await this.plugin.log('testClaudeExecution: Test completed successfully');
            return result;
        } catch (error) {
            await this.plugin.log(`testClaudeExecution: Test failed with error: ${error.message}`);
            throw error;
        }
    }

    async testCommand(command: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env },
                timeout: 10000
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout || stderr); // stderrも正常出力として扱う場合がある
                } else {
                    reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`));
                }
            });

            child.on('error', (error) => {
                reject(new Error(`Command error: ${error.message}`));
            });

            setTimeout(() => {
                child.kill();
                reject(new Error('Command timeout'));
            }, 10000);
        });
    }
}
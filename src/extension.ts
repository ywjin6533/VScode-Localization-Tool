import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface TranslationEntry {
    original: string;
    translation: string;
    lineNumber: number;
    fullLine?: string;
    completed?: boolean; // 엔터로 완료된 항목인지 추적
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Game Localization Helper가 활성화되었습니다!');

    const openEditorCommand = vscode.commands.registerCommand('gameLocalization.openEditor', (uri: vscode.Uri) => {
        const panel = vscode.window.createWebviewPanel(
            'gameLocalizationEditor',
            '게임 로컬라이제이션 에디터',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const filePath = uri.fsPath;

        // 번역된 파일이 존재하는지 확인
        const dir = path.dirname(filePath);
        const filename = path.basename(filePath, '.txt');
        const translatedPath = path.join(dir, `${filename}_translated.txt`);
        const progressPath = path.join(dir, `${filename}_progress.json`);

        let actualFilePath = filePath;
        if (fs.existsSync(translatedPath)) {
            actualFilePath = translatedPath;
            console.log('번역된 파일을 발견했습니다:', translatedPath);
        }

        const entries = parseLocalizationFile(actualFilePath);

        // 진행률 정보 로드
        loadProgressInfo(entries, progressPath);

        // 디버깅: 총 라인 수와 파싱된 항목 수 로그
        const totalLines = fs.readFileSync(actualFilePath, 'utf8').split('\n').length;
        console.log(`총 라인 수: ${totalLines}, 파싱된 항목 수: ${entries.length}`);

        panel.webview.html = getWebviewContent(entries, path.basename(actualFilePath));

        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'updateTranslation':
                        entries[message.index].translation = message.translation;
                        // 텍스트가 수정되면 완료 상태 해제
                        entries[message.index].completed = false;
                        // 진행률 정보 저장
                        saveProgressInfo(entries, progressPath);
                        break;
                    case 'markCompleted':
                        // 엔터로 완료된 항목 표시
                        entries[message.index].completed = true;
                        // 진행률 정보 저장
                        saveProgressInfo(entries, progressPath);
                        break;
                    case 'requestTranslation':
                        console.log('서버에서 번역 요청 받음:', message.originalText);

                        // 클립보드에 번역 프롬프트 복사하여 Cursor에서 쉽게 사용할 수 있도록
                        const translationPrompt = `다음 영어 텍스트를 자연스러운 한국어로 번역해주세요. 게임 텍스트이므로 맥락에 맞게 번역해주세요:

"${message.originalText}"

번역만 제공해주세요.`;

                        console.log('클립보드에 복사할 프롬프트:', translationPrompt);

                        vscode.env.clipboard.writeText(translationPrompt).then(() => {
                            console.log('클립보드 복사 성공');

                            // 웹뷰에 복사 완료 알림
                            panel.webview.postMessage({
                                command: 'showCopySuccess',
                                type: 'translation'
                            });

                            vscode.window.showInformationMessage('번역 프롬프트가 클립보드에 복사되었습니다. Cursor AI 채팅에 붙여넣기하세요!',
                                'Cursor 채팅 열기').then(selection => {
                                    if (selection === 'Cursor 채팅 열기') {
                                        // Cursor 채팅 패널 열기 시도
                                        vscode.commands.executeCommand('workbench.action.chat.open');
                                    }
                                });
                        }, (error) => {
                            console.log('클립보드 복사 실패:', error);

                            panel.webview.postMessage({
                                command: 'showCopyError'
                            });
                        });
                        break;
                    case 'saveSettings':
                        // 폰트 설정 저장
                        context.globalState.update('localizationSettings', message.settings);
                        console.log('설정이 저장되었습니다:', message.settings);
                        break;
                    case 'loadSettings':
                        // 저장된 설정 로드
                        const savedSettings = context.globalState.get('localizationSettings', {
                            originalFont: "'Courier New', monospace",
                            originalSize: "16",
                            translationFont: "'Courier New', monospace",
                            translationSize: "16",
                            textAlignment: "left"
                        });
                        panel.webview.postMessage({
                            command: 'settingsLoaded',
                            settings: savedSettings
                        });
                        break;
                    case 'exportFile':
                        // 클라이언트에서 전달받은 전체 상태로 업데이트
                        if (message.allEntries) {
                            message.allEntries.forEach((clientEntry: any, index: number) => {
                                if (entries[index]) {
                                    entries[index].translation = clientEntry.translation;
                                    entries[index].completed = clientEntry.completed;
                                }
                            });
                        }

                        console.log('Export 시작, 총 항목 수:', entries.length);
                        console.log('완료된 항목:', entries.filter(e => e.completed === true).length);
                        console.log('번역된 항목:', entries.filter(e => e.translation.trim() !== '').length);

                        // 번역된 파일이 있으면 그 파일에 저장, 없으면 새로 생성
                        if (fs.existsSync(translatedPath)) {
                            exportTranslationFile(translatedPath, entries, true); // 덮어쓰기
                        } else {
                            exportTranslationFile(filePath, entries, false); // 새 파일 생성
                        }
                        // 진행률 정보도 저장
                        saveProgressInfo(entries, progressPath);
                        vscode.window.showInformationMessage('번역 파일이 저장되었습니다!');
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    });

    const exportCommand = vscode.commands.registerCommand('gameLocalization.exportTranslation', () => {
        vscode.window.showInformationMessage('번역 파일 내보내기가 실행되었습니다!');
    });

    context.subscriptions.push(openEditorCommand, exportCommand);
}

function parseLocalizationFile(filePath: string): TranslationEntry[] {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const entries: TranslationEntry[] = [];

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine && trimmedLine.includes(' -> ')) {
            // 더 유연한 정규식 - 라인 끝의 추가 문자들도 포함
            const match = trimmedLine.match(/^(['"])(.*?)\1\s*->\s*(['"])(.*?)\3(.*)$/);
            if (match) {
                const original = match[2];
                const translation = match[4];

                // 빈 문자열이 아닌 모든 텍스트 포함 (스크립트 명령어 제외 안 함)
                if (original.trim() !== '') {
                    entries.push({
                        original,
                        translation,
                        lineNumber: index + 1,
                        fullLine: trimmedLine, // 전체 라인 정보 저장
                        completed: false // 초기값은 미완료
                    });
                }
            }
        }
    });

    return entries;
}

function loadProgressInfo(entries: TranslationEntry[], progressPath: string) {
    try {
        if (fs.existsSync(progressPath)) {
            const progressData = JSON.parse(fs.readFileSync(progressPath, 'utf8'));

            // 라인 번호를 키로 하여 진행률 정보 복원
            entries.forEach(entry => {
                const progressEntry = progressData.find((p: any) => p.lineNumber === entry.lineNumber);
                if (progressEntry) {
                    entry.completed = progressEntry.completed || false;
                }
            });

            console.log('진행률 정보를 로드했습니다:', progressPath);
        }
    } catch (error) {
        console.log('진행률 정보 로드 중 오류:', error);
    }
}

function saveProgressInfo(entries: TranslationEntry[], progressPath: string) {
    try {
        const progressData = entries.map(entry => ({
            lineNumber: entry.lineNumber,
            original: entry.original.substring(0, 50), // 식별용 원본 텍스트 일부
            completed: entry.completed || false,
            hasTranslation: entry.translation.trim() !== '',
            lastModified: new Date().toISOString()
        }));

        const completedCount = progressData.filter(p => p.completed).length;
        const translatedCount = progressData.filter(p => p.hasTranslation).length;

        fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2));
        console.log(`진행률 정보 저장 완료: ${progressPath}`);
        console.log(`- 완료된 항목: ${completedCount}/${progressData.length}`);
        console.log(`- 번역된 항목: ${translatedCount}/${progressData.length}`);
    } catch (error) {
        console.log('진행률 정보 저장 중 오류:', error);
    }
}

function exportTranslationFile(originalPath: string, entries: TranslationEntry[], overwrite: boolean = false) {
    const content = fs.readFileSync(originalPath, 'utf8');
    let updatedContent = content;

    // 각 번역된 항목에 대해 원본 파일에서 해당 라인을 찾아 교체
    entries.forEach(entry => {
        if (entry.translation.trim() !== '') {
            // 원본 라인의 패턴을 찾기
            const lines = content.split('\n');
            const originalLine = lines[entry.lineNumber - 1];

            if (originalLine) {
                // 라인에서 -> 기준으로 앞뒤 분리
                const arrowIndex = originalLine.indexOf(' -> ');
                if (arrowIndex !== -1) {
                    const beforeArrow = originalLine.substring(0, arrowIndex);
                    const afterArrowStart = originalLine.indexOf('"', arrowIndex) !== -1 ?
                        originalLine.indexOf('"', arrowIndex) :
                        originalLine.indexOf("'", arrowIndex);

                    if (afterArrowStart !== -1) {
                        const quote = originalLine.charAt(afterArrowStart);
                        const afterArrowEnd = originalLine.indexOf(quote, afterArrowStart + 1);
                        const lineEnding = afterArrowEnd !== -1 ?
                            originalLine.substring(afterArrowEnd + 1) : '';

                        // 새로운 라인 구성
                        const newLine = `${beforeArrow} -> ${quote}${entry.translation}${quote}${lineEnding}`;

                        // 원본 라인을 새 라인으로 교체
                        updatedContent = updatedContent.replace(originalLine, newLine);
                    }
                }
            }
        }
    });

    let newPath: string;
    if (overwrite) {
        // 기존 번역 파일에 덮어쓰기
        newPath = originalPath;
    } else {
        // 새 번역 파일 생성
        const dir = path.dirname(originalPath);
        const filename = path.basename(originalPath, '.txt');
        newPath = path.join(dir, `${filename}_translated.txt`);
    }

    fs.writeFileSync(newPath, updatedContent);
}

function getWebviewContent(entries: TranslationEntry[], filename: string): string {
    const entriesJson = JSON.stringify(entries);

    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>게임 로컬라이제이션 에디터</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #1e1e1e;
            color: #d4d4d4;
            overflow: hidden;
        }
        .header {
            margin-bottom: 20px;
            padding: 15px;
            background-color: #2d2d30;
            border-radius: 8px;
            border-left: 4px solid #007acc;
            position: fixed;
            top: 20px;
            left: 20px;
            right: 20px;
            z-index: 100;
        }
        .header h1 {
            margin: 0;
            color: #007acc;
            font-size: 24px;
        }
        .filename {
            color: #9cdcfe;
            font-size: 14px;
            margin-top: 5px;
        }
        .stats {
            margin-top: 10px;
            font-size: 12px;
            color: #808080;
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background-color: #464647;
            border-radius: 4px;
            overflow: hidden;
            margin: 10px 0;
        }
        .progress-fill {
            height: 100%;
            background-color: #4caf50;
            transition: width 0.3s ease;
        }
        .controls {
            position: fixed;
            top: 160px;
            left: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            background-color: #2d2d30;
            padding: 15px;
            border-radius: 8px;
            z-index: 99;
        }
        .btn {
            padding: 8px 16px;
            background-color: #007acc;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .btn:hover {
            background-color: #106ba3;
        }
        .btn:disabled {
            background-color: #464647;
            cursor: not-allowed;
        }
        .btn-secondary {
            background-color: #68217a;
        }
        .btn-secondary:hover {
            background-color: #7c2d8a;
        }
        .page-info {
            color: #9cdcfe;
            font-weight: bold;
            margin: 0 10px;
        }
        .main-content {
            position: fixed;
            top: 240px;
            left: 20px;
            right: 20px;
            bottom: 20px;
            background-color: #2d2d30;
            border-radius: 8px;
            padding: 30px;
            display: flex;
            gap: 30px;
            box-sizing: border-box;
        }
        .text-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0; /* flex 아이템이 축소될 수 있도록 */
            position: relative;
        }
        .text-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .text-actions {
            display: flex;
            gap: 8px;
        }
        .text-label {
            font-weight: bold;
            color: #4ec9b0;
            font-size: 16px;
        }
        .copy-btn {
            padding: 4px 8px;
            background-color: #68217a;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0.8;
            white-space: nowrap;
        }
        .copy-btn:hover {
            background-color: #7c2d8a;
            opacity: 1;
        }
        .cursor-only {
            background-color: #007acc;
        }
        .copy-btn.success {
            background-color: #4caf50 !important;
            transform: scale(0.95);
            transition: all 0.2s ease;
        }
        .copy-btn.success:hover {
            background-color: #45a049 !important;
        }
        .toast-notification {
            position: fixed;
            top: 80px;
            right: 20px;
            background-color: #4caf50;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .toast-notification.show {
            opacity: 1;
            transform: translateX(0);
        }
        .original-text {
            background-color: #1e1e1e;
            padding: 20px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            border-left: 4px solid #007acc;
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            line-height: 1.6;
            user-select: text;
            cursor: text;
            word-wrap: break-word;
            word-break: break-word;
            text-align: left; /* 기본값을 왼쪽 정렬로 변경 */
        }
        .original-text:focus {
            outline: 2px solid #007acc;
            background-color: #252526;
        }
        .translation-input {
            width: 100%;
            height: 100%;
            padding: 20px;
            border: 2px solid #464647;
            border-radius: 8px;
            background-color: #1e1e1e;
            color: #d4d4d4;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            resize: none;
            outline: none;
            line-height: 1.6;
            box-sizing: border-box;
            word-wrap: break-word;
            overflow-wrap: break-word;
            text-align: left; /* 기본값을 왼쪽 정렬로 변경 */
        }
        .translation-input:focus {
            border-color: #007acc;
            background-color: #252526;
        }
        .entry-info {
            position: absolute;
            top: 10px;
            right: 10px;
            background-color: #464647;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            color: #cccccc;
        }
        .navigation-help {
            position: absolute;
            bottom: 10px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #464647;
            padding: 8px 15px;
            border-radius: 4px;
            font-size: 12px;
            color: #cccccc;
        }
        .settings-panel {
            position: fixed;
            top: 20px;
            right: -320px; /* 완전히 오른쪽 밖으로 숨김 */
            width: 300px;
            background-color: #2d2d30;
            border-radius: 8px;
            padding: 15px;
            z-index: 101;
            transition: right 0.3s ease;
            border: 1px solid #464647;
            box-shadow: -5px 0 15px rgba(0, 0, 0, 0.3);
        }
        .settings-panel.open {
            right: 20px; /* 열릴 때 오른쪽에 20px 여백 */
        }
        .settings-toggle {
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #007acc;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px 12px;
            cursor: pointer;
            z-index: 10002; /* 모든 것보다 위에 */
            font-size: 12px;
        }
        .settings-toggle:hover {
            background-color: #106ba3;
        }
        .hidden {
            display: none;
        }
        .setting-group {
            margin-bottom: 15px;
        }
        .setting-label {
            display: block;
            color: #4ec9b0;
            font-size: 12px;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .setting-input {
            width: 100%;
            padding: 6px;
            border: 1px solid #464647;
            border-radius: 4px;
            background-color: #1e1e1e;
            color: #d4d4d4;
            font-size: 12px;
            box-sizing: border-box;
        }
        .setting-input:focus {
            outline: none;
            border-color: #007acc;
        }
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div id="toastContainer"></div>

    <button class="settings-toggle" onclick="toggleSettings()">⚙️ 설정</button>
    
    <div class="settings-panel" id="settingsPanel">
        <div class="settings-header">
            <h3 class="settings-title">🎨 텍스트 설정</h3>
            <p class="settings-subtitle">폰트, 크기, 정렬 등을 조정할 수 있습니다</p>
        </div>
        
        <div class="setting-group">
            <label class="setting-label">원본 텍스트 폰트</label>
            <select class="setting-input" id="originalFontFamily" onchange="updateFontSettings()">
                <option value="">폰트 로딩 중...</option>
            </select>
            <div class="font-preview" id="originalPreview">샘플 텍스트</div>
        </div>
        
        <div class="setting-group">
            <label class="setting-label">원본 텍스트 크기: <span id="originalSizeValue">16px</span></label>
            <input type="range" class="setting-input" id="originalFontSize" min="10" max="24" value="16" onchange="updateFontSettings()">
        </div>
        
        <div class="setting-group">
            <label class="setting-label">번역 텍스트 폰트</label>
            <select class="setting-input" id="translationFontFamily" onchange="updateFontSettings()">
                <option value="">폰트 로딩 중...</option>
            </select>
            <div class="font-preview" id="translationPreview">샘플 텍스트</div>
        </div>
        
        <div class="setting-group">
            <label class="setting-label">번역 텍스트 크기: <span id="translationSizeValue">16px</span></label>
            <input type="range" class="setting-input" id="translationFontSize" min="10" max="24" value="16" onchange="updateFontSettings()">
        </div>
        
        <div class="setting-group">
            <label class="setting-label">텍스트 정렬</label>
            <select class="setting-input" id="textAlignment" onchange="updateFontSettings()">
                <option value="left">⬅️ 왼쪽 정렬</option>
                <option value="center">🔄 가운데 정렬</option>
                <option value="right">➡️ 오른쪽 정렬</option>
                <option value="justify">📐 양쪽 맞춤</option>
            </select>
        </div>
        
        <div class="settings-actions">
            <button class="btn-settings btn-secondary-settings" onclick="resetFontSettings()">기본값 복원</button>
            <button class="btn-settings btn-primary-settings" onclick="toggleSettings()">완료</button>
        </div>
    </div>

    <div class="header">
        <h1>🎮 게임 로컬라이제이션 에디터</h1>
        <div class="filename">파일: ${filename}</div>
        <div class="stats">
            총 <span id="totalCount">0</span>개 항목 | 완료: <span id="completedCount">0</span>개 | 
            진행률: <span id="progressPercent">0</span>%
        </div>
        <div class="progress-bar">
            <div class="progress-fill" id="progressFill"></div>
        </div>
    </div>

    <div class="controls">
        <button class="btn" id="prevBtn" onclick="previousEntry()" disabled>⬅️ 이전</button>
        <button class="btn" id="nextBtn" onclick="nextEntry()">다음 ➡️</button>
        <div class="page-info">
            <span id="currentPage">1</span> / <span id="totalPages">1</span>
        </div>
        <button class="btn btn-secondary" onclick="jumpToEmpty()">📝 미완료 항목으로 이동</button>
        <button class="btn" onclick="exportTranslation()">💾 번역 파일 저장</button>
    </div>

    <div class="main-content">
        <div class="text-container">
            <div class="text-header">
                <div class="text-label">원본 텍스트</div>
                <div class="text-actions">
                    <button class="copy-btn cursor-only" id="translationSuggestBtn">🤖 번역 제안</button>
                    <button class="copy-btn" onclick="copyOriginalText()">📋 원본 텍스트 복사</button>
                </div>
            </div>
            <div class="original-text" id="originalText" tabindex="0"></div>
        </div>
        <div class="text-container">
            <div class="text-header">
                <div class="text-label">번역 텍스트</div>
            </div>
            <textarea class="translation-input" id="translationInput" 
                      placeholder="여기에 번역을 입력하세요..."></textarea>
        </div>
        <div class="entry-info" id="entryInfo"></div>
    </div>

    <div class="navigation-help">
        💡 Enter: 다음 항목 | Shift+Enter: 이전 항목 | Ctrl+D: 원본 복사 | Ctrl+T: 번역 제안
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let entries = ${entriesJson};
        let currentIndex = 0;
        let lastSavedTranslation = ''; // 마지막으로 저장된 번역 내용

        function renderCurrentEntry() {
            if (entries.length === 0) return;
            
            const entry = entries[currentIndex];
            const originalText = document.getElementById('originalText');
            const translationInput = document.getElementById('translationInput');
            const entryInfo = document.getElementById('entryInfo');
            
            originalText.textContent = entry.original;
            translationInput.value = entry.translation;
            lastSavedTranslation = entry.translation; // 현재 번역 내용 저장
            entryInfo.textContent = \`#\${currentIndex + 1} (라인 \${entry.lineNumber})\`;
            
            // 버튼 상태 업데이트
            document.getElementById('prevBtn').disabled = currentIndex === 0;
            document.getElementById('nextBtn').disabled = currentIndex === entries.length - 1;
            
            // 페이지 정보 업데이트
            document.getElementById('currentPage').textContent = currentIndex + 1;
            document.getElementById('totalPages').textContent = entries.length;
            
            updateStats();
        }

        function nextEntry() {
            if (currentIndex < entries.length - 1) {
                // 엔터로 이동하는 경우에만 완료 처리
                markCurrentAsCompleted();
                saveCurrentTranslation();
                currentIndex++;
                renderCurrentEntry();
                document.getElementById('translationInput').focus();
            }
        }

        function previousEntry() {
            if (currentIndex > 0) {
                saveCurrentTranslation();
                currentIndex--;
                renderCurrentEntry();
                document.getElementById('translationInput').focus();
            }
        }

        function markCurrentAsCompleted() {
            const translationInput = document.getElementById('translationInput');
            const currentTranslation = translationInput.value.trim();
            
            // 번역이 있고, 수정되지 않았으면 완료 처리
            if (currentTranslation !== '' && entries[currentIndex]) {
                entries[currentIndex].completed = true;
                vscode.postMessage({
                    command: 'markCompleted',
                    index: currentIndex
                });
            }
        }

        function jumpToEmpty() {
            saveCurrentTranslation();
            
            // 현재 위치부터 순차적으로 미완료 항목 찾기 (completed: false)
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].completed !== true) {
                    currentIndex = i;
                    renderCurrentEntry();
                    document.getElementById('translationInput').focus();
                    return;
                }
            }
            
            // 미완료 항목이 없으면 알림
            alert('완료되지 않은 항목이 없습니다!');
        }

        function saveCurrentTranslation() {
            const translationInput = document.getElementById('translationInput');
            if (entries[currentIndex]) {
                entries[currentIndex].translation = translationInput.value;
                vscode.postMessage({
                    command: 'updateTranslation',
                    index: currentIndex,
                    translation: translationInput.value
                });
            }
        }

        function updateStats() {
            const total = entries.length;
            const completed = entries.filter(e => e.completed === true).length; // completed가 true인 항목만 계산
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
            
            document.getElementById('totalCount').textContent = total;
            document.getElementById('completedCount').textContent = completed;
            document.getElementById('progressPercent').textContent = percent;
            document.getElementById('progressFill').style.width = percent + '%';
        }

        function exportTranslation() {
            // 현재 번역 상태 저장
            saveCurrentTranslation();
            
            // 현재 상태를 서버에 전달
            vscode.postMessage({
                command: 'exportFile',
                currentIndex: currentIndex,
                currentTranslation: document.getElementById('translationInput').value,
                allEntries: entries // 전체 상태 전달
            });
        }

        let availableFonts = [];

        async function loadSystemFonts() {
            console.log('시스템 폰트 로딩 시작...');
            
            try {
                // 기본 폰트 목록
                const defaultFonts = [
                    { name: "Courier New", value: "'Courier New', monospace", category: "모노스페이스" },
                    { name: "Consolas", value: "'Consolas', monospace", category: "모노스페이스" },
                    { name: "Monaco", value: "'Monaco', monospace", category: "모노스페이스" },
                    { name: "D2Coding", value: "'D2Coding', monospace", category: "모노스페이스" },
                    { name: "맑은 고딕", value: "'Malgun Gothic', sans-serif", category: "한글" },
                    { name: "나눔고딕", value: "'NanumGothic', sans-serif", category: "한글" },
                    { name: "Pretendard", value: "'Pretendard', sans-serif", category: "한글" },
                    { name: "돋움", value: "'Dotum', sans-serif", category: "한글" },
                    { name: "굴림", value: "'Gulim', sans-serif", category: "한글" },
                    { name: "Arial", value: "'Arial', sans-serif", category: "영문" },
                    { name: "Times New Roman", value: "'Times New Roman', serif", category: "영문" },
                    { name: "Verdana", value: "'Verdana', sans-serif", category: "영문" },
                    { name: "Georgia", value: "'Georgia', serif", category: "영문" }
                ];

                // 일단 기본 폰트만 사용 (Font Access API는 VSCode 환경에서 제한적)
                availableFonts = defaultFonts;
                updateFontSelectBoxes();
                console.log('기본 폰트 로드 완료:', defaultFonts.length, '개');
                
            } catch (error) {
                console.log('폰트 로드 중 오류:', error);
                // 최소한의 기본 폰트만 사용
                availableFonts = [
                    { name: "Courier New", value: "'Courier New', monospace", category: "기본" },
                    { name: "맑은 고딕", value: "'Malgun Gothic', sans-serif", category: "기본" },
                    { name: "Arial", value: "'Arial', sans-serif", category: "기본" }
                ];
                updateFontSelectBoxes();
            }
            
            console.log('폰트 로딩 프로세스 완료');
        }

        function updateFontSelectBoxes() {
            console.log('폰트 선택박스 업데이트 시작...');
            
            const originalSelect = document.getElementById('originalFontFamily');
            const translationSelect = document.getElementById('translationFontFamily');
            
            if (!originalSelect || !translationSelect) {
                console.log('폰트 선택박스를 찾을 수 없습니다.');
                return;
            }
            
            // 기존 옵션 제거
            originalSelect.innerHTML = '';
            translationSelect.innerHTML = '';
            
            // 카테고리별로 그룹화
            const categories = {};
            availableFonts.forEach(font => {
                if (!categories[font.category]) {
                    categories[font.category] = [];
                }
                categories[font.category].push(font);
            });
            
            // 카테고리 순서 정의
            const categoryOrder = ["모노스페이스", "한글", "영문", "기본"];
            
            categoryOrder.forEach(category => {
                if (categories[category]) {
                    // 카테고리 그룹 생성
                    const optgroup1 = document.createElement('optgroup');
                    optgroup1.label = category;
                    const optgroup2 = document.createElement('optgroup');
                    optgroup2.label = category;
                    
                    categories[category].forEach(font => {
                        const option1 = document.createElement('option');
                        option1.value = font.value;
                        option1.textContent = font.name;
                        
                        const option2 = document.createElement('option');
                        option2.value = font.value;
                        option2.textContent = font.name;
                        
                        optgroup1.appendChild(option1);
                        optgroup2.appendChild(option2);
                    });
                    
                    originalSelect.appendChild(optgroup1);
                    translationSelect.appendChild(optgroup2);
                }
            });
            
            // 기본값 설정
            originalSelect.value = "'Courier New', monospace";
            translationSelect.value = "'Courier New', monospace";
            
            console.log('폰트 선택박스 업데이트 완료:', availableFonts.length, '개 폰트');
        }

        // Cursor 환경 감지 및 번역 제안 버튼 표시
        function detectCursorEnvironment() {
            console.log('Cursor 환경 감지 시작...');
            
            // 일단 테스트를 위해 항상 버튼을 표시하도록 수정
            const isCursor = true; // 테스트용으로 항상 true
            
            console.log('Cursor 환경 감지 결과:', isCursor);
            console.log('User Agent:', navigator.userAgent);
            console.log('Location:', window.location.href);
            
            if (isCursor) {
                const translateBtn = document.getElementById('translationSuggestBtn');
                console.log('번역 제안 버튼 요소:', translateBtn);
                
                if (translateBtn) {
                    translateBtn.classList.remove('hidden');
                    console.log('번역 제안 버튼 표시됨');
                    console.log('버튼 클래스:', translateBtn.className);
                } else {
                    console.log('번역 제안 버튼을 찾을 수 없음');
                }
            }
        }

        function copyOriginalText() {
            const originalText = document.getElementById('originalText').textContent;
            const translationInput = document.getElementById('translationInput');
            
            // 번역 입력창에 원본 텍스트 복사
            translationInput.value = originalText;
            translationInput.focus();
            
            // 커서를 끝으로 이동
            translationInput.selectionStart = translationInput.selectionEnd = translationInput.value.length;
            
            // 복사로 인한 수정이므로 미완료 상태로 변경
            if (entries[currentIndex]) {
                entries[currentIndex].completed = false;
            }
            
            // 변경 사항 저장
            saveCurrentTranslation();
            updateStats(); // 진행률 즉시 업데이트
            
            // 복사 성공 피드백
            showCopyFeedback('copy');
        }

        function showCopyFeedback(type) {
            console.log('showCopyFeedback 호출됨, 타입:', type);
            
            let message, icon;
            
            switch(type) {
                case 'copy':
                    message = '원본 텍스트가 복사되었습니다';
                    icon = '📋';
                    break;
                case 'translation':
                    message = '번역 프롬프트가 클립보드에 복사되었습니다';
                    icon = '🤖';
                    break;
                case 'error':
                    message = '복사 중 오류가 발생했습니다';
                    icon = '❌';
                    break;
                default:
                    message = '복사되었습니다';
                    icon = '✅';
            }
            
            console.log('토스트 메시지:', message);
            
            // 토스트 알림 생성
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = \`\${icon} \${message}\`;
            
            const container = document.getElementById('toastContainer');
            console.log('토스트 컨테이너:', container);
            
            if (!container) {
                console.log('토스트 컨테이너를 찾을 수 없음');
                return;
            }
            
            container.appendChild(toast);
            console.log('토스트 추가됨');
            
            // 애니메이션으로 표시
            setTimeout(() => {
                toast.classList.add('show');
                console.log('토스트 표시 애니메이션 시작');
            }, 100);
            
            // 3초 후 제거
            setTimeout(() => {
                toast.classList.remove('show');
                console.log('토스트 숨김 애니메이션 시작');
                setTimeout(() => {
                    if (container.contains(toast)) {
                        container.removeChild(toast);
                        console.log('토스트 제거됨');
                    }
                }, 300);
            }, 3000);
        }

        function toggleSettings() {
            const panel = document.getElementById('settingsPanel');
            panel.classList.toggle('open');
        }

        function updateFontSettings() {
            const originalText = document.getElementById('originalText');
            const translationInput = document.getElementById('translationInput');
            
            const originalFont = document.getElementById('originalFontFamily').value;
            const originalSize = document.getElementById('originalFontSize').value;
            const translationFont = document.getElementById('translationFontFamily').value;
            const translationSize = document.getElementById('translationFontSize').value;
            const textAlignment = document.getElementById('textAlignment').value;
            
            // 폰트 적용
            originalText.style.fontFamily = originalFont;
            originalText.style.fontSize = originalSize + 'px';
            translationInput.style.fontFamily = translationFont;
            translationInput.style.fontSize = translationSize + 'px';
            
            // 텍스트 정렬 적용
            originalText.style.textAlign = textAlignment;
            translationInput.style.textAlign = textAlignment;
            
            // 양쪽 맞춤일 때만 text-justify 적용
            if (textAlignment === 'justify') {
                originalText.style.textJustify = 'inter-word';
                translationInput.style.textJustify = 'inter-word';
            } else {
                originalText.style.textJustify = 'auto';
                translationInput.style.textJustify = 'auto';
            }
            
            // 미리보기 업데이트
            const originalPreview = document.getElementById('originalPreview');
            if (originalPreview) {
                originalPreview.innerHTML = \`샘플 텍스트\`;
                originalPreview.style.fontFamily = originalFont;
                originalPreview.style.fontSize = originalSize + 'px';
                originalPreview.style.textAlign = textAlignment;
            }
            
            const translationPreview = document.getElementById('translationPreview');
            if (translationPreview) {
                translationPreview.innerHTML = \`샘플 텍스트\`;
                translationPreview.style.fontFamily = translationFont;
                translationPreview.style.fontSize = translationSize + 'px';
                translationPreview.style.textAlign = textAlignment;
            }
            
            // 크기 표시 업데이트
            const originalSizeValue = document.getElementById('originalSizeValue');
            if (originalSizeValue) {
                originalSizeValue.textContent = originalSize + 'px';
            }
            
            const translationSizeValue = document.getElementById('translationSizeValue');
            if (translationSizeValue) {
                translationSizeValue.textContent = translationSize + 'px';
            }
            
            // VSCode 글로벌 설정에 저장
            const settings = {
                originalFont,
                originalSize,
                translationFont,
                translationSize,
                textAlignment
            };
            
            vscode.postMessage({
                command: 'saveSettings',
                settings: settings
            });
        }

        function loadFontSettings() {
            // VSCode에서 설정 로드 요청
            vscode.postMessage({
                command: 'loadSettings'
            });
        }

        // VSCode에서 설정 데이터 수신
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'settingsLoaded':
                    const settings = message.settings;
                    
                    if (settings.originalFont && document.getElementById('originalFontFamily').options.length > 1) {
                        document.getElementById('originalFontFamily').value = settings.originalFont;
                    }
                    if (settings.originalSize) {
                        document.getElementById('originalFontSize').value = settings.originalSize;
                    }
                    if (settings.translationFont && document.getElementById('translationFontFamily').options.length > 1) {
                        document.getElementById('translationFontFamily').value = settings.translationFont;
                    }
                    if (settings.translationSize) {
                        document.getElementById('translationFontSize').value = settings.translationSize;
                    }
                    if (settings.textAlignment) {
                        document.getElementById('textAlignment').value = settings.textAlignment;
                    }
                    
                    // 폰트 적용
                    updateFontSettings();
                    break;
                case 'showCopySuccess':
                    showCopyFeedback(message.type);
                    // 버튼 시각적 피드백
                    const btn = document.getElementById('translationSuggestBtn');
                    if (btn) {
                        btn.classList.add('success');
                        btn.textContent = '✅ 복사됨';
                        setTimeout(() => {
                            btn.classList.remove('success');
                            btn.textContent = '🤖 번역 제안';
                        }, 2000);
                    }
                    break;
                case 'showCopyError':
                    showCopyFeedback('error');
                    break;
            }
        });

        function resetFontSettings() {
            document.getElementById('originalFontFamily').value = "'Courier New', monospace";
            document.getElementById('originalFontSize').value = "16";
            document.getElementById('translationFontFamily').value = "'Courier New', monospace";
            document.getElementById('translationFontSize').value = "16";
            document.getElementById('textAlignment').value = "left";
            
            updateFontSettings();
            
            alert('기본 설정으로 복원되었습니다.');
        }

        // Font Access API 권한 요청 제거 (VSCode 환경에서는 지원되지 않음)
        // async function requestFontPermission() { ... }

        // 키보드 이벤트 처리
        document.addEventListener('keydown', function(e) {
            if (e.target.id === 'translationInput') {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    nextEntry();
                } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    previousEntry();
                }
            }
            
            // 전역 단축키: Ctrl+D (또는 Cmd+D) - 원본 텍스트 복사
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                console.log('단축키로 원본 텍스트 복사 실행됨 (Ctrl+D)');
                copyOriginalText();
            }
            
            // 전역 단축키: Ctrl+T (또는 Cmd+T) - 번역 제안
            if ((e.ctrlKey || e.metaKey) && e.key === 't') {
                e.preventDefault();
                console.log('단축키로 번역 제안 실행됨 (Ctrl+T)');
                const translateBtn = document.getElementById('translationSuggestBtn');
                if (translateBtn) {
                    translateBtn.click();
                }
            }
        });

        // 원본 텍스트 클릭 시 번역 입력창에 포커스
        document.getElementById('originalText').addEventListener('click', function() {
            document.getElementById('translationInput').focus();
        });

        // 전역 키보드 이벤트 (원본 텍스트에 포커스 있을 때)
        document.getElementById('originalText').addEventListener('keydown', function(e) {
            if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                // 문자 입력이나 삭제 키가 눌리면 번역 입력창으로 포커스 이동
                const translationInput = document.getElementById('translationInput');
                translationInput.focus();
                
                if (e.key.length === 1) {
                    // 현재 커서 위치에 문자 삽입
                    const start = translationInput.selectionStart;
                    const end = translationInput.selectionEnd;
                    const value = translationInput.value;
                    translationInput.value = value.substring(0, start) + e.key + value.substring(end);
                    translationInput.selectionStart = translationInput.selectionEnd = start + 1;
                }
                e.preventDefault();
            }
        });

        // 번역 입력 시 완료 상태 해제 및 자동 저장
        document.getElementById('translationInput').addEventListener('input', function() {
            // 내용이 변경되면 완료 상태 해제
            if (entries[currentIndex]) {
                entries[currentIndex].completed = false;
                // 서버에 완료 상태 해제 알림
                vscode.postMessage({
                    command: 'updateTranslation',
                    index: currentIndex,
                    translation: this.value
                });
            }
            updateStats(); // 진행률 즉시 업데이트
        });

        // 초기 렌더링
        if (entries.length > 0) {
            renderCurrentEntry();
            // 첫 번째 미완료 항목으로 이동 (completed: false)
            const firstIncompleteIndex = entries.findIndex(entry => entry.completed !== true);
            if (firstIncompleteIndex !== -1) {
                currentIndex = firstIncompleteIndex;
                renderCurrentEntry();
            }
            document.getElementById('translationInput').focus();
        }
        
        // 시스템 폰트 로드 및 설정 로드
        loadSystemFonts().then(() => {
            // 폰트 목록 로드 완료 후 설정 로드
            setTimeout(() => {
                loadFontSettings();
                
                // 디버깅: 모든 요소가 제대로 로드되었는지 확인
                console.log('DOM 로드 완료 후 디버깅...');
                console.log('번역 제안 버튼:', document.getElementById('translationSuggestBtn'));
                console.log('원본 텍스트:', document.getElementById('originalText'));
                console.log('토스트 컨테이너:', document.getElementById('toastContainer'));
                
                // 번역 제안 버튼에 이벤트 리스너 추가
                const translateBtn = document.getElementById('translationSuggestBtn');
                if (translateBtn) {
                    translateBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        console.log('이벤트 리스너로 번역 제안 버튼 클릭 감지됨');
                        
                        const originalText = document.getElementById('originalText');
                        if (!originalText) {
                            console.log('원본 텍스트 요소를 찾을 수 없음');
                            alert('원본 텍스트를 찾을 수 없습니다.');
                            return;
                        }
                        
                        const textContent = originalText.textContent || originalText.innerText;
                        console.log('원본 텍스트:', textContent);
                        
                        if (!textContent || textContent.trim() === '') {
                            console.log('원본 텍스트가 비어있음');
                            alert('번역할 텍스트가 없습니다.');
                            return;
                        }
                        
                        console.log('번역 제안 요청 전송 중...');
                        
                        // 즉시 피드백 표시
                        showCopyFeedback('translation');
                        
                        // VSCode로 번역 요청 전송
                        if (typeof vscode !== 'undefined' && vscode.postMessage) {
                            vscode.postMessage({
                                command: 'requestTranslation',
                                originalText: textContent.trim()
                            });
                            console.log('번역 제안 요청 전송 완료');
                        } else {
                            console.log('vscode API를 사용할 수 없음');
                            alert('VSCode API를 사용할 수 없습니다.');
                        }
                    });
                    console.log('번역 제안 버튼에 이벤트 리스너 추가됨');
                } else {
                    console.log('번역 제안 버튼을 찾을 수 없음');
                }
            }, 100);
        });
    </script>
</body>
</html>`;
}

export function deactivate() { }
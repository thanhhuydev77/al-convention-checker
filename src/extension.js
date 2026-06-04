const vscode = require('vscode');

function activate(context) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('alConvention');
    context.subscriptions.push(diagnosticCollection);

    const runValidation = (doc) => reviewALCode(doc, diagnosticCollection);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(runValidation),
        vscode.workspace.onDidChangeTextDocument(e => runValidation(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('alConvention') && vscode.window.activeTextEditor) {
                runValidation(vscode.window.activeTextEditor.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('al', new ALActionProvider(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('alConvention.fixNaming', async (uri, range, newName) => {
            try {
                const edit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, range.start, newName);
                if (edit && edit.size > 0) {
                    await vscode.workspace.applyEdit(edit);
                    return;
                }
            } catch (error) {
                console.warn("AL Rename Provider failed or not available:", error);
            }
            
            const fallbackEdit = new vscode.WorkspaceEdit();
            fallbackEdit.replace(uri, range, newName);
            await vscode.workspace.applyEdit(fallbackEdit);
        })
    );

    if (vscode.window.activeTextEditor) {
        runValidation(vscode.window.activeTextEditor.document);
    }
}

class ALActionProvider {
    provideCodeActions(document, range, context, token) {
        const actions = [];
        context.diagnostics
            .filter(diagnostic => diagnostic.code && diagnostic.code.toString().startsWith('AL_CONV_'))
            .forEach(diagnostic => {
                if (diagnostic.suggestedFix) {
                    const fixAction = new vscode.CodeAction(
                        `Rename to '${diagnostic.suggestedFix}' (AL Convention)`, 
                        vscode.CodeActionKind.QuickFix
                    );
                    fixAction.command = {
                        command: 'alConvention.fixNaming',
                        title: fixAction.title,
                        arguments: [document.uri, diagnostic.range, diagnostic.suggestedFix]
                    };
                    fixAction.isPreferred = true;
                    actions.push(fixAction);
                }
            });
        return actions;
    }
}

// =========================================================================
// 🛠️ CÁC HÀM TIỆN ÍCH XỬ LÝ CHUỖI (UTILITIES)
// =========================================================================

function toSnakeCase(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function toCamelCase(str) {
    const pascal = toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toPascalCase(str) {
    if (!str) return '';
    if (str.includes('_') || str === str.toLowerCase()) {
        return str
            .replace(/[^a-zA-Z0-9]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 0)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join('');
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function cleanDoubleTypePrefix(prefix, base, style) {
    if (style === 'PascalCase' && prefix.length >= 3 && base.length >= 3) {
        const lastThree = prefix.slice(-3);
        if (base.startsWith(lastThree)) {
            return base.substring(3);
        }
    }
    return base;
}

function checkNamingStyle(str, style) {
    if (!str) return true;
    switch (style) {
        case 'snake_case': return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(str);
        case 'camelCase': return /^[a-z0-9]+([A-Z0-9][a-z0-9]*)*$/.test(str);
        case 'PascalCase': return /^[A-Z0-9][a-z0-9]*([A-Z0-9][a-z0-9]*)*$/.test(str);
        default: return true;
    }
}

function formatBaseName(str, style) {
    switch (style) {
        case 'snake_case': return toSnakeCase(str);
        case 'camelCase': return toCamelCase(str);
        case 'PascalCase': return toPascalCase(str);
        default: return str;
    }
}

/**
 * Nâng cấp thuật toán V5: Tự động phân rã và dọn dẹp các tiền tố lai (lopt, pcode) dính liền
 */
function extractPureBaseName(currentName, expectedPrefix) {
    if (!currentName) return '';

    if (currentName.startsWith(expectedPrefix)) {
        return currentName.substring(expectedPrefix.length);
    }

    let cleanBase = currentName;

    if (cleanBase.includes('_')) {
        const words = cleanBase.split('_');
        const coreBlacklist = new Set([
            'l', 'g', 'p', 't', 'v', 'var', 'temp', 'tmp', 'tem', 'gtemp', 'ltemp', 'ptemp'
        ]);
        const typeAbbreviations = new Set([
            'rec', 'cu', 'pag', 'que', 'rep', 'int', 'txt', 'cod', 'boo', 'dec', 'guid', 'dat', 'opt', 'code', 'xml', 'jso', 'jsa', 'dic', 'lst', 'jst'
        ]);

        let startIndex = 0;
        while (startIndex < words.length) {
            const currentWord = words[startIndex].toLowerCase();
            if (coreBlacklist.has(currentWord) || typeAbbreviations.has(currentWord) || currentWord === 'lrec' || currentWord === 'grec' || currentWord === 'prec') {
                startIndex++;
                continue;
            }
            if (currentWord.length >= 4 && /^[glpt]/.test(currentWord)) {
                const potentialType = currentWord.substring(1);
                if (typeAbbreviations.has(potentialType)) {
                    startIndex++;
                    continue;
                }
            }
            break;
        }

        let remainingWords = startIndex < words.length ? words.slice(startIndex) : [words[words.length - 1]];
        const normalizedExpected = expectedPrefix.toLowerCase().replace(/_/g, '');
        
        while (remainingWords.length > 1) {
            const firstWordNormalized = remainingWords[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedExpected.includes(firstWordNormalized)) {
                remainingWords.shift(); 
            } else {
                break;
            }
        }

        cleanBase = remainingWords.join('_');
        return cleanBase;
    }

    if (/^[glpt][A-Z]/.test(cleanBase)) {
        cleanBase = cleanBase.substring(1);
    }
    if (/^[glpt]Rec[A-Z]/.test(cleanBase)) {
        cleanBase = cleanBase.substring(4);
    }
    if (/^Temp[A-Z]/i.test(cleanBase)) {
        cleanBase = cleanBase.substring(4);
    }

    if (cleanBase.length === 0) {
        return currentName;
    }
    return cleanBase;
}

// =========================================================================
// 🎯 CÁC HÀM PHÂN TÁCH XỬ LÝ CHUYÊN BIỆT (MODULAR PROCESSORS)
// =========================================================================

function validateObjects(text, objectPrefixText, document, diagnostics) {
    const lines = text.split('\n');
    const objectRegex = /^(?:table|page|codeunit|report|query|xmlport|tableextension|pageextension)\s+\d+\s+([a-zA-Z0-9_"]+)/i;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        const match = objectRegex.exec(line);
        if (match) {
            let objName = match[1].replace(/"/g, '');
            if (!objName.startsWith(objectPrefixText)) {
                const suggestedFix = objectPrefixText + objName;
                const startChar = line.indexOf(match[1]);
                if (startChar !== -1) {
                    const range = new vscode.Range(new vscode.Position(i, startChar), new vscode.Position(i, startChar + match[1].length));
                    const diag = new vscode.Diagnostic(range, `AL Convention: Object name '${objName}' must start with '${objectPrefixText}'`, vscode.DiagnosticSeverity.Warning);
                    diag.code = 'AL_CONV_OBJ';
                    diag.suggestedFix = suggestedFix;
                    diagnostics.push(diag);
                }
            }
        }
    }
}

function validateProcedures(text, namingStyle, document, diagnostics) {
    const lines = text.split('\n');
    const procRegex = /(?:local\s+|internal\s+)?procedure\s+([a-zA-Z0-9_]+)\(/i;
    const procStyle = namingStyle['procedure'] || 'PascalCase';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        const match = procRegex.exec(line);
        if (match) {
            const procName = match[1];
            if (!checkNamingStyle(procName, procStyle)) {
                const suggestedFix = formatBaseName(procName, procStyle);
                const startChar = line.indexOf(procName);
                if (startChar !== -1) {
                    const range = new vscode.Range(new vscode.Position(i, startChar), new vscode.Position(i, startChar + procName.length));
                    const diag = new vscode.Diagnostic(range, `AL Convention: Procedure name '${procName}' must comply with ${procStyle}`, vscode.DiagnosticSeverity.Warning);
                    diag.code = 'AL_CONV_PROC';
                    diag.suggestedFix = suggestedFix;
                    diagnostics.push(diag);
                }
            }
        }
    }
}
// =========================================================================
// 🚀 HÀM ĐIỀU PHỐI CHÍNH (MAIN COORDINATOR)
// =========================================================================

function reviewALCode(document, collection) {
    if (document.languageId !== 'al' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) { 
        return; 
    }

    const diagnostics = [];
    const text = document.getText();

    const config = vscode.workspace.getConfiguration('alConvention', document.uri);
    const alObjectPrefix = config.get('alObjectPrefix') || 'ALE';
    const namingStyle = config.get('namingStyle') || {};
    const showShortTypeInName = config.get('showShortTypeInName') !== undefined ? config.get('showShortTypeInName') : true;
    const typeAbbreviations = config.get('typeAbbreviations') || {};
    const scopePrefixes = config.get('scopePrefixes') || {};
        const temporaryRecordPrefix = config.get('temporaryRecordPrefix') || '';

    const expectedPrefixHelpers = {
        pPrefix: scopePrefixes['ProcedureParameter'] || '',
            tempPrefix: temporaryRecordPrefix,
        gPrefix: scopePrefixes['globalVariablePrefix'] || '',
        lPrefix: scopePrefixes['localVariablePrefix'] || '',
        tempPrefixBeforeScope: config.get('temporaryPrefixBeforeScope') !== undefined ? config.get('temporaryPrefixBeforeScope') : true,
        getShortType: (fullType) => {
            if (!showShortTypeInName) return '';
            return typeAbbreviations[fullType] || typeAbbreviations[fullType.charAt(0).toUpperCase() + fullType.slice(1).toLowerCase()] || fullType.toLowerCase().substring(0, 3);
        }
    };

    const paramStyle = namingStyle['parameter'] || 'PascalCase';
    const localVarStyle = namingStyle['local_variable'] || 'PascalCase';
    const globalVarStyle = namingStyle['global_variable'] || 'PascalCase';

    validateObjects(text, alObjectPrefix, document, diagnostics);
    validateProcedures(text, namingStyle, document, diagnostics);
    validateParameters(text, namingStyle, paramStyle, expectedPrefixHelpers, document, diagnostics);
    validateVariables(text, namingStyle, localVarStyle, globalVarStyle, expectedPrefixHelpers, document, diagnostics);

    collection.set(document.uri, diagnostics);
}

function validateVariables(text, namingStyle, localVarStyle, globalVarStyle, expectedPrefixHelpers, document, diagnostics) {
    const lines = text.split('\n');
    let currentScope = 'global'; 
    
    let isInsideProcedureSignature = false; 
    let procedureBaseIndent = 0; // 🌟 Lưu độ thụt lề gốc của Procedure hiện tại

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        const trimmedLine = line.trim().toLowerCase();

        // 1. Nhận diện điểm BẮT ĐẦU của một Procedure hoặc Trigger
        if (/(?:local\s+|internal\s+)?procedure\s+/i.test(line) || /\btrigger\s+[a-zA-Z0-9_]+\(/i.test(line)) {
            currentScope = 'local';
            isInsideProcedureSignature = true; 
            
            // 🌟 ĐO ĐỘ THỤT LỀ GỐC: Đếm số lượng khoảng trắng/tab ở đầu dòng khai báo hàm
            const indentMatch = line.match(/^(\s*)/);
            procedureBaseIndent = indentMatch ? indentMatch[1].length : 0;
            
            continue; // Bỏ qua dòng signature
        }

        // 2. Nhận diện điểm KẾT THÚC của Signature dựa trên từ khóa VÀ ĐỘ THỤT LỀ (Indent)
        if (isInsideProcedureSignature) {
            // Tính độ thụt lề của dòng hiện tại
            const currentIndentMatch = line.match(/^(\s*)/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[1].length : 0;

            // Điều kiện dứt khoát: Gặp 'var' hoặc 'begin' VÀ phải thẳng hàng (hoặc nằm ngoài) cấp độ của procedure gốc
            if (trimmedLine === 'var' || trimmedLine.startsWith('var ') || trimmedLine === 'begin' || trimmedLine.startsWith('begin ')) {
                if (currentIndent <= procedureBaseIndent) {
                    isInsideProcedureSignature = false; // Hạ cờ chặn quét biến thành công!
                    continue; // Bỏ qua dòng 'var' hoặc 'begin' này
                }
            }
            
            // Nếu cờ vẫn bật, dòng này an toàn thuộc về tham số -> CẤM QUÉT BIẾN
            continue; 
        }
        
        // 3. Trở về global nếu gặp dấu đóng khối hẳn của Procedure/Trigger bằng end; hoặc đóng khối Object }
        if (trimmedLine.startsWith('end;') || trimmedLine === '}') {
            currentScope = 'global';
            isInsideProcedureSignature = false;
        }

        // 4. Tiến hành quét cấu trúc biến (Bảo đảm không bị giẫm chân lên parameter dù viết kiểu gì)
        const varMatch = /^\s*([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_\[\]" ]+)/.exec(line);
        if (varMatch) {
            const vName = varMatch[1];
            const fullTypeString = varMatch[2].trim();
            const vType = fullTypeString.split(' ')[0].split('[')[0].replace(/"/g, '');
            const shortType = expectedPrefixHelpers.getShortType(vType);

            let isTemp = /\btemporary\b/i.test(line);
            if (!isTemp && i + 1 < lines.length) {
                if (/^\s*IsTemporary\s*=\s*true\s*;/i.test(lines[i + 1])) {
                    isTemp = true;
                }
            }

            const isLocal = (currentScope === 'local'); 
            const prefixChar = isLocal ? expectedPrefixHelpers.lPrefix : expectedPrefixHelpers.gPrefix;
            const currentStyle = isLocal ? localVarStyle : globalVarStyle;

            let expectedPrefix = '';
            if (currentStyle === 'PascalCase') {
                if (isTemp) {
                    expectedPrefix = expectedPrefixHelpers.tempPrefixBeforeScope
                        ? `${capitalize(expectedPrefixHelpers.tempPrefix)}${capitalize(prefixChar)}${capitalize(shortType)}`
                        : `${capitalize(prefixChar)}${capitalize(expectedPrefixHelpers.tempPrefix)}${capitalize(shortType)}`;
                } else {
                    expectedPrefix = `${capitalize(prefixChar)}${capitalize(shortType)}`;
                }
            } else {
                if (isTemp) {
                    expectedPrefix = expectedPrefixHelpers.tempPrefixBeforeScope
                        ? `${expectedPrefixHelpers.tempPrefix}${prefixChar}${shortType}_`
                        : `${prefixChar}${expectedPrefixHelpers.tempPrefix}${shortType}_`;
                } else {
                    expectedPrefix = `${prefixChar}${shortType}_`;
                }
            }
            
            const cleanBase = extractPureBaseName(vName, expectedPrefix);
            let formattedBase = formatBaseName(cleanBase, currentStyle);
            formattedBase = cleanDoubleTypePrefix(expectedPrefix, formattedBase, currentStyle);
            const suggestedFix = expectedPrefix + formattedBase;

            if (vName !== suggestedFix) {
                const startChar = line.indexOf(vName);
                if (startChar !== -1) {
                    const range = new vscode.Range(new vscode.Position(i, startChar), new vscode.Position(i, startChar + vName.length));
                    const diag = new vscode.Diagnostic(range, `AL Convention: Variable '${vName}' must use format '${suggestedFix}'`, vscode.DiagnosticSeverity.Warning);
                    diag.code = 'AL_CONV_VAR';
                    diag.suggestedFix = suggestedFix;
                    diagnostics.push(diag);
                }
            }
        }
    }
}
function validateParameters(text, namingStyle, paramStyle, expectedPrefixHelpers, document, diagnostics) {
    const textLines = text.split('\n');
    let inEventSubscriber = false;

    for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i];
        
        // 1. Bỏ qua nếu là dòng comment
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        // Bật cờ nếu là EventSubscriber (Để skip bảo vệ luật Microsoft)
        if (/^\s*\[EventSubscriber\(/i.test(line)) {
            inEventSubscriber = true;
        }

        // 2. Nhận diện dòng chứa từ khóa procedure
        if (/(?:local\s+|internal\s+)?procedure\s+/i.test(line)) {
            const procIndex = line.indexOf('procedure');
            const commentIndex = line.indexOf('//');
            if (commentIndex !== -1 && commentIndex < procIndex) continue;

            if (inEventSubscriber) {
                inEventSubscriber = false; 
                continue; 
            }
            inEventSubscriber = false; 

            // 3. XỬ LÝ ĐA DÒNG: Thu thập toàn bộ block chứa tham số nằm trong cặp ngoặc (...)
            // Phòng trường hợp danh sách tham số dài và bị lập trình viên xuống hàng
            let fullSignature = line;
            let targetLineIndex = i;
            let openBraceIndex = line.indexOf('(');
            
            // Nếu dòng hiện tại không chứa dấu đóng ngoặc ')', ta gom dòng tiếp theo vào để phân tích
            let j = i;
            while (!fullSignature.includes(')') && j + 1 < textLines.length) {
                j++;
                fullSignature += ' ' + textLines[j];
            }

            const paramMatch = /\(([^)]*)\)/.exec(fullSignature);
            if (!paramMatch || !paramMatch[1].trim()) continue;

            const paramBlock = paramMatch[1];
            
            // 🌟 TÁCH CÁC PARAMETER BẰNG DẤU CHẤM PHẨY CHUẨN XÁC
            const actualParams = paramBlock.split(';');
            
            actualParams.forEach(param => {
                const parts = param.split(':');
                if (parts.length === 2) {
                    let pName = parts[0].replace(/var\s+/i, '').trim();
                    let fullTypeString = parts[1].trim();
                    
                    const isTemp = /\btemporary\b/i.test(fullTypeString);
                    let pType = fullTypeString.split(' ')[0].split('[')[0].replace(/"/g, '');
                    const shortType = expectedPrefixHelpers.getShortType(pType);

                    let expectedPrefix = '';
                    if (paramStyle === 'PascalCase') {
                        if (isTemp) {
                            expectedPrefix = expectedPrefixHelpers.tempPrefixBeforeScope 
                                ? `${capitalize(expectedPrefixHelpers.tempPrefix)}${capitalize(expectedPrefixHelpers.pPrefix)}${capitalize(shortType)}`
                                : `${capitalize(expectedPrefixHelpers.pPrefix)}${capitalize(expectedPrefixHelpers.tempPrefix)}${capitalize(shortType)}`;
                        } else {
                            expectedPrefix = `${capitalize(expectedPrefixHelpers.pPrefix)}${capitalize(shortType)}`;
                        }
                    } else {
                        if (isTemp) {
                            expectedPrefix = expectedPrefixHelpers.tempPrefixBeforeScope
                                ? `${expectedPrefixHelpers.tempPrefix}${expectedPrefixHelpers.pPrefix}${shortType}_`
                                : `${expectedPrefixHelpers.pPrefix}${expectedPrefixHelpers.tempPrefix}${shortType}_`;
                        } else {
                            expectedPrefix = `${expectedPrefixHelpers.pPrefix}${shortType}_`;
                        }
                    }

                    const cleanBase = extractPureBaseName(pName, expectedPrefix);
                    let formattedBase = formatBaseName(cleanBase, paramStyle);
                    formattedBase = cleanDoubleTypePrefix(expectedPrefix, formattedBase, paramStyle);
                    const suggestedFix = expectedPrefix + formattedBase;

                    if (pName !== suggestedFix) {
                        // 🌟 TÌM DÒNG THỰC TẾ CHỨA PARAMETER LỖI (Để hiển thị dấu lượn sóng đúng vị trí)
                        let foundLine = i;
                        let startChar = -1;
                        
                        for (let k = i; k <= j; k++) {
                            startChar = textLines[k].indexOf(pName);
                            if (startChar !== -1) {
                                foundLine = k;
                                break;
                            }
                        }

                        if (startChar !== -1) {
                            const range = new vscode.Range(new vscode.Position(foundLine, startChar), new vscode.Position(foundLine, startChar + pName.length));
                            const diag = new vscode.Diagnostic(range, `AL Convention: Parameter '${pName}' must use format '${suggestedFix}'`, vscode.DiagnosticSeverity.Warning);
                            diag.code = 'AL_CONV_PARAM';
                            diag.suggestedFix = suggestedFix;
                            diagnostics.push(diag);
                        }
                    }
                }
            });
            
            // Cập nhật bước nhảy vòng lặp lớn nếu signature kéo dài nhiều dòng
            i = j;
        }
    }
}
function deactivate() {}

module.exports = { activate, deactivate };
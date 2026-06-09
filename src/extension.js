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
            providedCodeActionKinds: [
                vscode.CodeActionKind.QuickFix,
                vscode.CodeActionKind.SourceFixAll
            ]
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('al', new ALVariableCompletionProvider(), ':', ' ', ',')
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

    context.subscriptions.push(
        vscode.commands.registerCommand('alConvention.fixAllNaming', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return vscode.window.showInformationMessage('No active editor.');
            }

            const doc = editor.document;
            if (doc.languageId !== 'al') {
                return vscode.window.showInformationMessage('Active editor is not an AL file.');
            }

            let diagnostics = diagnosticCollection.get(doc.uri) || [];
            let fixableDiagnostics = diagnostics.filter(d => d.code && d.code.toString().startsWith('AL_CONV_') && d.suggestedFix);

            if (fixableDiagnostics.length === 0) {
                return vscode.window.showInformationMessage('No naming issues found in the active editor.');
            }

            // We process fixes one by one and re-evaluate to avoid shifting ranges
            let maxIterations = fixableDiagnostics.length * 2;
            let issueFixed = true;

            while (issueFixed && maxIterations > 0) {
                issueFixed = false;
                maxIterations--;

                diagnostics = diagnosticCollection.get(doc.uri) || [];
                fixableDiagnostics = diagnostics.filter(d => d.code && d.code.toString().startsWith('AL_CONV_') && d.suggestedFix);

                if (fixableDiagnostics.length > 0) {
                    const diagnostic = fixableDiagnostics[0];
                    await vscode.commands.executeCommand('alConvention.fixNaming', doc.uri, diagnostic.range, diagnostic.suggestedFix);
                    
                    // Manually re-trigger validation immediately to update diagnostics for the next iteration
                    reviewALCode(doc, diagnosticCollection);
                    issueFixed = true;
                }
            }

            vscode.window.showInformationMessage('AL Convention: Quick Fix All completed.');
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
            
        // Provide "Fix All" action if applicable or explicitly requested
        const isFixAll = context.only && context.only.contains(vscode.CodeActionKind.SourceFixAll);
        if (actions.length > 0 || isFixAll) {
            const fixAllAction = new vscode.CodeAction(
                'Fix all AL naming convention issues',
                vscode.CodeActionKind.SourceFixAll
            );
            fixAllAction.command = {
                command: 'alConvention.fixAllNaming',
                title: fixAllAction.title,
                arguments: []
            };
            actions.push(fixAllAction);
        }

        return actions;
    }
}

class ALScopeAnalyzer {
    static getActiveScope(document, position) {
        const textBeforeCursor = document.getText(new vscode.Range(0, 0, position.line, position.character));

        const cleanText = textBeforeCursor
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '')
            .replace(/'[^']*'/g, "''");

        const lastOpenParen = cleanText.lastIndexOf('(');
        const lastCloseParen = cleanText.lastIndexOf(')');
        if (lastOpenParen > lastCloseParen) {
            const textBeforeParen = cleanText.substring(0, lastOpenParen).trim();
            if (/(?:procedure|trigger)\s+[a-zA-Z0-9_]+\s*$/i.test(textBeforeParen)) {
                return 'PARAMETER';
            }
        }

        const lastVar = cleanText.lastIndexOf('var');
        const lastBegin = cleanText.lastIndexOf('begin');

        if (lastVar !== -1) {
            if (lastBegin > lastVar) {
                return 'UNKNOWN';
            }

            const lastProcedure = Math.max(cleanText.lastIndexOf('procedure'), cleanText.lastIndexOf('trigger'));
            if (lastProcedure !== -1 && lastProcedure < lastVar) {
                return 'LOCAL_VARIABLE';
            }

            if (this.isInsideExclusionBlock(cleanText)) {
                return 'INVALID';
            }
            return 'GLOBAL_VARIABLE';
        }

        return 'UNKNOWN';
    }

    static isInsideExclusionBlock(text) {
        const exclusionRegex = /\b(fields|keys|fieldgroups|layout|actions|dataset|requestpage|elements|schema)\b\s*\{/gi;
        let match;
        let lastExclusionIndex = -1;
        while ((match = exclusionRegex.exec(text)) !== null) {
            lastExclusionIndex = match.index;
        }

        if (lastExclusionIndex === -1) return false;

        const textAfterExclusion = text.substring(lastExclusionIndex);
        let braceCount = 0;
        for (let i = 0; i < textAfterExclusion.length; i++) {
            if (textAfterExclusion[i] === '{') braceCount++;
            if (textAfterExclusion[i] === '}') braceCount--;
        }
        return braceCount > 0;
    }
}

class ALVariableCompletionProvider {
    provideCompletionItems(document, position, token, context) {
        const scope = ALScopeAnalyzer.getActiveScope(document, position);
        if (!scope || scope === 'UNKNOWN' || scope === 'INVALID') return undefined;

        const lineText = document.lineAt(position.line).text;
        const completions = [];

        const colonIndex = lineText.indexOf(':');

        if (colonIndex !== -1 && position.character <= colonIndex) {
            let rightSide = lineText.substring(colonIndex + 1).trim();
            if (rightSide.endsWith(';')) rightSide = rightSide.slice(0, -1).trim();

            const typeMatch = /^(Record|Codeunit|Report|Page|Query|XmlPort|Enum)\s+"?([a-zA-Z0-9_ ]+)"?/i.exec(rightSide);

            if (typeMatch) {
                const objectName = typeMatch[2].replace(/"/g, '').trim();
                let suggestedName = objectName.replace(/[^a-zA-Z0-9]/g, '');

                if (scope === 'PARAMETER') {
                    suggestedName = `p${suggestedName}`;
                } else if (scope === 'LOCAL_VARIABLE') {
                    suggestedName = `l${suggestedName}`;
                } else if (scope === 'GLOBAL_VARIABLE') {
                    suggestedName = `g${suggestedName}`;
                }

                if (rightSide.toLowerCase().includes('temporary')) {
                    suggestedName = `Temp${suggestedName}`;
                }

                const item = new vscode.CompletionItem(suggestedName, vscode.CompletionItemKind.Variable);
                item.detail = `Auto-suggested ${scope} name (AL Convention)`;
                item.insertText = suggestedName;
                completions.push(item);
            }
        }

        return completions;
    }
}

function toSnakeCase(str) {
    if (!str) return '';
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/__+/g, '_')
        .toLowerCase();
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
        case 'snake_case':
            return /^[a-z0-9_]+$/.test(str) && !/[A-Z]/.test(str);
        case 'camelCase':
            return /^[a-z0-9]+([A-Z0-9][a-z0-9]*)*$/.test(str);
        case 'PascalCase':
            return /^[A-Z0-9][a-z0-9]*([A-Z0-9][a-z0-9]*)*$/.test(str);
        default:
            return true;
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
            'rec', 'cu', 'pag', 'que', 'rep', 'int', 'txt', 'cod', 'boo', 'dec', 'guid', 'dat', 'opt', 'code', 'job', 'jar', 'jtk'
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
        return remainingWords.join('_');
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

function validateParameters(text, namingStyle, paramStyle, expectedPrefixHelpers, document, diagnostics) {
    const textLines = text.split('\n');
    let inEventSubscriber = false;

    for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i];
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        if (/^\s*\[EventSubscriber\(/i.test(line)) {
            inEventSubscriber = true;
        }

        if (/(?:local\s+|internal\s+)?procedure\s+/i.test(line)) {
            const procIndex = line.indexOf('procedure');
            const commentIndex = line.indexOf('//');
            if (commentIndex !== -1 && commentIndex < procIndex) continue;

            if (inEventSubscriber) {
                inEventSubscriber = false;
                continue;
            }
            inEventSubscriber = false;

            let fullSignature = line;
            let j = i;
            while (!fullSignature.includes(')') && j + 1 < textLines.length) {
                j++;
                fullSignature += ' ' + textLines[j];
            }

            const paramMatch = /\(([^)]*)\)/.exec(fullSignature);
            if (!paramMatch || !paramMatch[1].trim()) continue;

            const paramBlock = paramMatch[1];
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
                        let foundLine = i;
                        let startChar = -1;

                        for (let k = i; k <= j; k++) {
                            const currentLineText = textLines[k];
                            const searchStartIndex = currentLineText.includes('(') ? currentLineText.indexOf('(') + 1 : 0;

                            startChar = currentLineText.indexOf(pName, searchStartIndex);
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
            i = j;
        }
    }
}

function validateProcedures(text, namingStyle, document, diagnostics) {
    const lines = text.split('\n');
    const procRegex = /(?:local\s+|internal\s+)?procedure\s+([a-zA-Z0-9_]+)\s*\(/i;
    const procStyle = namingStyle['procedure'] || 'snake_case';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        const match = procRegex.exec(line);
        if (match) {
            const procName = match[1];

            if (!checkNamingStyle(procName, procStyle)) {
                const suggestedFix = formatBaseName(procName, procStyle);

                const procKeywordIndex = line.indexOf('procedure');
                const startChar = line.indexOf(procName, procKeywordIndex);

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

function reviewALCode(document, collection) {
    if (document.languageId !== 'al' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
        return;
    }

    const diagnostics = [];
    const text = document.getText();

    const config = vscode.workspace.getConfiguration('alConvention', document.uri);
    const objectPrefixText = config.get('alObjectPrefix') || '';
    const namingStyle = config.get('namingStyle') || {};
    const showTypeInName = config.get('showShortTypeInName') !== undefined ? config.get('showShortTypeInName') : true;
    const typeNameMap = config.get('typeAbbreviations') || {};

    const typeNameMapLower = Object.keys(typeNameMap).reduce((acc, key) => {
        acc[key.toLowerCase()] = typeNameMap[key];
        return acc;
    }, {});
    const scopePrefixes = config.get('scopePrefixes') || {};
    const tempRecordPrefix = config.get('temporaryRecordPrefix') || 'temp_';
    const tempPrefixBeforeScope = config.get('temporaryPrefixBeforeScope') !== undefined ? config.get('temporaryPrefixBeforeScope') : false;

    const expectedPrefixHelpers = {
        pPrefix: scopePrefixes['ProcedureParameter'] || '',
        tempPrefix: tempRecordPrefix,
        gPrefix: scopePrefixes['globalVariablePrefix'] || '',
        lPrefix: scopePrefixes['localVariablePrefix'] || '',
        tempPrefixBeforeScope: tempPrefixBeforeScope,
        getShortType: (fullType) => {
            if (!showTypeInName) return '';
            const lowerType = fullType.toLowerCase().trim();

            if (typeNameMapLower[lowerType])
                return typeNameMapLower[lowerType];

            const defaultTypeMap = {
                'jsonobject': 'job', 'jsonarray': 'jar', 'jsontoken': 'jtk',
                'integer': 'int', 'text': 'txt', 'code': 'cod', 'record': 'rec', 'report': 'rep'
            };
            return defaultTypeMap[lowerType] || lowerType.substring(0, 3);
        }
    };

    const paramStyle = namingStyle['parameter'] || 'snake_case';
    const localVarStyle = namingStyle['local_variable'] || 'snake_case';
    const globalVarStyle = namingStyle['global_variable'] || 'snake_case';

    validateObjects(text, objectPrefixText, document, diagnostics);
    validateProcedures(text, namingStyle, document, diagnostics);
    validateParameters(text, namingStyle, paramStyle, expectedPrefixHelpers, document, diagnostics);
    validateVariables(text, namingStyle, localVarStyle, globalVarStyle, expectedPrefixHelpers, document, diagnostics);

    collection.set(document.uri, diagnostics);
}
function validateVariables(text, namingStyle, localVarStyle, globalVarStyle, expectedPrefixHelpers, document, diagnostics) {
    const lines = text.split('\n');
    let currentScope = 'global';
    let isInsideProcedureSignature = false;
    let procedureBaseIndent = 0;
    let scopeBaseIndent = 0; // 🌟 BỔ SUNG: Lưu độ thụt lề gốc của scope local hiện tại

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || line.trim().startsWith('//')) continue;

        const trimmedLine = line.trim().toLowerCase();

        // 1. Nhận diện điểm BẮT ĐẦU của Procedure hoặc Trigger
        if (/(?:local\s+|internal\s+)?procedure\s+/i.test(line) || /\btrigger\s+[a-zA-Z0-9_]+/i.test(line)) {
            currentScope = 'local';
            isInsideProcedureSignature = true;

            const indentMatch = line.match(/^(\s*)/);
            procedureBaseIndent = indentMatch ? indentMatch[1].length : 0;
            scopeBaseIndent = procedureBaseIndent; // Ghi nhớ độ thụt lề để đối chiếu end; sau này
            
            if (line.includes(')') && /\b(begin|var)\b/i.test(line)) {
                isInsideProcedureSignature = false;
            }
            continue;
        }

        // 2. Máy trạng thái Indent-Aware bảo vệ vùng parameter đa dòng
        if (isInsideProcedureSignature) {
            const currentIndentMatch = line.match(/^(\s*)/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[1].length : 0;

            const isBlockStart = trimmedLine === 'var' || trimmedLine === 'begin' || trimmedLine.startsWith('var ') || trimmedLine.startsWith('begin ');
            const isSignatureEndLine = line.includes(')') && !/(?:local\s+|internal\s+)?procedure\s+/i.test(line);

            if ((isBlockStart && currentIndent <= procedureBaseIndent) || isSignatureEndLine) {
                isInsideProcedureSignature = false;
                if (isSignatureEndLine) continue;
            }
            continue;
        }
        
        // 3. 🌟 NÂNG CẤP BẢO VỆ SCOPE: Trở về global khi kết thúc block thực tế của hàm/trigger
        if (trimmedLine.startsWith('end;') || trimmedLine === '}') {
            const currentIndentMatch = line.match(/^(\s*)/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[1].length : 0;
            
            // Nếu gặp end; thẳng hàng với trigger/procedure khai báo, hoặc lùi hẳn ra ngoài lề gốc
            if (currentScope === 'local' && currentIndent <= scopeBaseIndent) {
                currentScope = 'global';
            } else if (currentIndent === 0 || trimmedLine === '}') {
                currentScope = 'global';
            }
        }

        // 4. Bỏ qua các pattern của khối cấu hình option (Ví dụ: "0:", "1:", "'KinhDoanh':")
        if (/^\s*([0-9]+|'[A-Za-z0-9_]+'|[A-Za-z0-9_]+::[A-Za-z0-9_]+)\s*:/i.test(line)) {
            continue;
        }

        // 5. Quét cấu trúc khai báo biến
        const varMatch = /^\s*([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_\[\]" ]+)/.exec(line);
        if (varMatch) {
            const vName = varMatch[1];
            const fullTypeString = varMatch[2].trim();

            if (fullTypeString.startsWith('//')) continue;

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
            const currentStyle = isLocal ? (localVarStyle || 'snake_case') : (globalVarStyle || 'snake_case');

            // 1. Tách lấy tên gốc tinh khiết trước khi tính toán prefix nâng cao
            // Dùng cấu trúc tạm thời để bóc tách từ cũ
            const tempPrefixCheck = currentStyle === 'PascalCase' ? prefixChar : `${prefixChar}${shortType}_`;
            const cleanBase = extractPureBaseName(vName, tempPrefixCheck);

            let expectedPrefix = '';
            let formattedBase = '';
            let suggestedFix = '';

            if (currentStyle === 'PascalCase') {
                // 🌟 XỬ LÝ PASCAL CASE CHO BASE NAME TRƯỚC
                formattedBase = formatBaseName(cleanBase, currentStyle);

                // Gán expectedPrefix theo cấu hình hiện loại dữ liệu
                if (shortType === '') {
                    expectedPrefix = prefixChar; // Giữ nguyên chữ 'g' thường hoặc 'l' (Ví dụ: 'g')
                } else {
                    if (isTemp) {
                        expectedPrefix = expectedPrefixHelpers.tempPrefixBeforeScope
                            ? `${capitalize(expectedPrefixHelpers.tempPrefix)}${capitalize(prefixChar)}${capitalize(shortType)}`
                            : `${capitalize(prefixChar)}${capitalize(expectedPrefixHelpers.tempPrefix)}${capitalize(shortType)}`;
                    } else {
                        expectedPrefix = `${capitalize(prefixChar)}${capitalize(shortType)}`;
                    }
                }
                
                formattedBase = cleanDoubleTypePrefix(expectedPrefix, formattedBase, currentStyle);
                // Gắn tiền tố scope ra ngoài cùng sau khi tên biến đã thành PascalCase
                suggestedFix = expectedPrefix + formattedBase;
            } else {
                // Giữ nguyên luồng xử lý cũ của nhánh snake_case
                const cleanTempPrefix = expectedPrefixHelpers.tempPrefix.replace(/_/g, '');
                if (isTemp) {
                    expectedPrefix = expectedPrefixHelpers.tempPrefixBeforeScope
                        ? `${cleanTempPrefix}_${prefixChar}${shortType}_`
                        : `${prefixChar}${cleanTempPrefix}_${shortType}_`;
                } else {
                    expectedPrefix = `${prefixChar}${shortType}_`;
                }
                
                formattedBase = formatBaseName(cleanBase, currentStyle);
                suggestedFix = expectedPrefix + formattedBase;
            }

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
function deactivate() { }

module.exports = { activate, deactivate };
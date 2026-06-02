const vscode = require('vscode');

function activate(context) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('alConvention');
    context.subscriptions.push(diagnosticCollection);

    const runValidation = (doc) => reviewALCode(doc, diagnosticCollection);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(runValidation),
        vscode.workspace.onDidChangeTextDocument(e => runValidation(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration(() => {
            if (vscode.window.activeTextEditor) {
                runValidation(vscode.window.activeTextEditor.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('al', new ALActionProvider(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
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
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, diagnostic.range, diagnostic.suggestedFix);
                    fixAction.edit = edit;
                    fixAction.isPreferred = true;
                    actions.push(fixAction);
                }
            });
        return actions;
    }
}

function toSnakeCase(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function toCamelCase(str) {
    const pascal = toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toPascalCase(str) {
    if (!str) return '';
    
    // Nếu chuỗi có chứa dấu gạch dưới (snake_case) hoặc viết thường hết, xử lý tách từ chuẩn
    if (str.includes('_') || str === str.toLowerCase()) {
        return str
            .replace(/[^a-zA-Z0-9]/g, ' ')
            .split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join('');
    }
    
    // [SỬA TẠI ĐÂY]: Nếu chuỗi đã ở dạng camelCase hoặc PascalCase sẵn (ví dụ: SourceDate)
    // Chỉ cần viết hoa chữ cái đầu tiên và GIỮ NGUYÊN các chữ viết hoa ở giữa chuỗi.
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0) + str.slice(1);
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

function reviewALCode(document, collection) {
    if (document.languageId !== 'al') { return; }

    const diagnostics = [];
    const text = document.getText();

    // MAP CHUẨN FILE CONFIG JSON CỦA USER
    const config = vscode.workspace.getConfiguration('alConvention', document.uri);
    const objectPrefixText = config.get('objectPrefixText') || 'ALE';
    
    const namingStyle = config.get('NamingStyle') || {};
    const showTypeInName = config.get('ProcedureParameter.ShowTypeInName') !== undefined ? config.get('ProcedureParameter.ShowTypeInName') : true;
    const typeNameMap = config.get('ProcedureParameter.TypeName') || {};
    const objectPrefix = config.get('ObjectPrefix') || {};

    const pPrefix = objectPrefix['ProcedureParameter'] || 'p';
    const tempPrefix = objectPrefix['temporaryPrefix'] || 'temp';
    const gPrefix = objectPrefix['globalVariablePrefix'] || '';
    const lPrefix = objectPrefix['localVariablePrefix'] || '';

    const getShortType = (fullType) => {
        if (!showTypeInName) return '';
        return typeNameMap[fullType] || typeNameMap[fullType.charAt(0).toUpperCase() + fullType.slice(1).toLowerCase()] || fullType.toLowerCase().substring(0, 3);
    };

    // -------------------------------------------------------------------------
    // 1. OBJECT NAME VALIDATION
    // -------------------------------------------------------------------------
    const objectRegex = /^(table|page|codeunit|report|query|xmlport|tableextension|pageextension)\s+\d+\s+([a-zA-Z0-9_"]+)/gm;
    let match;
    while ((match = objectRegex.exec(text)) !== null) {
        let objName = match[2].replace(/"/g, '');
        if (!objName.startsWith(objectPrefixText)) {
            const suggestedFix = objectPrefixText + objName;
            createDiagnostic(match, objName, `Object name '${objName}' must start with '${objectPrefixText}'`, document, diagnostics, 'AL_CONV_OBJ', suggestedFix);
        }
    }

    // -------------------------------------------------------------------------
    // 2. PROCEDURE NAME VALIDATION
    // -------------------------------------------------------------------------
    const procRegex = /(?:local\s+|internal\s+)?procedure\s+([a-zA-Z0-9_]+)\(/gm;
    const procStyle = namingStyle['procedure'] || 'PascalCase';
    while ((match = procRegex.exec(text)) !== null) {
        const procName = match[1];
        if (!checkNamingStyle(procName, procStyle)) {
            const suggestedFix = formatBaseName(procName, procStyle);
            createDiagnostic(match, procName, `Procedure name '${procName}' must comply with ${procStyle}`, document, diagnostics, 'AL_CONV_PROC', suggestedFix);
        }
    }

    // -------------------------------------------------------------------------
    // 3. PARAMETER VALIDATION & QUICK FIX (VÁ LỖI NUỐT TÊN PARAMETER)
    // -------------------------------------------------------------------------
    const paramBlockRegex = /procedure\s+[a-zA-Z0-9_]+\(([^)]*)\)/gm;
    const paramStyle = namingStyle['parameter'] || 'PascalCase';
    while ((match = paramBlockRegex.exec(text)) !== null) {
        const paramBlock = match[1];
        if (!paramBlock.trim()) continue;

        const params = paramBlockRegex.exec ? paramBlock.split(';') : []; // Bảo vệ vòng lặp nếu có lỗi split
        const actualParams = paramBlock.split(';');
        
        actualParams.forEach(param => {
            const parts = param.split(':');
            if (parts.length === 2) {
                let pName = parts[0].replace(/var\s+/i, '').trim();
                let fullTypeString = parts[1].trim();
                
                const isTemp = /\btemporary\b/i.test(fullTypeString);
                let pType = fullTypeString.split(' ')[0].split('[')[0].replace(/"/g, '');
                const shortType = getShortType(pType);

                let expectedPrefix = '';
                if (paramStyle === 'PascalCase') {
                    expectedPrefix = isTemp ? `${capitalize(tempPrefix)}${capitalize(pPrefix)}${capitalize(shortType)}` : `${capitalize(pPrefix)}${capitalize(shortType)}`;
                } else {
                    expectedPrefix = isTemp ? `${tempPrefix}${pPrefix}${shortType}_` : `${pPrefix}${shortType}_`;
                }

                // [SỬA TẠI ĐÂY]: Logic bóc tách chuẩn đoán, chống nuốt tên gốc của Parameter
                let cleanBase = pName;
                if (pName.startsWith(expectedPrefix)) {
                    cleanBase = pName.substring(expectedPrefix.length);
                } else {
                    // Nếu tham số bắt đầu bằng chữ p hoặc var p nhưng viết theo kiểu Pascal/Camel (Ví dụ: pInt, pCustomer)
                    if (/^[glpt][A-Z]/.test(cleanBase)) {
                        cleanBase = cleanBase.substring(1);
                    }
                    // Loại bỏ tiền tố lỗi có dấu gạch dưới (Ví dụ: p_..., pint_...)
                    cleanBase = cleanBase.replace(/^([a-zA-Z0-9]+_)/, '');
                    
                    // Nếu lỡ cắt hết sạch chữ thì trả lại tên ban đầu để bảo toàn cấu trúc
                    if (cleanBase.length === 0) {
                        cleanBase = pName;
                    }
                }

                const formattedBase = formatBaseName(cleanBase, paramStyle);
                const suggestedFix = expectedPrefix + formattedBase;

                if (pName !== suggestedFix) {
                    const startOffset = match.index + match[0].indexOf(pName);
                    const range = new vscode.Range(document.positionAt(startOffset), document.positionAt(startOffset + pName.length));
                    const diag = new vscode.Diagnostic(range, `AL Convention: Parameter '${pName}' must use format '${suggestedFix}'`, vscode.DiagnosticSeverity.Warning);
                    diag.code = 'AL_CONV_PARAM';
                    diag.suggestedFix = suggestedFix;
                    diagnostics.push(diag);
                }
            }
        });
    }
// -------------------------------------------------------------------------
    // 4. LOCAL & GLOBAL VARIABLES VALIDATION & QUICK FIX (BỔ SUNG TRIGGER SCOPE)
    // -------------------------------------------------------------------------
    const lines = text.split('\n');
    const localVarStyle = namingStyle['local_variable'] || 'PascalCase';
    const globalVarStyle = namingStyle['global_variable'] || 'PascalCase';

    let currentScope = 'global'; 

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // [SỬA TẠI ĐÂY]: Khớp cả trường hợp khai báo procedure lẫn trigger nội bộ
        if (/(?:local\s+|internal\s+)?procedure\s+/i.test(line) || /\btrigger\s+[a-zA-Z0-9_]+\(/i.test(line)) {
            currentScope = 'local';
        }
        
        // Trở về global nếu gặp dấu đóng khối Object hoặc khi kết thúc một trigger/procedure bằng end;
        if (/^\s*end\s*;\s*$/i.test(line) || /^\s*\}\s*$/.test(line)) {
            currentScope = 'global';
        }

        const varMatch = /^\s*([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_\[\]" ]+)/.exec(line);
        
        if (varMatch) {
            const vName = varMatch[1];
            const fullTypeString = varMatch[2].trim();
            const vType = fullTypeString.split(' ')[0].split('[')[0].replace(/"/g, '');
            const shortType = getShortType(vType);

            let isTemp = /\btemporary\b/i.test(line);
            if (!isTemp && i + 1 < lines.length) {
                if (/^\s*IsTemporary\s*=\s*true\s*;/i.test(lines[i + 1])) {
                    isTemp = true;
                }
            }

            const isLocal = (currentScope === 'local'); 
            const prefixChar = isLocal ? lPrefix : gPrefix;
            const currentStyle = isLocal ? localVarStyle : globalVarStyle;

            let expectedPrefix = '';
            if (currentStyle === 'PascalCase') {
                expectedPrefix = isTemp ? `${capitalize(tempPrefix)}${capitalize(prefixChar)}${capitalize(shortType)}` : `${capitalize(prefixChar)}${capitalize(shortType)}`;
            } else {
                expectedPrefix = isTemp ? `${tempPrefix}${prefixChar}${shortType}_` : `${prefixChar}${shortType}_`;
            }
            
            // Logic bóc tách bảo vệ base name
            let cleanBase = vName;
            if (vName.startsWith(expectedPrefix)) {
                cleanBase = vName.substring(expectedPrefix.length);
            } else {
                if (/^[glpt][A-Z]/.test(cleanBase)) {
                    cleanBase = cleanBase.substring(1);
                }
                cleanBase = cleanBase.replace(/^([a-zA-Z0-9]+_)/, '');
                
                if (cleanBase.length === 0) {
                    cleanBase = vName;
                }
            }

            const formattedBase = formatBaseName(cleanBase, currentStyle);
            const suggestedFix = expectedPrefix + formattedBase;

            if (vName !== suggestedFix) {
                const startChar = line.indexOf(vName);
                const range = new vscode.Range(new vscode.Position(i, startChar), new vscode.Position(i, startChar + vName.length));
                const diag = new vscode.Diagnostic(range, `AL Convention: Variable '${vName}' must use format '${suggestedFix}'`, vscode.DiagnosticSeverity.Warning);
                diag.code = 'AL_CONV_VAR';
                diag.suggestedFix = suggestedFix;
                diagnostics.push(diag);
            }
        }
    }
    collection.set(document.uri, diagnostics);
}

function createDiagnostic(match, targetString, message, document, diagnostics, code, suggestedFix = null) {
    const startPos = document.positionAt(match.index + match[0].indexOf(targetString));
    const endPos = document.positionAt(match.index + match[0].indexOf(targetString) + targetString.length);
    const range = new vscode.Range(startPos, endPos);
    const diagnostic = new vscode.Diagnostic(range, `AL Convention: ${message}`, vscode.DiagnosticSeverity.Warning);
    diagnostic.code = code;
    if (suggestedFix) {
        diagnostic.suggestedFix = suggestedFix;
    }
    diagnostics.push(diagnostic);
}

function deactivate() {}

module.exports = { activate, deactivate };
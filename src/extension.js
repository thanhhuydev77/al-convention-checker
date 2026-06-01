const vscode = require('vscode');

function activate(context) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('alConvention');
    context.subscriptions.push(diagnosticCollection);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => reviewALCode(doc, diagnosticCollection)),
        vscode.workspace.onDidChangeTextDocument(e => reviewALCode(e.document, diagnosticCollection)),
        vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (vscode.window.activeTextEditor) {
                reviewALCode(vscode.window.activeTextEditor.document, diagnosticCollection);
            }
        })
    );

    if (vscode.window.activeTextEditor) {
        reviewALCode(vscode.window.activeTextEditor.document, diagnosticCollection);
    }
}

function checkNamingStyle(str, style) {
    if (!str) return true;
    switch (style) {
        case 'snake_case':
            return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(str);
        case 'camelCase':
            return /^[a-z0-9]+([A-Z0-9][a-z0-9]*)*$/.test(str);
        case 'PascalCase':
            return /^[A-Z0-9][a-z0-9]*([A-Z0-9][a-z0-9]*)*$/.test(str);
        default:
            return true;
    }
}

function reviewALCode(document, collection) {
    if (document.languageId !== 'al') { return; }

    const diagnostics = [];
    const text = document.getText();

    // FETCH DYNAMIC SETTINGS FROM CONFIGURATION
    const config = vscode.workspace.getConfiguration('alConvention');
    const objectPrefix = config.get('objectPrefix') || 'ATL_';
    const tempConfigPrefix = config.get('temporaryPrefix') !== undefined ? config.get('temporaryPrefix') : 'temp';
    const typeMapping = config.get('typeMapping') || {};
    const namingStyles = config.get('namingStyles') || {};

    // Build the correct temporary infix block (e.g., "temp_" or "tmp_" or "")
    const tempMiddleFix = tempConfigPrefix ? `${tempConfigPrefix}_` : '';

    const getShortType = (fullType) => {
        return typeMapping[fullType] || typeMapping[fullType.charAt(0).toUpperCase() + fullType.slice(1).toLowerCase()] || fullType.toLowerCase().substring(0, 3);
    };

    // -------------------------------------------------------------------------
    // 1. OBJECT NAME VALIDATION
    // -------------------------------------------------------------------------
    const objectRegex = /^(table|page|codeunit|report|query|xmlport|tableextension|pageextension)\s+\d+\s+([a-zA-Z0-9_"]+)/gm;
    let match;
    while ((match = objectRegex.exec(text)) !== null) {
        let objName = match[2].replace(/"/g, '');
        if (!objName.startsWith(objectPrefix)) {
            createDiagnostic(match, objName, `Object name '${objName}' must start with the configured prefix: '${objectPrefix}'`, document, diagnostics);
        }
    }

    // -------------------------------------------------------------------------
    // 2. PROCEDURE NAME VALIDATION
    // -------------------------------------------------------------------------
    const procRegex = /(?:local\s+|internal\s+)?procedure\s+([a-zA-Z0-9_]+)\(/gm;
    const procStyle = namingStyles['procedure'] || 'snake_case';
    while ((match = procRegex.exec(text)) !== null) {
        const procName = match[1];
        if (!checkNamingStyle(procName, procStyle)) {
            createDiagnostic(match, procName, `Procedure name '${procName}' must comply with ${procStyle} formatting`, document, diagnostics);
        }
    }

    // -------------------------------------------------------------------------
    // 3. PARAMETER VALIDATION (Utilizing Dynamic Temp Configuration)
    // -------------------------------------------------------------------------
    const paramBlockRegex = /procedure\s+[a-zA-Z0-9_]+\(([^)]*)\)/gm;
    const paramStyle = namingStyles['parameter'] || 'snake_case';
    while ((match = paramBlockRegex.exec(text)) !== null) {
        const paramBlock = match[1];
        if (!paramBlock.trim()) continue;

        const params = paramBlock.split(';');
        params.forEach(param => {
            const parts = param.split(':');
            if (parts.length === 2) {
                let pName = parts[0].replace(/var\s+/i, '').trim();
                let fullTypeString = parts[1].trim();
                
                const isTemp = /\btemporary\b/i.test(fullTypeString);
                let pType = fullTypeString.split(' ')[0].split('[')[0].replace(/"/g, '');

                const shortType = getShortType(pType);
                // Dynamically applies configured temporary prefix structure
                const expectedPrefix = isTemp ? `p${tempMiddleFix}${shortType}_` : `p${shortType}_`;
                const remainName = pName.substring(expectedPrefix.length);

                if (!pName.startsWith(expectedPrefix) || !checkNamingStyle(remainName, paramStyle)) {
                    const startOffset = match.index + match[0].indexOf(pName);
                    const range = new vscode.Range(document.positionAt(startOffset), document.positionAt(startOffset + pName.length));
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `AL Convention: Parameter '${pName}' must use the format: '${expectedPrefix}${paramStyle}'`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        });
    }

    // -------------------------------------------------------------------------
    // 4. LOCAL & GLOBAL VARIABLES VALIDATION (Utilizing Dynamic Temp Configuration)
    // -------------------------------------------------------------------------
    const lines = text.split('\n');
    const localVarStyle = namingStyles['local_variable'] || 'snake_case';
    const globalVarStyle = namingStyles['global_variable'] || 'snake_case';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
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

            const isLocal = line.search(/\S/) > 4; 
            const prefixChar = isLocal ? 'l' : 'g';
            const currentStyle = isLocal ? localVarStyle : globalVarStyle;
            
            // Dynamically applies configured temporary prefix structure
            const expectedPrefix = isTemp ? `${prefixChar}${tempMiddleFix}${shortType}_` : `${prefixChar}${shortType}_`;
            const remainName = vName.substring(expectedPrefix.length);

            if (!vName.startsWith(expectedPrefix) || !checkNamingStyle(remainName, currentStyle)) {
                const startChar = line.indexOf(vName);
                const range = new vscode.Range(new vscode.Position(i, startChar), new vscode.Position(i, startChar + vName.length));
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `AL Convention: ${isLocal ? 'Local' : 'Global'} variable '${vName}' must use the format: '${expectedPrefix}${currentStyle}'`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    collection.set(document.uri, diagnostics);
}

function createDiagnostic(match, targetString, message, document, diagnostics) {
    const startPos = document.positionAt(match.index + match[0].indexOf(targetString));
    const endPos = document.positionAt(match.index + match[0].indexOf(targetString) + targetString.length);
    const range = new vscode.Range(startPos, endPos);
    diagnostics.push(new vscode.Diagnostic(range, `AL Convention: ${message}`, vscode.DiagnosticSeverity.Warning));
}

function deactivate() {}

module.exports = { activate, deactivate };
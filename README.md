# AL Team Convention

A Visual Studio Code extension designed to enforce and automatically fix naming conventions in AL (Dynamics 365 Business Central) projects. It helps your team maintain a consistent, clean, and readable codebase effortlessly.

## Features

- **Object Naming Validation**: Ensures all AL objects (Tables, Pages, Codeunits, Reports, etc.) start with a mandatory team prefix.
- **Variable & Parameter Naming**: Validates naming styles (e.g., `PascalCase`, `camelCase`, `snake_case`) for global variables, local variables, and parameters.
- **Smart Type Abbreviations**: Automatically checks if variables include their short type abbreviations (e.g., `rec` for Record, `cu` for Codeunit, `jso` for JsonObject, `jst` for JsonToken) based on your team's custom mapping.
- **Scope & Temporary Indicators**: Enforces correct prefixes for scopes (`g` for global, `l` for local, `p` for parameters) and temporary states (e.g., `temp`).
- **Quick Fixes (Code Actions)**: Provides 1-click Quick Fixes to automatically rename non-compliant variables, parameters, and procedures across your document using VS Code's native rename provider.

## Extension Settings

This extension contributes the following settings that can be configured in your `settings.json`:

| Field | Default Value | Description |
|-------|---------------|-------------|
| `alConvention.alObjectPrefix` | `"ATL_"` | Mandatory prefix for AL Objects (Table, Page, Codeunit, etc.). |
| `alConvention.namingStyle` | `{...}` | Define naming styles for each component type (`procedure`, `parameter`, `local_variable`, `global_variable`). Options: `PascalCase`, `camelCase`, `snake_case`. |
| `alConvention.showShortTypeInName` | `true` | Toggle to include or exclude short type names inside variables/parameters. |
| `alConvention.typeAbbreviations` | `{...}` | Customize short type abbreviations mapping used for prefixes (e.g., `"Record": "rec"`, `"Codeunit": "cu"`, `"JsonObject": "jso"`). |
| `alConvention.scopePrefixes` | `{...}` | Prefix indicators for different scopes (e.g., `p` for ProcedureParameter, `g` for globalVariable, `l` for localVariable). |
| `alConvention.temporaryRecordPrefix` | `"temp"` | Prefix indicator for temporary records. |
| `alConvention.temporaryPrefixBeforeScope` | `true` | If `true`, placed before scope (e.g., `TempgItem`). If `false`, placed after (e.g., `gTempItem`). |

### Default Type Abbreviations

| AL Type | Abbreviation |
| :--- | :--- |
| **Record** | `rec` |
| **Page** | `pag` |
| **Codeunit** | `cu` |
| **Query** | `que` |
| **Report** | `rep` |
| **Integer** | `int` |
| **Text** | `txt` |
| **Code** | `cod` |
| **Boolean** | `boo` |
| **Decimal** | `dec` |
| **XmlPort** | `xml` |
| **JsonObject** | `jso` |
| **JsonArray** | `jsa` |
| **Dictionary** | `dic` |
| **List** | `lst` |
| **JsonToken** | `jst` |
| **Date** | `dat` |
| **DateTime** | `dtm` |
| **Time** | `tim` |

## How to Use

1. Open any `.al` file in your workspace.
2. The extension will automatically analyze the code on the fly and highlight any naming convention violations with yellow warnings.
3. Hover over the warning to see the suggested compliant name.
4. Click **Quick Fix** (or press `Ctrl+.` / `Cmd+.`) to safely and automatically rename the identifier across your entire document.

## Customizing for your Team

You can easily share these settings with your team by adding them to your workspace's `.vscode/settings.json` file:

```json
{
    "alConvention.alObjectPrefix": "MY_PREFIX_",
    "alConvention.temporaryRecordPrefix": "tmp",
    "alConvention.temporaryPrefixBeforeScope": false
}
```

## Requirements

- VS Code `^1.85.0` or higher.
- AL Language extension for Dynamics 365 Business Central.

---
*Built with ❤️ to keep your AL codebase clean.*
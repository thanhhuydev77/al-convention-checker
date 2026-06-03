# AL Advanced Naming Convention Checker

A powerful, customizable VS Code extension designed to enforce strict coding conventions for the AL Language (Dynamics 365 Business Central). It scans your code in real-time, provides clear diagnostic feedback on naming conventions, and supports Quick Fixes (including auto-renaming related symbols).

## Features

- **Object Prefix Verification:** Mandates custom prefixes (e.g., `ATL_`) for all AL objects (Table, Page, Codeunit, Report, Query, XMLPort, TableExtension, PageExtension).
- **Flexible Naming Styles:** Enforces specific casing (`PascalCase`, `camelCase`, `snake_case`) independently for procedures, parameters, local variables, and global variables.
- **Hungarian Notation Support:** Automatically checks for variable declarations combining scope prefixes (`p` for parameters, `l` for locals, `g` for globals) and configured short data-type prefixes (e.g., `rec`, `int`, `txt`).
- **Smart Temporary Variable Isolation:** Dynamically recognizes inline `temporary` strings or `IsTemporary = true;` configurations and enforces custom temporary prefixes.
- **Quick Fix & Rename Provider:** Instantly fix naming issues directly from the code editor. It integrates with VS Code's Rename Provider to safely rename variable references across your workspace.

## Extension Settings

You can customize this extension via your standard VS Code `settings.json` file. Here are the available configuration properties:

### 1. Object Prefix
* **`alConvention.objectPrefixText`**  
  **Type:** `string` | **Default:** `"ATL_"`  
  Mandatory prefix for AL Objects (Table, Page, Codeunit, etc.).

### 2. Naming Styles
* **`alConvention.NamingStyle`**  
  **Type:** `object`  
  Define the naming style (`PascalCase`, `camelCase`, `snake_case`) for each component type.  
  *Default:*
  ```json
  "alConvention.NamingStyle": {
      "procedure": "PascalCase",
      "parameter": "PascalCase",
      "local_variable": "PascalCase",
      "global_variable": "PascalCase"
  }
  ```

### 3. Variable/Parameter Configuration
* **`alConvention.ProcedureParameter.ShowTypeInName`**  
  **Type:** `boolean` | **Default:** `true`  
  Toggle to include or exclude the short type name (e.g., `rec`, `int`) inside variables/parameters.

* **`alConvention.ProcedureParameter.TypeName`**  
  **Type:** `object`  
  Short type abbreviations mapping used for prefixes. Modify this to match your team's standard.  
  *Default:*
  ```json
  "alConvention.ProcedureParameter.TypeName": {
      "Record": "rec", "Page": "pag", "Codeunit": "cu", 
      "Query": "que", "Report": "rep", "Integer": "int", 
      "Text": "txt", "Code": "cod", "Boolean": "boo", "Decimal": "dec"
  }
  ```

* **`alConvention.ObjectPrefix`**  
  **Type:** `object`  
  Prefix indicators for scopes (global, local, parameter) and temporary states.  
  *Default:*
  ```json
  "alConvention.ObjectPrefix": {
      "ProcedureParameter": "p",
      "temporaryPrefix": "temp",
      "globalVariablePrefix": "g",
      "localVariablePrefix": "l"
  }
  ```

## Example Configuration in `settings.json`

To customize the extension for a specific project workspace, open the `.vscode/settings.json` file in your project and add your rules. For example:

```json
{
    "alConvention.objectPrefixText": "MYAPP_",
    "alConvention.NamingStyle": {
        "procedure": "camelCase",
        "parameter": "camelCase",
        "local_variable": "camelCase",
        "global_variable": "PascalCase"
    },
    "alConvention.ProcedureParameter.ShowTypeInName": true,
    "alConvention.ObjectPrefix": {
        "ProcedureParameter": "p",
        "temporaryPrefix": "Temp",
        "globalVariablePrefix": "G",
        "localVariablePrefix": "L"
    }
}
```

## Example Code Layout

With the default configuration, your AL code should look something like this:

```al
codeunit 50100 ATL_MyMgtCodeunit 
{
    var
        GTempRecCustomer: Record Customer temporary; // Valid temporary global (PascalCase)
        GRecVendor: Record Vendor;                   // Valid regular global (PascalCase)

    procedure CalculateTotals(PTempRecInvoice: Record "Sales Header" temporary)
    var
        LIntLoopCounter: Integer;                    // Valid local variable (PascalCase)
    begin
    end;
}
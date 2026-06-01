# AL Advanced Naming Convention Checker

A powerful, customizable VS Code extension designed to enforce strict coding conventions for the AL Language (Dynamics 365 Business Central). It scans your code in real-time and provides clear diagnostic feedback on naming conventions.

## Features

- **Object Prefix Verification:** Mandates custom prefixes (e.g., `ATL_`) for tables, pages, codeunits, reports, queries, and xmlports.
- **Procedure Case Styling:** Ensures procedure names comply with your team's preferred casing format (e.g., `snake_case`).
- **Hungarian Notation Scope & Type Mapping:** Automates checks for variable declarations combining scope prefixes (`p` for parameters, `l` for locals, `g` for globals) and configured short data-type prefixes (e.g., `rec`, `int`, `txt`).
- **Smart Temporary Variable Isolation:** Dynamically recognizes inline `temporary` strings or `IsTemporary = true;` parameters and enforces custom temporary infixes (e.g., `gtemp_rec_customer`).

## Extension Settings

You can customize this extension via your standard VS Code `settings.json` file under the following properties:

* `alConvention.objectPrefix`: Set the required prefix for your AL objects. (Default: `"ATL_"`)
* `alConvention.temporaryPrefix`: Set the variable keyword marker for temporary data. (Default: `"temp"`)
* `alConvention.typeMapping`: An object mapping full AL types to your custom short prefixes.
* `alConvention.namingStyles`: Define format rules (`snake_case`, `camelCase`, `PascalCase`) independently for procedures, parameters, local variables, and global variables.

## Example Layout

```al
codeunit 50100 ATL_MyMgtCodeunit 
{
    var
        gtemp_rec_customer: Record Customer temporary; // Valid temporary global
        grec_vendor: Record Vendor;                    // Valid regular global

    procedure calculate_totals(ptemp_rec_invoice: Record "Sales Header" temporary)
    var
        lint_loop_counter: Integer;                    // Valid snake_case local
    begin
    end;
}
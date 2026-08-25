# @vouchington/csv

CSV parsing and safe serialization for Node.js 24+. `parseCsvRows` accepts UTF-8 BOM input and
rejects inconsistent row widths. `stringifyCsvRows` and `streamCsvRows` require declared columns,
ignore undeclared fields, and prefix spreadsheet formula cells with an apostrophe.
